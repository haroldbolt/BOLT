import {EntrancePhotoPreview} from './EntrancePhotoPicker';
import React, {useEffect, useState} from 'react';
import {X, MapPin, Plus, Pencil, Trash2, Star, Check, Bookmark} from 'lucide-react';
import {api} from '../../lib/api';
import {DEVICE_ADDRESSES_NOTICE, type SavedAddress, type AddressSelection} from '../../lib/guestAddresses';
import type {DeliveryQuote} from '../../lib/deliveryService';
import {COVERAGE_NOTICE} from '../../data/coverageConfig';
import {CurrentLocationAction} from './CurrentLocationAction';

interface Props {
  accountSaved?:boolean;
  isOpen:boolean;onClose:()=>void;addresses:SavedAddress[];current:AddressSelection|null;
  quote:DeliveryQuote|null;warning:string;message:string;
  onAdd:()=>void;onEdit:(address:SavedAddress)=>void;onUse:(id:string)=>void;
  onUseCurrentLocation?:()=>void;
  onRemove:(id:string)=>void;onDefault:(id:string)=>void;
  onSave:(name:string,isDefault:boolean)=>boolean;onContinue:()=>void;
}
export function SavedAddressesModal({accountSaved=false,isOpen,onClose,addresses,current,quote,warning,message,onAdd,onEdit,onUse,onRemove,onDefault,onSave,onContinue,onUseCurrentLocation}:Props) {
  const [name,setName]=useState(''),[makeDefault,setMakeDefault]=useState(false);
  const [checks,setChecks]=useState<Record<string,DeliveryQuote|null>>({});
  const [checking,setChecking]=useState(false);
  useEffect(()=>{
    if(!isOpen)return;
    let cancelled=false;setChecks({});setChecking(true);
    // Coverage is a fresh, read-only server result, never persisted as permission.
    Promise.all(addresses.map(async address=>{
      try{return [address.id,await api.getDeliveryQuote({destination:address,items:[]})] as const}catch{return [address.id,null] as const}
    })).then(results=>{if(!cancelled){setChecks(Object.fromEntries(results));setChecking(false)}});
    return ()=>{cancelled=true};
  },[isOpen,addresses]);
  useEffect(()=>{setName('');setMakeDefault(false)},[current?.address,current?.details,current?.savedId]);
  if(!isOpen)return null;
  const canSave=!!current && !!quote && quote.eligibilityStatus!=='ADDRESS_NEEDS_CONFIRMATION';
  const activeName=addresses.find(a=>a.id===current?.savedId)?.name;
  return <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 md:p-4">
    <section role="dialog" aria-modal="true" aria-labelledby="saved-addresses-title" className="bg-white rounded-3xl w-full max-w-xl max-h-[92vh] flex flex-col overflow-hidden shadow-2xl border border-slate-100">
      <div className="p-5 flex items-start justify-between border-b border-slate-100 bg-slate-50">
        <div><h2 id="saved-addresses-title" className="font-black text-lg text-slate-900 flex items-center gap-2"><MapPin className="text-red-600 w-5 h-5"/>Mis direcciones</h2><p className="text-xs text-slate-500 mt-1">{accountSaved?'Direcciones guardadas en tu cuenta':DEVICE_ADDRESSES_NOTICE}</p></div>
        <button type="button" aria-label="Cerrar direcciones guardadas" onClick={onClose} className="p-2 rounded-full hover:bg-slate-200"><X className="w-5 h-5 text-slate-500"/></button>
      </div>
      <div className="p-4 md:p-5 space-y-4 overflow-y-auto">
        {onUseCurrentLocation && <CurrentLocationAction onClick={onUseCurrentLocation}/>}
        {warning && <p role="status" className="text-sm p-3 rounded-xl bg-amber-50 text-amber-900">{warning}</p>}
        {message && <p role="status" className="text-sm p-3 rounded-xl bg-blue-50 text-blue-900">{message}</p>}
        {current ? <section aria-label="Dirección para esta compra" className="p-4 rounded-2xl border border-red-200 bg-red-50/60 space-y-2">
          <p className="font-bold text-sm text-red-900">Para esta compra{activeName?`: ${activeName}`:''}</p>
          <p className="text-sm text-slate-800">{current.address}</p>{current.details && <p className="text-xs text-slate-600">{current.details}</p>}
          <p role="status" className="text-xs text-slate-700">{!quote?'Comprobando destino con el servidor…':quote.eligibilityStatus==='OUT_OF_COVERAGE'?'No disponible para entrega · '+COVERAGE_NOTICE.title:quote.territoryInfo?.isCovered?`Zona habilitada · ${quote.warehouse?.customerName || quote.assignedStoreName || 'Sede pendiente'}`:quote.message}</p>
          {current.referencePhotoId && <EntrancePhotoPreview photoId={current.referencePhotoId}/>}
          {!current.savedId && <form onSubmit={e=>{e.preventDefault();if(canSave)onSave(name,makeDefault)}} className="space-y-3 pt-2">
            <label className="text-xs font-bold text-slate-700 block">Nombre de la dirección<input aria-label="Nombre de la dirección" maxLength={60} required value={name} onChange={e=>setName(e.target.value)} placeholder="Casa, Trabajo u otro" className="mt-1 w-full rounded-xl border border-slate-200 bg-white p-3 text-sm font-normal"/></label>
            <label className="flex items-center gap-2 text-xs text-slate-700"><input type="checkbox" checked={makeDefault} onChange={e=>setMakeDefault(e.target.checked)} className="w-4 h-4 accent-red-600"/>Usar como predeterminada</label>
            <button type="submit" disabled={!canSave || !name.trim()} className="min-h-11 w-full rounded-xl bg-red-600 text-white text-sm font-bold disabled:bg-slate-300 flex items-center justify-center gap-2"><Bookmark className="w-4 h-4"/>Guardar dirección</button>
            {quote?.eligibilityStatus==='OUT_OF_COVERAGE' && <p className="text-xs text-amber-800">Puedes guardarla; seguirá bloqueada para entregas mientras esté fuera de cobertura.</p>}
          </form>}
        </section> : <p role="status" className="p-3 rounded-xl bg-amber-50 text-amber-900 text-sm">Selecciona o agrega una dirección antes de confirmar el pedido.</p>}
        <button type="button" onClick={onAdd} className="min-h-11 w-full border border-dashed border-red-300 rounded-2xl text-red-700 font-bold text-sm flex items-center justify-center gap-2 hover:bg-red-50"><Plus className="w-4 h-4"/>Agregar nueva dirección</button>
        {!addresses.length && <p className="text-sm text-center text-slate-500">Todavía no tienes direcciones guardadas.</p>}
        {[...addresses].sort((a,b)=>Number(b.isDefault)-Number(a.isDefault)).map(address=>{
          const q=checks[address.id],active=current?.savedId===address.id;
          return <article key={address.id} aria-label={`Dirección ${address.name}`} className={`p-4 rounded-2xl border space-y-2 ${active?'border-red-400 bg-red-50/30':'border-slate-200'}`}>
            <div className="flex items-center justify-between gap-2"><h3 className="text-sm font-black text-slate-900 break-words">{address.name}</h3><div className="flex flex-wrap gap-1 text-[10px] font-bold">{address.isDefault && <span className="bg-amber-100 text-amber-900 rounded-md px-2 py-1">Predeterminada</span>}{active && <span className="bg-red-100 text-red-800 rounded-md px-2 py-1">En uso</span>}</div></div>
            <p className="text-sm text-slate-800 break-words">{address.address}</p>{address.details && <p className="text-xs text-slate-600 break-words">{address.details}</p>}
            <p className="text-xs text-slate-500">{address.municipality}{address.locality?` · ${address.locality}`:''}</p>
            <p role="status" className={`text-xs ${q?.eligibilityStatus==='OUT_OF_COVERAGE'?'text-rose-700 font-bold':'text-slate-600'}`}>{checking?'Comprobando cobertura…':!q?'Cobertura pendiente de comprobar':q.eligibilityStatus==='OUT_OF_COVERAGE'?'No disponible para entrega':q.territoryInfo?.isCovered?'Zona habilitada · Entrega sujeta a validación al seleccionar':q.message}</p>
            <div className="flex flex-wrap gap-2 pt-1">
              <button type="button" aria-label={`Usar ${address.name}`} onClick={()=>onUse(address.id)} className="min-h-11 px-3 bg-red-600 text-white rounded-xl text-xs font-bold flex items-center gap-1"><Check className="w-4 h-4"/>{active?'Volver a validar':'Usar dirección'}</button>
              <button type="button" aria-label={`Editar ${address.name}`} onClick={()=>onEdit(address)} className="min-h-11 px-3 rounded-xl bg-slate-100 text-slate-700 text-xs flex items-center gap-1"><Pencil className="w-4 h-4"/>Editar</button>
              <button type="button" aria-label={`Eliminar ${address.name}`} onClick={()=>onRemove(address.id)} className="min-h-11 px-3 rounded-xl bg-slate-100 text-slate-700 text-xs flex items-center gap-1"><Trash2 className="w-4 h-4"/>Eliminar</button>
              {!address.isDefault && <button type="button" aria-label={`Hacer predeterminada ${address.name}`} onClick={()=>onDefault(address.id)} className="min-h-11 px-3 rounded-xl bg-slate-100 text-slate-700 text-xs flex items-center gap-1"><Star className="w-4 h-4"/>Predeterminada</button>}
            </div>
          </article>;
        })}
      </div>
      <div className="p-4 border-t border-slate-100 bg-slate-50"><button type="button" onClick={onContinue} className="min-h-11 w-full rounded-xl bg-slate-900 text-white text-sm font-bold">{current && quote?.territoryInfo?.isCovered && quote.effectiveMode==='PROGRAMADO'?'Elegir horario de entrega':'Continuar explorando'}</button></div>
    </section>
  </div>;
}
