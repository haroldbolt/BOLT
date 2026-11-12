import {deliveryStatusMessage} from '../../lib/checkoutReadiness';
import React from 'react';
import type { DeliveryQuote } from '../../lib/deliveryService';
import { formatCOP } from '../../lib/formatters';
export function DeliveryPlanSummary({quote,onRefresh}:{quote?:DeliveryQuote|null;onRefresh?:()=>void}) {
  if(!quote) return <p role="status" className="text-xs text-slate-600">Calculando transporte…</p>;
  if(!quote.transportPlan?.feasible) return <div role="status" className="rounded-xl bg-amber-50 p-3 text-xs text-amber-950"><p>{deliveryStatusMessage(quote)}</p>{onRefresh && <button type="button" onClick={onRefresh} className="min-h-11 font-bold underline">Actualizar disponibilidad</button>}</div>;
  return <section aria-label="Organización de tu compra" className="rounded-2xl border border-amber-200 bg-amber-50 p-3 text-xs text-slate-800 space-y-2">
    <p className="font-bold">{quote.transportPlan.message}</p>
    <p>{quote.recommendedMode==='PROGRAMADO'?`Programado · ${quote.transportWindow?.dateLabel || 'Selecciona una franja'} · ${quote.transportWindow?.displayWindowFull || ''}`:'Turbo · aprox. '+quote.estimatedMinutes+' min'} · {quote.warehouse?.customerName || quote.assignedStoreName}</p>
    {quote.turboDividido?.shipments.map((s,i)=><div key={s.shipmentId} className="bg-white rounded-xl p-2">
      <p className="font-bold">Entrega {i+1} · {s.weightKg.toLocaleString('es-CO')} kg de productos</p>
      <ul className="mt-1 space-y-1">{s.items.map(item=><li key={item.productId}>{item.quantity} × {item.name}</li>)}</ul>
      <p className="mt-1 text-slate-500">Con embalaje: {(quote.transportPlan!.shipments[i].grossWeightGrams/1000).toLocaleString('es-CO')} kg</p>
      {quote.transportPlan!.shipments[i].vehicle.externalOffer ? <p className="mt-1">Red externa simulada · {quote.transportPlan!.shipments[i].vehicle.externalOffer!.providerName} · aprox. {s.estimatedArrivalSeconds/60} min</p> : <p className="mt-1">Flota propia{quote.recommendedMode!=='PROGRAMADO' ? ` · aprox. ${s.estimatedArrivalSeconds/60} min` : ''}</p>}
    </div>)}
    {quote.charges && <p className="font-bold">Total de la compra: {formatCOP(quote.charges.total)} (sin propina). Transporte total: {formatCOP(quote.charges.shipping)}. Servicio: {quote.charges.serviceFee===0?'gratis':formatCOP(quote.charges.serviceFee)}.</p>}
  </section>;
}
