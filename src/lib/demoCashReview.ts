import type { DriverProfile, Order, Product, Store } from '../types';
import type { TransportVehicle } from '../types/transport';
import { boltAdminDemoProduct } from './boltAdminDemo';
import { generateScheduledSlots } from './deliveryService';
import type { TransportContext } from './transportPlanner';

export const CASH_REVIEW_SKU = 'RDI-EFECTIVO-1KG';
const storeIds = ['HUB_ALAMOS', 'HUB_KENNEDY', 'HUB_SUBA'];
const stockPerStore = 8;

export function cashReviewStores(stores: Store[]) {
  return storeIds.flatMap(id => {
    const store = stores.find(candidate => candidate.id === id && candidate.isActive);
    if (!store) return [];
    return [{id, name: store.name, destination: {
      address: store.address, coordinates: store.coordinates, municipality: 'Bogotá',
    }}];
  });
}

export function cashReviewProduct(): Product {
  const fixture = boltAdminDemoProduct();
  return {
    ...fixture,
    id: CASH_REVIEW_SKU, sku: CASH_REVIEW_SKU,
    name: 'Alimento de prueba RDI', description: 'Presentación ficticia para probar el checkout en efectivo sin cobro.',
    status: 'ACTIVE', price: 59_000, bodegaIds: [...storeIds],
    stockByStore: Object.fromEntries(storeIds.map(id => [id, stockPerStore])),
    reservedStockByStore: Object.fromEntries(storeIds.map(id => [id, 0])),
    presentaciones: [{
      ...fixture.presentaciones![0], varianteId: CASH_REVIEW_SKU, sku: CASH_REVIEW_SKU, bodegaIds: [...storeIds],
    }],
  };
}

export function cashReviewBasket(items: unknown): 'review' | 'mixed' | undefined {
  if (!Array.isArray(items) || !items.some(item => item?.productId === CASH_REVIEW_SKU)) return undefined;
  return items.every(item => item?.productId === CASH_REVIEW_SKU) ? 'review' : 'mixed';
}

export function isCashReviewOrder(order?: Order) {
  return order?.demoCustomerCheckout === true && cashReviewBasket(order.items) === 'review';
}

// Ephemeral vehicles are visible only to a simulation quote containing exclusively this test presentation.
// Stable driver IDs keep reservations and repeat quotes consistent; nothing here starts a dispatch or writes fleet state.
export function cashReviewContext(stores: Store[], base: TransportContext, now = new Date()): TransportContext {
  const scheduledSlots = generateScheduledSlots(now).map(slot => slot.date + '|' + slot.slotId);
  const vehicles: TransportVehicle[] = [];
  const drivers: DriverProfile[] = [];
  for (const store of cashReviewStores(stores)) {
    for (let index = 1; index <= stockPerStore; index++) {
      const id = 'RDI-SIM-' + store.id + '-' + index;
      vehicles.push({
        driverId: id, enabled: true, storeIds: [store.id], modes: ['TURBO', 'PROGRAMADO'],
        maxLoadGrams: 5_000, packagingGrams: 200, cargoDimensionsCm: [60, 40, 35], maxVolumeCm3: 84_000, scheduledSlots,
      });
      drivers.push({
        id, name: 'Vehículo de prueba ' + store.name + ' ' + index, phone: '0000000000', vehiclePlate: 'SIMULADO',
        vehicleType: 'CARRO', maxWeightKg: 5, rating: 0, photo: '', operationalEligible: true,
        isOnline: true, currentStatus: 'DISPONIBLE', currentLocation: {...store.destination.coordinates, updatedAt: now.toISOString()},
        cashBalance: 0,
      });
    }
  }
  return {...base, config: {...base.config, vehicles, externalProviders: []}, drivers};
}
