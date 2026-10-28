import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { loadShopifyInventory } from '../../lib/shopifyInventory';
import { normalizeShopifySnapshot, shopifyShippingWeightKg, type ShopifySnapshot, type ShopifySnapshotVariant } from '../lib/shopifyMapper';
import { ShopifyService } from '../lib/shopifyService';

let passed = 0;
function check(condition: unknown, title: string) {
  assert.ok(condition, title);
  passed++;
  console.log('PASS: ' + title);
}
const projectRoot = fileURLToPath(new URL('../..', import.meta.url));
const snapshot = JSON.parse(await readFile(path.join(projectRoot, '.bolt-private/shopify/snapshot.json'), 'utf8')) as ShopifySnapshot;
const inventory = await loadShopifyInventory(projectRoot, {});
const { products, stores, status } = inventory;
check(status.complete && status.productsCount === 3830 && products.length === 5652, 'La lectura completa conserva 3.830 productos y 5.652 variantes');
check(status.activeVariantsCount === 5280 && status.locationsCount === 5, 'Variantes activas y cinco ubicaciones conservadas');
check(new Set(products.map(product => product.id)).size === products.length, 'Todas las variantes tienen identidad propia estable');
check(products.filter(product => product.sku === '').length === 5460, 'Los SKU ausentes se conservan sin inventarlos ni colisionar variantes');
check(status.fetchedAt === snapshot.fetchedAt && status.automaticSync === false, 'La fecha corresponde a la lectura original y no hay actualización automática');
check(stores.filter(store => store.isActive).length === 4 && stores.filter(store => store.turboEnabled).length === 3, 'Cuatro sedes activas y solo tres orígenes Turbo');
check(stores.find(store => store.id === 'HUB_CENTRO')?.shopifyLocationGid === 'gid://shopify/Location/115676021016'
  && stores.find(store => store.id === 'HUB_CENTRO')?.turboEnabled === false, 'Centro conserva el GID real y permanece fuera de Turbo');
check(stores.find(store => store.id === 'SHOPIFY_LOCATION_99059073304')?.isActive === false, 'La ubicación inactiva no se convierte en un origen activo');

const storeIdByGid = new Map(stores.map(store => [store.shopifyLocationGid, store.id]));
const byId = new Map(products.map(product => [product.shopifyVariantGid, product]));
for (const variant of snapshot.variants) {
  const product = byId.get(variant.id)!;
  for (const level of variant.inventoryItem?.inventoryLevels?.nodes || []) {
    const storeId = storeIdByGid.get(level.location.id)!;
    const quantities = Object.fromEntries((level.quantities || []).map(quantity => [quantity.name, quantity.quantity]));
    assert.equal(product.stockByStore[storeId], quantities.available ?? 0);
    assert.equal(product.inventoryByStore[storeId].available, quantities.available ?? null);
    assert.equal(product.inventoryByStore[storeId].onHand, quantities.on_hand ?? null);
    assert.equal(product.inventoryByStore[storeId].committed, quantities.committed ?? null);
    assert.equal(product.reservedStockByStore[storeId], 0);
  }
}
check(true, 'Cada cantidad real de cada variante permanece en su bodega, sin inventar comprometidos ni reservas');
for (const [storeId, expectedPositive, expectedSum] of [
  ['HUB_KENNEDY', 556, 10337], ['HUB_ALAMOS', 376, 3036], ['HUB_SUBA', 381, 2077], ['HUB_CENTRO', 558, 8715],
] as const) {
  check(products.filter(product => product.stockByStore[storeId] > 0).length === expectedPositive
    && products.reduce((sum, product) => sum + product.stockByStore[storeId], 0) === expectedSum,
  'Totales exactos de existencias por bodega: ' + storeId);
}
check(status.missingWeights === 4476 && status.pendingPrices === 1500 && status.pendingInventory === 4674,
  'Los datos pendientes permanecen identificados sin fabricar pesos, precios o inventario');

const gid = (entity: string, id: number) => `gid://shopify/${entity}/${id}`;
const fixtureVariant = (id: number): ShopifySnapshotVariant => ({
  id: gid('ProductVariant', id), title: '10–25 kg', sku: '', price: '25000',
  product: { id: gid('Product', id), title: 'Producto de prueba', handle: 'prueba', status: 'ACTIVE', tags: ['Perros'] },
  inventoryItem: {
    id: gid('InventoryItem', id), tracked: true, requiresShipping: true,
    measurement: { weight: null },
    inventoryLevels: { nodes: [{ location: { id: gid('Location', 115617857816) }, quantities: [{ name: 'on_hand', quantity: 7 }] }], pageInfo: { hasNextPage: false } },
  },
});
const fixture: ShopifySnapshot = {
  shop: { name: 'Fixture', myshopifyDomain: 'fixture.myshopify.com', currencyCode: 'COP' },
  fetchedAt: '2026-10-26T14:16:43.296Z', complete: true,
  locations: [{ id: gid('Location', 115617857816), name: 'Kennedy', isActive: true, address: { latitude: 4.63, longitude: -74.15 } }],
  variants: [fixtureVariant(1), fixtureVariant(2)],
};
const before = JSON.stringify(fixture);
const mapped = normalizeShopifySnapshot(fixture);
check(mapped.products[0].id !== mapped.products[1].id && mapped.products.every(product => !product.sku), 'Variantes sin SKU mantienen identidades distintas');
check(mapped.products[0].inventoryByStore.HUB_KENNEDY.available === null
  && mapped.products[0].inventoryByStore.HUB_KENNEDY.committed === null
  && mapped.products[0].inventoryPending, 'Disponible o comprometido desconocido permanece null y requiere revisión');
check(mapped.products[0].shippingWeightKg === null && !mapped.products[0].weightVerified && mapped.products[0].logisticsBlocked,
  'La presentación o el peso del animal no se utiliza como peso físico de envío');
check(JSON.stringify(fixture) === before, 'El mapper no modifica el objeto de origen');
const zero = fixtureVariant(3);
zero.inventoryItem!.inventoryLevels!.nodes![0].quantities = [{ name: 'available', quantity: 0 }, { name: 'on_hand', quantity: 0 }, { name: 'committed', quantity: 0 }];
const zeroProduct = normalizeShopifySnapshot({ ...fixture, variants: [zero] }).products[0];
check(zeroProduct.inventoryByStore.HUB_KENNEDY.available === 0 && !zeroProduct.inventoryPending, 'Cero confirmado es diferente de cantidad desconocida');
const noLevels = fixtureVariant(4);
noLevels.inventoryItem!.inventoryLevels!.nodes = [];
check(normalizeShopifySnapshot({ ...fixture, variants: [noLevels] }).products[0].inventoryPending, 'Ausencia de niveles requiere revisión de inventario');
const incomplete = fixtureVariant(5);
incomplete.inventoryItem!.inventoryLevels!.pageInfo = { hasNextPage: true };
check(!normalizeShopifySnapshot({ ...fixture, variants: [incomplete] }).status.complete, 'Una lectura incompleta no se presenta como completa');
const measured = fixtureVariant(6);
measured.inventoryItem!.measurement!.weight = { value: 2500, unit: 'GRAMS' };
check(shopifyShippingWeightKg(measured) === 2.5, 'La conversión usa únicamente la medida física de Shopify');

const service = new ShopifyService();
check(service.getState().inventoryItems.length === 0 && !service.getState().lastSuccessfulSync, 'Sin importación no aparecen productos, IDs ni sincronizaciones ficticios');
const imported = service.configureSnapshot(inventory);
check(imported.status === 'SNAPSHOT_IMPORTADO' && imported.mode === 'READ_ONLY_SNAPSHOT' && imported.automaticSync === false
  && imported.reconciliationIntervalMinutes === 0, 'El estado informa instantánea importada, sin conexión automática');
check(imported.inventoryItems.length === 5652 && imported.importedProductCount === 3830 && imported.importedVariantCount === 5652,
  'La tarjeta de integración recibe cantidades reales de productos y variantes');
const availableProduct = products.find(product => !product.sku && product.stockByStore.HUB_KENNEDY > 1)!;
const originalAvailable = availableProduct.stockByStore.HUB_KENNEDY;
check(service.getSellableStock('', 'HUB_KENNEDY') === 0 && service.getSellableStock(availableProduct.id, 'HUB_KENNEDY') === originalAvailable,
  'La consulta usa identidad de variante, nunca un SKU vacío');
check(service.reserveStockLocally('HUB_KENNEDY', availableProduct.id, 1)
  && service.getSellableStock(availableProduct.shopifyVariantGid, 'HUB_KENNEDY') === originalAvailable - 1,
  'La reserva local se aplica a la variante y bodega correctas sin restar comprometidos otra vez');
check(availableProduct.reservedStockByStore.HUB_KENNEDY === 1, 'La reserva del servicio actualiza el mismo producto que utiliza el servidor');
check(service.getSellableStock(availableProduct.id, 'HUB_SUBA') === availableProduct.stockByStore.HUB_SUBA,
  'Reservar Kennedy conserva las existencias de Suba');
check(!service.reserveStockLocally('HUB_KENNEDY', availableProduct.id, -1), 'Una reserva negativa se rechaza');
const refreshed = await service.triggerReconciliation();
check(refreshed.lastSuccessfulSync === snapshot.fetchedAt && refreshed.lastAttemptedSync === snapshot.fetchedAt
  && service.getSellableStock(availableProduct.id, 'HUB_KENNEDY') === originalAvailable - 1,
  'Volver a consultar conserva la fecha original y las reservas locales');
service.configureSnapshot(inventory);
check(service.getSellableStock(availableProduct.id, 'HUB_KENNEDY') === originalAvailable - 1, 'Reinstalar la lectura conserva reservas por GID de variante');
check(!service.updateLocationStock('HUB_KENNEDY', availableProduct.id, 999999).success
  && service.getSellableStock(availableProduct.id, 'HUB_KENNEDY') === originalAvailable - 1,
  'El simulador no altera el inventario importado');
const detached = service.getState();
detached.inventoryItems[0].productName = 'Cambio externo';
check(service.getState().inventoryItems[0].productName !== 'Cambio externo', 'Consultar estado no permite mutar el inventario interno');
const rawOnHand = availableProduct.inventoryByStore.HUB_KENNEDY.onHand;
availableProduct.reservedStockByStore.HUB_KENNEDY = 0;
availableProduct.stockByStore.HUB_KENNEDY = originalAvailable - 1;
const deliveredItem = service.getState().inventoryItems.find(item => item.productId === availableProduct.id)!;
check(deliveredItem.quantitiesByLocation.HUB_KENNEDY.available === originalAvailable - 1
  && deliveredItem.quantitiesByLocation.HUB_KENNEDY.reservedBolt === 0
  && deliveredItem.quantitiesByLocation.HUB_KENNEDY.sellable === originalAvailable - 1
  && deliveredItem.quantitiesByLocation.HUB_KENNEDY.onHand === rawOnHand,
  'Una entrega local se refleja en disponible y reservas, conservando el físico original de Shopify');
availableProduct.reservedStockByStore.HUB_KENNEDY = 1;
const externalReservedItem = (await service.triggerReconciliation()).inventoryItems.find(item => item.productId === availableProduct.id)!;
check(externalReservedItem.quantitiesByLocation.HUB_KENNEDY.reservedBolt === 1
  && externalReservedItem.quantitiesByLocation.HUB_KENNEDY.sellable === Math.max(0, originalAvailable - 2)
  && externalReservedItem.lastUpdated === snapshot.fetchedAt,
  'Una reserva hecha por el servidor aparece al consultar sin fabricar una lectura nueva');
const olderApiInventory = normalizeShopifySnapshot({ ...fixture, apiVersion: '2025-10' });
check(new ShopifyService().configureSnapshot(olderApiInventory).apiVersion === '2025-10', 'La versión de API se conserva desde la instantánea');
check(new ShopifyService().configureSnapshot(mapped).apiVersion === '', 'Una versión de API ausente permanece desconocida');
await assert.rejects(loadShopifyInventory(projectRoot, { BOLT_SHOPIFY_SNAPSHOT_PATH: '.bolt-private/no-existe.json' }), /No se pudo leer/);
check(true, 'Un archivo ausente produce error explícito sin recurrir a datos de demostración');
await assert.rejects(loadShopifyInventory(projectRoot, { BOLT_SHOPIFY_SNAPSHOT_PATH: 'public/snapshot.json' }), /ruta privada/);
check(true, 'El cargador rechaza rutas públicas para la instantánea');
console.log(`${passed} comprobaciones de inventario Shopify aprobadas.`);
