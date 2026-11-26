import { checkoutFetch } from './checkoutBrowserFixture.mjs';
import { adminBootstrapFixture, establishFixtureAdmin } from './adminBootstrapFixture.mjs';
/** Cash order across the real HTTP handlers, with only disposable records and measured test fixtures. */
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import type { Order } from '../types';
import type { DeliveryQuote } from '../lib/deliveryService';
import { fixtureConfig, fixtureDrivers, fixtureProduct } from './transportFixtures';

const source = process.cwd();
const runtime = fs.mkdtempSync(path.join(os.tmpdir(), 'bolt-pilot-cash-http-'));
const data = path.join(runtime, 'orders');
const sku = 'FIXTURE-PILOT-CASH';
const warehouse = 'HUB_SUBA';
const adminCredentials = { email: 'admin@fixture.invalid', password: randomUUID() };
const staffFixture = adminBootstrapFixture(runtime, adminCredentials.email);
const driverCredentials = { email: 'driver@fixture.invalid', password: randomUUID() };
const driver = fixtureDrivers.find(item => item.id.includes(warehouse))!;
const location = { lat: 4.747154, lng: -74.098137 };
const destination = {
  address: 'Carrera 107 #143-31, Bogotá',
  coordinates: { lat: 4.7468, lng: -74.0978 },
  municipality: 'Bogotá',
  locality: 'Suba',
};
const item = { productId: sku, quantity: 1 };
const quoteRequest = { destination, items: [item], requestedMode: 'TURBO' };
const purchase = {
  items: [{ ...item, price: 59_000 }], deliveryAddress: destination, deliveryMode: 'TURBO',
  customer: { name: 'Cliente de prueba', phone: '3000000000', email: 'buyer@fixture.invalid', isGuest: true },
  paymentMethod: 'CASH_ON_DELIVERY', tip: 0, shipping: 0, total: 1,
};

const socket = net.createServer();
let child: ChildProcess | undefined;
let base: string;

type RequestOptions = { method?: string; body?: unknown; token?: string; guest?: string; idempotencyKey?: string; status?: number };
async function call<T>(route: string, { method = 'GET', body, token, guest, idempotencyKey, status = 200 }: RequestOptions = {}): Promise<T> {
  const response = await checkoutFetch(base + route, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token && { Authorization: 'Bearer ' + token }),
      ...(guest && { 'X-Order-Token': guest }),
      ...(idempotencyKey && { 'Idempotency-Key': idempotencyKey }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(5_000),
  });
  const result = await response.json();
  assert.equal(response.status, status, [method, route, result.code, result.error].filter(Boolean).join(' '));
  return result as T;
}

async function start(pilotStore?: string) {
  let output = '';
  const port = new URL(base).port;
  child = spawn(process.execPath, ['--import', 'tsx', path.join(source, 'server.ts')], {
    cwd: runtime,
    env: {
      PATH: process.env.PATH,
      NODE_ENV: 'production',
      PORT: port,
      BOLT_DATA_DIR: data,
      ...staffFixture.env,
      ...(pilotStore && { BOLT_PILOT_STORE_ID: pilotStore }),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout?.on('data', chunk => { output += chunk; });
  child.stderr?.on('data', chunk => { output += chunk; });
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null || child.signalCode !== null) throw Error(output);
    if (await fetch(base + '/health', { signal: AbortSignal.timeout(500) }).then(res => res.ok, () => false)) return;
    await delay(50);
  }
  throw Error('No inició el servidor HTTP de prueba. ' + output);
}

async function stop() {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const closed = once(child, 'exit');
  child.kill('SIGTERM');
  await closed;
}

try {
  fs.cpSync(path.join(source, 'src/data'), path.join(runtime, 'src/data'), {
    recursive: true,
    filter: file => !/^(persisted-|tmp-|\.env)/.test(path.basename(file)),
  });
  fs.symlinkSync(fs.realpathSync(path.join(source, 'node_modules')), path.join(runtime, 'node_modules'), 'dir');
  fs.mkdirSync(data);
  for (const name of ['orders', 'drivers', 'audit', 'telemetry']) fs.writeFileSync(path.join(data, `persisted-${name}.json`), '[]');
  const product = {
    ...fixtureProduct(sku, 1_000), price: 59_000, bodegaIds: [warehouse],
    stockByStore: { [warehouse]: 4 }, reservedStockByStore: { [warehouse]: 0 },
  };
  fs.writeFileSync(path.join(runtime, 'src/data/persisted-catalog-overrides.json'), JSON.stringify({
    version: 1, overrides: {}, customProducts: [product],
  }));
  fs.mkdirSync(path.join(runtime, '.bolt-private'));
  const config = fixtureConfig();
  config.vehicles = config.vehicles.filter(vehicle => vehicle.driverId === driver.id);
  fs.writeFileSync(path.join(runtime, '.bolt-private/transport-config.json'), JSON.stringify({
    config, revision: 'pilot-cash-http-fixture', audit: [],
  }));
  socket.listen(0, '127.0.0.1');
  await once(socket, 'listening');
  base = `http://127.0.0.1:${(socket.address() as net.AddressInfo).port}/api/v1`;
  await new Promise<void>(resolve => socket.close(() => resolve()));

  await start();
  assert.equal((await call<{ enabled: boolean }>('/simulation')).enabled, false);
  const login = (route: string, credentials: { email: string; password: string }) =>
    call<{ token: string }>(route, { method: 'POST', body: credentials }).then(result => result.token);
  await establishFixtureAdmin(new URL(base).origin, adminCredentials.email, adminCredentials.password, staffFixture.env.BOLT_ADMIN_SETUP_TOKEN);
  let admin = await login('/auth/login', adminCredentials);
  assert.equal((await call<{ mode: string }>('/bolt-admin/session', { token: admin })).mode, 'live');
  await call('/admin/dispatch/drivers', { method: 'POST', token: admin, body: {
    driver, ...driverCredentials, storeIds: [warehouse],
  } });
  const conductor = await login('/driver/auth/login', driverCredentials);
  const driverAction = <T>(route: string, body: unknown, status = 200) => call<T>(route, { method: 'POST', token: conductor, body, status });
  await driverAction('/driver/shift', { action: 'START' });
  await driverAction('/driver/location', { latitude: location.lat, longitude: location.lng, accuracy: 8, timestamp: Date.now() });

  const quote = await call<DeliveryQuote>('/delivery/quote', { method: 'POST', body: quoteRequest });
  assert.equal(quote.recommendedMode, 'TURBO', quote.message);
  assert.ok(quote.confirmationToken);
  const payload = { ...purchase, confirmationToken: quote.confirmationToken };
  const checkout = { method: 'POST', body: payload, idempotencyKey: randomUUID() };
  for (const paymentMethod of ['WOMPI_CARD', 'WOMPI_PSE', 'WOMPI_BANCOLOMBIA']) {
    const rejected = await call<{ code: string }>('/orders', {
      ...checkout, body: { ...payload, paymentMethod }, status: 400,
    });
    assert.equal(rejected.code, 'PAYMENT_UNAVAILABLE');
  }
  const stalePrice = await call<{ code: string }>('/orders', {
    ...checkout, body: { ...payload, items: [{ ...item, price: 1 }] }, status: 409,
  });
  assert.equal(stalePrice.code, 'PRICE_CHANGED');
  const order = await call<Order & { guestAccessToken: string }>('/orders', { ...checkout, status: 201 });
  assert.equal(order.storeId, warehouse);
  assert.equal(order.fulfillmentStatus, 'CONFIRMADO');
  assert.equal(order.payment.method, 'CASH_ON_DELIVERY');
  assert.equal(order.payment.status, 'PENDIENTE');
  assert.equal(order.payment.cashToCollect, 69_000);
  assert.equal((await call<Order>('/orders', checkout)).id, order.id);
  assert.equal((await call<Order[]>('/orders', { token: admin })).length, 1);
  const identity = '/orders/' + order.id;
  const adminOrder = '/bolt-admin' + identity;
  const adminAction = (action: string, status = 200) => call<Order>(adminOrder + '/' + action, {
    method: 'POST', token: admin, body: {}, status,
  });
  const inventory = async () => {
    const snapshot = await call<{ items: { productId: string; stock: number; reserved: number; available: number }[] }>(
      '/bolt-admin/inventory?storeId=' + warehouse + '&query=' + sku, { token: admin },
    );
    const row = snapshot.items.find(item => item.productId === sku);
    assert.ok(row);
    return [row.stock, row.reserved, row.available];
  };
  assert.deepEqual(await inventory(), [4, 1, 3]);
  await call(adminOrder + '/ready-for-dispatch', { method: 'POST', body: {}, status: 401 });
  await adminAction('ready-for-dispatch', 409);
  assert.equal((await adminAction('start-preparation')).fulfillmentStatus, 'EN_ALISTAMIENTO');
  assert.equal((await adminAction('ready-for-dispatch')).fulfillmentStatus, 'LISTO_PARA_DESPACHO');
  assert.equal((await adminAction('ready-for-dispatch')).fulfillmentStatus, 'LISTO_PARA_DESPACHO');

  const view = await call<{ orders: { id: string; code: string; dispatches: { id: string }[] }[] }>('/admin/dispatch', { token: admin });
  assert.equal(view.orders.length, 1);
  assert.equal(view.orders[0].id, order.id);
  assert.equal(view.orders[0].code, order.purchaseCode);
  assert.equal(view.orders[0].dispatches.length, 1);
  const dispatchId = view.orders[0].dispatches[0].id;
  await call('/admin/dispatch/' + dispatchId + '/search', { method: 'POST', token: admin });
  type Assignment = {
    assignmentId: string; orderId: string; purchaseCode: string; offer: { id: string };
    sellablePackages: number; cashToCollect: number; secretDeliveryCode?: string;
  };
  let task: Assignment | undefined;
  for (let attempt = 0; attempt < 20 && !task; attempt++) {
    const { assignments } = await call<{ assignments: Assignment[] }>('/driver/assignments', { token: conductor });
    task = assignments.find(assignment => assignment.assignmentId === dispatchId);
    if (!task) await delay(50);
  }
  assert.ok(task, 'El conductor de Suba debe recibir una oferta del despacho preparado.');
  assert.equal(task.assignmentId, dispatchId);
  assert.equal(task.orderId, order.id);
  assert.equal(task.purchaseCode, order.purchaseCode);
  assert.equal(task.cashToCollect, 69_000);
  assert.equal(task.secretDeliveryCode, undefined);
  const assignment = '/driver/assignments/' + dispatchId;
  await driverAction(assignment + '/accept', { offerId: task.offer.id });
  await driverAction(assignment + '/arrived-hub', {});
  const pickedUp = await driverAction<{ status: string; tripId: string }>(assignment + '/pickup', {
    sellablePackages: task.sellablePackages,
  });
  assert.equal(pickedUp.status, 'PICKED_UP');
  await driverAction('/driver/gps', {
    orderId: order.id, assignmentId: dispatchId, tripId: pickedUp.tripId,
    latitude: destination.coordinates.lat, longitude: destination.coordinates.lng,
    accuracy: 8, timestamp: Date.now(), sequenceNumber: 1,
  });
  const tracking = identity + '/tracking';
  await call(tracking, { status: 403 });
  const guest = { guest: order.guestAccessToken };
  const enRoute = await call<{ status: string; simulation: boolean; locationStatus: string; secretDeliveryCode?: string }>(tracking, guest);
  assert.equal(enRoute.status, 'EN_CAMINO');
  assert.equal(enRoute.simulation, false);
  assert.equal(enRoute.locationStatus, 'LIVE');
  assert.match(enRoute.secretDeliveryCode ?? '', /^\d{4}$/);
  await driverAction(assignment + '/delivered', { deliveryCode: '0000', collectedCOP: 69_000 }, 403);
  await driverAction(assignment + '/delivered', { deliveryCode: enRoute.secretDeliveryCode, collectedCOP: 1 }, 400);
  assert.deepEqual(await inventory(), [4, 1, 3]);
  const delivery = { deliveryCode: enRoute.secretDeliveryCode, collectedCOP: 69_000 };
  await driverAction(assignment + '/delivered', delivery);
  await driverAction(assignment + '/delivered', delivery);
  const complete = await call<Order>(identity, guest);
  assert.equal(complete.fulfillmentStatus, 'ENTREGADO');
  assert.equal(complete.payment.status, 'APROBADO');
  assert.equal(complete.payment.cashToCollect, 0);
  assert.equal(complete.payment.cashSettled, false);
  assert.deepEqual(await inventory(), [3, 0, 3]);
  const settlement = { amountCOP: 69_000, receiptId: randomUUID() };
  const settle = '/admin/dispatch/drivers/' + driver.id + '/settlement';
  assert.equal((await call<{ cashHeldCOP: number }>('/driver/settlement', { token: conductor })).cashHeldCOP, 69_000);
  await call(settle, { method: 'POST', token: admin, body: settlement });
  await call(settle, { method: 'POST', token: admin, body: settlement });
  assert.equal((await call<{ cashHeldCOP: number }>('/driver/settlement', { token: conductor })).cashHeldCOP, 0);
  const sales = await call<{ summary: { orderCount: number; collectedCOP: number } }>(
    '/bolt-admin/sales?storeId=' + warehouse + '&period=7d', { token: admin },
  );
  assert.equal(sales.summary.orderCount, 1);
  assert.equal(sales.summary.collectedCOP, 69_000);

  await stop();
  await start(warehouse);
  admin = await login('/auth/login', adminCredentials);
  assert.deepEqual((await call<{ id: string }[]>('/stores')).map(store => store.id), [warehouse]);
  const heldQuote = await call<DeliveryQuote>('/delivery/quote', { method: 'POST', body: quoteRequest });
  assert.equal(heldQuote.reasonCode, 'RAPPI_CASH_UNCONFIRMED');
  assert.equal(heldQuote.confirmationToken, undefined);
  assert.equal(heldQuote.reviewRequestToken, undefined);
  const heldOrder = await call<{ code: string }>('/orders', { ...checkout, idempotencyKey: randomUUID(), status: 503 });
  assert.equal(heldOrder.code, 'RAPPI_CASH_UNCONFIRMED');
  assert.equal((await call<Order[]>('/orders', { token: admin })).length, 1);
  assert.equal((await call<Order>(identity, guest)).fulfillmentStatus, 'ENTREGADO');
  assert.deepEqual(await inventory(), [3, 0, 3]);
  console.log('PASS Suba: checkout en efectivo, alistamiento y despacho de Admin, entrega con PIN por Conductor, recaudo exacto, reserva única, persistencia y bloqueo de Cargo pendiente.');
} finally {
  if (socket.listening) await new Promise<void>(resolve => socket.close(() => resolve()));
  await stop();
  staffFixture.dispose(); fs.rmSync(runtime, { recursive: true, force: true });
}
