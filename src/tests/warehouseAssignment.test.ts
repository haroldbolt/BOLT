import assert from 'node:assert/strict';
import { INITIAL_STORES, INITIAL_PRODUCTS } from '../data/seedData';
import { evaluateDeliveryQuote } from '../lib/deliveryService';
import { assignScheduledWarehouse } from '../lib/warehouseAssignment';

const stores = structuredClone(INITIAL_STORES);
const products = structuredClone(INITIAL_PRODUCTS);
const destination = { address: 'Calle 140, Usaquén, Bogotá', coordinates: { lat: 4.711, lng: -74.030 } };
const quote = evaluateDeliveryQuote({ destination }, stores, products);
assert.equal(quote.scheduledEligible, true);
const assigned = assignScheduledWarehouse(quote, stores, products);
assert.ok(assigned.assignedStoreId);
assert.ok(stores.find(store => store.id === assigned.assignedStoreId)?.isActive);
assert.equal(quote.assignedStoreId, undefined, 'The original quote is not mutated');
const product = products[0];
for (const store of stores) product.stockByStore[store.id] = 0;
product.reservedStockByStore = {};
product.stockByStore.HUB_SUBA = 4;
product.inventoryByStore = Object.fromEntries(stores.map(store => [store.id, {
  locationGid: store.shopifyLocationGid || 'fixture-location', available: product.stockByStore[store.id],
  onHand: product.stockByStore[store.id], committed: 0, quantities: { available: product.stockByStore[store.id] },
}]));
const withStock = assignScheduledWarehouse(quote, stores, products, [{ productId: product.id, quantity: 1 }]);
assert.equal(withStock.assignedStoreId, 'HUB_SUBA');
assert.equal(assignScheduledWarehouse(quote, stores, products, [{ productId: product.id, quantity: 5 }]).scheduledEligible, false);
assert.equal(assignScheduledWarehouse(quote, [], products).assignedStoreId, undefined);
assert.equal(assignScheduledWarehouse({ ...quote, scheduledEligible: false }, stores, products).assignedStoreId, undefined);
const turbo = evaluateDeliveryQuote({ destination: { address: 'Kennedy, Bogotá', coordinates: stores[0].coordinates } }, stores, products);
assert.equal(assignScheduledWarehouse(turbo, stores, products).assignedStoreId, turbo.assignedStoreId);
console.log('9 comprobaciones de asignación de bodega aprobadas.');
