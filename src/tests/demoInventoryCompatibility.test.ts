import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { WAREHOUSES } from '../data/warehouseConfig';
import { CatalogOperations } from '../lib/catalogOperations';
import { FulfillmentStorage } from '../lib/fulfillmentStorage';
import { OrdersRepository } from '../lib/ordersRepository';
import { pendingDeliveryOrder } from '../lib/pendingDeliveryOrder';
import { newDispatchState } from '../types/dispatch';
import { fixtureProduct } from './transportFixtures';

const dir = mkdtempSync(path.join(tmpdir(), 'bolt-stock-compat-'));
try {
  const id = 'gid://shopify/ProductVariant/48875669717272';
  const p = fixtureProduct(id, 15_000);
  const suba = WAREHOUSES.find(s => s.id === 'HUB_SUBA')!;
  const sites = WAREHOUSES.filter(s => s.isActive).map(s => s.id);
  p.bodegaIds = [suba.id];
  p.stockByStore = { [suba.id]: 1 };
  const old = pendingDeliveryOrder({
    items: [{productId: id, sku: id, presentation: '15 kg', quantity: 1, name: 'Fixture', brand: 'Fixture', weightKg: 15,
      requiresPrescription: false, image: '', price: 20_000}],
    store: suba, requestedMode: 'PROGRAMADO',
    customer: {isGuest: true, name: 'Prueba de inventario', phone: '0000000000', email: 'prueba-entrega-suba@example.invalid'},
    address: {address: suba.address, coordinates: suba.coordinates, details: "", porteriaPolicy: 'SUBIR_A_PUERTA'},
    creationRequestId: 'fixture-compat-inventory', creationRequestFingerprint: '1'.repeat(64),
  });
  old.purchaseCode = 'BP-000011';
  const dataDir = path.join(dir, 'orders');
  new FulfillmentStorage(dataDir).commit({orders: [old], drivers: [], audit: [], telemetry: {}, dispatch: newDispatchState()});
  let repo = new OrdersRepository({dataDir});
  const file = path.join(dir, 'catalog.json');
  const state = {version: 1, values: { [JSON.stringify([id,id])]: {
    productId: id, variantId: id, price: 20_000, stock: p.stockByStore, reserved: {}, revision: 0, demoInventory: true,
    delta: Object.fromEntries(sites.map(s => [s, 100 - (p.stockByStore[s] || 0)])),
  }}, baselineEffects: {}, batches: {}, audit: [], demoInventory: {
    batchId: 'demo-inventory-100-v1', stockPerStore: 100, storeIds: sites, products: 1, variants: 1, rows: sites.length,
    changedRows: sites.length, appliedAt: '2026-11-10T12:00:00.000Z',
  }};
  const original = JSON.stringify(state);
  writeFileSync(file, original);
  const options = {file, products: () => [p], stores: () => WAREHOUSES, orders: () => repo.getAllOrders()};
  const demo = new CatalogOperations({...options, demo: true});
  assert.equal(demo.hasDemoInventory(), true);
  const product = demo.getSalesProducts()[0];
  assert.deepEqual(product.bodegaIds?.sort(), [...sites].sort());
  for (const site of sites) assert.equal(product.stockByStore[site], 100);
  assert.equal(product.reservedStockByStore[suba.id], 1);
  assert.deepEqual(new CatalogOperations(options).getSalesProducts()[0].bodegaIds, [suba.id]);
  assert.equal(readFileSync(file,'utf8'), original);
  assert.equal(repo.completeDemoInventoryDelivery(old.id,{role:'BODEGA',id:'local'}).code, 403);
  const actor = {role: 'ADMINISTRADOR' as const, id: 'coordinacion'};
  assert.ok(repo.completeDemoInventoryDelivery(old.id, actor).success);
  repo = new OrdersRepository({dataDir});
  assert.ok(repo.completeDemoInventoryDelivery(old.id, actor).success);
  const delivered = repo.getOrderById(old.id)!;
  assert.equal(delivered.purchaseCode, old.purchaseCode);
  assert.equal(delivered.payment.cashToCollect, 0);
  assert.equal(delivered.deliveryReview?.status, 'SIMULATED');
  assert.equal(delivered.statusHistory?.length, 1);
  const projected = demo.getSalesProducts()[0];
  for (const site of sites) {
    assert.equal(projected.stockByStore[site], site === suba.id ? 99 : 100);
    assert.equal(projected.reservedStockByStore[site], 0);
  }
  assert.equal(readFileSync(file, 'utf8'), original);
  console.log('PASS lote anterior visible en tres sedes, sin reaplicarlo; histórico de entrega a $0 conservado tras reinicio');
} finally { rmSync(dir, {recursive: true, force:true}); }
