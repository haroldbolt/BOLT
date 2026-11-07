import React,{useState} from 'react';
import type {Order,FulfillmentStatus} from '../../types';
import {formatCOP} from '../../lib/formatters';
export function GroupedDispatches({orders,transition,assign,confirmReturn,track}:{orders:Order[];transition:(id:string,status:FulfillmentStatus,shipmentId?:string,reason?:string,deliveryCode?:string)=>void;assign:(id:string,shipmentId?:string)=>void;confirmReturn:(id:string,shipmentId?:string)=>void;track:(id:string)=>void}) {
  const [pins,setPins]=useState<Record<string,string>>({});
  const [reasons,setReasons]=useState<Record<string,string>>({});
  return <section aria-label="Compras con varias entregas" className="space-y-4">{orders.filter(o=>o.childShipments?.length).map(order=><article key={order.id} className="border border-amber-200 bg-white rounded-2xl p-4 space-y-3">
    <div className="flex flex-wrap justify-between gap-2"><h3 className="font-bold">Compra {order.orderNumber} · {order.childShipments!.length} entregas</h3><span>{formatCOP(order.totals.total)} · {order.fulfillmentStatus}</span></div>
    <p className="text-sm">{order.storeName} · {order.customer.name} · {order.deliveryAddress.address}</p>
    <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">{order.childShipments!.map(child=><div key={child.shipmentId} className="border rounded-xl p-3 text-sm space-y-2">
      <h4 className="font-bold">Entrega {child.shipmentIndex} · {child.weightKg} kg</h4><p>{child.fulfillmentStatus} · {child.driver?.name || 'Repartidor pendiente'}</p>
      {child.transportLoad && <p className="text-xs">Carga con embalaje: {child.transportLoad.grossWeightGrams/1000} kg · Sede: {order.storeName}</p>}
      <ul className="text-xs space-y-1">{child.items.map(i=><li key={i.productId}>{i.quantity} × {i.name}{i.presentation && !i.name.endsWith(i.presentation) ? ` · ${i.presentation}` : ''}</li>)}</ul>
      <p className="text-xs">Cobro asignado: {formatCOP(child.cashToCollect)}</p>
      <div className="flex flex-wrap gap-2">{child.fulfillmentStatus==='CONFIRMADO' && <button className="border p-2 rounded-lg" onClick={()=>transition(order.id,'EN_ALISTAMIENTO',child.shipmentId)}>Alistar entrega</button>}
      {child.fulfillmentStatus==='EN_ALISTAMIENTO' && <button className="border p-2 rounded-lg" onClick={()=>transition(order.id,'LISTO_PARA_DESPACHO',child.shipmentId)}>Empacado</button>}
      {child.fulfillmentStatus==='LISTO_PARA_DESPACHO' && <button className="border p-2 rounded-lg" onClick={()=>assign(order.id,child.shipmentId)}>Confirmar repartidor</button>}
      {child.fulfillmentStatus==='REPARTIDOR_ASIGNADO' && <button className="border p-2 rounded-lg" onClick={()=>transition(order.id,'EN_CAMINO',child.shipmentId)}>Despachar entrega</button>}
      {['EN_CAMINO','CON_INCIDENCIA'].includes(child.fulfillmentStatus) && <div className="space-y-2"><label className="block">PIN proporcionado por el cliente<input aria-label={`PIN entrega ${child.shipmentIndex} de ${order.orderNumber}`} inputMode="numeric" maxLength={4} className="border rounded-lg p-2 w-24 ml-2" value={pins[child.shipmentId]||''} onChange={e=>setPins({...pins,[child.shipmentId]:e.target.value})}/></label><button disabled={!/^\d{4}$/.test(pins[child.shipmentId]||'')} className="bg-red-600 disabled:bg-slate-300 text-white p-2 rounded-lg" onClick={()=>transition(order.id,'ENTREGADO',child.shipmentId,undefined,pins[child.shipmentId])}>Validar PIN y entregar</button></div>}
      {!['ENTREGADO','CANCELADO'].includes(child.fulfillmentStatus) && <details><summary className="cursor-pointer p-2">Cancelar esta entrega</summary><label>Motivo<input aria-label={`Motivo cancelación entrega ${child.shipmentIndex} de ${order.orderNumber}`} className="border rounded-lg p-2 w-full" value={reasons[child.shipmentId]||''} onChange={e=>setReasons({...reasons,[child.shipmentId]:e.target.value})}/></label><button disabled={!reasons[child.shipmentId]?.trim()} className="border p-2 rounded-lg disabled:opacity-50" onClick={()=>transition(order.id,'CANCELADO',child.shipmentId,reasons[child.shipmentId])}>Confirmar cancelación de esta entrega</button></details>}
      {child.physicalReturnPending && <button className="border p-2 rounded-lg" onClick={()=>confirmReturn(order.id,child.shipmentId)}>Confirmar devolución física</button>}</div>
    </div>)}</div>
    <button className="text-red-700 underline" onClick={()=>track(order.id)}>Abrir seguimiento de la compra</button>
  </article>)}</section>;
}
