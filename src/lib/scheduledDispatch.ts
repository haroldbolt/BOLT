import type { DeliveryMode, Product, Store } from '../types';
import type { DeliveryQuote, LatLng, QuoteRequestItem } from './deliveryService';
import { resolveBogotaLocality, type BogotaLocalityCode } from './bogotaLocalities';

export const SCHEDULED_DISPATCH_POLICY_VERSION = '2026.11-LOCALITY-1';
export type ScheduledWarehouseId = 'HUB_KENNEDY' | 'HUB_ALAMOS' | 'HUB_SUBA';
export type ScheduledAssignmentStatus = 'SUGERIDA' | 'CONFIRMADA' | 'REVISION_REQUERIDA' | 'SIN_COBERTURA' | 'DIRECCION_PENDIENTE';
export interface ScheduledAssignment {
  storeId?: string;
  storeName?: string;
  storeAddress?: string;
  storeCoordinates?: LatLng;
  localityCode?: BogotaLocalityCode;
  localityName?: string;
  status: ScheduledAssignmentStatus;
  reason?: string;
  policyVersion: string;
}
export const SCHEDULED_LOCALITY_WAREHOUSES: Readonly<Record<Exclude<BogotaLocalityCode, 'SUMAPAZ'>, ScheduledWarehouseId>> = Object.freeze({
  SUBA: 'HUB_SUBA', USAQUEN: 'HUB_SUBA',
  ENGATIVA: 'HUB_ALAMOS', FONTIBON: 'HUB_ALAMOS', BARRIOS_UNIDOS: 'HUB_ALAMOS', TEUSAQUILLO: 'HUB_ALAMOS', CHAPINERO: 'HUB_ALAMOS',
  KENNEDY: 'HUB_KENNEDY', BOSA: 'HUB_KENNEDY', PUENTE_ARANDA: 'HUB_KENNEDY', ANTONIO_NARINO: 'HUB_KENNEDY',
  LOS_MARTIRES: 'HUB_KENNEDY', SANTA_FE: 'HUB_KENNEDY', LA_CANDELARIA: 'HUB_KENNEDY', SAN_CRISTOBAL: 'HUB_KENNEDY',
  RAFAEL_URIBE_URIBE: 'HUB_KENNEDY', TUNJUELITO: 'HUB_KENNEDY', CIUDAD_BOLIVAR: 'HUB_KENNEDY', USME: 'HUB_KENNEDY',
});
export const SCHEDULED_NO_COVERAGE_MESSAGE = 'Por ahora no tenemos cobertura de envío programado en esta ubicación';

export function isScheduledWarehouse(store: Store): boolean {
  return ['HUB_KENNEDY', 'HUB_ALAMOS', 'HUB_SUBA'].includes(store.id) && store.isActive && !store.isPaused;
}
function distanceMeters(a: LatLng, b: LatLng): number {
  const rad = Math.PI / 180;
  const x = Math.sin((b.lat - a.lat) * rad / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin((b.lng - a.lng) * rad / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(Math.max(0, 1 - x)));
}

/** Location policy suggests one responsible hub. A quote never reserves stock. */
export function getScheduledAssignment(
  coordinates: LatLng | null | undefined, stores: Store[], products: Product[] = [],
  items: QuoteRequestItem[] = [], maxCoverageMeters = 25000,
): ScheduledAssignment {
  const policyVersion = SCHEDULED_DISPATCH_POLICY_VERSION;
  const locality = resolveBogotaLocality(coordinates);
  if (!locality) return { status: 'DIRECCION_PENDIENTE', reason: 'Confirma una dirección dentro de una localidad de Bogotá para asignar la bodega.', policyVersion };
  const area = { localityCode: locality.code, localityName: locality.name, policyVersion };
  if (locality.code === 'SUMAPAZ') return { ...area, status: 'SIN_COBERTURA', reason: SCHEDULED_NO_COVERAGE_MESSAGE };
  const storeId = SCHEDULED_LOCALITY_WAREHOUSES[locality.code];
  const store = stores.find(candidate => candidate.id === storeId);
  const target = { ...area, storeId, storeName: store?.name, storeAddress: store?.address,
    storeCoordinates: store ? { ...(store.verifiedEntrance || store.shopifyCoordinates || store.coordinates) } : undefined };
  if (!store || !isScheduledWarehouse(store)) return { ...target, status: 'REVISION_REQUERIDA', reason: 'La bodega responsable no está disponible. Requiere revisión administrativa.' };
  if (distanceMeters(target.storeCoordinates!, coordinates!) > maxCoverageMeters) return { ...area, status: 'SIN_COBERTURA', reason: SCHEDULED_NO_COVERAGE_MESSAGE };
  if (!items.length) return { ...target, status: 'SUGERIDA' };
  const requested = new Map<string, number>();
  for (const item of items) {
    if (!Number.isSafeInteger(item.quantity) || item.quantity <= 0) return { ...target, status: 'REVISION_REQUERIDA', reason: 'Revisa los productos y cantidades del pedido.' };
    requested.set(item.productId, (requested.get(item.productId) || 0) + item.quantity);
  }
  for (const [productId, quantity] of requested) {
    const product = products.find(product => product.id === productId) as (Product & { inventoryVerifiedByStore?: Record<string, boolean> }) | undefined;
    const associated = product && (!product.bodegaIds || product.bodegaIds.includes(storeId) || !!store.shopifyLocationGid && product.bodegaIds.includes(store.shopifyLocationGid));
    const physical = product?.stockByStore[storeId];
    const reserved = product?.reservedStockByStore[storeId] ?? 0;
    if (!product || product.status && product.status !== 'ACTIVE' || !associated ||
      !(product.price > 0) || !Number.isFinite(product.price) || !(product.weightKg > 0) || !Number.isFinite(product.weightKg) ||
      product.inventoryVerifiedByStore?.[storeId] !== true || !Number.isSafeInteger(physical) || !Number.isSafeInteger(reserved) ||
      reserved < 0 || physical! - reserved < quantity) {
      return { ...target, status: 'REVISION_REQUERIDA', reason: 'La bodega responsable necesita verificar disponibilidad, precio y peso de todos los productos. Requiere revisión administrativa.' };
    }
  }
  return { ...target, status: 'CONFIRMADA' };
}

/** A delivery mode always uses its own dispatch hub. */
export function getQuoteDispatchStore(quote: DeliveryQuote | null | undefined, mode: DeliveryMode):
  { storeId: string; storeName?: string; storeAddress?: string; storeCoordinates?: LatLng } | null {
  if (!quote) return null;
  if (mode === 'PROGRAMADO') {
    const assignment = quote.scheduledAssignment;
    return assignment?.storeId && assignment.status !== 'SIN_COBERTURA' && assignment.status !== 'DIRECCION_PENDIENTE'
      ? { storeId: assignment.storeId, storeName: assignment.storeName, storeAddress: assignment.storeAddress, storeCoordinates: assignment.storeCoordinates } : null;
  }
  return quote.assignedStoreId ? { storeId: quote.assignedStoreId, storeName: quote.assignedStoreName, storeAddress: quote.assignedStoreAddress, storeCoordinates: quote.assignedStoreCoordinates } : null;
}
