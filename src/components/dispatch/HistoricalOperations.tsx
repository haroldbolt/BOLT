import React,{useCallback,useState} from 'react';
import {dispatchClient,type AdminDispatchData} from '../../lib/dispatchClient';
import {useDispatchQuery} from './useDispatchQuery';
import {control,primary,field} from './DispatchUi';
export function HistoricalOperations({orders,onChanged}:{orders:AdminDispatchData['historicalOrders'];onChanged:()=>void}){
 const [query,setQuery]=useState(''),[forms,setForms]=useState<Record<string,any>>({}),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const load=useCallback(()=>dispatchClient.admin<any[]>('/recoveries'),[]),recoveries=useDispatchQuery(load,true);
 const set=(id:string,key:string,value:any)=>setForms(old=>({...old,[id]:{...old[id],[key]:value}}));
 const act=async(path:string,body:any)=>{if(busy)return;setBusy(true);setError('');setNotice('');try{await dispatchClient.admin(path,'POST',body);setNotice('Operación guardada.');onChanged();recoveries.refresh();}catch(e:any){setError(e.message);}finally{setBusy(false);}};
 const filtered=orders.filter(o=>`${o.code} ${o.status}`.toLowerCase().includes(query.toLowerCase()));
 return <section aria-label="Continuidad de pedidos anteriores" className="bg-white rounded-2xl border p-5 space-y-4">
  <h2 className="text-xl font-black">Pedidos anteriores y recuperación de seguimiento</h2>
  <p className="text-sm text-slate-600">Registrar conserva el pedido. La conciliación verifica saldo y custodia antes de continuar; los pedidos cerrados permanecen en el historial.</p>
  <label className="block text-sm font-bold">Buscar compra o estado<input className={field} value={query} onChange={e=>setQuery(e.target.value)} /></label>
  {error&&<p role="alert" className="text-red-700">{error}</p>}{notice&&<p role="status" className="text-emerald-700">{notice}</p>}
  {filtered.slice(0,30).map(o=><article key={o.id} className="border rounded-xl p-4 space-y-3">
   <h3 className="font-bold">{o.code} · {o.status}</h3>
   <p className="text-sm">{o.classification==='CLOSED'?'Histórico cerrado. Solo consulta y recuperación de seguimiento.':o.classification==='UNREGISTERED'?'Despachos pendientes de registrar':o.classification==='RECONCILIATION_PENDING'?'Conciliación operativa pendiente':'Registrado en despachos'}</p>
   <a className={control} href={'/pedido/'+o.id} target="_blank" rel="noopener">Consultar histórico</a>
   {o.canRegister&&<button disabled={busy} className={primary} onClick={()=>void act('/orders/'+o.id+'/register',{})}>Registrar despachos de {o.code}</button>}
   {o.status==='PENDIENTE_CONFIRMACION'&&<p>Primero verifica y confirma la compra en Pedidos. No se generan despachos antes de confirmarla.</p>}
   {o.dispatches.filter(d=>d.needsReconciliation).map(d=>{const f=forms[d.id]||{};return <form key={d.id} aria-label={'Conciliar '+d.code} className="grid sm:grid-cols-2 gap-3 border-t pt-3" onSubmit={e=>{e.preventDefault();void act('/'+d.id+'/reconcile-legacy',{driverId:d.driverId||undefined,cashDueCOP:Number(f.cash),note:f.note,...(d.needsPickupEvidence?{pickupEvidence:{pickedUpAt:f.pickup,sourceReference:f.source}}:{})});}}>
    <p className="sm:col-span-2 font-bold">{d.code} · {d.driverId?'Conservar custodio: '+d.driverId:'Sin conductor histórico'}</p>
    <label className="text-sm">Saldo pendiente comprobado (COP)<input required type="number" min="0" step="1" className={field} value={f.cash??''} onChange={e=>set(d.id,'cash',e.target.value)}/><span className="text-xs">Referencia guardada: {d.cashDueCOP??'Sin dato; revisar comprobantes'}. Confirma el importe.</span></label>
    <label className="text-sm">Nota de conciliación y evidencia<input required className={field} value={f.note||''} onChange={e=>set(d.id,'note',e.target.value)}/></label>
    {d.needsPickupEvidence&&<><p className="sm:col-span-2 text-amber-800">Falta comprobar cuándo fue recogido. Se conserva EN_CAMINO; no vuelvas a recoger ni liberes la custodia.</p><label className="text-sm">Fecha de recogida comprobada (con zona horaria)<input required className={field} placeholder="AAAA-MM-DDTHH:mm:ss-05:00" value={f.pickup||''} onChange={e=>set(d.id,'pickup',e.target.value)}/></label><label className="text-sm">Referencia del soporte de recogida<input required minLength={8} className={field} value={f.source||''} onChange={e=>set(d.id,'source',e.target.value)}/></label></>}
    <button disabled={busy} className={primary}>Confirmar conciliación de {d.code}</button>
   </form>})}
  </article>)}
  {filtered.length>30&&<p>Se muestran 30 de {filtered.length}. Usa la búsqueda para localizar la compra.</p>}
  <h3 className="font-bold">Solicitudes de seguimiento privado</h3>
  <p className="text-sm">El cliente inicia la solicitud en “Recuperar seguimiento” y conserva la clave en su dispositivo. Comprueba el documento original o el comprobante de pago; conocer nombre, correo o teléfono no acredita titularidad. No se envían accesos por servicios externos.</p>
  {(recoveries.data||[]).map(c=>{const f=forms[c.id]||{};return <form key={c.id} className="border rounded-xl p-4 space-y-3" onSubmit={e=>{e.preventDefault();void act('/recoveries/'+c.id+'/approve',{method:f.method||'IN_PERSON_DOCUMENT_REVIEW',evidenceReference:f.evidence,transactionReference:f.transaction,verifiedOwner:f.verified===true});}}>
   <p className="font-bold">Solicitud {c.id} · Compra {c.reference} · {c.status}</p>
   {!c.orderId?<p>Pedido no identificado. Revisa la referencia con el solicitante; no autorices acceso.</p>:c.status==='PENDING'?<>
   <label className="block text-sm">Evidencia verificada<select className={field} value={f.method||'IN_PERSON_DOCUMENT_REVIEW'} onChange={e=>set(c.id,'method',e.target.value)}><option value="IN_PERSON_DOCUMENT_REVIEW">Documento y compra revisados presencialmente</option><option value="PAYMENT_RECEIPT_REVIEW">Comprobante original cotejado con la transacción</option></select></label>
   {f.method==='PAYMENT_RECEIPT_REVIEW'&&<label className="block text-sm">Referencia de la transacción del comprobante<input required className={field} value={f.transaction||''} onChange={e=>set(c.id,'transaction',e.target.value)}/></label>}
   <label className="block text-sm">Referencia del expediente (CASE-...)<input required pattern="CASE-[A-Za-z0-9_.-]{6,100}" className={field} placeholder="CASE-expediente-interno" value={f.evidence||''} onChange={e=>set(c.id,'evidence',e.target.value)}/></label>
   <label className="flex items-start gap-2 text-sm"><input required type="checkbox" checked={!!f.verified} onChange={e=>set(c.id,'verified',e.target.checked)}/>Verifiqué la titularidad con evidencia suficiente. No usé solo datos de contacto conocidos.</label>
   <button disabled={busy} className={primary}>Autorizar seguimiento privado</button></>:<p>Operación auditada. El cliente puede consultar desde el dispositivo que inició la solicitud.</p>}
  </form>})}
 </section>;
}
