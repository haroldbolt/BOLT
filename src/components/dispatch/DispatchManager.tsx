import {PendingDeliveryReviews} from './PendingDeliveryReviews';
import {OrderEntrancePhoto} from '../customer/OrderEntrancePhoto';
import {HistoricalOperations} from './HistoricalOperations';
import { DriverAccounts, SettleDriver } from "./DriverAccounts";
import React, { useCallback, useState } from "react";
import { dispatchClient, pickupText } from "../../lib/dispatchClient";
import { api } from "../../lib/api";
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
export function DispatchManager({
  authenticated,
  onAuthenticate,
  storeFilter,
}: {
  authenticated: boolean;
  storeFilter?:string[];
  onAuthenticate: () => void;
}) {
  const load = useCallback(() => dispatchClient.admin(), []),
    q = useDispatchQuery(load, authenticated),
    a = useDispatchAction(q.refresh);
  const [transfers, setTransfers] = useState<Record<string, string>>({}),
    [config, setConfig] = useState<Record<string, number>>({});
  const data = q.data,
    visibleOrders=q.data?.orders.filter(o=>!storeFilter||storeFilter.includes(o.storeId))||[],
    seconds = (n: number | null) =>
      n === null ? "Sin datos" : `${Math.round(n)} s`;
  if (!authenticated)
    return (
      <section className="p-6 bg-white rounded-2xl border">
        <h2 className="text-xl font-black">Despachos y asignación</h2>
        <p className="my-3">
          Inicia una sesión administrativa para supervisar la operación.
        </p>
        <button className={primary} onClick={onAuthenticate}>
          Ingresar a administración
        </button>
      </section>
    );
  const action = (id: string, name: string, body?: unknown) =>
    a.run(
      () => dispatchClient.admin("/" + id + "/" + name, "POST", body),
      "Operación registrada",
    );
  return (
    <div className="space-y-5">
      {data?.simulation && <SimulationBanner />}
      <div className="flex flex-wrap justify-between gap-3">
        <div>
          <h2 className="font-black text-2xl">Despachos y asignación</h2>
          <p className="text-sm text-slate-500">
            Una compra, todas sus entregas. Actualización cada 3 segundos.
          </p>
        </div>
        <a className={control} href="/conductor" target="_blank" rel="noopener">
          Abrir BOLT Conductor
        </a>
      </div>
      <Feedback error={a.error || q.error} notice={a.notice} />
      {q.loading && <p role="status">Consultando operación…</p>}
      {data && (
        <>
          <PendingDeliveryReviews orders={(data.pendingDeliveryReviews||[]).filter(o=>!storeFilter||storeFilter.includes(o.storeId))} onChanged={q.refresh}/>
          <HistoricalOperations orders={data.historicalOrders.filter(o=>!storeFilter||storeFilter.includes(o.storeId))} onChanged={q.refresh}/>
          <div className="grid sm:grid-cols-4 gap-3">
            {[
              [
                "Asignación promedio (global)",
                seconds(data.metrics.averageAssignmentSeconds),
              ],
              [
                "Espera en bodega (global)",
                seconds(data.metrics.averageWarehouseWaitSeconds),
              ],
              ["Búsquedas sin capacidad", data.metrics.failedSearches],
              [
                "Ofertas vencidas / rechazadas",
                `${data.metrics.expiredOffers} / ${data.metrics.rejectedOffers}`,
              ],
            ].map(([label, value]) => (
              <div key={label} className="bg-white border rounded-2xl p-4">
                <p className="text-xs text-slate-500">{label}</p>
                <p className="text-xl font-black">{value}</p>
              </div>
            ))}
          </div>
          {visibleOrders.length === 0 && (
            <p className="p-5 bg-white rounded-xl">
              No hay compras registradas en el motor de despachos.
            </p>
          )}
          {[...visibleOrders].reverse().map((order) => (
            <article
              key={order.id}
              className="bg-white border rounded-2xl overflow-hidden"
            >
              <header className="p-5 bg-slate-50 flex flex-wrap justify-between gap-2">
                <div>
                  <h3 className="font-black text-xl">{order.code}</h3>
                  <p className="text-sm">
                    {order.warehouse?.name || order.storeId} · {order.status}
                  </p>
                </div>
                <a
                  href={"/pedido/" + order.id}
                  className={control}
                  target="_blank"
                  rel="noopener"
                >
                  Ver seguimiento
                </a>
              </header>
              <div className="px-4"><OrderEntrancePhoto orderId={order.id} audience="admin"/></div>
              <div className="grid lg:grid-cols-2 gap-4 p-4">
                {order.dispatches.map((d) => (
                  <section
                    key={d.id}
                    className="rounded-xl border p-4 space-y-3"
                  >
                    <div className="flex flex-wrap justify-between gap-2">
                      <h4 className="font-black">{d.code}</h4>
                      <Status value={d.status} />
                    </div>
                    <p className="text-sm">
                      Preparación: {d.fulfillmentStatus}
                    </p>
                    <ul className="text-sm">
                      {d.items.map((i, n) => (
                        <li key={n}>
                          {i.quantity} × {i.name} · {i.presentation}
                        </li>
                      ))}
                    </ul>
                    <p className="text-sm">
                      {d.weightGrams
                        ? `${d.weightGrams / 1000} kg con embalaje`
                        : "Peso pendiente"}{" "}
                      ·{" "}
                      {d.providerId === "OWN"
                        ? "Flota propia"
                        : d.external?.providerName ||
                          "Proveedor pendiente"}{" "}
                      ·{" "}
                      {data.drivers.find((x) => x.driverId === d.driverId)
                        ?.name ||
                        d.external?.driver?.name ||
                        "Repartidor pendiente"}
                    </p>
                    <p className="text-sm">{pickupText(d.estimate)}</p>
                    <p className="text-sm">
                      Recaudo asignado: {formatCOP(d.cashDue)} · recibido:{" "}
                      {formatCOP(d.cashCollected)}
                    </p>
                    {d.reason && (
                      <p className="bg-amber-50 text-amber-900 p-2 rounded-lg text-sm">
                        Incidencia: {d.reason}
                      </p>
                    )}
                    {d.external && (
                      <p className="text-sm">
                        Servicio externo: <Status value={d.external.status} />
                      </p>
                    )}
                    {d.offers.map((o) => (
                      <p key={o.id} className="text-xs">
                        Oferta a{" "}
                        {data.drivers.find((x) => x.driverId === o.driverId)
                          ?.name || o.driverId}
                        : <Status value={o.status === "ACCEPTED" ? "OFFER_ACCEPTED" : o.status} /> · vence{" "}
                        {new Date(o.expiresAt).toLocaleTimeString("es-CO", {
                          timeZone: "America/Bogota",
                        })}
                      </p>
                    ))}
                    <div className="flex flex-wrap gap-2">
                      {d.fulfillmentStatus === "CONFIRMADO" && (
                        <button
                          className={control}
                          disabled={a.busy}
                          onClick={() =>
                            void a.run(() =>
                              api.updateOrderStatus(
                                order.id,
                                "EN_ALISTAMIENTO",
                                d.shipmentId,
                              ),
                            )
                          }
                        >
                          Iniciar preparación
                        </button>
                      )}
                      {d.fulfillmentStatus === "EN_ALISTAMIENTO" && (
                        <button
                          className={primary}
                          disabled={a.busy}
                          onClick={() =>
                            void a.run(
                              () =>
                                api.updateOrderStatus(
                                  order.id,
                                  "LISTO_PARA_DESPACHO",
                                  d.shipmentId,
                                ),
                              "Entrega lista para buscar repartidor",
                            )
                          }
                        >
                          Marcar listo
                        </button>
                      )}
                      {d.fulfillmentStatus === "LISTO_PARA_DESPACHO" &&
                        ["PENDING", "SEARCHING"].includes(d.status) && (
                          <button
                            className={primary}
                            disabled={a.busy}
                            onClick={() => void action(d.id, "search")}
                          >
                            Buscar repartidor
                          </button>
                        )}
                      {["SEARCH_EXHAUSTED", "INCIDENT"].includes(d.status) &&
                        !d.driverId &&
                        !d.external && (
                          <button
                            className={control}
                            disabled={a.busy}
                            onClick={() => void action(d.id, "restart-search")}
                          >
                            Reintentar búsqueda
                          </button>
                        )}
                      {["ASSIGNED","INCIDENT"].includes(d.status) && !d.pickedUpAt && d.driverId && (
                        <button
                          className={control}
                          disabled={a.busy || !!d.releaseRequested}
                          onClick={() => void action(d.id, "release")}
                        >
                          {d.releaseRequested
                            ? "Liberación pendiente"
                            : "Solicitar liberación"}
                        </button>
                      )}
                      {d.external &&
                        ["UNKNOWN", "REQUESTING", "ACCEPTED"].includes(
                          d.external.status,
                        ) && (
                          <>
                            <button
                              className={control}
                              disabled={a.busy}
                              onClick={() => void action(d.id, "reconcile")}
                            >
                              Consultar servicio externo
                            </button>
                            <button
                              className={control}
                              disabled={a.busy}
                              onClick={() =>
                                void action(d.id, "cancel-external")
                              }
                            >
                              Cancelar servicio externo
                            </button>
                          </>
                        )}
                    </div>
                    {["PICKED_UP","INCIDENT"].includes(d.status) && !!d.pickedUpAt && d.driverId && (
                      <div className="flex flex-wrap gap-2">
                        <label className="text-sm flex-1">
                          Transferencia de custodia autorizada
                          <select
                            className={field}
                            value={transfers[d.id] || ""}
                            onChange={(e) =>
                              setTransfers({
                                ...transfers,
                                [d.id]: e.target.value,
                              })
                            }
                          >
                            <option value="">
                              Seleccionar conductor disponible
                            </option>
                            {data.drivers
                              .filter(
                                (x) =>
                                  x.status === "AVAILABLE" &&
                                  x.driverId !== d.driverId,
                              )
                              .map((x) => (
                                <option key={x.driverId} value={x.driverId}>
                                  {x.name}
                                </option>
                              ))}
                          </select>
                        </label>
                        <button
                          className={control}
                          disabled={a.busy || !transfers[d.id]}
                          onClick={() =>
                            void action(d.id, "transfer", {
                              toDriverId: transfers[d.id],
                            })
                          }
                        >
                          Solicitar transferencia
                        </button>
                      </div>
                    )}
                  </section>
                ))}
              </div>
            </article>
          ))}
          <section className="bg-white rounded-2xl border p-5 space-y-3">
            <h3 className="text-lg font-black">
              Disponibilidad de flota propia
            </h3>
            {data.drivers.map((d) => (
              <div
                key={d.driverId}
                className="border-t py-3 flex flex-wrap justify-between gap-3"
              >
                <div>
                  <strong>{d.name}</strong> <Status value={d.status} />
                  <p className="text-sm">
                    {d.storeIds.join(", ")} ·{" "}
                    {d.vehicle
                      ? `${d.vehicle.maxLoadGrams / 1000} kg`
                      : "Capacidad pendiente"}
                  </p>
                  <p className="text-xs text-slate-500">
                    {d.location
                      ? `Ubicación de hace ${Math.floor(d.location.ageSeconds)} s${d.location.stale ? " · vencida" : ""}`
                      : "Sin ubicación"}
                    {d.heartbeatStale ? " · presencia vencida" : ""}
                  </p>
                  <p className="text-sm">
                    Efectivo pendiente: {formatCOP(d.cashHeldCOP)}
                  </p>
                  <SettleDriver
                    id={d.driverId}
                    busy={a.busy}
                    submit={(amountCOP, receiptId) =>
                      void a.run(
                        () =>
                          dispatchClient.admin(
                            "/drivers/" + d.driverId + "/settlement",
                            "POST",
                            { amountCOP, receiptId },
                          ),
                        "Recibo registrado",
                      )
                    }
                  />
                </div>
                <button
                  className={control}
                  disabled={a.busy}
                  onClick={() =>
                    void a.run(() =>
                      dispatchClient.admin("/drivers/" + d.driverId, "PATCH", {
                        enabled: !d.enabled,
                        storeIds: d.storeIds,
                      }),
                    )
                  }
                >
                  {d.enabled ? "Deshabilitar cuenta" : "Habilitar cuenta"}
                </button>
              </div>
            ))}
          </section>
          <DriverAccounts
            registered={data.drivers.map((d) => d.driverId)}
            refresh={q.refresh}
          />
          <details className="bg-white rounded-2xl border p-5">
            <summary className="cursor-pointer font-bold">
              Parámetros de asignación
            </summary>
            <form
              className="grid md:grid-cols-3 gap-3 mt-4"
              onSubmit={(e) => {
                e.preventDefault();
                void a.run(
                  () =>
                    dispatchClient.admin("/config", "PUT", {
                      ...data.config,
                      ...config,
                    }),
                  "Parámetros guardados",
                );
              }}
            >
              {Object.entries(data.config).map(([key, value]) => (
                <label key={key} className="text-sm">
                  {(
                    {
                      offerSeconds: "Vigencia de oferta (s)",
                      searchSeconds: "Búsqueda máxima (s)",
                      locationMaxAgeSeconds: "Vigencia de ubicación (s)",
                      heartbeatMaxAgeSeconds: "Vigencia de presencia (s)",
                      routeMaxAgeSeconds: "Vigencia de ETA (s)",
                      routeTieSeconds: "Empate de ETA (s)",
                      providerTimeoutSeconds: "Espera del proveedor (s)",
                      locationAccuracyMeters: "Precisión máxima GPS (m)",
                      driverSessionHours: "Sesión de conductor (h)",
                      pinAttempts: "Intentos de PIN",
                    } as Record<string, string>
                  )[key] || key}
                  <input
                    type="number"
                    className={field}
                    value={config[key] ?? value}
                    onChange={(e) =>
                      setConfig({ ...config, [key]: Number(e.target.value) })
                    }
                  />
                </label>
              ))}
              <button className={primary} disabled={a.busy}>
                Guardar parámetros
              </button>
            </form>
            <p className="text-sm mt-3">
              Los vehículos, dimensiones, modalidades y tarifas se administran
              en Flota & Repartidores.
            </p>
          </details>
          <p className="text-sm text-slate-500">
            Rappi e inDrive: desactivados. Pendientes convenio, acceso
            autorizado y homologación.
          </p>
          <details className="bg-white rounded-2xl border p-4">
            <summary className="font-bold cursor-pointer">
              Auditoría reciente
            </summary>
            <ul className="text-xs space-y-2 mt-3">
              {data.events
                .slice(-20)
                .reverse()
                .map((e) => (
                  <li key={e.id}>
                    {new Date(e.at).toLocaleString("es-CO")} · {e.type} ·{" "}
                    {e.dispatchId || "Configuración"}
                  </li>
                ))}
            </ul>
          </details>
        </>
      )}
    </div>
  );
}
