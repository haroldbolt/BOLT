import type {ExternalProviderResponse,TransportConfig,TransportVehicle} from '../types/transport';
/** Read-only quote adapter. SIMULATION only: never calls or books Rappi. */
export function externalAvailability(config:TransportConfig,now=Date.now(),scope?:{storeId:string;mode:string}):{vehicles:TransportVehicle[];responses:ExternalProviderResponse[]} {
 const vehicles:TransportVehicle[]=[],responses:ExternalProviderResponse[]=[];
 for(const p of config.externalProviders || []) {
  if(!p.enabled || p.integration!=='SIMULATION' || scope && (!p.storeIds.includes(scope.storeId) || !p.modes.includes(scope.mode as any))) continue;
  const status=p.response==='REJECTED'?'REJECTED':now>=Date.parse(p.offerExpiresAt)?'EXPIRED':p.response==='DELAYED' && now<Date.parse(p.respondsAt)?'PENDING':'ACCEPTED';
  responses.push({providerId:p.id,providerName:p.name,status,simulation:true,message:status==='ACCEPTED'?'Proveedor simulado: oferta aceptada con capacidad, costo y tiempo.':status==='PENDING'?'Esperando respuesta del proveedor simulado. No se ha reservado un repartidor.':status==='EXPIRED'?'La oferta del proveedor simulado venció.':'El proveedor simulado rechazó la solicitud.'});
  if(status!=='ACCEPTED') continue;
  // The planner accepts at most 1,000 sellable units per calculation; extra offers cannot be used.
  for(let i=0;i<Math.min(p.availableVehicles,1000);i++) {
   const id=`SIM-EXT-${p.id}-${i+1}`;
   vehicles.push({driverId:id,storeIds:p.storeIds,enabled:true,modes:p.modes,maxLoadGrams:p.maxLoadGrams,cargoDimensionsCm:p.cargoDimensionsCm,maxVolumeCm3:p.maxVolumeCm3,packagingGrams:p.packagingGrams,scheduledSlots:p.scheduledSlots,
    externalOffer:{providerId:p.id,providerName:p.name,offerId:`${p.id}:${p.offerExpiresAt}:${i+1}`,expiresAt:p.offerExpiresAt,shippingCOP:p.shippingPerDispatchCOP,estimatedMinutes:p.estimatedMinutes,simulation:true,
     driver:{id,name:`SIMULACIÓN ${p.name} ${i+1}`,phone:'',vehiclePlate:'SIMULADO',vehicleType:'MOTO',rating:0,photo:''}}});
  }
 }
 return {vehicles,responses};
}
