import { pushService } from "../lib/notifications";
import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
} from "react";
import { ACCOUNT_KEYS, type CustomerData } from "./data";
export interface CustomerUser {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  phone: string;
  createdAt: string;
  marketing: boolean;
  legalVersion: string;
  providers: string[];
}
export interface PublicAuthConfig {
  simulation?: boolean;
  configured: boolean;
  registrationEnabled: boolean;
  email: boolean;
  google: boolean;
  apple: boolean;
  legalVersion: string;
  legalStatus: string;
  notice: string;
}
let activeAccountId: string | null = null;
export async function customerRequest(
  path: string,
  body?: unknown,
  method = body === undefined ? "GET" : "POST",
  expectedAccountId = activeAccountId,
) {
  if (
    !path.startsWith("/api/customer/") &&
    !path.startsWith("/api/customer-auth/")
  )
    throw Error("Ruta de cuenta inválida");
  const response = await fetch(path, {
    method,
    credentials: "same-origin",
    cache: "no-store",
    headers: {
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(expectedAccountId ? { "X-Customer-Id": expectedAccountId } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = await response.json();
  if (!response.ok) {
    const error = new Error(
      data.error?.message ||
        data.error ||
        data.message ||
        "No se pudo completar la solicitud",
    ) as Error & { status: number; code: string };
    error.status = response.status;
    error.code = data.code;
    throw error;
  }
  return data;
}
/** Account-scoped memory; no auth tokens or commercial data are stored in localStorage. */
export class AccountStorage {
  private listeners = new Set<() => void>();
  private running = false;
  private dirty = false;
  private version = 0;
  private state = { pending: false, error: "" };
  constructor(
    public readonly userId: string,
    private payload: CustomerData,
    private revision: number,
  ) {}
  getItem = (key: string) => this.payload[key] ?? null;
  getSnapshot = () => this.state;
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  private emit(pending: boolean, error = "") {
    this.state = { pending, error };
    this.listeners.forEach((fn) => fn());
  }
  setItem = (key: string, value: string) => {
    if (!ACCOUNT_KEYS.includes(key as any))
      throw Error("Clave de cuenta no autorizada");
    if (this.payload[key] === value) return;
    this.payload = { ...this.payload, [key]: value };
    this.version++;
    this.dirty = true;
    this.emit(true);
    void this.flush();
  };
  flush = async () => {
    if (this.running) return;
    this.running = true;
    try {
      while (this.dirty) {
        const version = this.version,
          payload = { ...this.payload };
        const result = await customerRequest(
          "/api/customer/data",
          { payload, revision: this.revision },
          "PUT",
          this.userId,
        );
        this.revision = result.revision;
        this.dirty = version !== this.version;
      }
      this.emit(false);
    } catch (e: any) {
      this.emit(false, e.message);
    } finally {
      this.running = false;
    }
  };
  hasUnsaved = () => this.dirty;
  exportPending = () =>
    JSON.stringify(
      { version: 1, accountId: this.userId, payload: this.payload },
      null,
      2,
    );
  discardAfterBackup = () => {
    this.dirty = false;
    this.emit(false);
  };
}
const Context = createContext<{
  user: CustomerUser | null;
  config: PublicAuthConfig | null;
  storage: Pick<Storage, "getItem" | "setItem"> | undefined;
  refresh: () => Promise<void>;
  loading: boolean;
  error: string;
  accountStorage: AccountStorage | null;
}>({
  user: null,
  config: null,
  storage: undefined,
  refresh: async () => {},
  loading: false,
  error: "",
  accountStorage: null,
});
export const useCustomer = () => useContext(Context);
export function guestStorage() {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}
export function CustomerProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<CustomerUser | null>(null),
    [config, setConfig] = useState<PublicAuthConfig | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [accountStorage, setStorage] = useState<AccountStorage | null>(null);
  const refresh = async () => {
    try {
      const [configuration, session] = await Promise.all([
        customerRequest("/api/customer/config"),
        customerRequest("/api/customer/me"),
      ]);
      setConfig(configuration);
      activeAccountId = session.user?.emailVerified ? session.user.id : null;
      pushService.setCustomerScope(activeAccountId);
      if (session.user?.emailVerified) {
        if (session.user.id !== user?.id || !accountStorage) {
          setLoading(true);
          const data = await customerRequest("/api/customer/data");
          setStorage(
            new AccountStorage(session.user.id, data.payload, data.revision),
          );
        }
        setUser(session.user);
      } else {
        setUser(null);
        setStorage(null);
      }
      setError("");
    } catch (e: any) {
      activeAccountId = null;
      pushService.setCustomerScope(null);
      setUser(null);
      setStorage(null);
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void refresh();
  }, []);
  useEffect(() => {
    // Revalidate on focus without unmounting forms or the catalog when the same session is still valid.
    const recheck = () => {
      if (!accountStorage?.hasUnsaved()) void refresh();
    };
    window.addEventListener("focus", recheck);
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") recheck();
    }, 300000);
    return () => {
      window.removeEventListener("focus", recheck);
      window.clearInterval(timer);
    };
  }, [user?.id, accountStorage]);
  useEffect(() => {
    const before = (event: BeforeUnloadEvent) => {
      if (accountStorage?.hasUnsaved()) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", before);
    return () => window.removeEventListener("beforeunload", before);
  }, [accountStorage]);
  return (
    <Context.Provider
      value={{
        user,
        config,
        storage: accountStorage || guestStorage(),
        refresh,
        loading,
        error,
        accountStorage,
      }}
    >
      {loading ? (
        <main
          className="min-h-screen grid place-items-center bg-white text-red-700"
          role="status"
        >
          Comprobando tu sesión de BOLT…
        </main>
      ) : (
        <React.Fragment key={user?.id || "guest"}>
          {config?.simulation && (
            <p
              role="status"
              className="bg-yellow-100 text-amber-950 text-center text-xs p-2"
            >
              Simulación local de cuentas · datos ficticios y correos
              capturados, sin envío real.
            </p>
          )}
          {error && (
            <p role="alert" className="bg-amber-50 p-4 text-amber-900">
              No pudimos comprobar tu cuenta. {error}{" "}
              <button onClick={() => void refresh()} className="underline">
                Reintentar
              </button>
            </p>
          )}
          {accountStorage && <SyncNotice storage={accountStorage} />}
          {children}
        </React.Fragment>
      )}
    </Context.Provider>
  );
}
function SyncNotice({ storage }: { storage: AccountStorage }) {
  const state = useSyncExternalStore(
    storage.subscribe,
    storage.getSnapshot,
    storage.getSnapshot,
  );
  const [backedUp, setBackedUp] = useState(false);
  const backup = () => {
    const url = URL.createObjectURL(
      new Blob([storage.exportPending()], { type: "application/json" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = "bolt-selecciones-pendientes.json";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setBackedUp(true);
  };
  return state.error ? (
    <div role="alert" className="bg-amber-50 p-4 text-amber-900">
      {state.error} Tus cambios locales siguen abiertos; no cierres esta página.{" "}
      <button className="underline" onClick={() => void storage.flush()}>
        Reintentar guardado
      </button>{" "}
      <button className="underline min-h-11 ml-3" onClick={backup}>
        Descargar mis selecciones pendientes
      </button>
      {backedUp && (
        <button
          className="underline min-h-11 ml-3"
          onClick={() => {
            storage.discardAfterBackup();
            window.location.reload();
          }}
        >
          Cargar versión guardada del servidor
        </button>
      )}
      <p className="text-sm">
        Si hubo cambios en otro dispositivo, descarga primero tus selecciones
        para conservarlas. Después puedes cargar la versión del servidor y
        revisar las diferencias.
      </p>
    </div>
  ) : state.pending ? (
    <p role="status" className="text-center text-xs p-1 bg-yellow-50">
      Guardando tus selecciones en la cuenta…
    </p>
  ) : null;
}
