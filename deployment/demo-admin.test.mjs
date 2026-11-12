import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

async function freePort() {
  const socket = net.createServer();
  socket.listen(0, '127.0.0.1');
  await once(socket, 'listening');
  const port = socket.address().port;
  socket.close();
  await once(socket, 'close');
  return port;
}

const volume = fs.mkdtempSync(path.join(os.tmpdir(), 'bolt-admin-review-test-'));
const port = await freePort();
const upstream = await freePort();
const origin = 'http://127.0.0.1:' + port;
const password = crypto.randomBytes(24).toString('hex');
const adminPath = '/api/v1/bolt-admin';
let child;
let gatewayCookie;

async function startDemo() {
  child = spawn(process.execPath, ['deployment/start-demo.mjs', '--local-test'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
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
  let errors = '';
  child.stderr.on('data', part => { errors += part; });
  for (let i = 0; i < 200; i++) {
    if (child.exitCode !== null) throw new Error('Demo exited: ' + errors);
    try {
      if ((await fetch(origin + '/__demo/health')).ok) return;
    } catch { /* Wait for the isolated server to start. */ }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Demo failed to start: ' + errors);
}

async function api(endpoint, { method = 'GET', token, guestToken, idempotency, body, expected = 200 } = {}) {
  const response = await fetch(origin + endpoint, {
    method,
    headers: {
      Cookie: gatewayCookie,
      Origin: origin,
      'Content-Type': 'application/json',
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
      ...(guestToken ? { 'X-Order-Token': guestToken } : {}),
      ...(idempotency ? { 'Idempotency-Key': idempotency } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const result = await response.json();
  const allowed = Array.isArray(expected) ? expected : [expected];
  assert.ok(allowed.includes(response.status), `${method} ${endpoint}: ${response.status} ${result.error || ''}`);
  return result;
}

const admin = (endpoint, options) => api(adminPath + endpoint, options);
const demoLogin = profileId => admin('/demo/session', { method: 'POST', body: { profileId }, expected: [200, 201] });

try {
  await startDemo();
  assert.equal((await fetch(origin + adminPath + '/session')).status, 401);
  const entry = '/admin/nuevo/';
  const gate = await fetch(origin + entry);
  assert.match(await gate.text(), /Clave de la reunión/);
  const continuation = gate.headers.getSetCookie().map(cookie => cookie.split(';')[0]).join('; ');
  const login = await fetch(origin + '/__demo/login', {
    method: 'POST', redirect: 'manual', headers: { Origin: origin, Cookie: continuation },
    body: new URLSearchParams({ password }),
  });
  assert.equal(login.status, 303);
  assert.equal(login.headers.get('location'), entry);
  gatewayCookie = login.headers.getSetCookie()[0].split(';')[0];
  const panel = await fetch(origin + entry, { headers: { Cookie: gatewayCookie } });
  assert.equal(panel.status, 200);
  assert.match(await panel.text(), /<title>BOLT Admin<\/title>/);
  const legacy = await fetch(origin + '/admin', { headers: { Cookie: gatewayCookie } });
  assert.equal(new URL(legacy.url).pathname, '/admin');
  assert.match(await legacy.text(), /<title>Bolt Pets Colombia<\/title>/);

  const initial = await admin('/session');
  assert.equal(initial.mode, 'demo');
  assert.equal(initial.actor, null);
  await admin('/orders', { expected: [401, 403] });
  await admin('/demo/session', { method: 'POST', body: { profileId: 'untrusted-role' }, expected: [400, 403] });
  const [{ token: suba, actor: subaActor }, { token: kennedy }, { token: coordination, actor: coordinator }] = await Promise.all([
    demoLogin('suba'), demoLogin('kennedy'), demoLogin('coordinacion'),
  ]);
  assert.deepEqual(subaActor.storeIds, ['HUB_SUBA']);
  assert.equal(subaActor.canConfirm, true);
  assert.equal(subaActor.canAdjustInventory, false);
  assert.equal(coordinator.canAdjustInventory, true);
  await admin('/orders?storeId=HUB_SUBA', { token: kennedy, expected: 403 });
  await admin('/inventory?storeId=HUB_SUBA', { token: kennedy, expected: 403 });
  await api('/api/v1/orders', { token: suba, expected: [401, 403] });
  const beforeOrders = await admin('/orders?storeId=HUB_SUBA', { token: suba });
  assert.equal(beforeOrders.orders.length, 0);
  assert.equal((await admin('/orders?storeId=HUB_SUBA', { token: coordination })).orders.length, 0);
  const inventory = async () => (await admin('/inventory?storeId=HUB_SUBA', { token: suba })).items;
  const baseline = await inventory();

  const idempotency = crypto.randomUUID();
  const create = token => admin('/demo/orders', { method: 'POST', token, idempotency, body: {}, expected: [200, 201] });
  const fixture = await create(suba);
  assert.ok(fixture.orderId && fixture.guestAccessToken);
  assert.equal((await create(suba)).orderId, fixture.orderId);
  const orderUrl = '/orders/' + encodeURIComponent(fixture.orderId);
  const pending = (await admin(orderUrl, { token: suba })).order;
  assert.equal(pending.fulfillmentStatus, 'PENDIENTE_CONFIRMACION');
  assert.equal(pending.storeId, 'HUB_SUBA');
  assert.equal(pending.deliveryReview.requestedMode, 'PROGRAMADO');
  assert.equal(pending.scheduledWindow, undefined);
  await admin(orderUrl, { token: kennedy, expected: 403 });
  await admin(orderUrl + '/quote', { method: 'POST', token: kennedy, body: { deliveryMode: 'PROGRAMADO' }, expected: 403 });
  await admin(orderUrl + '/confirm', { method: 'POST', token: kennedy, body: {}, expected: 403 });

  const before = await inventory();
  assert.ok(before.length > 0);
  const pendingItem = pending.items[0];
  const findStock = rows => rows.find(item => item.variantId === pendingItem.productId || item.productId === pendingItem.productId);
  const initialStock = findStock(baseline);
  const reservedStock = findStock(before);
  assert.ok(reservedStock);
  assert.equal(reservedStock.reserved, (initialStock?.reserved || 0) + pendingItem.quantity);
  assert.equal(reservedStock.available, reservedStock.stock - reservedStock.reserved);
  assert.ok(!(await api('/api/v1/catalog?all=true')).some(item => item.id === reservedStock.productId));
  const quoteOptions = await admin(orderUrl + '/quote', { method: 'POST', token: suba, body: { deliveryMode: 'PROGRAMADO' } });
  const slot = quoteOptions.scheduledSlots?.find(value => !value.cutoffPassed && value.availableCapacity > 0);
  assert.ok(slot, 'La demostración necesita una franja programada disponible');
  const scheduledWindow = quoteOptions.transportWindow || slot;
  const quote = await admin(orderUrl + '/quote', { method: 'POST', token: suba, body: { deliveryMode: 'PROGRAMADO', scheduledWindow } });
  assert.ok(quote.confirmationToken, quote.message);
  const confirmation = {
    deliveryMode: 'PROGRAMADO', scheduledWindow, confirmationToken: quote.confirmationToken,
    customerAccepted: true, customerAgreementReference: 'SIMULACIÓN: cliente de prueba acepta horario y costo',
  };
  await admin(orderUrl + '/confirm', { method: 'POST', token: suba, body: { ...confirmation, customerAccepted: false }, expected: 400 });
  const accepted = await admin(orderUrl + '/confirm', { method: 'POST', token: suba, body: confirmation, expected: [200, 201] });
  assert.equal((accepted.order || accepted).fulfillmentStatus, 'CONFIRMADO');
  const repeated = await admin(orderUrl + '/confirm', { method: 'POST', token: suba, body: confirmation, expected: [200, 201] });
  assert.equal((repeated.order || repeated).id, fixture.orderId);
  assert.equal((await admin('/orders?storeId=HUB_SUBA', { token: suba })).orders.length, 1);
  assert.deepEqual(await inventory(), before, 'Confirmar y reintentar no duplican la reserva');
  const customer = await api('/api/v1' + orderUrl, { guestToken: fixture.guestAccessToken });
  assert.equal(customer.fulfillmentStatus, 'CONFIRMADO');
  assert.equal(customer.payment.status, 'PENDIENTE');
  assert.equal(customer.payment.transactionId, undefined);
  assert.equal(customer.payment.cashToCollect, 0);
  assert.ok(customer.totals.total > 0, 'El total simulado sigue visible');
  const tracking = await api('/api/v1' + orderUrl + '/tracking', { guestToken: fixture.guestAccessToken });
  assert.deepEqual(tracking.dispatches.map(dispatch => dispatch.cashToCollect), [0]);
  const start = token => admin(orderUrl + '/start-preparation', { method: 'POST', token, body: {} });
  await admin(orderUrl + '/start-preparation', { method: 'POST', token: kennedy, body: {}, expected: 403 });
  const started = await start(suba);
  assert.equal((started.order || started).fulfillmentStatus, 'EN_ALISTAMIENTO');
  const retryStart = await start(suba);
  assert.equal((retryStart.order || retryStart).fulfillmentStatus, 'EN_ALISTAMIENTO');
  assert.equal((await api('/api/v1' + orderUrl, { guestToken: fixture.guestAccessToken })).fulfillmentStatus, 'EN_ALISTAMIENTO');
  const adjustment = {
    storeId: 'HUB_SUBA', productId: reservedStock.productId, variantId: reservedStock.variantId,
    expectedRevision: reservedStock.revision, stock: reservedStock.stock + 2,
    reason: 'Simulación de reconteo en Suba',
  };
  await admin('/inventory', { method: 'PUT', token: suba, body: adjustment, expected: 403 });
  const updated = (await admin('/inventory', { method: 'PUT', token: coordination, body: adjustment })).item;
  assert.equal(updated.stock, adjustment.stock);
  assert.equal(updated.reserved, reservedStock.reserved);
  assert.equal(updated.available, adjustment.stock - updated.reserved);
  await admin('/inventory', { method: 'PUT', token: coordination, body: adjustment, expected: 409 });

  const turboKey = crypto.randomUUID();
  const createTurbo = overrides => admin('/demo/orders', {
    method: 'POST', token: suba, idempotency: turboKey, body: { deliveryMode: 'TURBO' }, expected: [200, 201], ...overrides,
  });
  await createTurbo({ body: { deliveryMode: 'INVALID' }, expected: 400 });
  await createTurbo({ idempotency, expected: 409 });
  const turbo = await createTurbo();
  assert.equal((await createTurbo()).orderId, turbo.orderId);
  const listing = (await admin('/orders?storeId=HUB_SUBA', { token: suba })).orders;
  assert.equal(listing.length, 2);
  const turboRow = listing.find(order => order.id === turbo.orderId);
  assert.equal(turboRow.fulfillmentStatus, 'PENDIENTE_CONFIRMACION');
  assert.equal(turboRow.deliveryReview.requestedMode, 'TURBO');
  assert.equal(turboRow.scheduledWindow, undefined);
  const turboTracking = await api('/api/v1/orders/' + encodeURIComponent(turbo.orderId) + '/tracking', { guestToken: turbo.guestAccessToken });
  assert.deepEqual(turboTracking.dispatches, []);
  const scheduledRow = listing.find(order => order.id === fixture.orderId);
  assert.equal(scheduledRow.deliveryMode, 'PROGRAMADO');
  const { date, startTime, endTime } = scheduledRow.scheduledWindow;
  assert.deepEqual({ date, startTime, endTime }, {
    date: scheduledWindow.date, startTime: scheduledWindow.startTime, endTime: scheduledWindow.endTime,
  });
  console.log('PASS BOLT Admin: acceso por sede, panel anterior, Turbo pendiente y Programado con su franja, pedidos idempotentes, seguimiento privado, recaudo cero y ajuste autorizado.');
} finally {
  if (child && child.exitCode === null) {
    child.kill('SIGTERM');
    await once(child, 'exit');
  }
  fs.rmSync(volume, { recursive: true, force: true });
}
