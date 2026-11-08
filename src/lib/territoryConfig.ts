import { WAREHOUSES } from '../data/warehouseConfig';
import { COVERAGE_MUNICIPALITIES, coverageMunicipality, normalizeTerritoryString } from '../data/coverageConfig';
export { normalizeTerritoryString } from '../data/coverageConfig';
// Programado: existing locality-to-warehouse registry + explicit municipality policy.
export const TERRITORIAL_WAREHOUSES = {
  KENNEDY: WAREHOUSES.find(s=>s.id==='HUB_KENNEDY')!,
  ALAMOS: WAREHOUSES.find(s=>s.id==='HUB_ALAMOS')!,
  SUBA: WAREHOUSES.find(s=>s.id==='HUB_SUBA')!,
};

export type TerritorialWarehouseId = string;

// 12 Localidades oficiales de Bogotá asignadas a Kennedy
export const KENNEDY_LOCALITIES = WAREHOUSES.find(s=>s.id==='HUB_KENNEDY')!.scheduledLocalities!;

// 5 Localidades oficiales de Bogotá asignadas a Álamos
export const ALAMOS_LOCALITIES = WAREHOUSES.find(s=>s.id==='HUB_ALAMOS')!.scheduledLocalities!;

// 2 Localidades oficiales de Bogotá asignadas a Suba
export const SUBA_LOCALITIES = WAREHOUSES.find(s=>s.id==='HUB_SUBA')!.scheduledLocalities!;

// Localidades de Bogotá no cubiertas
export const EXCLUDED_BOGOTA_LOCALITIES = [
  'Sumapaz',
] as const;

// Municipios habilitados
export const SUPPORTED_MUNICIPALITIES = COVERAGE_MUNICIPALITIES.filter(m=>m.active).map(m=>m.name);

export type BogotaCoveredLocality =
  | typeof KENNEDY_LOCALITIES[number]
  | typeof ALAMOS_LOCALITIES[number]
  | typeof SUBA_LOCALITIES[number];

export type AllBogotaLocality = BogotaCoveredLocality | 'Sumapaz';

export interface TerritorialAssignmentResult {
  status: 'ASSIGNED' | 'OUT_OF_COVERAGE' | 'NEEDS_CONFIRMATION';
  assignedStoreId: TerritorialWarehouseId | null;
  assignedStoreName: string | null;
  municipality: string;
  locality?: string;
  isCovered: boolean;
  reason?: string;
}

/**
 * Normaliza cadenas de texto para comparación tolerante a acentos y mayúsculas
 */
/**
 * Canónica de nombres de localidad en Bogotá
 */
export function canonicalizeBogotaLocality(raw?: string | null): AllBogotaLocality | null {
  if (!raw) return null;
  const clean = normalizeTerritoryString(raw);

  // Kennedy y afines
  if (clean === 'kennedy' || clean === 'localidad kennedy' || clean.startsWith('kennedy ')) return 'Kennedy';
  if (clean === 'bosa' || clean === 'localidad bosa') return 'Bosa';
  if (clean === 'ciudad bolivar' || clean === 'localidad ciudad bolivar') return 'Ciudad Bolívar';
  if (clean === 'tunjuelito' || clean === 'localidad tunjuelito') return 'Tunjuelito';
  if (clean === 'usme' || clean === 'localidad usme') return 'Usme';
  if (clean === 'rafael uribe uribe' || clean === 'rafael uribe' || clean === 'localidad rafael uribe uribe') return 'Rafael Uribe Uribe';
  if (clean === 'san cristobal' || clean === 'localidad san cristobal') return 'San Cristóbal';
  if (clean === 'antonio narino' || clean === 'localidad antonio narino') return 'Antonio Nariño';
  if (clean === 'puente aranda' || clean === 'localidad puente aranda') return 'Puente Aranda';
  if (clean === 'los martires' || clean === 'martires' || clean === 'localidad los martires') return 'Los Mártires';
  if (clean === 'santa fe' || clean === 'santafe' || clean === 'santa fe bogota' || clean === 'localidad santa fe') return 'Santa Fe';
  if (clean === 'la candelaria' || clean === 'candelaria' || clean === 'localidad la candelaria') return 'La Candelaria';

  // Álamos y afines
  if (clean === 'engativa' || clean === 'localidad engativa') return 'Engativá';
  if (clean === 'fontibon' || clean === 'localidad fontibon') return 'Fontibón';
  if (clean === 'teusaquillo' || clean === 'localidad teusaquillo') return 'Teusaquillo';
  if (clean === 'barrios unidos' || clean === 'localidad barrios unidos') return 'Barrios Unidos';
  if (clean === 'chapinero' || clean === 'localidad chapinero') return 'Chapinero';

  // Suba y afines
  if (clean === 'suba' || clean === 'localidad suba') return 'Suba';
  if (clean === 'usaquen' || clean === 'localidad usaquen') return 'Usaquén';

  // Fuera de cobertura estándar
  if (clean === 'sumapaz' || clean === 'localidad sumapaz') return 'Sumapaz';

  return null;
}

/**
 * Detecta si la referencia corresponde a Soacha
 */
export function isSoachaMunicipality(text?: string | null): boolean {
  if (!text) return false;
  const clean = normalizeTerritoryString(text);
  return clean === 'soacha' || clean === 'municipio de soacha' || clean === 'soacha cundinamarca';
}

/**
 * Extrae de forma segura municipio y localidad a partir de componentes estructurados
 * sin inferir territorios de la dirección escrita.
 */
export function extractTerritoryFromInput(input: {municipality?:string|null;locality?:string|null;address?:string|null;coordinates?:{lat:number;lng:number}|null}) {
  // Never infer municipality/locality from street text, neighborhood, or a bounding box.
  const policy=coverageMunicipality(input.municipality);
  const municipality=policy?.name || input.municipality?.trim() || '';
  const locality=policy?.code==='11001' ? canonicalizeBogotaLocality(input.locality) || undefined : undefined;
  return {municipality,locality,isConfirmed:!!municipality && (policy?.code!=='11001' || !!locality)};
}

/**
 * Resuelve autoritativamente la asignación territorial para pedidos PROGRAMADOS:
 * - Kennedy: 12 localidades de Bogotá + Soacha
 * - Álamos: 5 localidades de Bogotá
 * - Suba: Suba, Usaquén, Chía y Cajicá
 * - Sumapaz: Fuera de cobertura estándar
 * - Municipios no incluidos expresamente: fuera de cobertura
 */
export function resolveTerritorialAssignment(input: {municipality?:string|null;locality?:string|null;address?:string|null;coordinates?:{lat:number;lng:number}|null}): TerritorialAssignmentResult {
  const extracted=extractTerritoryFromInput(input);
  const policy=coverageMunicipality(extracted.municipality);
  const result:TerritorialAssignmentResult={status:'NEEDS_CONFIRMATION',assignedStoreId:null,assignedStoreName:null,municipality:extracted.municipality,locality:extracted.locality,isCovered:false};
  if(!extracted.municipality) return {...result,reason:'Municipio pendiente de identificar. Completa la dirección y confirma el punto de entrega.'};
  if(!policy?.active) return {...result,status:'OUT_OF_COVERAGE',reason:'El municipio no está habilitado para entregas de BOLT.'};
  if(policy.code==='11001' && !extracted.locality) return {...result,reason:'Localidad de Bogotá pendiente de identificar. Completa o confirma el punto de entrega.'};
  if(extracted.locality==='Sumapaz') return {...result,status:'OUT_OF_COVERAGE',reason:'Sumapaz queda fuera de la cobertura estándar inicial.'};
  const store=policy.code==='11001' ? WAREHOUSES.find(s=>s.scheduledLocalities?.includes(extracted.locality!)) : WAREHOUSES.find(s=>s.id===policy.scheduledStoreId);
  return store ? {...result,status:'ASSIGNED',isCovered:true,assignedStoreId:store.id,assignedStoreName:store.name,reason:`${extracted.locality || policy.name} asignado a ${store.name}.`}
    : {...result,reason:'La asignación territorial de la sede está pendiente de configurar.'};
}

/**
 * Lista consolidada de todas las localidades y municipios para selectores en UI
 */
export const TERRITORY_OPTIONS = WAREHOUSES.filter(s=>s.scheduledLocalities?.length || s.scheduledMunicipalities?.length).map(store=>({
 group:store.name,storeId:store.id,storeName:store.name,items:[...(store.scheduledMunicipalities || []).map(m=>({municipality:m,locality:'',label:m+' (Municipio)'})),...(store.scheduledLocalities || []).map(locality=>({municipality:'Bogotá D.C.',locality,label:locality+' (Bogotá)'}))]
}));
