import assert from 'node:assert/strict';
import { loadShopifyInventory } from '../../lib/shopifyInventory';
import { getProductPurchaseBlock, getProductSellableQuantity } from '../lib/productAvailability';
import { evaluateDeliveryQuote } from '../lib/deliveryService';
import { fileURLToPath } from 'node:url';
import type { Product } from '../types';

const inventory = await loadShopifyInventory(fileURLToPath(new URL('../..', import.meta.url)), {});
const store = inventory.stores.find(store => store.id === 'HUB_KENNEDY')!;
// An isolated complete fixture tests the purchase path without inventing data in the import.
const base = inventory.products.find(product => product.shopifyStatus === 'ACTIVE')!;
const valid: Product = {
  ...base, price: 10000, weightKg: 1, shippingWeightKg: 1,
  pricePending: false, weightVerified: true, inventoryPending: false,
  compliancePending: false, logisticsBlocked: false, requiresShipping: true,
  stockByStore: { ...base.stockByStore, HUB_KENNEDY: 10 },
  inventoryByStore: { ...base.inventoryByStore, HUB_KENNEDY: { ...base.inventoryByStore.HUB_KENNEDY, available: 10 } },
};
assert.ok(inventory.products.some(product => getProductPurchaseBlock(product)), 'Los datos reales pendientes permanecen bloqueados');
const catalog = [valid];
const request = { destination: { address: 'Kennedy, Bogotá', coordinates: store.coordinates }, items: [{ productId: valid.id, quantity: 1 }] };
assert.ok(evaluateDeliveryQuote(request, inventory.stores, catalog).availableModes.turbo);
assert.equal(getProductSellableQuantity(valid, 'HUB_KENNEDY'), valid.stockByStore.HUB_KENNEDY);

let checks = 3;
for (const change of [
  { weightVerified: false, weightKg: 0 }, { pricePending: true },
  { inventoryPending: true }, { compliancePending: true },
  { shopifyStatus: 'DRAFT' }, { requiresShipping: false },
]) {
  const product = { ...valid, ...change };
  assert.ok(getProductPurchaseBlock(product));
  assert.equal(getProductSellableQuantity(product, store.id), 0);
  const quote = evaluateDeliveryQuote(request, inventory.stores, [product]);
  assert.equal(quote.reasonCode, 'PRODUCT_DATA_PENDING');
  assert.equal(quote.scheduledEligible, false);
  assert.equal(quote.basketValidated, false);
  checks += 5;
}
for (const quantity of [-1, 0, 1.5, NaN]) {
  assert.equal(evaluateDeliveryQuote({ ...request, items: [{ productId: valid.id, quantity }] }, inventory.stores, catalog).reasonCode, 'INVALID_BASKET');
  checks++;
}
assert.equal(evaluateDeliveryQuote({ ...request, items: [{ productId: 'seed-missing', quantity: 1 }] }, inventory.stores, inventory.products).reasonCode, 'PRODUCT_NOT_FOUND');
assert.equal(evaluateDeliveryQuote({ ...request, items: [request.items[0], request.items[0]] }, inventory.stores, catalog).reasonCode, 'INVALID_BASKET');
assert.equal(getProductSellableQuantity(valid, 'UNMAPPED'), 0);
assert.equal(getProductSellableQuantity({ ...valid, reservedStockByStore: { ...valid.reservedStockByStore, [store.id]: 1 } }, store.id), Math.max(0, valid.stockByStore[store.id] - 1));
checks += 4;
console.log(`${checks} comprobaciones de compra e inventario aprobadas.`);
