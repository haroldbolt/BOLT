import React, { useCallback, useEffect, useState } from "react";
import { api } from "../../lib/api";
import { dispatchClient } from "../../lib/dispatchClient";
import { useDispatchQuery, useDispatchAction } from "./useDispatchQuery";
import {
  control,
  primary,
  Status,
  Feedback,
  SimulationBanner,
} from "./DispatchUi";
export function DispatchSimulation() {
  const [info, setInfo] = useState<any>(null),
    [enabled, setEnabled] = useState(!!api.getStoredAdminToken()),
    [initError, setInitError] = useState("");
  useEffect(() => {
    dispatchClient
      .simulationInfo()
      .then(setInfo)
      .catch((e) => setInitError(e.message));
  }, []);
  const load = useCallback(async () => {
      const [simulation, dispatch] = await Promise.all([
        dispatchClient.simulation(),
        dispatchClient.admin(),
      ]);
      for (const o of simulation.orders)
        api.saveOrderAccess(o.id, o.guestAccessToken);
      return { simulation, dispatch };
    }, []),
    q = useDispatchQuery(load, enabled && info?.enabled === true),
    a = useDispatchAction(q.refresh);
  if (info && !info.enabled)
    return (
      <main className="p-8">
        La simulación está desactivada en esta instancia.{" "}
        <a className="underline" href="/">
          Volver a BOLT
        </a>
      </main>
    );
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <SimulationBanner />
      <main className="max-w-6xl mx-auto p-5 space-y-5">
        <h1 className="text-3xl font-black">
          Prueba de asignación y seguimiento
        </h1>
        <p>
          Compra ficticia de tres bolsas cerradas de 20 kg: dos entregas, de 40
          kg y 20 kg, desde Suba. Vehículos ficticios de 55 kg y 80 × 60 × 60
          cm. Sin límite fijo de repartidores por compra. Esta prueba no
          confirma disponibilidad operativa real.
        </p>
        <Feedback error={initError || a.error || q.error} notice={a.notice} />
        {info?.enabled && (
          <>
            <div className="flex flex-wrap gap-3">
              <button
                className={primary}
                disabled={a.busy}
                onClick={() =>
                  void a.run(async () => {
                    await api.loginAdmin(info.admin.email, info.admin.password);
                    setEnabled(true);
                  }, "Sesión administrativa de prueba iniciada")
                }
              >
                Ingresar a la simulación
              </button>
              <a
                className={control}
                href="/operacion?tab=DESPACHOS"
                target="_blank"
                rel="noopener"
              >
                Administración
              </a>
              <a
                className={control}
                href="/conductor"
                target="_blank"
                rel="noopener"
              >
                BOLT Conductor
              </a>
            </div>
            <details className="bg-white border rounded-2xl p-4">
              <summary className="font-bold cursor-pointer">
                Cuentas ficticias de conductor
              </summary>
              <p className="text-sm my-2">
                Cada pestaña mantiene su propia sesión de conductor.
              </p>
              {info.drivers.map((d: any) => (
                <div key={d.id} className="py-3 border-t">
                  <strong>{d.name}</strong>
                  <p className="text-sm break-all">{d.email}</p>
                  <code className="text-sm break-all">{d.password}</code>
                </div>
              ))}
            </details>
          </>
        )}
        {q.data && (
          <>
            <section className="bg-white border rounded-2xl p-5 space-y-4">
              <h2 className="font-black text-xl">
                1. Preparar disponibilidad ficticia
              </h2>
              <p className="text-sm">
                Activa los conductores libres y renueva sus posiciones de
                prueba. Los ocupados conservan su tarea. Las ubicaciones vuelven
                a vencer si no se actualizan.
              </p>
              <div className="flex flex-wrap gap-2">
                {[2, 1, 0].map((count) => (
                  <button
                    key={count}
                    className={control}
                    disabled={a.busy}
                    onClick={() =>
                      void a.run(
                        () =>
                          dispatchClient.simulation("/fleet", "POST", {
                            count,
                          }),
                        `${count} conductores libres habilitados`,
                      )
                    }
                  >
                    {count} conductores propios
                  </button>
                ))}
              </div>
              <div className="flex flex-wrap gap-2">
                {[
                  ["OFF", "Externo desactivado"],
                  ["ACCEPT", "Externo acepta"],
                  ["DELAY", "Externo demora"],
                  ["REJECT", "Externo rechaza"],
                ].map(([mode, label]) => (
                  <button
                    key={mode}
                    className={control}
                    disabled={a.busy}
                    onClick={() =>
                      void a.run(
                        () =>
                          dispatchClient.simulation("/provider", "POST", {
                            mode: mode === "OFF" ? "ACCEPT" : mode,
                            enabled: mode !== "OFF",
                          }),
                        "Respuesta externa simulada configurada",
                      )
                    }
                  >
                    {label}
                  </button>
                ))}
              </div>
              <p className="text-sm">
                Proveedor ficticio:{" "}
                {q.data.simulation.provider.enabled
                  ? q.data.simulation.provider.mode
                  : "Desactivado"}
                . Rappi e inDrive reales siguen desactivados.
              </p>
              <h2 className="font-black text-xl">2. Crear compra de prueba</h2>
              <p className="text-sm">
                Total ficticio: $36.400 COP, incluido transporte y servicio. El
                botón crea una compra nueva solo en esta instancia. Después,
                marca sus entregas en alistamiento y listas en administración.
              </p>
              <button
                className={primary}
                disabled={a.busy}
                onClick={() =>
                  void a.run(async () => {
                    let key = sessionStorage.getItem("bolt_simulation_request");
                    if (!key) {
                      key = crypto.randomUUID();
                      sessionStorage.setItem("bolt_simulation_request", key);
                    }
                    const r = await dispatchClient.simulation(
                      "/purchases",
                      "POST",
                      { requestId: key },
                    );
                    api.saveOrderAccess(r.order.id, r.guestAccessToken);
                    sessionStorage.removeItem("bolt_simulation_request");
                  }, "Compra ficticia creada; abre sus paneles")
                }
              >
                Crear compra de prueba · $36.400
              </button>
            </section>
            <section className="bg-white border rounded-2xl p-5 space-y-4">
              <h2 className="text-xl font-black">
                3. Revisar las compras y sus entregas
              </h2>
              {[...q.data.simulation.orders].reverse().map((o: any) => (
                <div
                  key={o.id}
                  className="flex flex-wrap justify-between gap-3 border-t pt-3"
                >
                  <div>
                    <strong>{o.code}</strong> · <Status value={o.status} />
                  </div>
                  <a
                    className={control}
                    href={"/simulacion/cliente/" + o.id}
                    target="_blank"
                    rel="noopener"
                  >
                    Cliente · {o.code}
                  </a>
                </div>
              ))}
              <p className="text-sm">
                En Conductor: inicia sesión, acepta la oferta, confirma recogida
                y solicita al cliente el PIN de esa entrega. Para probar la
                ubicación, pulsa “Enviar ubicación simulada”.
              </p>
              <p className="text-sm">
                Ofertas de prueba: 120 segundos. Producción conserva su
                parámetro. Ninguna entrega se crea al consultar o actualizar
                estas pantallas.
              </p>
            </section>
            <section className="bg-white border rounded-2xl p-5 space-y-3">
              <h2 className="font-black">Controles de eventos simulados</h2>
              {q.data.dispatch.orders
                .flatMap((o) => o.dispatches)
                .map((d) => (
                  <div key={d.id} className="border-t pt-3 space-y-2">
                    <strong>{d.code}</strong> <Status value={d.status} />
                    <div className="flex flex-wrap gap-2">
                      {d.offers
                        .filter((o) => o.status === "PENDING")
                        .map((o) => (
                          <button
                            key={o.id}
                            className={control}
                            disabled={a.busy}
                            onClick={() =>
                              void a.run(
                                () =>
                                  dispatchClient.simulation("/expire", "POST", {
                                    offerId: o.id,
                                  }),
                                "Oferta vencida en simulación",
                              )
                            }
                          >
                            Vencer oferta
                          </button>
                        ))}
                      {d.external?.status === "UNKNOWN" &&
                        [true, false].map((accept) => (
                          <button
                            key={String(accept)}
                            className={control}
                            disabled={a.busy}
                            onClick={() =>
                              void a.run(
                                () =>
                                  dispatchClient.simulation(
                                    "/resolve",
                                    "POST",
                                    { key: d.external!.key, accept },
                                  ),
                                "Respuesta tardía conciliada",
                              )
                            }
                          >
                            {accept
                              ? "Aceptar servicio con demora"
                              : "Rechazar servicio con demora"}
                          </button>
                        ))}
                      {d.external?.status === "ASSIGNED" &&
                        d.status === "ASSIGNED" && (
                          <button
                            className={control}
                            disabled={a.busy}
                            onClick={() =>
                              void a.run(
                                () =>
                                  dispatchClient.admin(
                                    "/" + d.id + "/simulate",
                                    "POST",
                                    { action: "pickup" },
                                  ),
                                "Recogida externa simulada",
                              )
                            }
                          >
                            Simular recogida externa
                          </button>
                        )}
                      {d.external?.status === "ASSIGNED" &&
                        d.status === "PICKED_UP" && (
                          <ExternalDelivery
                            id={d.id}
                            busy={a.busy}
                            submit={(pin) =>
                              void a.run(
                                () =>
                                  dispatchClient.admin(
                                    "/" + d.id + "/simulate",
                                    "POST",
                                    {
                                      action: "delivered",
                                      deliveryCode: pin,
                                      collectedCOP: 0,
                                    },
                                  ),
                                "Entrega externa simulada",
                              )
                            }
                          />
                        )}
                    </div>
                  </div>
                ))}
            </section>
          </>
        )}
      </main>
    </div>
  );
}
function ExternalDelivery({
  id,
  busy,
  submit,
}: {
  id: string;
  busy: boolean;
  submit: (pin: string) => void;
}) {
  const [pin, setPin] = useState("");
  return (
    <form
      className="flex gap-2 flex-wrap"
      onSubmit={(e) => {
        e.preventDefault();
        submit(pin);
      }}
    >
      <label className="text-sm">
        PIN de entrega ficticia
        <input
          className="border rounded-xl p-3 ml-2"
          inputMode="numeric"
          value={pin}
          onChange={(e) => setPin(e.target.value)}
          autoComplete="off"
          required
        />
      </label>
      <button disabled={busy} className={control}>
        Simular entrega externa
      </button>
    </form>
  );
}
