import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { INITIAL_PRODUCTS, INITIAL_STORES, INITIAL_DRIVERS, INITIAL_ORDERS } from '../data/seedData';
import { AdminRepository } from '../lib/adminRepository';
import type { OrderActor, Order } from '../types';

const dir = mkdtempSync(path.join(tmpdir(), 'bolt-admin-adversarial-'));
const previousDataDir = process.env.BOLT_DATA_DIR;
process.env.BOLT_DATA_DIR = path.join(dir, 'module-default');
const { createBoltApp } = await import('../../server');
const { OrdersRepository } = await import('../lib/ordersRepository');
const products = structuredClone(INITIAL_PRODUCTS.slice(0, 2));
const stores = structuredClone(INITIAL_STORES);
for (const product of products) {
  Object.assign(product, { status: 'ACTIVE', price: 20000, weightKg: 1, bodegaIds: ['HUB_KENNEDY'], inventoryVerifiedByStore: { HUB_KENNEDY: true } });
  product.stockByStore = Object.fromEntries(stores.map(s => [s.id, s.id === 'HUB_KENNEDY' ? 100 : 0]));
  product.reservedStockByStore = Object.fromEntries(stores.map(s => [s.id, 0]));
}
const repository = new OrdersRepository({ dataDir: dir, initialOrders: [], initialDrivers: structuredClone(INITIAL_DRIVERS) });
const administration = new AdminRepository({ dataDir: dir, products, stores });
const user = administration.createAdministrator('qa.adversarial', 'Solo-Prueba-Adversarial-2026');
const session = await administration.login(user.username, 'Solo-Prueba-Adversarial-2026', 'qa-adversarial');
const auth = { Cookie: `bolt_admin_session=${session.token}`, 'X-CSRF-Token': session.csrfToken };
const app = await createBoltApp({ serveFrontend: false, products, stores, repository, adminRepository: administration });
const server = app.listen(0, '127.0.0.1');
await new Promise<void>(resolve => server.once('listening', resolve));
const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/v1`;
let passed = 0;
function check(label: string, run: () => void) { run(); passed++; console.log(`PASS: ${label}`); }
async function request(route: string, options: { method?: string; body?: unknown; headers?: Record<string, string> } = {}) {
  const response = await fetch(base + route, { method: options.method || 'GET', headers: { ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...options.headers }, body: options.body === undefined ? undefined : JSON.stringify(options.body) });
  return { status: response.status, body: await response.json().catch(() => ({})) as any };
}
const product = products[0];
const payload = {
  storeId: 'HUB_KENNEDY', deliveryMode: 'TURBO',
  items: [{ productId: product.id, quantity: 1 }],
  customer: { name: 'Comprador temporal', phone: '0000000000', email: 'qa@example.invalid', isGuest: true },
  deliveryAddress: { address: 'Dirección de prueba, Kennedy, Bogotá', details: '', porteriaPolicy: 'DEJAR_EN_PORTERIA', coordinates: { lat: 4.6325, lng: -74.1520 } },
  paymentMethod: 'WOMPI_CARD', tip: 0,
};
try {
  for (const field of ['name', 'phone', 'email'] as const) {
    const result = await request('/orders', { method: 'POST', body: { ...payload, customer: { ...payload.customer, [field]: { injected: 'object' } } } });
    check(`no permite inutilizar el panel con customer.${field} como objeto`, () => assert.equal(result.status, 400));
  }
  const badAddress = await request('/orders', { method: 'POST', body: { ...payload, deliveryAddress: { ...payload.deliveryAddress, address: ['Dirección inválida'] } } });
  const badMode = await request('/orders', { method: 'POST', body: { ...payload, deliveryMode: 'MODO-INVENTADO' } });
  check('los datos inválidos de dirección y modalidad no crean pedidos ni reservas', () => {
    assert.equal(badAddress.status, 400);
    assert.equal(badMode.status, 400);
    assert.equal(repository.getAllOrders().length, 0);
    assert.equal(product.reservedStockByStore.HUB_KENNEDY, 0);
  });
  const addressOnly = await request('/delivery/quote', { method: 'POST', body: { destination: { address: payload.deliveryAddress.address, coordinates: payload.deliveryAddress.coordinates }, items: [] } });
  const unknownQuote = await request('/delivery/quote', { method: 'POST', body: { destination: { address: payload.deliveryAddress.address, coordinates: payload.deliveryAddress.coordinates }, items: [{ productId: 'NO-EXISTE', quantity: 1000000000 }] } });
  check('la consulta inicial de dirección sigue funcionando y los productos inventados no se cotizan', () => {
    assert.equal(addressOnly.status, 200);
    assert.equal(unknownQuote.status, 400);
  });
  const staleTotal = await request('/orders', { method: 'POST', body: { ...payload, expectedTotal: 1, expectedDiscount: 0 } });
  const staleDiscount = await request('/orders', { method: 'POST', body: { ...payload, expectedTotal: 24900, expectedDiscount: 1000 } });
  const malformedExpected = await request('/orders', { method: 'POST', body: { ...payload, expectedTotal: '24900' } });
  check('un cambio de precio o descuento requiere nueva confirmación antes de reservar', () => {
    assert.equal(staleTotal.status, 409);
    assert.equal(staleTotal.body.code, 'PRICE_CHANGED');
    assert.equal(staleDiscount.status, 409);
    assert.equal(staleDiscount.body.code, 'PRICE_CHANGED');
    assert.equal(malformedExpected.status, 400);
    assert.equal(product.reservedStockByStore.HUB_KENNEDY, 0);
  });
  const excessiveAmount = await request('/cart/price', { method: 'POST', body: { storeId: 'HUB_KENNEDY', items: [{ productId: product.id, quantity: Number.MAX_SAFE_INTEGER }] } });
  check('un importe fuera de rango es un error de entrada y no un fallo del servidor', () => {
    assert.equal(excessiveAmount.status, 400);
    assert.equal(excessiveAmount.body.code, 'INVALID_INPUT');
  });
  const created = await request('/orders', { method: 'POST', body: { ...payload, expectedTotal: 24900, expectedDiscount: 0 } });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const id = created.body.id;
  const customer = { 'x-order-token': created.body.customerAccessToken };
  check('el comprador recibe el PIN y la capacidad privada una vez, nunca el hash almacenado', () => {
    assert.match(created.body.secretDeliveryCode, /^\d{4}$/);
    assert.equal(created.body.customerAccessTokenHash, undefined);
    assert.ok(created.body.customerAccessToken.length >= 40);
  });
  for (const suffix of ['/history', '/history/', '/HISTORY', '/telemetry/history', '/telemetry/history/', '/TeLeMeTrY/HiStOrY']) {
    const result = await request(`/orders/${id}${suffix}`, { headers: customer });
    check(`la capacidad de comprador no autoriza el historial administrativo ${suffix}`, () => assert.equal(result.status, 401));
  }
  const upper = await request('/ORDERS', { headers: auth });
  const upperDetail = await request(`/ORDERS/${id}`, { headers: auth });
  const upperTracking = await request(`/ORDERS/${id}/TRACKING/`, { headers: auth });
  check('variar mayúsculas o barra final no revela PIN ni hash al administrador', () => {
    for (const result of [upperDetail, upperTracking]) { assert.equal(result.status, 200); assert.equal(result.body.secretDeliveryCode, undefined); assert.equal(result.body.customerAccessTokenHash, undefined); }
    assert.equal(upper.body[0].secretDeliveryCode, undefined);
    assert.equal(upper.body[0].customerAccessTokenHash, undefined);
  });
  const badReason = await request(`/orders/${id}/cancel`, { method: 'POST', headers: customer, body: { reason: { invalid: true } } });
  const badPrescription = await request(`/orders/${id}/prescription`, { method: 'POST', headers: customer, body: { documentName: 'Fórmula', documentUrl: 'javascript:alert(1)' } });
  check('el acceso a un pedido no permite insertar objetos de texto ni enlaces ejecutables', () => {
    assert.equal(badReason.status, 400);
    assert.equal(badPrescription.status, 400);
    assert.equal(repository.getOrderById(id)!.fulfillmentStatus, 'CONFIRMADO');
  });
  const other = await request('/orders', { method: 'POST', body: payload });
  assert.equal(other.status, 201, JSON.stringify(other.body));
  const wrongOrder = await request(`/orders/${other.body.id}`, { headers: customer });
  check('el token de un comprador no abre otro pedido válido', () => assert.equal(wrongOrder.status, 401));

  const second = products[1];
  second.price = 10000;
  second.weightKg = 20;
  administration.persistCatalog();
  const heavyPayload = { ...payload, items: [{ productId: second.id, quantity: 4 }] };
  const heavyMono = await request('/orders', { method: 'POST', body: heavyPayload });
  const falseSplit = await request('/orders', { method: 'POST', body: { ...payload, deliveryMode: 'TURBO_DIVIDIDO' } });
  check('el navegador no puede saltarse la división obligatoria ni inventar un plan dividido', () => {
    assert.equal(heavyMono.status, 400);
    assert.equal(heavyMono.body.code, 'DELIVERY_MODE_UNAVAILABLE');
    assert.equal(falseSplit.status, 400);
    assert.equal(second.reservedStockByStore.HUB_KENNEDY, 0);
  });
  const split = await request('/orders', { method: 'POST', body: { ...heavyPayload, deliveryMode: 'TURBO_DIVIDIDO' } });
  check('un plan dividido válido conserva empaques y nace pendiente de asignación real', () => {
    assert.equal(split.status, 201, JSON.stringify(split.body));
    assert.equal(split.body.childShipments.length, 4);
    assert.equal(split.body.childShipments.reduce((sum: number, child: any) => sum + child.items.reduce((n: number, item: any) => n + item.quantity, 0), 0), 4);
    assert.ok(split.body.childShipments.every((child: any) => child.weightKg <= 25 && !child.driver));
  });
  const forgedSlot = await request('/orders', { method: 'POST', body: { ...payload, deliveryMode: 'PROGRAMADO', scheduledWindow: { date: '2099-01-01', slotId: 'SLOT-INVENTADO', startTime: '00:00', endTime: '23:59' } } });
  check('solo admite franjas programadas ofrecidas por el servidor', () => assert.equal(forgedSlot.status, 400));
  const quote = await request('/delivery/quote', { method: 'POST', body: { destination: { address: payload.deliveryAddress.address, coordinates: payload.deliveryAddress.coordinates }, items: payload.items } });
  const availableSlot = quote.body.scheduledSlots.find((slot: any) => !slot.cutoffPassed);
  assert.ok(availableSlot);
  const scheduled = await request('/orders', { method: 'POST', body: { ...payload, deliveryMode: 'PROGRAMADO', scheduledWindow: { ...availableSlot, dateLabel: { injected: true }, displayWindow: 'Horario falso', endTime: '23:59' } } });
  check('la franja guardada es autoritativa y su fecha límite respeta Bogotá', () => {
    assert.equal(scheduled.status, 201, JSON.stringify(scheduled.body));
    assert.equal(scheduled.body.scheduledWindow.displayWindow, availableSlot.displayWindow);
    assert.equal(scheduled.body.scheduledWindow.dateLabel, availableSlot.dateLabel);
    assert.equal(scheduled.body.originalPromiseWindow.end, new Date(`${availableSlot.date}T${availableSlot.endTime}:00-05:00`).toISOString());
  });

  const unverified = products[1] as typeof products[1] & { inventoryVerifiedByStore: Record<string, boolean> };
  unverified.inventoryVerifiedByStore.HUB_KENNEDY = false;
  const unverifiedOrder = await request('/orders', { method: 'POST', body: { ...payload, items: [{ productId: unverified.id, quantity: 1 }] } });
  unverified.inventoryVerifiedByStore.HUB_KENNEDY = true;
  const previousAssociations = unverified.bodegaIds;
  unverified.bodegaIds = ['HUB_SUBA'];
  const wrongWarehouse = await request('/orders', { method: 'POST', body: { ...payload, items: [{ productId: unverified.id, quantity: 1 }] } });
  unverified.bodegaIds = previousAssociations;
  check('una cantidad histórica no autoriza venta sin verificación y asociación con la bodega', () => {
    assert.equal(unverifiedOrder.status, 409);
    assert.equal(wrongWarehouse.status, 409);
  });

  const actor: OrderActor = { role: 'ADMINISTRADOR', id: user.id, name: user.displayName };
  const beforeIncident = structuredClone(repository.getOrderById(id)!.incidents || []);
  const invalidIncident = repository.reportIncident(id, actor, 'PRUEBA', 'No debe registrarse en estado confirmado');
  check('una incidencia rechazada no deja mutaciones de memoria fuera de la transacción', () => {
    assert.equal(invalidIncident.success, false);
    assert.deepEqual(repository.getOrderById(id)!.incidents || [], beforeIncident);
  });
  assert.equal(repository.transitionStatus(id, 'EN_ALISTAMIENTO', actor).success, true);
  assert.equal(repository.transitionStatus(id, 'LISTO_PARA_DESPACHO', actor).success, true);
  assert.equal(repository.reportIncident(id, actor, 'QA-UNO', 'Primera incidencia temporal').success, true);
  assert.equal(repository.reportIncident(id, actor, 'QA-DOS', 'Segunda incidencia temporal').success, true);
  check('una incidencia adicional se guarda aunque el envío ya esté en incidencia', () => {
    assert.equal(repository.getOrderById(id)!.incidents!.length, 2);
    assert.equal(administration.readOperationalState().orders.find((order: any) => order.id === id).incidents.length, 2);
  });
  administration.db.exec("CREATE TRIGGER qa_fail_incident BEFORE INSERT ON operational_state BEGIN SELECT RAISE(ABORT, 'fallo temporal de incidencia'); END");
  try { assert.throws(() => repository.reportIncident(id, actor, 'QA-NO-GUARDAR', 'No debe persistir'), /fallo temporal/); }
  finally { administration.db.exec('DROP TRIGGER qa_fail_incident'); }
  check('un fallo al guardar una incidencia revierte también el cambio en memoria', () => {
    assert.equal(repository.getOrderById(id)!.incidents!.length, 2);
    assert.equal(administration.readOperationalState().orders.find((order: any) => order.id === id).incidents.length, 2);
  });
  const driver = repository.getAllDrivers()[0];
  const shift = await request('/driver/shift', { method: 'POST', headers: auth, body: { action: 'START', driverId: driver.id } });
  check('el cambio de turno se guarda junto con el estado operativo persistente', () => {
    assert.equal(shift.status, 200);
    assert.equal(shift.body.driver.isOnline, true);
    assert.equal(administration.readOperationalState().drivers.find((entry: any) => entry.id === driver.id).isOnline, true);
  });
  const cashOrder = structuredClone(INITIAL_ORDERS[0]) as Order;
  Object.assign(cashOrder, { id: 'QA-CASH-DELIVERY', orderNumber: 'QA-CASH-DELIVERY', isSplitOrder: false, childShipments: undefined, fulfillmentStatus: 'EN_CAMINO', storeId: 'HUB_KENNEDY', secretDeliveryCode: '1234', driver: { ...driver } });
  cashOrder.items = [{ ...cashOrder.items[0], productId: product.id, quantity: 1 }];
  cashOrder.payment = { method: 'CASH_ON_DELIVERY', status: 'PENDIENTE', cashToCollect: cashOrder.totals.total, cashSettled: false };
  assert.equal(repository.createOrder(cashOrder, products).success, true);
  const delivery = repository.verifyDelivery(cashOrder.id, '1234', actor, undefined, products);
  check('el PIN confirma la entrega sin acreditar automáticamente efectivo no conciliado', () => {
    assert.equal(delivery.success, true);
    assert.equal(delivery.order!.fulfillmentStatus, 'ENTREGADO');
    assert.equal(delivery.order!.payment.status, 'PENDIENTE');
    assert.equal(delivery.order!.payment.cashSettled, false);
  });
  const cashSplit = structuredClone(cashOrder);
  Object.assign(cashSplit, { id: 'QA-CASH-SPLIT', orderNumber: 'QA-CASH-SPLIT', isSplitOrder: true, fulfillmentStatus: 'EN_CAMINO' });
  cashSplit.items[0].quantity = 2;
  cashSplit.childShipments = ['1111', '2222'].map((code, index) => ({ shipmentId: `QA-CASH-CHILD-${index}`, parentOrderId: cashSplit.id, shipmentIndex: index + 1, shipmentCount: 2, items: [{ ...cashSplit.items[0], quantity: 1 }], weightKg: 1, weightGrams: 1000, subtotal: 20000, cashToCollect: 20000, fulfillmentStatus: 'EN_CAMINO', secretDeliveryCode: code, estimatedDeliveryMinutes: 20, timestamps: {} }));
  assert.equal(repository.createOrder(cashSplit, products).success, true);
  assert.equal(repository.verifyDelivery(cashSplit.id, '1111', actor, 'QA-CASH-CHILD-0', products).success, true);
  const cashSplitDelivered = repository.verifyDelivery(cashSplit.id, '2222', actor, 'QA-CASH-CHILD-1', products);
  check('la entrega de todos los hijos tampoco acredita automáticamente el efectivo del padre', () => {
    assert.equal(cashSplitDelivered.success, true);
    assert.equal(cashSplitDelivered.order!.fulfillmentStatus, 'ENTREGADO');
    assert.equal(cashSplitDelivered.order!.payment.status, 'PENDIENTE');
    assert.equal(cashSplitDelivered.order!.payment.cashSettled, false);
  });
  console.log(`ADMIN ADVERSARIAL: ${passed} comprobaciones aprobadas.`);
} finally {
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  app.locals.closeAdmin();
  if (previousDataDir === undefined) delete process.env.BOLT_DATA_DIR; else process.env.BOLT_DATA_DIR = previousDataDir;
  if (path.dirname(dir) !== path.resolve(tmpdir()) || !path.basename(dir).startsWith('bolt-admin-adversarial-')) throw new Error('Directorio temporal inválido');
  rmSync(dir, { recursive: true, force: true });
}
