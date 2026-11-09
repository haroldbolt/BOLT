import {OrderEntrancePhoto} from '../customer/OrderEntrancePhoto';
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  dispatchClient,
  driverSession,
  pickupText,
  type DriverAssignment,
  type DriverStatus,
} from "../../lib/dispatchClient";
import { formatCOP } from "../../lib/formatters";
import { useDispatchQuery, useDispatchAction } from "./useDispatchQuery";
import {
  control,
  primary,
  field,
  Status,
  Feedback,
  SimulationBanner,
} from "./DispatchUi";
const labels: Record<string, string> = {
  accept: "Aceptar oferta",
  reject: "Rechazar oferta",
  "arrived-hub": "Llegué a la bodega",
  pickup: "Confirmar recogida",
  delivered: "Confirmar entrega",
  incident: "Informar incidencia",
  release: "Confirmar liberación",
  "release-custody": "Liberar custodia",
  "accept-custody": "Recibir custodia",
};
function Task({
  task,
  busy,
  act,
}: {
  task: DriverAssignment;
  busy: boolean;
  act: (action: string, body?: any) => void;
}) {
  const [packages, setPackages] = useState(""),
    [pin, setPin] = useState(""),
    [cash, setCash] = useState(""),
    [incident, setIncident] = useState("");
  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-5 space-y-4">
      <div className="flex flex-wrap justify-between gap-2">
        <div>
          <p className="text-xs text-slate-500">Compra {task.purchaseCode}</p>
          <h2 className="font-black text-xl">{task.dispatchCode}</h2>
        </div>
        <Status value={task.status} />
      </div>
      {task.offer?.status === "PENDING" && (
        <p className="bg-blue-50 p-3 rounded-xl text-sm">
          Oferta hasta{" "}
          {new Date(task.offer.expiresAt).toLocaleTimeString("es-CO", {
            timeZone: "America/Bogota",
          })}
          . {pickupText(task.pickupEstimate)}.
        </p>
      )}
      <div>
        <h3 className="font-bold">
          Recoger en {task.warehouse?.name || "Sede pendiente"}
        </h3>
        <p className="text-sm text-slate-600">{task.warehouse?.address}</p>
      </div>
      <ul className="divide-y">
        {task.items.map((i, n) => (
          <li key={i.productId + "-" + n} className="py-2">
            {i.quantity} × {i.name}
            <span className="block text-sm text-slate-500">
              {i.presentation}
            </span>
          </li>
        ))}
      </ul>
      <p className="text-sm font-bold">
        {task.sellablePackages} unidades cerradas ·{" "}
        {task.weightGrams
          ? `${task.weightGrams / 1000} kg con embalaje`
          : "Peso pendiente"}{" "}
        · {task.volumeCm3 ? `${task.volumeCm3 / 1000} L` : "Volumen pendiente"}
      </p>
      {task.warnings.map((w) => (
        <p key={w} className="text-xs text-amber-800">
          {w}
        </p>
      ))}
      {task.destination && (
        <div className="bg-slate-50 p-3 rounded-xl">
          <h3 className="font-bold">Entregar en</h3>
          <p>{task.destination.address}</p>
          <p>{task.destination.details}</p>
          <OrderEntrancePhoto orderId={task.orderId} dispatchId={task.dispatchId} audience="driver"/>
          {task.customerPhone && (
            <a href={"tel:" + task.customerPhone} className="underline">
              Contactar al cliente
            </a>
          )}
        </div>
      )}
      <p className="font-bold">
        Recaudar en este despacho: {formatCOP(task.cashToCollect)}
      </p>
      {task.actions.includes("pickup") && (
        <label className="block text-sm">
          Unidades cerradas recibidas (confirma el conteo)
          <input
            className={field}
            type="number"
            min="0"
            value={packages}
            onChange={(e) => setPackages(e.target.value)}
          />
        </label>
      )}
      {task.actions.includes("delivered") && (
        <div className="space-y-3">
          <label className="block text-sm">
            PIN indicado por el cliente
            <input
              autoComplete="off"
              inputMode="numeric"
              className={field}
              value={pin}
              onChange={(e) => setPin(e.target.value)}
            />
          </label>
          <label className="block text-sm">
            Valor efectivamente recaudado (COP)
            <input
              className={field}
              type="number"
              min="0"
              value={cash}
              onChange={(e) => setCash(e.target.value)}
            />
          </label>
        </div>
      )}
      {task.actions.includes("incident") && (
        <label className="block text-sm">
          Motivo de incidencia
          <input
            className={field}
            value={incident}
            onChange={(e) => setIncident(e.target.value)}
            placeholder="Describe el problema"
          />
        </label>
      )}
      <div className="flex flex-wrap gap-2">
        {task.actions.map((action) => (
          <button
            key={action}
            disabled={
              busy ||
              (action === "pickup" && !packages) ||
              (action === "delivered" && (!pin || cash === "")) ||
              (action === "incident" && !incident.trim())
            }
            className={
              ["accept", "pickup", "delivered"].includes(action)
                ? primary
                : control
            }
            onClick={() =>
              act(action, {
                ...(task.offer ? { offerId: task.offer.id } : {}),
                ...(action === "pickup"
                  ? { sellablePackages: Number(packages) }
                  : {}),
                ...(action === "delivered"
                  ? { deliveryCode: pin, collectedCOP: Number(cash) }
                  : {}),
                ...(action === "incident" ? { type: incident } : {}),
              })
            }
          >
            {labels[action]}
          </button>
        ))}
      </div>
    </article>
  );
}
export function DriverPanel() {
  const [session, setSession] = useState(driverSession.get()),
    [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [simulation, setSimulation] = useState(false),
    [gps, setGps] = useState(false),
    [gpsMessage, setGpsMessage] = useState("");
  const load = useCallback(async () => {
    const [profile, tasks, settlement] = await Promise.all([
      dispatchClient.driver<DriverStatus>("profile"),
      dispatchClient.driver<{ assignments: DriverAssignment[] }>("assignments"),
      dispatchClient.driver<any>("settlement"),
    ]);
    return { profile, tasks: tasks.assignments, settlement };
  }, []);
  const q = useDispatchQuery(load, !!session),
    a = useDispatchAction(q.refresh);
  const current = useRef(q.data);
  current.current = q.data;
  const sequence = useRef(Date.now());
  useEffect(() => {
    dispatchClient
      .simulationInfo()
      .then((v) => setSimulation(!!v.enabled))
      .catch(() => {});
  }, []);
  useEffect(() => {
    if (!session) return;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible")
        dispatchClient.driver("heartbeat", "POST").catch(() => {});
    }, 20000);
    return () => clearInterval(timer);
  }, [session]);
  useEffect(() => {
    if (!gps || !session) return;
    let pending = false;
    const watch = navigator.geolocation.watchPosition(
      async (p) => {
        if (pending) return;
        pending = true;
        try {
          const task = current.current?.tasks.find(
            (t) => t.status === "PICKED_UP",
          );
          await dispatchClient.driver(task ? "gps" : "location", "POST", {
            latitude: p.coords.latitude,
            longitude: p.coords.longitude,
            accuracy: p.coords.accuracy,
            timestamp: p.timestamp,
            ...(task
              ? {
                  orderId: task.orderId,
                  shipmentId: task.shipmentId,
                  assignmentId: task.assignmentId,
                  tripId: task.tripId,
                  sequenceNumber: ++sequence.current,
                }
              : {}),
          });
          setGpsMessage(
            "Ubicación enviada " + new Date().toLocaleTimeString("es-CO"),
          );
        } catch (e: any) {
          setGpsMessage(e.message);
        } finally {
          pending = false;
        }
      },
      (e) => {
        setGpsMessage(e.message);
        setGps(false);
      },
      { enableHighAccuracy: true, maximumAge: 10000, timeout: 15000 },
    );
    return () => navigator.geolocation.clearWatch(watch);
  }, [gps, session]);
  const profile = q.data?.profile;
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      {simulation && <SimulationBanner />}
      <header className="bg-slate-900 text-white p-5 flex justify-between items-center gap-3">
        <div>
          <a href="/" className="text-xs text-slate-300">
            BOLT Pets
          </a>
          <h1 className="text-2xl font-black">BOLT Conductor</h1>
        </div>
        {session && (
          <button
            className={control}
            onClick={() =>
              void a.run(async () => {
                await dispatchClient.logout();
                setSession("");
                setGps(false);
              }, "Sesión cerrada")
            }
          >
            Cerrar sesión
          </button>
        )}
      </header>
      <main className="max-w-3xl mx-auto p-4 space-y-5">
        <Feedback error={a.error || q.error} notice={a.notice} />
        {!session ? (
          <form
            className="bg-white p-6 rounded-2xl border space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              void a.run(async () => {
                await dispatchClient.login(email, password);
                setSession(driverSession.get());
                setPassword("");
              }, "Sesión de conductor iniciada");
            }}
          >
            <h2 className="text-xl font-bold">Ingresar como conductor</h2>
            <p className="text-sm text-slate-500">
              Utiliza tu cuenta de BOLT Conductor.
            </p>
            <label className="block">
              Correo
              <input
                type="email"
                required
                autoComplete="username"
                className={field}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
            <label className="block">
              Contraseña
              <input
                type="password"
                required
                autoComplete="current-password"
                className={field}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
            <button disabled={a.busy} className={primary}>
              Ingresar
            </button>
          </form>
        ) : (
          <>
            {profile && (
              <section className="bg-white rounded-2xl border p-5 space-y-3">
                <div className="flex justify-between gap-2">
                  <h2 className="font-bold">{profile.name}</h2>
                  <Status value={profile.status} />
                </div>
                <p className="text-sm">
                  Sedes: {profile.storeIds.join(", ")}. Capacidad:{" "}
                  {profile.vehicle
                    ? `${profile.vehicle.maxLoadGrams / 1000} kg`
                    : "Pendiente de configurar"}
                  .
                </p>
                <p className="text-sm">
                  {profile.location
                    ? `Última ubicación: hace ${Math.floor(profile.location.ageSeconds)} s${profile.location.stale ? " · vencida" : ""}`
                    : "Ubicación pendiente"}
                </p>
                <div className="flex flex-wrap gap-2">
                  <button
                    disabled={a.busy || profile.status !== "OFF_DUTY"}
                    className={primary}
                    onClick={() =>
                      void a.run(
                        () =>
                          dispatchClient.driver("shift", "POST", {
                            action: "START",
                          }),
                        "Turno iniciado; actualiza tu ubicación",
                      )
                    }
                  >
                    Iniciar turno
                  </button>
                  <button
                    disabled={
                      a.busy ||
                      !["AVAILABLE", "OFF_DUTY"].includes(profile.status)
                    }
                    className={control}
                    onClick={() =>
                      void a.run(async () => {
                        await dispatchClient.driver("shift", "POST", {
                          action: "END",
                        });
                        setGps(false);
                      }, "Turno terminado")
                    }
                  >
                    Terminar turno
                  </button>
                  {simulation ? (
                    <button
                      className={control}
                      disabled={a.busy || profile.status === "OFF_DUTY"}
                      onClick={() =>
                        void a.run(
                          () =>
                            dispatchClient.driver(
                              "simulation/location",
                              "POST",
                            ),
                          "Ubicación ficticia actualizada",
                        )
                      }
                    >
                      Enviar ubicación simulada
                    </button>
                  ) : (
                    <button
                      className={control}
                      disabled={profile.status === "OFF_DUTY"}
                      onClick={() => setGps(!gps)}
                    >
                      {gps ? "Detener ubicación" : "Compartir ubicación"}
                    </button>
                  )}
                </div>
                <p className="text-xs text-slate-500">
                  La ubicación se actualiza con esta pantalla abierta. No se
                  garantiza seguimiento al cerrar la app.
                </p>
                <p role="status" className="text-xs">
                  {gpsMessage}
                </p>
                <p className="text-sm">
                  Recaudo pendiente de liquidar:{" "}
                  {formatCOP(q.data?.settlement?.cashHeldCOP || 0)}
                </p>
              </section>
            )}
            {q.loading && <p role="status">Cargando tareas…</p>}
            {q.data?.tasks.length === 0 && (
              <p className="p-6 bg-white rounded-2xl border">
                Sin tareas ni ofertas pendientes.
              </p>
            )}
            {q.data?.tasks.map((task) => (
              <Task
                key={task.dispatchId}
                task={task}
                busy={a.busy}
                act={(action, body) =>
                  void a.run(
                    () =>
                      dispatchClient.driver(
                        `assignments/${task.dispatchId}/${action}`,
                        "POST",
                        body,
                      ),
                    "Operación confirmada por BOLT",
                  )
                }
              />
            ))}
            {!profile && q.error && (
              <button
                className={control}
                onClick={() => {
                  driverSession.set("");
                  setSession("");
                }}
              >
                Volver a ingresar
              </button>
            )}
          </>
        )}
      </main>
    </div>
  );
}
