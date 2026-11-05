import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { INITIAL_PRODUCTS, INITIAL_STORES, INITIAL_ORDERS, INITIAL_DRIVERS } from '../data/seedData';
import { AdminRepository } from '../lib/adminRepository';
import { generateScheduledSlots, validateScheduledBooking } from '../lib/deliveryService';
import type { Order } from '../types';

const dir = mkdtempSync(path.join(tmpdir(), 'bolt-scheduled-http-'));
const previousDataDir = process.env.BOLT_DATA_DIR;
process.env.BOLT_DATA_DIR = path.join(dir, 'module-default');
const { createBoltApp } = await import('../../server');
const { OrdersRepository } = await import('../lib/ordersRepository');
const stores = structuredClone(INITIAL_STORES);
const products = structuredClone(INITIAL_PRODUCTS.slice(0, 1));
const product = products[0];
Object.assign(product, { status: 'ACTIVE', price: 20000, weightKg: 1,
  bodegaIds: ['HUB_KENNEDY', 'HUB_ALAMOS', 'HUB_SUBA', 'HUB_CENTRO'],
  stockByStore: Object.fromEntries(stores.map(store => [store.id, 30])),
  reservedStockByStore: Object.fromEntries(stores.map(store => [store.id, 0])),
  inventoryVerifiedByStore: { HUB_KENNEDY: true, HUB_ALAMOS: true, HUB_SUBA: true, HUB_CENTRO: true } });
const slot = generateScheduledSlots().find(slot => !slot.cutoffPassed && validateScheduledBooking(slot).valid)!;
assert.ok(slot);
const historical = Object.assign(structuredClone(INITIAL_ORDERS[0]), {
  id: 'HISTORICAL-CENTRO', orderNumber: '#HISTORICAL-CENTRO', storeId: 'HUB_CENTRO', storeName: 'Centro histórico conservado',
  deliveryMode: 'PROGRAMADO', fulfillmentStatus: 'CONFIRMADO', scheduledWindow: slot, scheduledDispatch: undefined,
}) as Order;
const repository = new OrdersRepository({ dataDir: dir, initialOrders: [historical], initialDrivers: structuredClone(INITIAL_DRIVERS) });
const administration = new AdminRepository({ dataDir: dir, products, stores });
const app = await createBoltApp({ serveFrontend: false, products, stores, repository, adminRepository: administration });
const historicalBefore = JSON.stringify(repository.getOrderById(historical.id));
const server = app.listen(0, '127.0.0.1');
await new Promise<void>(resolve => server.once('listening', resolve));
const base = 'http://127.0.0.1:' + (server.address() as { port: number }).port + '/api/v1';
let passed = 0;
function check(label: string, run: () => void) { run(); passed++; console.log('PASS: ' + label); }
async function request(route: string, body: unknown) {
  const response = await fetch(base + route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { status: response.status, body: await response.json() as any };
}
const coordinates = { lat: 4.651, lng: -74.058 };
const payload = {
  storeId: 'HUB_ALAMOS', deliveryMode: 'PROGRAMADO', scheduledWindow: slot,
  items: [{ productId: product.id, quantity: 1 }],
  customer: { name: 'Programado temporal QA', phone: '0000000000', email: 'qa@example.invalid', isGuest: true },
  deliveryAddress: { address: 'Dirección de prueba Chapinero', details: 'Detalle conservado', porteriaPolicy: 'DEJAR_EN_PORTERIA', coordinates },
  paymentMethod: 'WOMPI_CARD', tip: 0, expectedTotal: 24900, expectedDiscount: 0,
};
try {
  const quoteOnly = await request('/delivery/quote', { destination: { address: 'Kennedy falsa', coordinates } });
  check('la cotización sugiere Álamos por coordenadas y no crea pedidos ni reservas', () => {
    assert.equal(quoteOnly.status, 200);
    assert.equal(quoteOnly.body.scheduledAssignment.storeId, 'HUB_ALAMOS');
    assert.equal(quoteOnly.body.scheduledAssignment.status, 'SUGERIDA');
    assert.equal(repository.getAllOrders().length, 1);
    assert.equal(product.reservedStockByStore.HUB_ALAMOS, 0);
  });
  const quote = await request('/delivery/quote', { destination: { address: 'Kennedy falsa', coordinates }, items: payload.items });
  check('cotización con inventario real confirmado utiliza la misma sede que el pedido', () => {
    assert.equal(quote.status, 200);
    assert.equal(quote.body.scheduledAssignment.status, 'CONFIRMADA');
    assert.equal(quote.body.scheduledAssignment.localityCode, 'CHAPINERO');
  });
  const before = JSON.stringify(product.reservedStockByStore);
  for (const storeId of ['HUB_KENNEDY', 'HUB_SUBA', 'HUB_CENTRO']) {
    const wrong = await request('/orders', { ...payload, storeId });
    check('no acepta ni reserva el storeId impuesto ' + storeId, () => {
      assert.equal(wrong.status, 409); assert.equal(wrong.body.code, 'WAREHOUSE_CHANGED');
      assert.equal(wrong.body.assignedStoreId, 'HUB_ALAMOS');
      assert.equal(JSON.stringify(product.reservedStockByStore), before);
      assert.equal(repository.getAllOrders().length, 1);
    });
  }
  for (const deliveryMode of ['PROGRAMADO', 'TURBO', 'TURBO_DIVIDIDO']) {
    const sumapaz = await request('/orders', { ...payload, storeId: 'HUB_CENTRO', deliveryMode,
      deliveryAddress: { ...payload.deliveryAddress, address: 'Kennedy falsa, Bogotá', coordinates: { lat: 4.265, lng: -74.2 } },
      localityCode: 'KENNEDY', scheduledAssignment: { storeId: 'HUB_CENTRO', status: 'CONFIRMADA' } });
    check('Sumapaz no permite crear un pedido manipulando ' + deliveryMode, () => {
      assert.equal(sumapaz.status, 400);
      assert.match(sumapaz.body.error, /no tenemos cobertura/i);
      assert.equal(repository.getAllOrders().length, 1);
      assert.equal(JSON.stringify(product.reservedStockByStore), before);
    });
  }
  const unknown = await request('/orders', { ...payload, deliveryAddress: { ...payload.deliveryAddress, address: 'Kennedy falsa', coordinates: { lat: 4.8, lng: -74.2 } } });
  check('punto exterior no hereda la bodega de la compra ni una localidad del navegador', () => {
    assert.equal(unknown.status, 400); assert.equal(unknown.body.code, 'LOCALITY_NEEDS_CONFIRMATION');
  });
  product.stockByStore.HUB_ALAMOS = 0;
  const missing = await request('/orders', payload);
  check('faltante en Álamos requiere revisión, aunque Kennedy y Centro tengan mercancía', () => {
    assert.equal(missing.status, 409); assert.equal(missing.body.code, 'STOCK_UNAVAILABLE');
    assert.equal(missing.body.scheduledAssignment.storeId, 'HUB_ALAMOS');
    assert.equal(repository.getAllOrders().length, 1);
    assert.equal(JSON.stringify(product.reservedStockByStore), before);
  });
  product.stockByStore.HUB_ALAMOS = 30;
  Object.assign(product, { inventoryVerifiedByStore: { HUB_KENNEDY: true, HUB_SUBA: true, HUB_CENTRO: true } });
  const unverified = await request('/orders', payload);
  check('la cantidad histórica sin verificación tampoco confirma una reserva', () => {
    assert.equal(unverified.status, 409); assert.equal(unverified.body.code, 'STOCK_UNAVAILABLE');
  });
  Object.assign(product, { inventoryVerifiedByStore: { HUB_KENNEDY: true, HUB_ALAMOS: true, HUB_SUBA: true, HUB_CENTRO: true } });
  const inactive = stores.find(store => store.id === 'HUB_ALAMOS')!;
  inactive.isActive = false;
  const unavailable = await request('/orders', payload);
  check('la bodega inactiva no admite el pedido ni usa Centro', () => {
    assert.equal(unavailable.status, 400); assert.equal(repository.getAllOrders().length, 1);
  });
  inactive.isActive = true;
  const stalePrice = await request('/orders', { ...payload, expectedTotal: 1 });
  check('un total antiguo debe confirmarse otra vez antes de reservar', () => {
    assert.equal(stalePrice.status, 409); assert.equal(stalePrice.body.code, 'PRICE_CHANGED');
    assert.equal(JSON.stringify(product.reservedStockByStore), before);
  });
  const created = await request('/orders', payload);
  check('confirma el pedido en Álamos con localidad, política y una única reserva', () => {
    assert.equal(created.status, 201, JSON.stringify(created.body));
    assert.equal(created.body.storeId, quote.body.scheduledAssignment.storeId);
    assert.equal(created.body.scheduledDispatch.localityCode, 'CHAPINERO');
    assert.equal(created.body.scheduledDispatch.status, 'CONFIRMADA');
    assert.equal(created.body.payment.status, 'PENDIENTE');
    assert.equal(created.body.deliveryAddress.details, 'Detalle conservado');
    assert.equal(product.reservedStockByStore.HUB_ALAMOS, 1);
    assert.equal(product.reservedStockByStore.HUB_KENNEDY, 0);
    assert.equal(product.reservedStockByStore.HUB_CENTRO, 0);
  });
  // One historical Centro + this new Álamos order consume two of the shared 10.
  for (let i = 0; i < 8; i++) {
    const storeId = i % 2 ? 'HUB_SUBA' : 'HUB_KENNEDY';
    const coordinates = storeId === 'HUB_SUBA' ? { lat: 4.747, lng: -74.098 } : { lat: 4.631, lng: -74.151 };
    const order = await request('/orders', { ...payload, storeId, deliveryAddress: { ...payload.deliveryAddress, coordinates } });
    assert.equal(order.status, 201, JSON.stringify(order.body));
  }
  const reservedAtCapacity = JSON.stringify(product.reservedStockByStore);
  const exceeded = await request('/orders', payload);
  check('el cupo global de 10 incluye las tres sedes y los históricos Centro', () => {
    assert.equal(repository.getAllOrders().filter(order => order.deliveryMode === 'PROGRAMADO').length, 10);
    assert.equal(exceeded.status, 400); assert.equal(exceeded.body.code, 'SLOT_CAPACITY_EXCEEDED');
    assert.equal(JSON.stringify(product.reservedStockByStore), reservedAtCapacity);
  });
  const fullQuote = await request('/delivery/quote', { destination: { address: 'Chapinero', coordinates }, items: payload.items });
  check('la cotización pública refleja los diez cupos ocupados sin reiniciarlos por bodega', () => {
    const selected = fullQuote.body.scheduledSlots.find((candidate: any) => candidate.date === slot.date && candidate.startTime === slot.startTime);
    assert.equal(selected.maxCapacity, 10); assert.equal(selected.availableCapacity, 0);
  });
  const cancelled = repository.transitionStatus(created.body.id, 'CANCELADO', { role: 'ADMINISTRADOR', id: 'QA-CAPACITY', name: 'Prueba de cupos' }, { reason: 'Cancelar prueba aislada', catalogProducts: products });
  assert.equal(cancelled.success, true, cancelled.error);
  const reopenedQuote = await request('/delivery/quote', { destination: { address: 'Chapinero', coordinates }, items: payload.items });
  check('cancelar libera un cupo global y solo la reserva de la bodega correspondiente', () => {
    const selected = reopenedQuote.body.scheduledSlots.find((candidate: any) => candidate.date === slot.date && candidate.startTime === slot.startTime);
    assert.equal(selected.availableCapacity, 1); assert.equal(product.reservedStockByStore.HUB_ALAMOS, 0);
    assert.equal(product.reservedStockByStore.HUB_CENTRO, 0);
  });
  check('los pedidos históricos conservan sede, datos y reservas sin migración automática', () => {
    assert.equal(JSON.stringify(repository.getOrderById(historical.id)), historicalBefore);
    assert.equal(repository.getOrderById(historical.id)?.storeId, 'HUB_CENTRO');
    assert.equal(repository.getOrderById(historical.id)?.scheduledDispatch, undefined);
    assert.equal(product.reservedStockByStore.HUB_CENTRO, 0);
  });
  console.log('PROGRAMADO HTTP: ' + passed + ' comprobaciones aprobadas.');
} finally {
  await new Promise<void>(resolve => server.close(() => resolve()));
  app.locals.closeAdmin();
  if (previousDataDir === undefined) delete process.env.BOLT_DATA_DIR; else process.env.BOLT_DATA_DIR = previousDataDir;
  const checked = path.resolve(dir);
  if (checked.startsWith(path.resolve(tmpdir()) + path.sep) && path.basename(checked).startsWith('bolt-scheduled-http-')) rmSync(checked, { recursive: true, force: true });
}
