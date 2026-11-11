import {externalAvailability} from './externalDelivery';
import type { Product, DriverProfile, Order } from '../types';
import { DEFAULT_TRANSPORT_CONFIG, type TransportAttributes, type TransportConfig, type TransportLoad, type TransportVehicle } from '../types/transport';
export { DEFAULT_TRANSPORT_CONFIG };
export type TransportContext = { config: TransportConfig; drivers: DriverProfile[]; orders: Order[] };
type Item = { productId: string; quantity: number };
type Unit = { product: Product; data: TransportAttributes; eligible: boolean };
export type PlannedDispatch = TransportLoad & { items: Item[] };
export type TransportPlan = { feasible: boolean; reasonCode: string; message: string; shipments: PlannedDispatch[]; missingProductIds: string[] };
const positive = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0;
const integer = (v: unknown, zero=false) => Number.isSafeInteger(v) && Number(v) >= (zero ? 0 : 1);
export function validDimensions(v: unknown): v is [number,number,number] { return Array.isArray(v) && v.length===3 && v.every(n=>positive(n) && n<=10000); }
export function validateTransportAttributes(value: unknown): value is TransportAttributes {
  const v=value as TransportAttributes;
  return !!v && integer(v.weightGrams) && integer(v.packagingGrams,true) && validDimensions(v.dimensionsCm) && typeof v.bulky==='boolean' && typeof v.lightMarginEligible==='boolean' && (!v.kind || ['JUGUETES','MODA','OTRO'].includes(v.kind));
}
export function validateTransportConfig(c: TransportConfig, drivers: DriverProfile[], storeIds: string[]): void {
  if(!c || c.version!==1 || !integer(c.baseLimitGrams) || c.baseLimitGrams>50000 || !integer(c.lightMarginGrams,true) || c.lightMarginGrams>3000 || c.maxDispatches!==null && !integer(c.maxDispatches,true) || !Array.isArray(c.vehicles)) throw Error('Límites inválidos: máximo 50.000 g base, 3.000 g de margen; máximo de entregas opcional, 0 deshabilita la operación.');
  if(!c.pricing || !['shipping','freeShippingFrom','serviceFee'].every(k=>integer((c.pricing as any)[k],true))) throw Error('Tarifas COP inválidas.');
  if(c.pricing.turbo!==undefined && (!c.pricing.turbo || !['shipping','freeShippingFrom'].every(k=>integer((c.pricing.turbo as any)[k],true)))) throw Error('Tarifas Turbo COP inválidas.');
  if(c.externalProviders!==undefined && !Array.isArray(c.externalProviders)) throw Error('Configuración de proveedores inválida.');
  const providerIds=new Set();
  for(const p of c.externalProviders || []) {
    if(!p.id || !/^[a-z0-9-]+$/i.test(p.id) || providerIds.has(p.id) || !p.name?.trim() || p.integration!=='SIMULATION' || typeof p.enabled!=='boolean' || !['ACCEPTED','DELAYED','REJECTED'].includes(p.response) || !Number.isFinite(Date.parse(p.respondsAt)) || !Number.isFinite(Date.parse(p.offerExpiresAt)) || !integer(p.availableVehicles,true) || !integer(p.shippingPerDispatchCOP,true) || !integer(p.estimatedMinutes) || !Array.isArray(p.storeIds) || !p.storeIds.length || p.storeIds.some(id=>!storeIds.includes(id)) || !Array.isArray(p.modes) || p.modes.some(m=>!['TURBO','PROGRAMADO'].includes(m)) || !integer(p.maxLoadGrams) || !integer(p.packagingGrams,true) || p.maxLoadGrams<=p.packagingGrams || !validDimensions(p.cargoDimensionsCm) || !positive(p.maxVolumeCm3) || p.maxVolumeCm3>p.cargoDimensionsCm.reduce((a,b)=>a*b,1) || !Array.isArray(p.scheduledSlots) || p.scheduledSlots.some(s=>!/^\d{4}-\d{2}-\d{2}\|.+$/.test(s))) throw Error('Proveedor: completa capacidad, costo, tiempo, vigencia, disponibilidad y sedes. Solo se admite simulación; Rappi no está integrado.');
    providerIds.add(p.id);
  }
  const ids=new Set();
  for(const v of c.vehicles) {
    if(v.externalOffer || !drivers.some(d=>d.id===v.driverId) || ids.has(v.driverId)) throw Error('Selecciona un conductor existente y único por vehículo.');
    ids.add(v.driverId);
    if(typeof v.enabled!=='boolean' || !Array.isArray(v.storeIds) || !v.storeIds.length || v.storeIds.some(id=>!storeIds.includes(id)) || !Array.isArray(v.modes) || v.modes.some(m=>!['TURBO','PROGRAMADO'].includes(m)) || !integer(v.maxLoadGrams) || !integer(v.packagingGrams,true) || v.maxLoadGrams<=v.packagingGrams || !validDimensions(v.cargoDimensionsCm) || !positive(v.maxVolumeCm3) || v.maxVolumeCm3>v.cargoDimensionsCm.reduce((a,b)=>a*b,1) || !Array.isArray(v.scheduledSlots) || v.scheduledSlots.some(s=>typeof s!=='string' || !/^\d{4}-\d{2}-\d{2}\|.+$/.test(s))) throw Error('Capacidad, sede, modalidades o disponibilidad del vehículo inválidas.');
  }
}
function isLight(p: Product, t: TransportAttributes, config: TransportConfig) {
  const candidate = ['Snacks','Juguetes','Moda','Aseo','Higiene'].includes(p.category) || (p.category==='Accesorios' && ['JUGUETES','MODA'].includes(t.kind || ''));
  return candidate && t.lightMarginEligible && !t.bulky && t.weightGrams<=Math.min(3000,config.lightMarginGrams);
}
function occupied(context: TransportContext, driverId: string, mode: string, slot?: string, excludeOrderId?: string) {
  return context.orders.some(o=>o.id!==excludeOrderId && (o.childShipments?.length ? o.childShipments : [o]).some(s=> {
    if((s.driver?.id || s.transportLoad?.driverId)!==driverId || s.fulfillmentStatus==='ENTREGADO' || s.fulfillmentStatus==='CANCELADO' && !s.physicalReturnPending) return false;
    if(mode==='PROGRAMADO') return o.deliveryMode==='PROGRAMADO' && `${o.scheduledWindow?.date}|${o.scheduledWindow?.slotId}`===slot;
    return o.deliveryMode!=='PROGRAMADO' || ['EN_CAMINO','REPARTIDOR_ASIGNADO'].includes(s.fulfillmentStatus) || !!s.physicalReturnPending;
  }));
}
export function availableVehicles(context: TransportContext, storeId: string, mode: 'TURBO'|'PROGRAMADO', slot?: string, excludeOrderId?: string) {
  const external=externalAvailability(context.config,Date.now(),{storeId,mode});
  return [...context.config.vehicles,...external.vehicles].filter(v=>v.enabled && v.storeIds.includes(storeId) && v.modes.includes(mode) && !occupied(context,v.driverId,mode,slot,excludeOrderId) && (v.externalOffer
    ? mode==='PROGRAMADO' ? !!slot && v.scheduledSlots.includes(slot) : v.externalOffer.estimatedMinutes<=25
    : context.drivers.some(d=>d.id===v.driverId && d.operationalEligible!==false && (mode==='PROGRAMADO' ? !!slot && v.scheduledSlots.includes(slot) : d.isOnline && d.currentStatus==='DISPONIBLE' && !d.activeOrderId))));
}
/** Conservative orthogonal packing, disjoint free boxes. Whole packaged units, no compression. */
function boxesFit(units: Unit[], vehicle: TransportVehicle) {
  const spaces: number[][] = [[...vehicle.cargoDimensionsCm]];
  const boxes=units.map(u=>u.data.dimensionsCm).sort((a,b)=>b.reduce((x,y)=>x*y,1)-a.reduce((x,y)=>x*y,1));
  for(const box of boxes) {
    const [a,b,c]=box, rotations=[[a,b,c],[a,c,b],[b,a,c],[b,c,a],[c,a,b],[c,b,a]];
    let placed=false;
    for(let i=0;i<spaces.length && !placed;i++) for(const r of rotations) {
      const s=spaces[i]; if(!r.every((n,j)=>n<=s[j])) continue;
      spaces.splice(i,1);
      spaces.push([s[0]-r[0],s[1],s[2]],[r[0],s[1]-r[1],s[2]],[r[0],r[1],s[2]-r[2]]);
      for(let j=spaces.length-1;j>=0;j--) if(spaces[j].some(n=>n<=0)) spaces.splice(j,1);
      placed=true; break;
    }
    if(!placed) return false;
  }
  return true;
}
function load(units: Unit[], v: TransportVehicle, storeId: string): TransportLoad {
  const productWeightGrams=units.reduce((a,u)=>a+u.data.weightGrams,0);
  return {driverId:v.driverId,storeId,productWeightGrams,
    nonEligibleWeightGrams:units.reduce((a,u)=>a+(u.eligible?0:u.data.weightGrams),0),
    grossWeightGrams:productWeightGrams+v.packagingGrams+units.reduce((a,u)=>a+u.data.packagingGrams,0),
    volumeCm3:units.reduce((a,u)=>a+u.data.dimensionsCm.reduce((x,y)=>x*y,1),0),lightMarginUsedGrams:0,vehicle:v};
}
function fits(units: Unit[], v: TransportVehicle, storeId: string, c: TransportConfig, mode: string) {
  const l=load(units,v,storeId);
  return (mode==='PROGRAMADO' || l.nonEligibleWeightGrams<=c.baseLimitGrams && l.productWeightGrams<=c.baseLimitGrams+c.lightMarginGrams)
    && l.grossWeightGrams<=v.maxLoadGrams && l.volumeCm3<=v.maxVolumeCm3 && boxesFit(units,v);
}
export function planTransport(items: Item[], catalog: Product[], storeId: string, mode: 'TURBO'|'PROGRAMADO', context: TransportContext, slot?: string): TransportPlan {
  const fail=(reasonCode:string,message:string,missingProductIds:string[]=[]):TransportPlan=>({feasible:false,reasonCode,message,shipments:[],missingProductIds});
  const units: Unit[]=[]; const missing:string[]=[];
  for(const i of items) {
    if(!integer(i.quantity) || i.quantity>1000 || units.length+i.quantity>1000) return fail('INVALID_QUANTITY','Cantidad inválida o compra superior al máximo de planificación (1.000 unidades).');
    const p=catalog.find(p=>p.id===i.productId);
    if(!p || !validateTransportAttributes(p.transport)) {missing.push(i.productId);continue;}
    for(let n=0;n<i.quantity;n++) units.push({product:p,data:p.transport,eligible:isLight(p,p.transport,context.config)});
  }
  if(missing.length) return fail('TRANSPORT_DATA_PENDING','Faltan peso, embalaje o dimensiones verificadas de una presentación. Conservamos tu carrito; consulta la sede antes de confirmar.',missing);
  if(!units.length) return fail('EMPTY_BASKET','Agrega productos para calcular las entregas.');
  if(context.config.maxDispatches===0) return fail('FLEET_CONFIGURATION_PENDING','El transporte está pausado en la configuración operativa. Conservamos tu carrito.');
  const fleet=availableVehicles(context,storeId,mode,slot).sort((a,b)=>Number(!!a.externalOffer)-Number(!!b.externalOffer) || b.maxLoadGrams-a.maxLoadGrams || b.maxVolumeCm3-a.maxVolumeCm3 || a.driverId.localeCompare(b.driverId));
  if(!fleet.length) {
    const responses=externalAvailability(context.config,Date.now(),{storeId,mode}).responses;
    const pending=responses.find(r=>r.status==='PENDING');
    return fail(pending?'PROVIDER_RESPONSE_PENDING':responses.length?'PROVIDER_UNAVAILABLE':'NO_AVAILABLE_VEHICLES',pending?.message || (responses.length?'La red externa no confirmó vehículos aptos para esta compra. Revisa las franjas programadas disponibles.':'No hay vehículos disponibles con capacidad verificada para esta modalidad y sede.'));
  }
  units.sort((a,b)=>Number(a.eligible)-Number(b.eligible) || Number(b.data.bulky)-Number(a.data.bulky) || b.data.weightGrams-a.data.weightGrams || b.data.dimensionsCm.reduce((x,y)=>x*y,1)-a.data.dimensionsCm.reduce((x,y)=>x*y,1) || a.product.id.localeCompare(b.product.id));
  const bins:{vehicle:TransportVehicle;units:Unit[]}[]=[];
  for(const unit of units) {
    let bin=bins.find(b=>fits([...b.units,unit],b.vehicle,storeId,context.config,mode));
    if(!bin) {
      const vehicle=fleet.find(v=>!bins.some(b=>b.vehicle.driverId===v.driverId) && fits([unit],v,storeId,context.config,mode));
      if(!vehicle || context.config.maxDispatches!==null && bins.length>=context.config.maxDispatches) return fail(fleet.some(v=>fits([unit],v,storeId,context.config,mode))?'INSUFFICIENT_VEHICLES':'UNIT_EXCEEDS_CAPACITY',fleet.some(v=>fits([unit],v,storeId,context.config,mode))?'No hay suficientes vehículos para transportar todas las unidades. Revisa la alternativa programada.':'Una unidad completa excede la capacidad o el espacio disponible. Revisa un vehículo programado adecuado.');
      bin={vehicle,units:[]}; bins.push(bin);
    }
    bin.units.push(unit);
  }
  const shipments=bins.map(b=>{
    const l=load(b.units,b.vehicle,storeId); const quantities=new Map<string,number>();
    b.units.forEach(u=>quantities.set(u.product.id,(quantities.get(u.product.id)||0)+1));
    return {...l,lightMarginUsedGrams:mode==='TURBO'?Math.max(0,l.productWeightGrams-context.config.baseLimitGrams):0,items:[...quantities].map(([productId,quantity])=>({productId,quantity}))};
  });
  return {feasible:true,reasonCode:'CAPACITY_VERIFIED',message:`Tu compra se organizará en ${shipments.length} ${shipments.length===1?'entrega':'entregas'} para transportar correctamente tus productos.`,shipments,missingProductIds:[]};
}
