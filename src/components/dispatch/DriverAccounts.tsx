import React, { useEffect, useState } from "react";
import { api } from "../../lib/api";
import { dispatchClient } from "../../lib/dispatchClient";
import { field, primary, Feedback } from "./DispatchUi";
export function DriverAccounts({
  registered,
  refresh,
}: {
  registered: string[];
  refresh: () => Promise<unknown>;
}) {
  const [registry, setRegistry] = useState<any>(null),
    [id, setId] = useState(""),
    [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [storeIds, setStores] = useState<string[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  useEffect(() => {
    let cancelled = false;
    api
      .transportAdmin("transport")
      .then((d) => {
        if (!cancelled) setRegistry(d);
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return (
    <details className="bg-white rounded-2xl border p-5">
      <summary className="cursor-pointer font-bold">
        Vincular cuenta de BOLT Conductor
      </summary>
      <form
        className="space-y-3 mt-4"
        onSubmit={async (e) => {
          e.preventDefault();
          if (busy) return;
          setBusy(true);
          setError("");
          try {
            await dispatchClient.admin("/drivers", "POST", {
              driver: registry.drivers.find((d: any) => d.id === id),
              email,
              password,
              storeIds,
            });
            setPassword("");
            setMessage(
              "Cuenta creada. Configura el vehículo y entrega las credenciales por un canal seguro.",
            );
            await refresh();
          } catch (e: any) {
            setError(e.message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <Feedback error={error} notice={message} />
        <label className="block text-sm">
          Conductor del registro existente
          <select
            required
            className={field}
            value={id}
            onChange={(e) => setId(e.target.value)}
          >
            <option value="">Seleccionar conductor</option>
            {registry?.drivers
              .filter((d: any) => !registered.includes(d.id))
              .map((d: any) => (
                <option key={d.id} value={d.id}>
                  {d.name} · {d.id}
                </option>
              ))}
          </select>
        </label>
        <label className="block text-sm">
          Correo de acceso
          <input
            required
            type="email"
            className={field}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <label className="block text-sm">
          Contraseña inicial (mínimo 12 caracteres)
          <input
            required
            type="password"
            autoComplete="new-password"
            minLength={12}
            className={field}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <fieldset>
          <legend className="text-sm font-bold">Sedes autorizadas</legend>
          <div className="flex flex-wrap gap-4 py-3">
            {registry?.stores
              .filter((s: any) => s.isActive)
              .map((s: any) => (
                <label key={s.id} className="flex items-center gap-2 min-h-11">
                  <input
                    type="checkbox"
                    checked={storeIds.includes(s.id)}
                    onChange={(e) =>
                      setStores(
                        e.target.checked
                          ? [...storeIds, s.id]
                          : storeIds.filter((id) => id !== s.id),
                      )
                    }
                  />
                  {s.name}
                </label>
              ))}
          </div>
        </fieldset>
        <button className={primary} disabled={busy || !id || !storeIds.length}>
          Crear cuenta de conductor
        </button>
        <p className="text-xs text-slate-500">
          Crear una cuenta no inicia turno ni configura capacidades. Se conserva
          la identidad del conductor existente.
        </p>
      </form>
    </details>
  );
}
export function SettleDriver({
  id,
  busy,
  submit,
}: {
  id: string;
  busy: boolean;
  submit: (amount: number, receipt: string) => void;
}) {
  const [amount, setAmount] = useState(""),
    [receipt, setReceipt] = useState("");
  return (
    <details className="mt-2">
      <summary className="cursor-pointer text-sm font-bold">
        Registrar liquidación recibida
      </summary>
      <form
        className="flex flex-wrap gap-2 mt-2"
        onSubmit={(e) => {
          e.preventDefault();
          submit(Number(amount), receipt);
        }}
      >
        <label className="text-sm">
          Importe COP
          <input
            required
            type="number"
            min="1"
            step="1"
            className={field}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </label>
        <label className="text-sm">
          Número único del recibo
          <input
            required
            className={field}
            value={receipt}
            onChange={(e) => setReceipt(e.target.value)}
          />
        </label>
        <button className={primary} disabled={busy}>
          Registrar recibo
        </button>
      </form>
    </details>
  );
}
