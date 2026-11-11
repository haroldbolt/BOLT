import React, { useEffect, useState } from "react";
import {
  ArrowLeft,
  ShieldCheck,
  Mail,
  User,
  MapPin,
  Heart,
  Package,
  LogOut,
  Trash2,
} from "lucide-react";
import {
  BUSINESS,
  legalDocuments,
  LEGAL_VERSION,
  type LegalKind,
} from "./legal";
import { ACCOUNT_KEYS } from "./data";
import { customerRequest, useCustomer } from "./client";
import { api } from "../lib/api";
const button =
  "min-h-12 w-full rounded-2xl px-5 py-3 font-bold transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-600 disabled:opacity-45 disabled:cursor-not-allowed";
const input =
  "mt-1 w-full rounded-xl border border-slate-300 p-3 text-base bg-white";
function Frame({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-[#faf8f5] px-4 py-6 sm:py-10 text-slate-900">
      <div className="max-w-xl mx-auto">
        <a
          className="inline-flex min-h-11 items-center gap-2 text-red-700 font-semibold mb-4"
          href="/"
        >
          <ArrowLeft size={18} />
          Volver a BOLT
        </a>
        <div className="rounded-3xl bg-white border border-slate-100 shadow-sm p-5 sm:p-8">
          {children}
        </div>
        <footer className="text-xs text-center text-slate-600 flex flex-wrap justify-center gap-4 mt-6">
          <a href="/legal/terminos" className="underline">
            Términos
          </a>
          <a href="/legal/privacidad" className="underline">
            Privacidad
          </a>
          <a href="/eliminar-cuenta" className="underline">
            Eliminar cuenta
          </a>
        </footer>
      </div>
    </main>
  );
}
export function LegalPage({ kind }: { kind: LegalKind }) {
  const doc = legalDocuments[kind];
  const { config } = useCustomer();
  return (
    <Frame>
      <h1 className="text-3xl font-black">{doc.title}</h1>
      <p className="text-xs text-slate-500 mt-3">
        {BUSINESS.brand} · Versión {LEGAL_VERSION}
      </p>
      {config?.legalStatus !== "approved" && (
        <p
          role="status"
          className="rounded-xl bg-yellow-50 p-4 text-amber-900 my-5"
        >
          Borrador pendiente de revisión jurídica y aprobación empresarial. Aún
          no habilita registros reales.
        </p>
      )}
      <div className="space-y-6 mt-6">
        {doc.sections.map((section) => (
          <section key={section.title}>
            <h2 className="text-lg font-bold mb-2">{section.title}</h2>
            <p className="text-sm leading-7 text-slate-700">{section.text}</p>
          </section>
        ))}
      </div>
      {kind === "eliminacion" && (
        <a
          href="/cuenta?accion=eliminar"
          className={`${button} inline-block text-center bg-red-600 text-white mt-6`}
        >
          Iniciar solicitud de eliminación
        </a>
      )}
    </Frame>
  );
}
export function AccountPage() {
  const customer = useCustomer();
  const { user, config } = customer;
  const params = new URLSearchParams(window.location.search);
  const [mode, setMode] = useState(params.has("token") ? "reset" : "welcome"),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(
      params.has("error")
        ? "No se completó la autorización. Intenta nuevamente con tu método de acceso original."
        : params.has("eliminada")
          ? "Tu cuenta fue eliminada. Los registros sujetos a retención se conservan según la política."
          : params.has("verificado")
            ? "Correo verificado. Ya puedes iniciar sesión."
            : "",
    ),
    [failure, setFailure] = useState("");
  const [terms, setTerms] = useState(false),
    [privacy, setPrivacy] = useState(false),
    [marketing, setMarketing] = useState(false);
  const [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [name, setName] = useState("");
  const action = async (fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setNotice("");
    setFailure("");
    try {
      await fn();
    } catch (e: any) {
      setFailure(e.message);
    } finally {
      setBusy(false);
    }
  };
  const consent = { version: LEGAL_VERSION, terms, privacy, marketing };
  if (user && mode !== "reset") return <AccountHome />;
  const registering = mode === "register",
    canRegister = !!config?.registrationEnabled;
  const social = (provider: "google" | "apple") =>
    action(async () => {
      if (mode === "welcome") {
        setMode("register");
        return;
      }
      const result = await customerRequest(
        "/api/customer-auth/sign-in/social",
        {
          provider,
          callbackURL: "/cuenta",
          errorCallbackURL: "/cuenta?error=oauth",
          newUserCallbackURL: "/cuenta?importar=1",
          requestSignUp: registering,
          disableRedirect: true,
          ...(registering ? { additionalData: { legalConsent: consent } } : {}),
        },
      );
      if (!result.url)
        throw Error("El proveedor no devolvió una autorización válida.");
      // Only follow the provider redirect produced by the server; never a query-string return URL.
      const url = new URL(result.url);
      const allowed =
        provider === "google" ? "accounts.google.com" : "appleid.apple.com";
      if (url.protocol !== "https:" || url.hostname !== allowed)
        throw Error("Destino de autorización no permitido");
      window.location.assign(url.href);
    });
  return (
    <Frame>
      <div className="inline-flex items-center gap-2 text-red-600 font-black text-3xl">
        BOLT{" "}
        <span className="text-xs text-slate-500 font-semibold">
          by Agrocentro
        </span>
      </div>
      <h1 className="text-3xl sm:text-4xl font-black mt-6 leading-tight">
        {mode === "login"
          ? "Qué bueno verte de nuevo."
          : mode === "forgot"
            ? "Recupera tu acceso."
            : mode === "reset"
              ? "Elige una nueva contraseña."
              : "Todo para tu mascota, más rápido."}
      </h1>
      <p className="mt-3 text-slate-600 leading-relaxed">
        Crea tu cuenta y guarda tus direcciones, pedidos y productos favoritos
        en un solo lugar.
      </p>
      {notice && (
        <p role="status" className="bg-blue-50 p-4 rounded-xl my-4">
          {notice}
        </p>
      )}
      {failure && (
        <p role="alert" className="bg-red-50 text-red-800 p-4 rounded-xl my-4">
          {failure}
        </p>
      )}
      {!config?.configured && (
        <p
          role="status"
          className="bg-yellow-50 text-amber-900 rounded-xl p-4 my-5"
        >
          Estamos preparando el registro. Google, Apple y correo todavía no
          están configurados. Puedes explorar y comprar como invitado.
        </p>
      )}
      {registering && (
        <Consent
          terms={terms}
          privacy={privacy}
          marketing={marketing}
          onTerms={setTerms}
          onPrivacy={setPrivacy}
          onMarketing={setMarketing}
        />
      )}
      {(mode === "welcome" || registering || mode === "login") && (
        <div className="space-y-3 mt-6">
          <button
            disabled={
              busy ||
              !config?.google ||
              (registering && (!canRegister || !terms || !privacy))
            }
            onClick={() => void social("google")}
            className={`${button} border border-slate-300 bg-white`}
          >
            Continuar con Google{!config?.google && " · Próximamente"}
          </button>
          <button
            disabled={
              busy ||
              !config?.apple ||
              (registering && (!canRegister || !terms || !privacy))
            }
            onClick={() => void social("apple")}
            className={`${button} bg-slate-950 text-white`}
          >
            Continuar con Apple{!config?.apple && " · Próximamente"}
          </button>
          {mode === "welcome" && (
            <>
              <button
                onClick={() => {
                  setMode("register");
                  setFailure("");
                }}
                className={`${button} bg-red-600 text-white flex items-center justify-center gap-2`}
              >
                <Mail size={19} />
                Continuar con correo electrónico
              </button>
              <button
                onClick={() => setMode("login")}
                className={`${button} text-red-700 border border-red-200`}
              >
                Ya tengo cuenta
              </button>
            </>
          )}
        </div>
      )}
      {mode !== "welcome" && (
        <form
          className="space-y-4 mt-6"
          onSubmit={(e) => {
            e.preventDefault();
            void action(async () => {
              if (registering) {
                await customerRequest("/api/customer-auth/sign-up/email", {
                  name,
                  email,
                  password,
                  legalConsent: consent,
                  callbackURL: "/cuenta?verificado=1",
                });
                setNotice(
                  "Si el registro puede completarse, recibirás un correo para verificar tu cuenta. Revisa también spam.",
                );
              } else if (mode === "login") {
                await customerRequest("/api/customer-auth/sign-in/email", {
                  email,
                  password,
                  rememberMe: true,
                });
                await customer.refresh();
              } else if (mode === "forgot") {
                await customerRequest(
                  "/api/customer-auth/request-password-reset",
                  { email, redirectTo: "/cuenta" },
                );
                setNotice(
                  "Si existe una cuenta compatible, recibirás instrucciones para recuperar el acceso.",
                );
              } else {
                await customerRequest("/api/customer-auth/reset-password", {
                  token: params.get("token"),
                  newPassword: password,
                });
                history.replaceState(null, "", "/cuenta");
                setMode("login");
                setPassword("");
                setNotice("Contraseña actualizada. Inicia sesión nuevamente.");
              }
            });
          }}
        >
          {registering && (
            <label className="block text-sm font-semibold">
              Tu nombre
              <input
                className={input}
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoComplete="name"
                maxLength={100}
                required
              />
            </label>
          )}
          {mode !== "reset" && (
            <label className="block text-sm font-semibold">
              Correo electrónico
              <input
                className={input}
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                maxLength={254}
                required
              />
            </label>
          )}
          {mode !== "forgot" && (
            <label className="block text-sm font-semibold">
              Contraseña
              <input
                className={input}
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={
                  mode === "login" ? "current-password" : "new-password"
                }
                minLength={mode === "login" ? 1 : 12}
                maxLength={128}
                required
              />
              {mode !== "login" && (
                <span className="text-xs font-normal text-slate-500">
                  Al menos 12 caracteres. Puedes utilizar una frase.
                </span>
              )}
            </label>
          )}
          <button
            disabled={
              busy ||
              !config?.email ||
              (registering && (!canRegister || !terms || !privacy))
            }
            className={`${button} bg-red-600 text-white`}
          >
            {busy
              ? "Un momento…"
              : registering
                ? "Crear cuenta"
                : mode === "login"
                  ? "Iniciar sesión"
                  : mode === "forgot"
                    ? "Enviar instrucciones"
                    : "Guardar contraseña"}
          </button>
          {!config?.email && (
            <p className="text-sm text-slate-600">
              Acceso por correo pendiente de configuración.
            </p>
          )}
          {mode === "login" && (
            <button
              type="button"
              className="min-h-11 underline text-sm text-red-700"
              onClick={() => setMode("forgot")}
            >
              Olvidé mi contraseña
            </button>
          )}
          {!registering && mode !== "reset" && (
            <button
              type="button"
              className="block min-h-11 underline text-sm"
              onClick={() => setMode("register")}
            >
              Crear una cuenta nueva
            </button>
          )}
        </form>
      )}
      <a
        href="/"
        className="block text-center min-h-12 pt-4 font-semibold text-slate-600 mt-3 underline"
      >
        Explorar sin cuenta
      </a>
      <p className="text-xs text-slate-500 flex items-center gap-2 mt-4">
        <ShieldCheck size={16} />
        Tu información y tus pedidos son privados.
      </p>
    </Frame>
  );
}
function Consent(p: {
  terms: boolean;
  privacy: boolean;
  marketing: boolean;
  onTerms: (v: boolean) => void;
  onPrivacy: (v: boolean) => void;
  onMarketing: (v: boolean) => void;
}) {
  return (
    <fieldset className="space-y-4 text-sm mt-5">
      <legend className="font-bold mb-2">Antes de crear tu cuenta</legend>
      <label className="flex gap-3 items-start">
        <input
          type="checkbox"
          checked={p.terms}
          onChange={(e) => p.onTerms(e.target.checked)}
          className="size-5 shrink-0 accent-red-600"
        />{" "}
        <span>
          He leído y acepto los{" "}
          <a
            target="_blank"
            rel="noopener"
            className="underline text-red-700"
            href="/legal/terminos"
          >
            Términos y Condiciones
          </a>
          .
        </span>
      </label>
      <label className="flex gap-3 items-start">
        <input
          type="checkbox"
          checked={p.privacy}
          onChange={(e) => p.onPrivacy(e.target.checked)}
          className="size-5 shrink-0 accent-red-600"
        />
        <span>
          Autorizo el tratamiento de mis datos personales conforme a la{" "}
          <a
            target="_blank"
            rel="noopener"
            className="underline text-red-700"
            href="/legal/privacidad"
          >
            Política de Privacidad
          </a>
          .
        </span>
      </label>
      <label className="flex gap-3 items-start">
        <input
          type="checkbox"
          checked={p.marketing}
          onChange={(e) => p.onMarketing(e.target.checked)}
          className="size-5 shrink-0 accent-red-600"
        />
        <span>
          Quiero recibir promociones y novedades de Bolt.{" "}
          <span className="text-slate-500">Opcional.</span>
        </span>
      </label>
    </fieldset>
  );
}
function AccountHome() {
  const { user, refresh, accountStorage, config } = useCustomer();
  const [name, setName] = useState(user!.name),
    [phone, setPhone] = useState(user!.phone),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(
      new URLSearchParams(location.search).has("importado")
        ? "Datos de invitado importados. Los originales siguen en este dispositivo."
        : "",
    ),
    [error, setError] = useState(""),
    [newEmail, setNewEmail] = useState(""),
    [orders, setOrders] = useState<any[]>([]),
    [guestOrders, setGuestOrders] = useState<any[]>([]),
    [deleteOpen, setDeleteOpen] = useState(
      new URLSearchParams(location.search).get("accion") === "eliminar",
    );
  useEffect(() => {
    customerRequest("/api/customer/orders")
      .then(setOrders)
      .catch(() => setError("No pudimos consultar tus pedidos."));
    api
      .getGuestOrders()
      .then(setGuestOrders)
      .catch(() => {});
  }, []);
  const action = async (fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setNotice("");
    setError("");
    try {
      await fn();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  const migrate = () =>
    action(async () => {
      const payload: Record<string, string> = {};
      for (const key of ACCOUNT_KEYS) {
        const raw = localStorage.getItem(key);
        if (raw !== null) payload[key] = raw;
      }
      const fingerprint = Array.from(
        new Uint8Array(
          await crypto.subtle.digest(
            "SHA-256",
            new TextEncoder().encode(JSON.stringify(payload)),
          ),
        ),
      )
        .map((n) => n.toString(16).padStart(2, "0"))
        .join("");
      const importKey = `bolt_import_${user!.id}_${fingerprint}`;
      let importId = sessionStorage.getItem(importKey);
      if (!importId) {
        importId = crypto.randomUUID();
        sessionStorage.setItem(importKey, importId);
      }
      await customerRequest("/api/customer/import", { importId, payload });
      window.location.assign("/cuenta?importado=1");
    });
  return (
    <Frame>
      <p className="text-red-600 font-black">BOLT by Agrocentro</p>
      <h1 className="text-3xl font-black mt-4">Mi cuenta</h1>
      <p className="text-slate-600 mt-2 break-words">{user!.email}</p>
      {notice && (
        <p role="status" className="my-4 rounded-xl bg-blue-50 p-4">
          {notice}
        </p>
      )}
      {error && (
        <p role="alert" className="my-4 rounded-xl bg-red-50 p-4 text-red-800">
          {error}
        </p>
      )}
      <form
        className="space-y-4 mt-6"
        onSubmit={(e) => {
          e.preventDefault();
          void action(async () => {
            await customerRequest(
              "/api/customer/profile",
              { name, phone },
              "PATCH",
            );
            await refresh();
            setNotice("Datos guardados en tu cuenta.");
          });
        }}
      >
        <label className="block text-sm font-bold">
          Nombre
          <input
            className={input}
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            maxLength={100}
            autoComplete="name"
          />
        </label>
        <label className="block text-sm font-bold">
          Teléfono{" "}
          <span className="font-normal text-slate-500">(opcional)</span>
          <input
            className={input}
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            maxLength={30}
            autoComplete="tel"
            type="tel"
          />
        </label>
        <button disabled={busy} className={`${button} bg-red-600 text-white`}>
          Guardar mis datos
        </button>
      </form>
      <form
        className="mt-5 space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          void action(async () => {
            await customerRequest("/api/customer-auth/change-email", {
              newEmail,
              callbackURL: "/cuenta",
            });
            setNotice(
              "Confirma el cambio desde tu correo actual y después verifica el nuevo. Tu dirección no cambia hasta completar la verificación.",
            );
          });
        }}
      >
        <label className="block text-sm font-bold">
          Cambiar correo electrónico
          <input
            className={input}
            type="email"
            autoComplete="email"
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
            required
          />
        </label>
        <button
          disabled={busy || !config?.email}
          className={`${button} border border-slate-300`}
        >
          Solicitar cambio de correo
        </button>
      </form>
      <section className="mt-5 space-y-3">
        <h2 className="font-bold">Métodos de acceso</h2>
        <p className="text-sm text-slate-600">
          Métodos vinculados:{" "}
          {user!.providers
            ?.map((p) =>
              p === "credential"
                ? "Correo"
                : p === "apple"
                  ? "Apple"
                  : "Google",
            )
            .join(", ") || "Consulta pendiente"}
          . Un correo coincidente no vincula cuentas automáticamente.
        </p>
        {(["google", "apple"] as const)
          .filter((p) => !user!.providers?.includes(p))
          .map((provider) => (
            <button
              key={provider}
              disabled={busy || !config?.[provider]}
              className={`${button} border border-slate-300`}
              onClick={() =>
                void action(async () => {
                  const result = await customerRequest(
                    "/api/customer-auth/link-social",
                    {
                      provider,
                      callbackURL: "/cuenta",
                      errorCallbackURL: "/cuenta?error=oauth",
                    },
                  );
                  const url = new URL(result.url);
                  if (
                    url.protocol !== "https:" ||
                    url.hostname !==
                      (provider === "google"
                        ? "accounts.google.com"
                        : "appleid.apple.com")
                  )
                    throw Error("Destino no permitido");
                  window.location.assign(url.href);
                })
              }
            >
              Vincular {provider === "google" ? "Google" : "Apple"}
              {!config?.[provider] ? " · Próximamente" : ""}
            </button>
          ))}
      </section>
      <section className="border-y border-slate-100 py-5 my-6 space-y-3">
        <h2 className="font-bold">Tus datos, en tus dispositivos</h2>
        <p className="text-sm text-slate-600">
          Puedes importar el carrito, direcciones y listas de este navegador. No
          se borrarán los originales. Si una presentación está en ambos
          carritos, se conserva la mayor cantidad, sin sumarla dos veces.
        </p>
        <button
          disabled={busy || accountStorage?.hasUnsaved()}
          onClick={() => void migrate()}
          className={`${button} bg-yellow-100 text-red-900`}
        >
          Importar mis datos de invitado
        </button>
        <a
          href="/?cuenta=direcciones"
          className="flex gap-2 items-center min-h-12 text-red-700 font-bold"
        >
          <MapPin size={20} />
          Administrar mis direcciones
        </a>
        <a
          href="/?cuenta=favoritos"
          className="flex gap-2 items-center min-h-12 text-red-700 font-bold"
        >
          <Heart size={20} />
          Ver mis favoritos
        </a>
      </section>
      <section className="space-y-3">
        <h2 className="font-bold text-lg">Mis pedidos</h2>
        {orders.length === 0 ? (
          <p className="text-sm text-slate-600">
            Todavía no tienes pedidos vinculados.
          </p>
        ) : (
          orders.map((order) => (
            <a
              className="block border border-slate-200 p-4 rounded-xl text-sm"
              key={order.id}
              href={`/pedido/${encodeURIComponent(order.id)}`}
            >
              {order.purchaseCode || order.code || order.id} ·{" "}
              {order.fulfillmentStatus}
            </a>
          ))
        )}
        {guestOrders
          .filter((o) => !orders.some((x) => x.id === o.id))
          .map((order) => (
            <div className="border rounded-xl p-3 text-sm" key={order.id}>
              <p>
                Compra de invitado en este dispositivo:{" "}
                {order.purchaseCode || order.id}
              </p>
              <button
                disabled={busy}
                className="text-red-700 underline min-h-11"
                onClick={() =>
                  void action(async () => {
                    await api.linkGuestOrder(order.id);
                    setOrders(await customerRequest("/api/customer/orders"));
                    setNotice("Compra vinculada mediante su acceso privado.");
                  })
                }
              >
                Vincular esta compra a mi cuenta
              </button>
            </div>
          ))}
        <a
          href="/recuperar-seguimiento"
          className="underline text-sm text-red-700 block min-h-11 py-2"
        >
          Recuperar acceso privado a una compra anterior
        </a>
      </section>
      <section className="border-t mt-5 pt-5">
        <h2 className="font-bold mb-3">Comunicaciones</h2>
        <label className="flex gap-3 text-sm">
          <input
            type="checkbox"
            className="size-5 accent-red-600"
            checked={user!.marketing}
            disabled={busy}
            onChange={(e) => {
              const enabled = e.target.checked;
              void action(async () => {
                await customerRequest(
                  "/api/customer/communications",
                  { enabled },
                  "PUT",
                );
                await refresh();
                setNotice("Preferencia guardada.");
              });
            }}
          />
          Quiero recibir promociones y novedades de Bolt
        </label>
      </section>
      <button
        disabled={busy || accountStorage?.hasUnsaved()}
        className={`${button} border border-slate-300 mt-6 flex justify-center gap-2`}
        onClick={() =>
          void action(async () => {
            await customerRequest("/api/customer-auth/sign-out", {});
            await refresh();
          })
        }
      >
        <LogOut size={18} />
        Cerrar sesión
      </button>
      <button
        className="text-red-700 underline min-h-12 mt-3"
        onClick={() => setDeleteOpen(!deleteOpen)}
      >
        Eliminar cuenta permanentemente
      </button>
      {deleteOpen && (
        <section className="rounded-2xl bg-red-50 p-4 space-y-3">
          <h2 className="font-bold">Eliminar mi cuenta</h2>
          <p className="text-sm">
            Se eliminarán tu perfil, direcciones sincronizadas, favoritos y
            accesos. Los documentos comerciales sujetos a retención se conservan
            con acceso restringido. No se cancelan tus pedidos.{" "}
            <a className="underline" href="/legal/eliminacion">
              Consulta los detalles
            </a>
            .
          </p>
          <p className="text-sm">
            Te enviaremos un enlace privado a tu correo verificado para
            confirmar la solicitud.
          </p>
          <button
            disabled={busy || !config?.email}
            onClick={() =>
              void action(async () => {
                await customerRequest("/api/customer-auth/delete-user", {
                  callbackURL: "/cuenta?eliminada=1",
                });
                setNotice(
                  "Revisa tu correo para confirmar la eliminación. La solicitud aún no está completada.",
                );
              })
            }
            className={`${button} bg-red-700 text-white`}
          >
            Solicitar eliminación permanente
          </button>
        </section>
      )}
    </Frame>
  );
}
