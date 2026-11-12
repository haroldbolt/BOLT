import React from 'react';
import type {Order} from '../../types';
import {formatCOP} from '../../lib/formatters';
export function PendingDeliveryReceipt({order,onBack,onRefresh,onCancel,cancelling,error}:{order:Order;onBack:()=>void;onRefresh:()=>void;onCancel:()=>void;cancelling:boolean;error:string|null}) {
  const cancelled=order.fulfillmentStatus==='CANCELADO';
  return <main className="min-h-screen bg-slate-50 p-4 sm:p-8"><section className="max-w-xl mx-auto bg-white rounded-3xl border p-5 sm:p-8 space-y-5">
    <button onClick={onBack} className="min-h-11 text-red-700 font-bold">← Volver a BOLT</button>
    <h1 className="text-2xl font-black text-slate-900">{cancelled?'Solicitud cancelada':'Solicitud recibida'}</h1>
    <p className="font-bold">{order.purchaseCode||order.orderNumber}</p>
    <p role="status" className="rounded-2xl bg-amber-50 p-4 text-sm">{cancelled?'Tu solicitud fue cancelada. No se ha realizado ningún cobro.':'La sede confirmará contigo el costo y la disponibilidad de entrega. No se ha realizado ningún cobro ni reservado un horario.'}</p>
    <p className="text-sm">Sede: {order.warehouse?.customerName || order.storeName}</p>
    <ul className="divide-y">{order.items.map(i=><li key={i.productId} className="py-3"><p className="font-bold">{i.name} · {i.presentation}</p><p className="text-sm">{i.quantity} × {formatCOP(i.price)}</p></li>)}</ul>
    <p className="flex justify-between font-bold"><span>Subtotal de productos</span><span>{formatCOP(order.totals.subtotal)}</span></p>
    {!cancelled&&<><p className="text-sm text-slate-600">Envío, total final y horario: pendientes de tu aceptación. Puedes consultar aquí la actualización o cancelar tu solicitud.</p><button onClick={onRefresh} className="min-h-11 px-5 rounded-xl bg-red-600 text-white font-bold">Actualizar seguimiento</button><button onClick={onCancel} disabled={cancelling} className="block min-h-11 underline text-slate-600">{cancelling?'Cancelando…':'Cancelar solicitud'}</button></>}
    {error&&<p role="alert" className="text-red-700">{error}</p>}
  </section></main>;
}
