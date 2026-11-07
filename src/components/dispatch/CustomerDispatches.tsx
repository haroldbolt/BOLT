import React from "react";
import type { Order } from "../../types";
import type { PublicDispatch } from "../../lib/dispatchClient";
import { pickupText } from "../../lib/dispatchClient";
import { Status } from "./DispatchUi";
import { formatCOP } from "../../lib/formatters";
export function CustomerDispatches({
  order,
  onSelect,
}: {
  order: Order;
  onSelect: (index: number) => void;
}) {
  const dispatches: PublicDispatch[] = (order as any).dispatches || [];
  if (!dispatches.length) return null;
  return (
    <section
      aria-label="Entregas de tu compra"
      className="my-4 p-4 bg-white text-slate-900 rounded-2xl border border-slate-200 space-y-3"
    >
      <div>
        <h2 className="font-black">
          Tu compra {order.purchaseCode || order.orderNumber}
        </h2>
        <p className="text-sm text-slate-500">
          {dispatches.filter((d) => d.status === "DELIVERED").length} de{" "}
          {dispatches.length} entregas completadas
        </p>
      </div>
      {dispatches.map((d, n) => {
        const child = order.childShipments?.find(
          (c) => c.shipmentId === d.shipmentId,
        );
        return (
          <article key={d.id} className="rounded-xl border p-3 space-y-2">
            <div className="flex flex-wrap justify-between gap-2">
              <h3 className="font-bold">
                Entrega {n + 1} · {d.code}
              </h3>
              <Status value={d.status} />
            </div>
            <ul className="text-sm">
              {(child?.items || order.items).map((i) => (
                <li key={i.productId}>
                  {i.quantity} × {i.name} · {i.presentation}
                </li>
              ))}
            </ul>
            <p className="text-sm">
              {d.driverConfirmed
                ? d.provider
                : "Repartidor pendiente de confirmar"}
            </p>
            {d.status === "ASSIGNED" && d.pickupEstimate && (
              <p className="text-xs">{pickupText(d.pickupEstimate)}</p>
            )}
            {d.cashToCollect > 0 && (
              <p className="text-sm">
                Recaudo de esta entrega: {formatCOP(d.cashToCollect)}
              </p>
            )}
            <button
              className="min-h-11 text-red-700 text-sm font-bold underline"
              onClick={() =>
                onSelect(child ? order.childShipments!.indexOf(child) : 0)
              }
            >
              Ver entrega {n + 1}
            </button>
          </article>
        );
      })}
    </section>
  );
}
