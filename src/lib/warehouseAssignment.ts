import type { Product, Store } from '../types';
import { DELIVERY_CONFIG, getStoreDispatchCoordinates, haversine, type DeliveryQuote, type QuoteRequestItem } from './deliveryService';
import { getCatalogAvailableQuantity } from './catalogAvailability';

/** Scheduled deliveries also need a real stock-owning origin, never a default demo hub. */
export function assignScheduledWarehouse(
  quote: DeliveryQuote,
  stores: Store[],
  products: Product[],
  items: QuoteRequestItem[] = [],
): DeliveryQuote {
  if (quote.assignedStoreId || !quote.scheduledEligible || !quote.destination?.coordinates) return quote;
  const byId = new Map(products.map(product => [product.id, product]));
  const candidates = stores.filter(store => store.isActive && !store.isPaused)
    .map(store => ({ store, distance: haversine(getStoreDispatchCoordinates(store), quote.destination.coordinates) }))
    .filter(candidate => candidate.distance <= DELIVERY_CONFIG.scheduledCoverageRadiusMeters)
    .filter(({ store }) => items.every(item => {
      const product = byId.get(item.productId);
      return product && Number.isSafeInteger(item.quantity) && item.quantity > 0
        && getCatalogAvailableQuantity(product, store.id) >= item.quantity;
    }))
    .sort((a, b) => a.distance - b.distance);
  const winner = candidates[0];
  if (!winner) {
    return {
      ...quote, eligibilityStatus: 'INSUFFICIENT_STOCK', reasonCode: 'NO_STOCK_WAREHOUSE',
      message: 'Estamos revisando la disponibilidad para esta dirección. Conserva tu carrito y vuelve a consultar.',
      availableModes: { turbo: false, turboDividido: false, scheduled: false },
      recommendedMode: null, scheduledEligible: false, scheduledSlots: [], basketValidated: false,
    };
  }
  return {
    ...quote, assignedStoreId: winner.store.id, assignedStoreName: winner.store.name,
    assignedStoreAddress: winner.store.address, assignedStoreCoordinates: getStoreDispatchCoordinates(winner.store),
  };
}
