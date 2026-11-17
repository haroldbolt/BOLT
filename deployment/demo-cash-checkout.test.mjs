/** Private PR preview regression, through the same gateway used in Railway. */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';

async function freePort() {
  const socket = net.createServer();
  socket.listen(0, '127.0.0.1');
  await once(socket, 'listening');
  const { port } = socket.address();
  await new Promise(resolve => socket.close(resolve));
  return port;
}

const volume = fs.mkdtempSync(path.join(os.tmpdir(), 'bolt-demo-cash-'));
const storeId = 'HUB_SUBA';
const prefix = '/api/v1';
const sleep = 50;
const port = await freePort();
const upstream = await freePort();
const origin = 'http://127.0.0.1:' + port;
const password = crypto.randomBytes(24).toString('hex');
let cookies = '';
let child;

async function api(route, { method = 'GET', body, token, guest, key, status = 200 } = {}) {
  const response = await fetch(origin + prefix + route, {
    method,
    headers: {
      Origin: origin,
      'Content-Type': 'application/json',
      ...(cookies && { Cookie: cookies }),
      ...(token && { Authorization: 'Bearer ' + token }),
      ...(guest && { 'X-Order-Token': guest }),
      ...(key && { 'Idempotency-Key': key }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(5_000),
  });
  const result = await response.json();
  assert.equal(response.status, status, [method, route, result.code, result.error].filter(Boolean).join(' '));
  return result;
}

const action = (route, body, token, status = 200) => api(route, { method: 'POST', body, token, status });
const login = async (route, data, status = 200) => (await action(route, data, undefined, status)).token;
const findRow = (rows, productId) => rows.find(row => row.variantId === productId);

try {
  child = spawn(process.execPath, ['deployment/start-demo.mjs', '--local-test'], {
    env: {
      PATH: process.env.PATH,
      NODE_ENV: 'test',
      PORT: String(port),
      BOLT_DEMO_INTERNAL_PORT: String(upstream),
      BOLT_DEMO_PUBLIC_ORIGIN: origin,
      BOLT_DEMO_PASSWORD: password,
      BOLT_DEMO_VOLUME: volume,
      BOLT_DEMO_CUSTOMER_ACCOUNTS: '0',
    },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let startupError = '';
  child.stderr.on('data', part => { startupError += part; });
  let healthy = false;
  for (let attempt = 0; attempt < 200 && !healthy; attempt++) {
    if (child.exitCode !== null || child.signalCode !== null) break;
    healthy = await fetch(origin + '/__demo/health', { signal: AbortSignal.timeout(500) }).then(response => response.ok, () => false);
    if (!healthy) await delay(100);
  }
  assert.ok(healthy, startupError || 'No inició la demo aislada.');
  const cashCheckoutPath = '/simulation/cash-checkout';
  await api(cashCheckoutPath, { status: 401 });
  const gate = await fetch(origin + '/__demo/login', {
    method: 'POST', headers: { Origin: origin }, body: new URLSearchParams({ password }), redirect: 'manual',
  });
  assert.equal(gate.status, 303);
  cookies = gate.headers.getSetCookie().map(entry => entry.split(';')[0]).join('; ');
  assert.ok(cookies);

  const fixture = await api(cashCheckoutPath);
  const { product, address } = fixture;
  assert.equal(fixture.store.id, storeId);
  assert.equal(product.sku, 'SIM-CARD-1');
  assert.equal(product.price, 25_000);
  assert.ok(address.coordinates);
  const simulation = await api('/simulation');
  assert.equal(simulation.enabled, true);

  const admin = await login('/auth/login', simulation.admin);
  const suba = await login('/bolt-admin/demo/session', { profileId: 'suba' }, 201);
  const kennedy = await login('/bolt-admin/demo/session', { profileId: 'kennedy' }, 201);
  const driverFixture = simulation.cashCheckoutDriver;
  assert.equal(driverFixture.id, 'SIM-CASH-SUBA');
  const driver = await login('/driver/auth/login', driverFixture);
  const driverAction = (route, body, status) => action('/driver' + route, body, driver, status);
  await driverAction('/shift', { action: 'START' });
  await driverAction('/simulation/location', {});

  const sales = async () => (await api('/bolt-admin/sales?storeId=' + storeId + '&period=7d', { token: suba })).summary;
  const beforeSales = await sales();
  const item = { productId: product.id, quantity: 1 };
  const publicQuote = await action('/delivery/quote', { destination: address, items: [item], requestedMode: 'TURBO' });
  assert.notEqual(publicQuote.recommendedMode, 'TURBO', 'El conductor dedicado no cotiza pedidos ajenos a esta prueba.');
  const quote = await action(cashCheckoutPath + '/quote', {});
  assert.equal(quote.recommendedMode, 'TURBO', JSON.stringify({ mode: quote.effectiveMode, message: quote.message, available: quote.availableModes, locality: quote.locality, store: quote.assignedStoreId }));
  assert.equal(quote.assignedStoreId, storeId);
  assert.ok(quote.confirmationToken);
  const body = {
    items: [{ ...item, price: product.price }],
    deliveryAddress: address,
    deliveryMode: 'TURBO',
    customer: { name: 'Cliente de prueba', phone: '3000000000', email: 'efectivo-suba@example.invalid', isGuest: true },
    paymentMethod: 'CASH_ON_DELIVERY',
    confirmationToken: quote.confirmationToken,
    tip: 0,
  };
  const key = crypto.randomUUID();
  const orderRequest = { method: 'POST', body, key };
  const otherPayment = await api('/orders', {
    ...orderRequest, body: { ...body, paymentMethod: 'WOMPI_CARD' }, status: 400,
  });
  assert.equal(otherPayment.code, 'PAYMENT_UNAVAILABLE');
  const stalePrice = await api('/orders', {
    ...orderRequest, body: { ...body, items: [{ ...item, price: 1 }] }, status: 409,
  });
  assert.equal(stalePrice.code, 'PRICE_CHANGED');
  await api('/orders', {
    ...orderRequest, body: { ...body, items: [{ ...item, price: product.price, quantity: 2 }] }, status: 400,
  });
  const order = await api('/orders', { ...orderRequest, status: 201 });
  const identity = '/orders/' + order.id;
  const guest = order.guestAccessToken;
  assert.match(order.purchaseCode, /^BP-\d+$/);
  assert.ok(guest);
  assert.equal(order.storeId, storeId);
  assert.equal(order.fulfillmentStatus, 'CONFIRMADO');
  assert.equal(order.payment.method, 'CASH_ON_DELIVERY');
  assert.equal(order.payment.status, 'PENDIENTE');
  assert.equal(order.payment.cashToCollect, product.price + quote.charges.shipping + quote.charges.serviceFee);
  assert.ok(order.payment.cashToCollect > 0);
  assert.equal((await api('/orders', orderRequest)).id, order.id);

  const inventoryPath = '/bolt-admin/inventory?storeId=' + storeId + '&query=' + product.sku;
  const snapshot = await api(inventoryPath, { token: suba });
  const row = findRow(snapshot.items, product.id) ?? snapshot.items.find(candidate => candidate.sku === product.sku);
  assert.ok(row, 'La variante de prueba debe aparecer en Inventario de Suba.');
  assert.equal(row.reserved, 1);
  assert.equal(row.available, row.stock - 1);
  await api('/bolt-admin' + identity, { token: kennedy, status: 403 });

  const list = await api('/bolt-admin/orders?storeId=' + storeId, { token: suba });
  assert.equal(list.orders.filter(record => record.id === order.id).length, 1);
  assert.notEqual(list.orders.find(record => record.id === order.id).demoReadOnly, true);
  assert.equal(list.orders.find(record => record.id === order.id).demoCashCheckout, true);
  const adminAction = (operation, token = suba, status = 200) =>
    action('/bolt-admin' + identity + '/' + operation, {}, token, status);
  await adminAction('start-preparation', kennedy, 403);
  assert.equal((await adminAction('start-preparation')).fulfillmentStatus, 'EN_ALISTAMIENTO');
  await driverAction('/simulation/location', {});
  assert.equal((await adminAction('ready-for-dispatch')).fulfillmentStatus, 'LISTO_PARA_DESPACHO');
  assert.equal((await adminAction('ready-for-dispatch')).fulfillmentStatus, 'LISTO_PARA_DESPACHO');
  const dispatch = await api('/admin/dispatch', { token: admin });
  const matching = dispatch.orders.filter(record => record.id === order.id);
  assert.equal(matching.length, 1);
  assert.equal(matching[0].code, order.purchaseCode);
  assert.equal(matching[0].dispatches.length, 1);
  const [run] = matching[0].dispatches;
  const adminDetail = (await api('/bolt-admin' + identity, { token: suba })).order;
  assert.equal(adminDetail.dispatch?.id, run.id);

  let task;
  for (let attempt = 0; attempt < 100 && !task; attempt++) {
    const { assignments } = await api('/driver/assignments', { token: driver });
    task = assignments.find(record => record.assignmentId === run.id);
    if (!task) await delay(sleep);
  }
  assert.ok(task?.offer, 'El worker debe ofrecer el despacho al conductor de Suba al marcarlo listo.');
  assert.equal(task.orderId, order.id);
  assert.equal(task.purchaseCode, order.purchaseCode);
  assert.equal(task.cashToCollect, order.payment.cashToCollect);
  assert.equal(task.secretDeliveryCode, undefined);

  const taskPath = '/assignments/' + run.id;
  await driverAction(taskPath + '/accept', { offerId: task.offer.id });
  await driverAction(taskPath + '/arrived-hub', {});
  await driverAction(taskPath + '/pickup', { sellablePackages: task.sellablePackages });
  await driverAction('/simulation/location', {});
  const trackingPath = identity + '/tracking';
  await api(trackingPath, { status: 403 });
  const tracking = await api(trackingPath, { guest });
  assert.equal(tracking.status, 'EN_CAMINO');
  assert.equal(tracking.simulation, true);
  assert.equal(tracking.locationStatus, 'LIVE');
  assert.match(tracking.secretDeliveryCode, /^\d{4}$/);
  await driverAction(taskPath + '/delivered', {
    deliveryCode: tracking.secretDeliveryCode, collectedCOP: task.cashToCollect + 1,
  }, 400);
  await driverAction(taskPath + '/delivered', {
    deliveryCode: tracking.secretDeliveryCode, collectedCOP: task.cashToCollect,
  });

  const delivered = await api(identity, { guest });
  assert.equal(delivered.fulfillmentStatus, 'ENTREGADO');
  assert.equal(delivered.payment.cashToCollect, 0);
  assert.deepEqual(await sales(), beforeSales, 'La prueba no puede sumarse a las ventas de Suba.');
  const afterInventory = await api(inventoryPath, { token: suba });
  const after = findRow(afterInventory.items, product.id) ?? afterInventory.items.find(candidate => candidate.sku === product.sku);
  assert.deepEqual([after.stock, after.reserved], [row.stock - 1, 0]);
  const state = await api('/admin/simulation', { token: admin });
  assert.deepEqual(state.provider.requests, {}, 'La simulación no debe pedir servicios de un proveedor.');
  console.log('PASS: misma compra privada en Cliente, Admin Suba y Despachos, asignación y entrega con GPS y PIN en Conductor, sin ventas reales ni solicitudes a proveedores.');
} finally {
  if (child && child.exitCode === null && child.signalCode === null) {
    const exited = once(child, 'exit');
    child.kill('SIGTERM');
    await exited;
  }
  fs.rmSync(volume, { recursive: true, force: true });
}
