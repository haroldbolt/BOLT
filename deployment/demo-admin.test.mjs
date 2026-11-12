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

async function verifyCustomerCheckout({ suba, kennedy, coordination }) {
  const storeId = 'HUB_SUBA';
  const sku = 'BOLT-TEST-CHECKOUT-SUBA-2KG';
  const stock = 13;
  const price = 25_900;
  const quantity = 2;
  // Add a published variant without verified transport attributes only to this temporary demo.
  const simulation = await api('/api/v1/simulation');
  const { token: legacyAdmin } = await api('/api/v1/auth/login', { method: 'POST', body: simulation.admin });
  const { product } = await api('/api/v1/admin/catalog/products', {
    method: 'POST', token: legacyAdmin, expected: 201,
    body: {
      sku: 'BOLT-TEST-CHECKOUT-SUBA', name: 'Alimento ficticio de checkout Suba', price: 12_900,
      presentation: '1 kg', bodegaIds: [storeId],
      presentaciones: [
        { varianteId: 'BOLT-TEST-CHECKOUT-SUBA-1KG', nombre: '1 kg', bodegaIds: [storeId], price: 12_900, stockByStore: { [storeId]: 4 } },
        { varianteId: sku, nombre: '2 kg', sku, bodegaIds: [storeId], price, stockByStore: { [storeId]: stock } },
      ],
    },
  });
  const catalog = async () => (await api('/api/v1/catalog?storeId=' + storeId + '&q=' + encodeURIComponent(product.name)))
    .find(item => item.id === product.id);
  const selectedVariant = (await catalog())?.presentaciones.find(variant => variant.varianteId === sku);
  assert.ok(selectedVariant, 'El checkout debe usar una presentación publicada y disponible en Suba');
  assert.equal(selectedVariant.price, price);
  assert.equal(selectedVariant.stockByStore[storeId], stock);
  assert.equal(selectedVariant.reservedStockByStore[storeId] ?? 0, 0);
  const inventory = token => admin('/inventory?storeId=' + storeId + '&query=' + encodeURIComponent(sku), { token });
  assert.deepEqual((await inventory(suba)).items, [], 'La demo aún no expone esta presentación en BOLT Admin');

  const destination = {
    address: 'Calle 150 #16-56, Cedritos, Bogotá', coordinates: { lat: 4.731531, lng: -74.041785 },
    municipality: 'Bogotá', locality: 'Usaquén', neighborhood: 'Cedritos',
  };
  const deliveryMode = 'PROGRAMADO';
  const items = [{ productId: selectedVariant.varianteId, quantity }];
  const quote = await api('/api/v1/delivery/quote', {
    method: 'POST', body: { destination, items, requestedMode: deliveryMode },
  });
  assert.equal(quote.assignedStoreId, storeId);
  assert.equal(quote.reasonCode, 'TRANSPORT_DATA_PENDING');
  assert.equal(quote.inventoryValidated, true);
  assert.ok(quote.reviewRequestToken);
  assert.equal(quote.confirmationToken, undefined);
  const checkout = {
    method: 'POST', idempotency: crypto.randomUUID(),
    body: {
      requestDeliveryReview: true, reviewRequestToken: quote.reviewRequestToken, deliveryMode,
      items: items.map(item => ({ ...item, price: selectedVariant.price })),
      deliveryAddress: { ...destination, details: 'Referencia privada ficticia', porteriaPolicy: 'DEJAR_EN_PORTERIA' },
      customer: { name: 'Cliente ficticio checkout Suba', email: 'checkout-suba@example.invalid', phone: '0000000000', isGuest: true },
      paymentMethod: 'CASH_ON_DELIVERY', tip: 0,
    },
  };
  const order = await api('/api/v1/orders', { ...checkout, expected: 201 });
  const orderUrl = '/orders/' + encodeURIComponent(order.id);
  assert.equal(order.storeId, storeId);
  assert.equal(order.fulfillmentStatus, 'PENDIENTE_CONFIRMACION');
  assert.equal(order.deliveryReview.requestedMode, deliveryMode);
  assert.equal(order.scheduledWindow, undefined);
  assert.equal(order.payment.status, 'PENDIENTE');
  assert.equal(order.payment.cashToCollect, 0);
  assert.equal(order.payment.transactionId, undefined);
  assert.equal(order.totals.subtotal, price * quantity);
  assert.deepEqual(order.dispatches, []);
  assert.ok(order.guestAccessToken);
  assert.equal((await api('/api/v1/orders', checkout)).id, order.id);
  await api('/api/v1' + orderUrl, { expected: 403 });
  const guest = await api('/api/v1' + orderUrl, { guestToken: order.guestAccessToken });
  assert.equal(guest.customer.email, checkout.body.customer.email);
  assert.equal(guest.fulfillmentStatus, order.fulfillmentStatus);

  const expectSanitizedOrder = row => {
    assert.equal(row.id, order.id);
    assert.equal(row.storeId, storeId);
    assert.equal(row.fulfillmentStatus, 'PENDIENTE_CONFIRMACION');
    assert.equal(row.deliveryReview.requestedMode, deliveryMode);
    assert.equal(row.demoReadOnly, true);
    assert.equal(row.customer, undefined);
    assert.equal(row.deliveryAddress, undefined);
    assert.equal(row.guestAccessToken, undefined);
    assert.ok((row.statusHistory ?? []).every(event => event.actor === undefined));
    assert.deepEqual(row.items.map(item => [item.productId, item.presentation, item.price, item.quantity]), [[sku, '2 kg', price, quantity]]);
  };
  const scheduledOrders = (await admin('/orders?storeId=' + storeId, { token: suba })).orders
    .filter(row => row.id === order.id && (row.deliveryMode ?? row.deliveryReview?.requestedMode) === deliveryMode);
  assert.equal(scheduledOrders.length, 1, 'Programados de Suba muestra una sola fila de la compra del cliente');
  expectSanitizedOrder(scheduledOrders[0]);
  expectSanitizedOrder((await admin(orderUrl, { token: coordination })).order);
  await admin(orderUrl, { token: kennedy, expected: 403 });
  assert.ok(!(await admin('/orders?storeId=HUB_KENNEDY', { token: kennedy })).orders.some(row => row.id === order.id));
  for (const action of ['quote', 'confirm', 'start-preparation']) {
    await admin(orderUrl + '/' + action, { method: 'POST', token: suba, body: { deliveryMode }, expected: 403 });
  }

  const { items: inventoryRows } = await inventory(suba);
  assert.equal(inventoryRows.length, 1);
  const [reserved] = inventoryRows;
  assert.equal(reserved.variantId, sku);
  assert.equal(reserved.productId, product.id);
  assert.equal(reserved.demoReadOnly, true);
  assert.deepEqual([reserved.stock, reserved.reserved, reserved.available], [stock, quantity, stock - quantity]);
  assert.deepEqual((await inventory(coordination)).items, inventoryRows);
  await admin('/inventory?storeId=' + storeId, { token: kennedy, expected: 403 });
  assert.deepEqual((await admin('/prices?query=' + encodeURIComponent(sku), { token: coordination })).items, []);
  const edit = {
    productId: product.id, variantId: selectedVariant.varianteId,
    expectedRevision: reserved.revision ?? selectedVariant.commerceRevision, reason: 'Ajuste prohibido de la variante de checkout',
  };
  await admin('/inventory', {
    method: 'PUT', token: coordination, body: { ...edit, storeId, stock: stock + 1 }, expected: 404,
  });
  await admin('/prices', {
    method: 'PUT', token: coordination, body: { ...edit, regularPriceCOP: price + 1, promoPriceCOP: null }, expected: 404,
  });
  assert.deepEqual((await inventory(suba)).items, inventoryRows);
  const after = (await catalog()).presentaciones.find(variant => variant.varianteId === sku);
  assert.equal(after.price, price);
  assert.equal(after.stockByStore[storeId], stock);
  assert.equal(after.reservedStockByStore[storeId], quantity);
}

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
  await admin('/inventory?storeId=HUB_SUBA&scope=catalog', { token: suba, expected: 403 });
  const unassignedInventory = await admin('/inventory?storeId=HUB_KENNEDY&scope=catalog', { token: coordination });
  assert.equal(unassignedInventory.items.length, 1, 'El catálogo de la demo solo incluye la presentación ficticia');
  assert.equal(unassignedInventory.items[0].assignedToStore, false);
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

  const pendingItem = pending.items[0];
  const getFixturePrice = async () => {
    const { items } = await admin('/prices', { token: coordination });
    const item = items.find(item => item.productId === pendingItem.productId);
    assert.ok(item, 'El precio de la presentación simulada debe estar disponible para Coordinación');
    return item;
  };
  const priceBefore = await getFixturePrice();
  assert.equal(priceBefore.price, 25_000);
  const discount = {
    productId: priceBefore.productId, variantId: priceBefore.variantId, expectedRevision: priceBefore.revision,
    regularPriceCOP: priceBefore.price, promoPriceCOP: 20_000, reason: 'Promoción de prueba en Suba',
  };
  const updatePrice = (token, body, expected = 200) => admin('/prices', { method: 'PUT', token, body, expected });
  await updatePrice(suba, discount, 403);
  await updatePrice(coordination, { ...discount, promoPriceCOP: priceBefore.price }, 400);
  const promotion = (await updatePrice(coordination, discount)).item;
  assert.equal(promotion.price, 20_000);
  assert.equal(promotion.originalPrice, 25_000);
  await updatePrice(coordination, discount, 409);

  const before = await inventory();
  assert.ok(before.length > 0);
  const findStock = rows => rows.find(item => item.variantId === pendingItem.productId || item.productId === pendingItem.productId);
  const initialStock = findStock(baseline);
  const reservedStock = findStock(before);
  assert.ok(reservedStock);
  assert.equal(reservedStock.assignedToStore, true);
  assert.equal(reservedStock.price, promotion.price);
  assert.equal(reservedStock.originalPrice, promotion.originalPrice);
  assert.equal(reservedStock.revision, promotion.revision);
  assert.equal(reservedStock.reserved, (initialStock?.reserved || 0) + pendingItem.quantity);
  assert.equal(reservedStock.available, reservedStock.stock - reservedStock.reserved);
  assert.ok(!(await api('/api/v1/catalog?all=true')).some(item => item.id === reservedStock.productId));
  const quoteOptions = await admin(orderUrl + '/quote', { method: 'POST', token: suba, body: { deliveryMode: 'PROGRAMADO' } });
  const slot = quoteOptions.scheduledSlots?.find(value => !value.cutoffPassed && value.availableCapacity > 0);
  assert.ok(slot, 'La demostración necesita una franja programada disponible');
  const scheduledWindow = quoteOptions.transportWindow || slot;
  const quote = await admin(orderUrl + '/quote', { method: 'POST', token: suba, body: { deliveryMode: 'PROGRAMADO', scheduledWindow } });
  assert.ok(quote.confirmationToken, quote.message);
  assert.equal(quote.charges.subtotal, 50_000, 'La solicitud reservada conserva los precios originales');
  const confirmation = {
    deliveryMode: 'PROGRAMADO', scheduledWindow, confirmationToken: quote.confirmationToken,
    customerAccepted: true, customerAgreementReference: 'SIMULACIÓN: cliente de prueba acepta horario y costo',
  };
  await admin(orderUrl + '/confirm', { method: 'POST', token: suba, body: { ...confirmation, customerAccepted: false }, expected: 400 });
  const accepted = await admin(orderUrl + '/confirm', { method: 'POST', token: suba, body: confirmation, expected: [200, 201] });
  assert.equal((accepted.order || accepted).fulfillmentStatus, 'CONFIRMADO');
  assert.equal((accepted.order || accepted).items[0].price, pendingItem.price);
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
  assert.equal(updated.price, promotion.price);
  assert.equal(updated.originalPrice, promotion.originalPrice);
  await admin('/inventory', { method: 'PUT', token: coordination, body: adjustment, expected: 409 });
  await admin('/inventory/adjustments?storeId=HUB_SUBA', { token: suba, expected: 403 });
  const history = await admin('/inventory/adjustments?storeId=HUB_SUBA', { token: coordination });
  assert.equal(history.adjustments.length, 1);
  const [auditEntry] = history.adjustments;
  assert.deepEqual([auditEntry.before, auditEntry.after, auditEntry.reason, auditEntry.actorName], [reservedStock.stock, updated.stock, adjustment.reason, 'Coordinación']);
  assert.deepEqual((await admin('/inventory/adjustments?storeId=HUB_KENNEDY', { token: coordination })).adjustments, []);

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
  assert.equal(turboRow.items[0].price, 20_000, 'Un pedido nuevo aplica la promoción vigente');
  const turboTracking = await api('/api/v1/orders/' + encodeURIComponent(turbo.orderId) + '/tracking', { guestToken: turbo.guestAccessToken });
  assert.deepEqual(turboTracking.dispatches, []);
  const scheduledRow = listing.find(order => order.id === fixture.orderId);
  assert.equal(scheduledRow.deliveryMode, 'PROGRAMADO');
  const { date, startTime, endTime } = scheduledRow.scheduledWindow;
  assert.deepEqual({ date, startTime, endTime }, {
    date: scheduledWindow.date, startTime: scheduledWindow.startTime, endTime: scheduledWindow.endTime,
  });
  await admin('/sales?storeId=HUB_SUBA', { expected: 401 });
  await admin('/sales?storeId=HUB_SUBA', { token: kennedy, expected: 403 });
  const sales = await admin('/sales?storeId=all&period=7d', { token: suba });
  assert.equal(sales.demo, true);
  assert.deepEqual(sales.stores.map(store => store.id), ['HUB_SUBA']);
  assert.equal(sales.summary.orderCount, 1);
  assert.equal(sales.summary.confirmedCOP, customer.totals.total);
  assert.equal(sales.summary.collectedCOP, 0);
  assert.equal(sales.products[0].units, pendingItem.quantity);
  const currentPrice = await getFixturePrice();
  const restored = (await updatePrice(coordination, {
    ...discount, expectedRevision: currentPrice.revision, promoPriceCOP: null, reason: 'Restauración del precio de prueba',
  })).item;
  assert.equal(restored.price, 25_000);
  assert.ok(restored.originalPrice == null);
  console.log('PASS BOLT Admin: pedidos y ventas por sede, seguimiento privado, recaudo cero, reservas, ajuste autorizado e historial.');
  await verifyCustomerCheckout({ suba, kennedy, coordination });
  console.log('PASS checkout de invitado → Programados de Suba: reserva única de la variante, acceso privado y permisos de solo consulta.');
} finally {
  if (child && child.exitCode === null) {
    child.kill('SIGTERM');
    await once(child, 'exit');
  }
  fs.rmSync(volume, { recursive: true, force: true });
}
