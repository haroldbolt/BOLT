import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { INITIAL_PRODUCTS, INITIAL_STORES, INITIAL_ORDERS } from '../data/seedData';
import { AdminRepository } from '../lib/adminRepository';
import type { Order, Product } from '../types';

const dir = mkdtempSync(path.join(tmpdir(), 'bolt-checkout-policy-'));
const previousDataDir = process.env.BOLT_DATA_DIR;
process.env.BOLT_DATA_DIR = path.join(dir, 'module-default');
const { createBoltApp } = await import('../../server');
const { OrdersRepository } = await import('../lib/ordersRepository');
const stores = structuredClone(INITIAL_STORES);
const seed = structuredClone(INITIAL_PRODUCTS[0]);
const fixtures: Product[] = [
  { ...structuredClone(seed), id: 'QA-FEE-SINGLE', sku: 'QA-FEE-SINGLE', name: 'Producto de ensayo de tarifa', price: 20000, weightKg: 1 },
  { ...structuredClone(seed), id: 'QA-FEE-HEAVY', sku: 'QA-FEE-HEAVY', name: 'Empaque indivisible de ensayo', price: 20000, weightKg: 20 },
  { ...structuredClone(seed), id: 'QA-FEE-THRESHOLD', sku: 'QA-FEE-THRESHOLD', name: 'Producto de umbral de ensayo', price: 35000, weightKg: 1 },
].map(product => ({ ...product, status: 'ACTIVE', presentaciones: [], bodegaIds: ['HUB_KENNEDY'],
  stockByStore: Object.fromEntries(stores.map(store => [store.id, store.id === 'HUB_KENNEDY' ? 100 : 0])),
  reservedStockByStore: Object.fromEntries(stores.map(store => [store.id, 0])),
  inventoryVerifiedByStore: { HUB_KENNEDY: true },
}));
const historical = structuredClone(INITIAL_ORDERS.find(order => order.deliveryAddress.porteriaPolicy === 'SUBIR_A_PUERTA' && order.totals.serviceFee === 1500)!);
assert.ok(historical, 'La prueba necesita un pedido histórico real del fixture con tarifa y subir a puerta');
historical.id = 'QA-HISTORICAL-SERVICE-FEE';
historical.orderNumber = '#QA-HISTORICAL-SERVICE-FEE';
// Only the isolated clone receives an access capability; its saved invoice stays unchanged.
const historicalAccessToken = 'QA-historical-' + randomUUID();
Object.assign(historical, { customerAccessTokenHash: createHash('sha256').update(historicalAccessToken).digest('hex') });
let products: Product[] = [];
let repository!: InstanceType<typeof OrdersRepository>;
let administration!: AdminRepository;
let app!: Awaited<ReturnType<typeof createBoltApp>>;
let server: ReturnType<typeof app.listen> | undefined;
let base = '';
let cookie = '';
let csrf = '';
let passed = 0;
const password = 'QA-checkout-' + randomUUID();
function check(label: string, run: () => void) { run(); passed++; console.log('PASS: ' + label); }
async function boot(initialOrders: Order[]) {
  products = structuredClone(fixtures);
  repository = new OrdersRepository({ dataDir: dir, initialOrders, initialDrivers: [] });
  administration = new AdminRepository({ dataDir: dir, products, stores });
  if (!administration.hasAdministrator()) administration.createAdministrator('qa.checkout', password, 'Pruebas aisladas de checkout');
  app = await createBoltApp({ serveFrontend: false, products, stores, repository, adminRepository: administration });
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server!.once('listening', resolve));
  base = 'http://127.0.0.1:' + (server.address() as { port: number }).port + '/api/v1';
}
async function stop() {
  if (!server) return;
  const current = server;
  server = undefined;
  const closed = new Promise<void>((resolve, reject) => current.close(error => error ? reject(error) : resolve()));
  current.closeAllConnections?.();
  await closed;
  app.locals.closeAdmin();
}
async function request(route: string, body?: unknown, authorized = false, orderToken?: string) {
  const response = await fetch(base + route, { method: body === undefined ? 'GET' : 'POST',
    headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(authorized ? { Cookie: cookie, 'X-CSRF-Token': csrf } : {}), ...(orderToken ? { 'X-Order-Token': orderToken } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { response, status: response.status, body: await response.json() as any };
}
const standard = {
  storeId: 'HUB_KENNEDY', deliveryMode: 'TURBO',
  items: [{ productId: 'QA-FEE-SINGLE', quantity: 1 }],
  customer: { name: 'Comprador ficticio de política', phone: '0000000000', email: 'qa@example.invalid', isGuest: true },
  deliveryAddress: { address: 'Punto de prueba, Kennedy, Bogotá', details: 'Sin entrega real',
    porteriaPolicy: 'DEJAR_EN_PORTERIA', coordinates: { lat: 4.6325, lng: -74.1520 } },
  paymentMethod: 'WOMPI_CARD', tip: 0,
};
const stockSnapshot = () => JSON.stringify(products.map(product => [product.id, product.stockByStore, product.reservedStockByStore]));
const createdIds: string[] = [];

try {
  await boot([historical]);
  const login = await request('/admin/login', { username: 'qa.checkout', password });
  assert.equal(login.status, 200);
  cookie = login.response.headers.get('set-cookie')!.split(';')[0];
  csrf = login.body.csrfToken;
  const historyBefore = JSON.stringify(repository.getOrderById(historical.id));
  const readBefore = await request('/orders/' + historical.id, undefined, true);
  const trackBefore = await request('/orders/' + historical.id + '/tracking', undefined, true);
  check('administración consulta una instrucción histórica de subir y su tarifa original', () => {
    assert.equal(readBefore.status, 200);
    assert.equal(readBefore.body.deliveryAddress.porteriaPolicy, 'SUBIR_A_PUERTA');
    assert.equal(readBefore.body.totals.serviceFee, 1500);
    assert.deepEqual(readBefore.body.totals, historical.totals);
    assert.equal(trackBefore.status, 200);
  });
  const clientHistoryBefore = await request('/orders/' + historical.id, undefined, false, historicalAccessToken);
  const clientTrackingBefore = await request('/orders/' + historical.id + '/tracking', undefined, false, historicalAccessToken);
  check('el comprador consulta el histórico con su acceso privado y conserva factura e instrucción', () => {
    assert.equal(clientHistoryBefore.status, 200);
    assert.equal(clientHistoryBefore.body.deliveryAddress.porteriaPolicy, 'SUBIR_A_PUERTA');
    assert.deepEqual(clientHistoryBefore.body.totals, historical.totals);
    assert.deepEqual(clientHistoryBefore.body.payment, historical.payment);
    assert.equal(clientHistoryBefore.body.customerAccessTokenHash, undefined);
    assert.equal(clientTrackingBefore.status, 200);
  });

  const price = await request('/cart/price', { storeId: 'HUB_KENNEDY', items: standard.items });
  check('cotización de $20.000 con envío de $4.900 elimina la tarifa y totaliza $24.900', () => {
    assert.equal(price.status, 200);
    assert.equal(price.body.subtotal, 20000);
    assert.equal(price.body.shipping, 4900);
    assert.equal(price.body.serviceFee, 0);
    assert.equal(price.body.total, 24900);
  });
  const quote = await request('/delivery/quote', { destination: standard.deliveryAddress, items: standard.items });
  const scheduledSlot = quote.body.scheduledSlots.find((slot: any) => !slot.cutoffPassed && slot.availableCapacity > 0);
  assert.ok(scheduledSlot);

  for (const mode of ['TURBO', 'TURBO_DIVIDIDO', 'PROGRAMADO']) {
    const before = stockSnapshot();
    const count = repository.getAllOrders().length;
    const rejected = await request('/orders', { ...standard, deliveryMode: mode, scheduledWindow: mode === 'PROGRAMADO' ? scheduledSlot : undefined,
      items: mode === 'TURBO_DIVIDIDO' ? [{ productId: 'QA-FEE-HEAVY', quantity: 4 }] : standard.items,
      deliveryAddress: { ...standard.deliveryAddress, porteriaPolicy: 'SUBIR_A_PUERTA' } });
    check('no acepta subir al apartamento ni reserva mercancía en ' + mode, () => {
      assert.equal(rejected.status, 400);
      assert.equal(rejected.body.code, 'DELIVERY_INSTRUCTION_INVALID');
      assert.equal(stockSnapshot(), before);
      assert.equal(repository.getAllOrders().length, count);
    });
  }

  for (const mode of ['TURBO', 'TURBO_DIVIDIDO', 'PROGRAMADO']) {
    for (const policy of ['LLAMAR_AL_LLEGAR', 'DEJAR_EN_PORTERIA']) {
      const heavy = mode === 'TURBO_DIVIDIDO';
      const response = await request('/orders', { ...standard, deliveryMode: mode, scheduledWindow: mode === 'PROGRAMADO' ? scheduledSlot : undefined,
        items: heavy ? [{ productId: 'QA-FEE-HEAVY', quantity: 4 }] : standard.items,
        deliveryAddress: { ...standard.deliveryAddress, porteriaPolicy: policy },
        paymentMethod: heavy ? 'CASH_ON_DELIVERY' : standard.paymentMethod,
        // Inputs supplied by a buyer never restore the deleted fee or waive shipping.
        serviceFee: 1500, shipping: 0, total: 1,
      });
      check(mode + ' guarda ' + policy + ', tarifa cero, envío vigente y pago pendiente', () => {
        assert.equal(response.status, 201, JSON.stringify(response.body));
        assert.equal(response.body.deliveryMode, mode);
        assert.equal(response.body.deliveryAddress.porteriaPolicy, policy);
        assert.equal(response.body.totals.serviceFee, 0);
        assert.equal(response.body.totals.shipping, heavy ? 0 : 4900);
        assert.equal(response.body.totals.total, heavy ? 80000 : 24900);
        assert.equal(response.body.payment.status, 'PENDIENTE');
        assert.equal(response.body.payment.transactionId, undefined);
        if (heavy) assert.equal(response.body.childShipments.reduce((sum: number, child: any) => sum + child.cashToCollect, 0), 80000);
      });
      createdIds.push(response.body.id);
      const cancel = await request('/orders/' + response.body.id + '/cancel', { reason: 'Fin de prueba aislada, sin alistamiento ni entrega' }, true);
      assert.equal(cancel.status, 200, JSON.stringify(cancel.body));
    }
  }

  const tipOrder = await request('/orders', { ...standard, tip: 2000, expectedTotal: 26900, expectedDiscount: 0 });
  check('la propina de $2.000 se conserva y produce total $26.900 sin servicio', () => {
    assert.equal(tipOrder.status, 201, JSON.stringify(tipOrder.body));
    assert.equal(tipOrder.body.totals.tip, 2000);
    assert.equal(tipOrder.body.totals.total, 26900);
    assert.equal(tipOrder.body.totals.serviceFee, 0);
  });
  createdIds.push(tipOrder.body.id);
  assert.equal((await request('/orders/' + tipOrder.body.id + '/cancel', { reason: 'Finalizar ensayo de propina' }, true)).status, 200);

  const stockBeforeStale = stockSnapshot();
  const countBeforeStale = repository.getAllOrders().length;
  const stale = await request('/orders', { ...standard, expectedTotal: 26400, expectedDiscount: 0 });
  check('el total antiguo con $1.500 exige revisar el precio y no crea pedido ni reserva', () => {
    assert.equal(stale.status, 409);
    assert.equal(stale.body.code, 'PRICE_CHANGED');
    assert.equal(stale.body.totals.total, 24900);
    assert.equal(stale.body.totals.serviceFee, 0);
    assert.equal(repository.getAllOrders().length, countBeforeStale);
    assert.equal(stockSnapshot(), stockBeforeStale);
  });

  const promotion = await request('/admin/promotions', {
    name: 'Descuento de umbral, solo ensayo', type: 'PERCENTAGE', value: 50, active: true,
    startsAt: new Date(Date.now() - 60000).toISOString(), endsAt: new Date(Date.now() + 3600000).toISOString(),
    productIds: ['QA-FEE-THRESHOLD'], variantIds: [], storeIds: ['HUB_KENNEDY'], minSubtotal: 0,
  }, true);
  assert.equal(promotion.status, 201);
  const discounted = await request('/cart/price', { storeId: 'HUB_KENNEDY', items: [{ productId: 'QA-FEE-THRESHOLD', quantity: 2 }] });
  check('el umbral exacto $70.000 conserva envío gratis antes de aplicar descuentos', () => {
    assert.equal(discounted.status, 200);
    assert.equal(discounted.body.subtotal, 70000);
    assert.equal(discounted.body.discount, 35000);
    assert.equal(discounted.body.shipping, 0);
    assert.equal(discounted.body.serviceFee, 0);
    assert.equal(discounted.body.total, 35000);
  });
  const discountedOrder = await request('/orders', { ...standard,
    items: [{ productId: 'QA-FEE-THRESHOLD', quantity: 2 }], expectedTotal: 35000, expectedDiscount: 35000,
  });
  check('el pedido conserva el descuento del servidor, envío gratis y pago pendiente sin servicio', () => {
    assert.equal(discountedOrder.status, 201, JSON.stringify(discountedOrder.body));
    assert.equal(discountedOrder.body.deliveryMode, 'TURBO');
    assert.equal(discountedOrder.body.totals.subtotal, 70000);
    assert.equal(discountedOrder.body.totals.discount, 35000);
    assert.equal(discountedOrder.body.totals.shipping, 0);
    assert.equal(discountedOrder.body.totals.serviceFee, 0);
    assert.equal(discountedOrder.body.totals.total, 35000);
    assert.equal(discountedOrder.body.payment.status, 'PENDIENTE');
    assert.equal(discountedOrder.body.payment.transactionId, undefined);
  });
  createdIds.push(discountedOrder.body.id);
  assert.equal((await request('/orders/' + discountedOrder.body.id + '/cancel', { reason: 'Finalizar ensayo de promoción' }, true)).status, 200);
  const readAfter = await request('/orders/' + historical.id, undefined, true);
  const trackAfter = await request('/orders/' + historical.id + '/tracking', undefined, true);
  check('los pedidos nuevos no reescriben totales, pago o instrucción del histórico', () => {
    assert.equal(JSON.stringify(repository.getOrderById(historical.id)), historyBefore);
    assert.deepEqual(readAfter.body.totals, readBefore.body.totals);
    assert.deepEqual(readAfter.body.payment, readBefore.body.payment);
    assert.deepEqual(readAfter.body.deliveryAddress, readBefore.body.deliveryAddress);
    assert.equal(trackAfter.status, 200);
    assert.deepEqual(trackAfter.body.customerCoordinates, trackBefore.body.customerCoordinates);
    assert.equal(trackAfter.body.status, trackBefore.body.status);
  });
  const clientHistoryAfter = await request('/orders/' + historical.id, undefined, false, historicalAccessToken);
  const clientTrackingAfter = await request('/orders/' + historical.id + '/tracking', undefined, false, historicalAccessToken);
  check('el comprador sigue viendo sus importes y seguimiento históricos después de las compras nuevas', () => {
    assert.equal(clientHistoryAfter.status, 200);
    assert.deepEqual(clientHistoryAfter.body, clientHistoryBefore.body);
    assert.equal(clientTrackingAfter.status, 200);
    assert.deepEqual(clientTrackingAfter.body.customerCoordinates, clientTrackingBefore.body.customerCoordinates);
    assert.equal(clientTrackingAfter.body.status, clientTrackingBefore.body.status);
  });

  await stop();
  await boot([]);
  const readRestarted = await request('/orders/' + historical.id, undefined, true);
  check('reiniciar mantiene el histórico anterior y todas las tarifas nuevas en cero', () => {
    assert.equal(readRestarted.status, 200);
    assert.equal(JSON.stringify(repository.getOrderById(historical.id)), historyBefore);
    assert.equal(readRestarted.body.totals.serviceFee, 1500);
    assert.equal(readRestarted.body.deliveryAddress.porteriaPolicy, 'SUBIR_A_PUERTA');
    assert.deepEqual(readRestarted.body.totals, historical.totals);
    for (const id of createdIds) assert.equal(repository.getOrderById(id)!.totals.serviceFee, 0);
    assert.ok(products.every(product => product.reservedStockByStore.HUB_KENNEDY === 0));
  });
  const clientHistoryRestarted = await request('/orders/' + historical.id, undefined, false, historicalAccessToken);
  const clientTrackingRestarted = await request('/orders/' + historical.id + '/tracking', undefined, false, historicalAccessToken);
  check('el acceso del comprador y la factura histórica sobreviven el reinicio sin recalcular', () => {
    assert.equal(clientHistoryRestarted.status, 200);
    assert.deepEqual(clientHistoryRestarted.body, clientHistoryBefore.body);
    assert.equal(clientTrackingRestarted.status, 200);
    assert.deepEqual(clientTrackingRestarted.body.customerCoordinates, clientTrackingBefore.body.customerCoordinates);
    assert.equal(clientTrackingRestarted.body.status, clientTrackingBefore.body.status);
  });
  console.log(`CHECKOUT POLICY HTTP: ${passed} comprobaciones aprobadas; datos y servicios aislados.`);
} finally {
  await stop();
  if (previousDataDir === undefined) delete process.env.BOLT_DATA_DIR; else process.env.BOLT_DATA_DIR = previousDataDir;
  const checked = path.resolve(dir);
  assert.ok(checked.startsWith(path.resolve(tmpdir()) + path.sep) && path.basename(checked).startsWith('bolt-checkout-policy-'));
  rmSync(checked, { recursive: true, force: true });
}
