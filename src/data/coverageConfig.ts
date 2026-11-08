import type { DeliveryMode } from '../types';

export const COVERAGE_NOTICE = {
  title: '¡Muy pronto llegaremos a tu zona!',
  message: 'Por ahora no tenemos entregas disponibles en esta dirección. Estamos en zonas habilitadas de Bogotá, Soacha, Chía y Cajicá',
  actionLabel: 'Cambiar dirección',
};
export interface ScheduledMunicipalService {
  routeReference: string;
  verifiedAt: string;
  weekdays: number[]; // Bogotá local calendar: 0 Sunday ... 6 Saturday
  windowIds: string[]; // Existing scheduled window IDs
  capacityPerWindow: number;
  pricing: { shipping: number; freeShippingFrom: number; serviceFee: number };
}
export interface CoverageMunicipality {
  code: string; name: string; aliases: string[]; active: boolean;
  modes: DeliveryMode[];
  scheduledStoreId?: string; // Bogotá uses the existing locality assignment registry
  zone: 'BOGOTA_URBAN' | 'SOACHA_ENABLED_URBAN' | 'MUNICIPAL_SEAT';
  bounds?: { minLat:number; maxLat:number; minLng:number; maxLng:number };
  /** Explicit legacy service or verified route; null blocks new routes pending verification. */
  scheduledService: ScheduledMunicipalService | 'EXISTING_SERVICE' | null;
}
// Chía/Cajicá: user-approved reuse of Bogotá service (days, windows, capacity and pricing), dispatched from Suba.
// Protected source configuration: changing a warehouse/provider NEVER adds a destination.
// Geometry is independently resolved on the server; browser names are only hints.
export const COVERAGE_MUNICIPALITIES: CoverageMunicipality[] = [
  {code:'11001',name:'Bogotá D.C.',aliases:['Bogotá','Bogota DC','Bogotá Distrito Capital'],active:true,modes:['TURBO','TURBO_DIVIDIDO','PROGRAMADO'],zone:'BOGOTA_URBAN',scheduledService:'EXISTING_SERVICE'},
  {code:'25754',name:'Soacha',aliases:['Municipio de Soacha','Soacha Cundinamarca'],active:true,modes:['PROGRAMADO'],scheduledStoreId:'HUB_KENNEDY',zone:'SOACHA_ENABLED_URBAN',bounds:{minLat:4.540,maxLat:4.605,minLng:-74.240,maxLng:-74.195},scheduledService:'EXISTING_SERVICE'},
  {code:'25175',name:'Chía',aliases:['Chía Cundinamarca','Municipio de Chía'],active:true,modes:['PROGRAMADO'],scheduledStoreId:'HUB_SUBA',zone:'MUNICIPAL_SEAT',scheduledService:'EXISTING_SERVICE'},
  {code:'25126',name:'Cajicá',aliases:['Cajicá Cundinamarca','Municipio de Cajicá'],active:true,modes:['PROGRAMADO'],scheduledStoreId:'HUB_SUBA',zone:'MUNICIPAL_SEAT',scheduledService:'EXISTING_SERVICE'},
];
export function normalizeTerritoryString(value?: string | null): string {
  return typeof value==='string' ? value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[.,\-_#/]/g,' ').replace(/\s+/g,' ').trim() : '';
}
export function coverageMunicipality(value?: string | null, config=COVERAGE_MUNICIPALITIES) {
  const key=normalizeTerritoryString(value);
  return config.find(m=>[m.name,m.code,...m.aliases].some(alias=>normalizeTerritoryString(alias)===key));
}
export function scheduledServiceReady(service: ScheduledMunicipalService | 'EXISTING_SERVICE' | null | undefined): boolean {
  if(service==='EXISTING_SERVICE') return true; // Reuse approved service; warehouse capacity is still checked independently
  return !!service && !!service.routeReference?.trim() && Number.isFinite(Date.parse(service.verifiedAt))
    && service.weekdays?.length>0 && service.weekdays.every(d=>Number.isInteger(d)&&d>=0&&d<=6)
    && service.windowIds?.length>0 && service.windowIds.every(id=>['HORARIO_1','HORARIO_2','HORARIO_3'].includes(id))
    && Number.isSafeInteger(service.capacityPerWindow) && service.capacityPerWindow>0
    && !!service.pricing && [service.pricing.shipping,service.pricing.freeShippingFrom,service.pricing.serviceFee].every(n=>Number.isSafeInteger(n)&&n>=0);
}
