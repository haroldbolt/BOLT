import { COVERAGE_MUNICIPALITIES } from './coverageConfig';
import type { Store } from '../types';

// Single operational registry. A new store starts with no coverage unless explicitly assigned.
export const SCHEDULED_TERRITORIES: Record<string,readonly string[]> = {
'HUB_KENNEDY': [
  'Kennedy',
  'Bosa',
  'Ciudad Bolívar',
  'Tunjuelito',
  'Usme',
  'Rafael Uribe Uribe',
  'San Cristóbal',
  'Antonio Nariño',
  'Puente Aranda',
  'Los Mártires',
  'Santa Fe',
  'La Candelaria',
],
'HUB_ALAMOS': [
  'Engativá',
  'Fontibón',
  'Teusaquillo',
  'Barrios Unidos',
  'Chapinero',
],
'HUB_SUBA': [
  'Suba',
  'Usaquén',
]
};

export const SCHEDULED_MUNICIPALITIES: Record<string,readonly string[]> = Object.fromEntries([...new Set(COVERAGE_MUNICIPALITIES.map(m=>m.scheduledStoreId).filter(Boolean))].map(id=>[id,COVERAGE_MUNICIPALITIES.filter(m=>m.scheduledStoreId===id).map(m=>m.name)]));

export const WAREHOUSES: Store[] = ([
  {
    id: 'HUB_KENNEDY',
    name: 'Bolt Pets Kennedy',
    address: 'Carrera 79A #2-05, Bogotá, Colombia',
    postalAddress: 'Carrera 79A #2-05, Bogotá, Colombia',
    coordinates: { lat: 4.6320297, lng: -74.1516306 },
    shopifyCoordinates: { lat: 4.6320297, lng: -74.1516306 },
    verifiedEntrance: { lat: 4.6320297, lng: -74.1516306 },
    verificationStatus: 'VERIFIED',
    verifiedAt: '2026-10-25 14:30 COT',
    verifiedBy: 'Coordinador Operativo Bogotá',
    placeId: 'ChIJz27b_KENNEDY_BOG',
    shopifyLocationGid: 'gid://shopify/Location/115617857816',
    turboEnabled: true,
    isActive: true,
    schedule: '07:00 - 23:00',
    maxDeliveryRadiusKm: 6.0,
    vehicleMaxWeightKg: 25,
    safetyStockDefault: 2,
  },
  {
    id: 'HUB_ALAMOS',
    name: 'Bolt Pets Álamos',
    address: 'Calle 72 #97A-18, Bogotá, Colombia',
    postalAddress: 'Calle 72 #97A-18, Bogotá, Colombia',
    coordinates: { lat: 4.7026365, lng: -74.1149105 },
    shopifyCoordinates: { lat: 4.7026365, lng: -74.1149105 },
    verifiedEntrance: { lat: 4.7026365, lng: -74.1149105 },
    verificationStatus: 'VERIFIED',
    verifiedAt: '2026-10-25 15:10 COT',
    verifiedBy: 'Coordinador Operativo Bogotá',
    placeId: 'ChIJ_ALAMOS_ENGATIVA_BOG',
    shopifyLocationGid: 'gid://shopify/Location/115617890584',
    turboEnabled: true,
    isActive: true,
    schedule: '07:00 - 23:00',
    maxDeliveryRadiusKm: 6.0,
    vehicleMaxWeightKg: 25,
    safetyStockDefault: 2,
  },
  {
    id: 'HUB_SUBA',
    name: 'Bolt Pets Suba',
    address: 'Carrera 107 #143-31, Bogotá, Colombia',
    postalAddress: 'Carrera 107 #143-31, Bogotá, Colombia',
    coordinates: { lat: 4.747154, lng: -74.098137 },
    shopifyCoordinates: { lat: 4.747154, lng: -74.098137 },
    verifiedEntrance: { lat: 4.747154, lng: -74.098137 },
    verificationStatus: 'VERIFIED',
    verifiedAt: '2026-10-25 15:45 COT',
    verifiedBy: 'Coordinador Operativo Bogotá',
    placeId: 'ChIJ_SUBA_PINAR_BOG',
    shopifyLocationGid: 'gid://shopify/Location/115617923352',
    turboEnabled: true,
    isActive: true,
    schedule: '07:00 - 23:00',
    maxDeliveryRadiusKm: 6.0,
    vehicleMaxWeightKg: 25,
    safetyStockDefault: 2,
  },
  {
    id: 'HUB_CENTRO',
    name: 'Sede Centro Histórico',
    address: 'Calle 11 #15-53, La Candelaria / Centro, Bogotá',
    postalAddress: 'Calle 11 #15-53, La Candelaria / Centro, Bogotá',
    coordinates: { lat: 4.6028, lng: -74.0754 },
    shopifyCoordinates: { lat: 4.6028, lng: -74.0754 },
    verifiedEntrance: { lat: 4.6028, lng: -74.0754 },
    verificationStatus: 'VERIFIED',
    verifiedAt: '2026-10-20 10:00 COT',
    verifiedBy: 'Administración General',
    shopifyLocationGid: 'gid://shopify/Location/115617999999',
    turboEnabled: false, // Fuera de la red Turbo de Bolt Pets, para operaciones administrativas
    isActive: true,
    schedule: '08:00 - 20:00',
    maxDeliveryRadiusKm: 5.0,
    vehicleMaxWeightKg: 15,
    safetyStockDefault: 5,
  },
  {
    id: 'HUB_FONTIBON',
    name: 'Bolt Pets Fontibón',
    address: 'Calle 17 #99-42, Fontibón, Bogotá, Colombia',
    postalAddress: 'Calle 17 #99-42, Fontibón, Bogotá, Colombia',
    coordinates: { lat: 4.6750, lng: -74.1480 },
    shopifyCoordinates: { lat: 4.6750, lng: -74.1480 },
    verifiedEntrance: { lat: 4.6750, lng: -74.1480 },
    verificationStatus: 'UNVERIFIED',
    verifiedAt: undefined,
    shopifyLocationGid: 'gid://shopify/Location/115617934444',
    turboEnabled: false,
    isActive: false, // Ubicación inactiva
    schedule: 'Inactiva (En remodelación)',
    maxDeliveryRadiusKm: 5.0,
    vehicleMaxWeightKg: 20,
    safetyStockDefault: 2,
  },
] as Store[]).map(store => ({
  ...store,
  customerName:store.customerName || store.name.replace(/^Bolt Pets /, ''),
  showAddressToCustomer:store.showAddressToCustomer ?? true,
  enabledModes:store.enabledModes ?? (store.turboEnabled ? ['TURBO','TURBO_DIVIDIDO','PROGRAMADO'] : ['PROGRAMADO']),
  scheduledLocalities:store.scheduledLocalities ?? SCHEDULED_TERRITORIES[store.id] ?? [],
  scheduledMunicipalities:store.scheduledMunicipalities ?? SCHEDULED_MUNICIPALITIES[store.id] ?? [],
} as Store));

export function validateWarehouseConfiguration(stores:Store[]) {
  const ids=new Set<string>(),territories=new Set<string>();
  for(const store of stores) {
    if(!store.id || !store.name || ids.has(store.id)) throw Error('ID de sede vacío o duplicado: '+store.id);
    ids.add(store.id);
    for(const territory of [...(store.scheduledLocalities || []),...(store.scheduledMunicipalities || [])]) {
      const key=territory.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim();
      if(territories.has(key)) throw Error('Territorio asignado a más de una sede: '+territory);
      territories.add(key);
    }
  }
}
validateWarehouseConfiguration(WAREHOUSES);
