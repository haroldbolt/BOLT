import {ExternalProviderFields} from './ExternalProviderFields';
import React, {useState,useEffect} from 'react';
import {api} from '../../lib/api';
import type {Product,DriverProfile,Store} from '../../types';
import type {TransportAttributes,TransportConfig,TransportVehicle} from '../../types/transport';
import type {ScheduledSlot} from '../../lib/deliveryService';
const input='border border-slate-300 rounded-xl p-2 w-full bg-white text-sm';
function NumberField({label,value,onChange}:{label:string;value:number|undefined;onChange:(n:number)=>void}) {
  return <label className="text-xs font-semibold space-y-1"><span>{label}</span><input className={input} type="number" min="0" step="1" value={value??''} onChange={e=>onChange(e.target.value===''?NaN:Number(e.target.value))}/></label>;
}
export function TransportManagerTab({admin,onAuthenticate}:{admin:any;onAuthenticate:()=>void}) {
  const [config,setConfig]=useState<TransportConfig>();const [revision,setRevision]=useState('');
  const [drivers,setDrivers]=useState<DriverProfile[]>([]);const [stores,setStores]=useState<Store[]>([]);
  const [slots,setSlots]=useState<ScheduledSlot[]>([]);
  const [message,setMessage]=useState('');const [busy,setBusy]=useState(false);
  const [query,setQuery]=useState('');const [products,setProducts]=useState<Product[]>([]);const [product,setProduct]=useState<Product>();const [variantId,setVariantId]=useState('');
  const [attributes,setAttributes]=useState<Partial<TransportAttributes>>({});const [previous,setPrevious]=useState<TransportAttributes>();
  const [auditCount,setAuditCount]=useState(0);
  async function load() {try{const r=await api.transportAdmin('transport');setConfig(r.config);setRevision(r.revision);setDrivers(r.drivers);setStores(r.stores);setSlots(r.scheduledSlots);setAuditCount(r.audit.length);}catch(e:any){setMessage(e.message);}}
  useEffect(()=>{if(admin)void load();},[admin]);
  if(!admin)return <div className="bg-white p-6 rounded-2xl"><p>Inicia sesión administrativa para gestionar capacidades y transporte.</p><button onClick={onAuthenticate} className="mt-3 bg-red-600 text-white p-3 rounded-xl">Iniciar sesión</button></div>;
  const run=async(action:()=>Promise<void>)=>{if(busy)return;setBusy(true);setMessage('');try{await action();}catch(e:any){setMessage(e.message);}finally{setBusy(false);}};
  const changeVehicle=(index:number,patch:Partial<TransportVehicle>)=>setConfig(c=>c && ({...c,vehicles:c.vehicles.map((v,i)=>i===index?{...v,...patch}:v)}));
  const choose=(p:Product,id:string)=>{setProduct(p);setVariantId(id);const t=id?p.presentaciones?.find(v=>v.varianteId===id)?.transport:p.transport;setPrevious(t);setAttributes(t?structuredClone(t):{bulky:false,lightMarginEligible:false});};
  return <div className="space-y-5">
    <h2 className="text-xl font-black">Flota y capacidad de transporte</h2>
    <p className="text-sm text-slate-600">Registra capacidades verificadas. El peso comercial base y la capacidad física son límites independientes. Los cambios no reasignan pedidos confirmados.</p>
    <p role="status" className="text-sm text-red-700">{message}</p>
    {config && <form onSubmit={e=>{e.preventDefault();void run(async()=>{const r=await api.transportAdmin('transport','PUT',{config,revision});setRevision(r.revision);setAuditCount(r.audit.length);setMessage('Configuración guardada con auditoría.');});}} className="bg-white border rounded-2xl p-4 space-y-4">
      <h3 className="font-bold">Límites y tarifas por compra</h3>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <NumberField label="Límite base (g, máximo 50.000)" value={config.baseLimitGrams} onChange={baseLimitGrams=>setConfig({...config,baseLimitGrams})}/>
        <NumberField label="Margen ligero total (g, máximo 3.000)" value={config.lightMarginGrams} onChange={lightMarginGrams=>setConfig({...config,lightMarginGrams})}/>
        <NumberField label="Tope opcional de repartidores (vacío: sin tope; 0: pausa)" value={config.maxDispatches??undefined} onChange={maxDispatches=>setConfig({...config,maxDispatches:Number.isFinite(maxDispatches)?maxDispatches:null})}/>
        <NumberField label="Transporte Programado por compra (COP)" value={config.pricing.shipping} onChange={shipping=>setConfig({...config,pricing:{...config.pricing,shipping}})}/>
        <NumberField label="Programado gratis desde (COP)" value={config.pricing.freeShippingFrom} onChange={freeShippingFrom=>setConfig({...config,pricing:{...config.pricing,freeShippingFrom}})}/>
        <NumberField label="Transporte Turbo por compra (COP)" value={config.pricing.turbo?.shipping ?? config.pricing.shipping} onChange={shipping=>setConfig({...config,pricing:{...config.pricing,turbo:{freeShippingFrom:config.pricing.turbo?.freeShippingFrom ?? config.pricing.freeShippingFrom,shipping}}})}/>
        <NumberField label="Turbo gratis desde (COP)" value={config.pricing.turbo?.freeShippingFrom ?? config.pricing.freeShippingFrom} onChange={freeShippingFrom=>setConfig({...config,pricing:{...config.pricing,turbo:{shipping:config.pricing.turbo?.shipping ?? config.pricing.shipping,freeShippingFrom}}})}/>
        <NumberField label="Servicio por compra (COP)" value={config.pricing.serviceFee} onChange={serviceFee=>setConfig({...config,pricing:{...config.pricing,serviceFee}})}/>
      </div>
      <p className="text-xs text-slate-600">La tarifa Turbo se cobra una sola vez por compra, incluidas entregas divididas. Los costos del proveedor se conservan para operación y no se suman a esa tarifa. Servicio en 0 significa gratis.</p>
      <h3 className="font-bold">Vehículos de conductores registrados</h3>
      {config.vehicles.map((v,index)=><fieldset key={index} className="border rounded-2xl p-3 space-y-3"><legend>Vehículo {index+1}</legend>
        <label className="block text-xs">Conductor <select aria-label={`Conductor del vehículo ${index+1}`} className={input} value={v.driverId} onChange={e=>changeVehicle(index,{driverId:e.target.value})}><option value="">Seleccionar</option>{drivers.map(d=><option key={d.id} value={d.id}>{d.name} · {d.vehiclePlate} · {d.isOnline?d.currentStatus:'Desconectado'}</option>)}</select></label>
        <div className="flex flex-wrap gap-3 text-xs"><label><input type="checkbox" checked={v.enabled} onChange={e=>changeVehicle(index,{enabled:e.target.checked})}/> Capacidad verificada y habilitada</label>{(['TURBO','PROGRAMADO'] as const).map(mode=><label key={mode}><input type="checkbox" checked={v.modes.includes(mode)} onChange={e=>changeVehicle(index,{modes:e.target.checked?[...v.modes,mode]:v.modes.filter(m=>m!==mode)})}/> {mode}</label>)}</div>
        <div className="flex flex-wrap gap-3 text-xs">{stores.map(s=><label key={s.id}><input type="checkbox" checked={v.storeIds.includes(s.id)} onChange={e=>changeVehicle(index,{storeIds:e.target.checked?[...v.storeIds,s.id]:v.storeIds.filter(id=>id!==s.id)})}/> {s.customerName||s.name}</label>)}</div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3"><NumberField label="Carga útil física máxima (g)" value={v.maxLoadGrams} onChange={maxLoadGrams=>changeVehicle(index,{maxLoadGrams})}/><NumberField label="Embalaje adicional por despacho (g)" value={v.packagingGrams} onChange={packagingGrams=>changeVehicle(index,{packagingGrams})}/><NumberField label="Volumen útil disponible (cm³)" value={v.maxVolumeCm3} onChange={maxVolumeCm3=>changeVehicle(index,{maxVolumeCm3})}/>{['Largo útil','Ancho útil','Alto útil'].map((name,j)=><NumberField key={name} label={name+' (cm)'} value={v.cargoDimensionsCm[j]} onChange={n=>{const dims=[...v.cargoDimensionsCm] as [number,number,number];dims[j]=n;changeVehicle(index,{cargoDimensionsCm:dims});}}/>)}</div>
        <fieldset className="text-xs space-y-2"><legend className="font-semibold">Disponibilidad confirmada para Programados</legend><p>Habilita únicamente las franjas en que este conductor y vehículo estarán disponibles.</p><div className="grid sm:grid-cols-2 gap-2">{slots.filter(s=>!s.cutoffPassed).map(s=>{const key=`${s.date}|${s.slotId}`;return <label key={key} className="flex items-center gap-2 border rounded-lg p-2"><input type="checkbox" checked={v.scheduledSlots.includes(key)} onChange={e=>changeVehicle(index,{scheduledSlots:e.target.checked?[...v.scheduledSlots,key]:v.scheduledSlots.filter(k=>k!==key)})}/>{s.dateLabel} · {s.displayWindowFull}</label>;})}</div></fieldset>
        <button type="button" className="text-red-700 text-sm underline" onClick={()=>setConfig({...config,vehicles:config.vehicles.filter((_,i)=>i!==index)})}>Retirar vehículo de esta configuración</button>
      </fieldset>)}
      <button type="button" className="border p-2 rounded-xl" onClick={()=>setConfig({...config,vehicles:[...config.vehicles,{driverId:'',enabled:false,storeIds:[],modes:[],maxLoadGrams:0,maxVolumeCm3:0,packagingGrams:0,cargoDimensionsCm:[0,0,0],scheduledSlots:[]}]})}>Añadir vehículo existente</button>
      <ExternalProviderFields providers={config.externalProviders||[]} stores={stores} slots={slots} onChange={externalProviders=>setConfig({...config,externalProviders})}/>
      <button disabled={busy} className="ml-3 bg-red-600 text-white p-3 rounded-xl disabled:opacity-50">Guardar capacidades y tarifas</button><p className="text-xs text-slate-500">{auditCount} cambios registrados. Recarga si otro administrador modificó esta configuración.</p>
    </form>}
    <section className="bg-white border rounded-2xl p-4 space-y-3"><h3 className="font-bold">Datos físicos por presentación</h3>
      <div className="flex gap-2"><input aria-label="Buscar presentación para transporte" placeholder="Nombre o SKU" className={input} value={query} onChange={e=>setQuery(e.target.value)}/><button disabled={busy} className="border rounded-xl p-2" onClick={()=>void run(async()=>setProducts(await api.getAdminCatalog({q:query})))}>Buscar</button></div>
      <select aria-label="Producto para transporte" className={input} value={product?.id||''} onChange={e=>{const p=products.find(p=>p.id===e.target.value);if(p)choose(p,p.presentaciones?.[0]?.varianteId||'');}}><option value="">Selecciona producto</option>{products.map(p=><option key={p.id} value={p.id}>{p.name} · {p.sku}</option>)}</select>
      {product && <form className="space-y-3" onSubmit={e=>{e.preventDefault();void run(async()=>{const r=await api.transportAdmin('catalog/transport','PUT',{productId:product.id,variantId,transport:attributes,previous});setProduct(r.product);setPrevious(attributes as TransportAttributes);setMessage('Atributos de esta presentación guardados; precio e inventario conservados.');});}}>
        {!!product.presentaciones?.length && <select aria-label="Presentación para transporte" className={input} value={variantId} onChange={e=>choose(product,e.target.value)}>{product.presentaciones.map(v=><option key={v.varianteId} value={v.varianteId}>{v.nombre} · {v.sku}</option>)}</select>}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3"><NumberField label="Peso real por unidad vendible (g)" value={attributes.weightGrams} onChange={weightGrams=>setAttributes({...attributes,weightGrams})}/><NumberField label="Embalaje de la unidad (g)" value={attributes.packagingGrams} onChange={packagingGrams=>setAttributes({...attributes,packagingGrams})}/>{['Largo embalado','Ancho embalado','Alto embalado'].map((name,j)=><NumberField key={name} label={name+' (cm)'} value={attributes.dimensionsCm?.[j]} onChange={n=>{const dims=[...(attributes.dimensionsCm||[0,0,0])] as [number,number,number];dims[j]=n;setAttributes({...attributes,dimensionsCm:dims});}}/>)}</div>
        <div className="flex flex-wrap gap-4 text-sm"><label><input type="checkbox" checked={attributes.bulky||false} onChange={e=>setAttributes({...attributes,bulky:e.target.checked})}/> Voluminoso</label><label><input type="checkbox" checked={attributes.lightMarginEligible||false} onChange={e=>setAttributes({...attributes,lightMarginEligible:e.target.checked})}/> Apto para margen ligero</label><label>Tipo de accesorio <select value={attributes.kind||'OTRO'} onChange={e=>setAttributes({...attributes,kind:e.target.value as any})}><option value="OTRO">Otro</option><option value="JUGUETES">Juguetes</option><option value="MODA">Moda</option></select></label></div>
        <p className="text-xs text-slate-600">Comida y arena no reciben margen. La categoría, el peso máximo de 3 kg, la aptitud y el volumen se comprueban juntos.</p>
        <button disabled={busy} className="bg-red-600 text-white p-3 rounded-xl disabled:opacity-50">Guardar datos de la presentación</button>
      </form>}
    </section>
  </div>;
}
