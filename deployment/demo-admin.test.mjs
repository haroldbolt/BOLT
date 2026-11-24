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
const photoPng = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC';
const photoDataUrl = 'data:image/png;base64,' + photoPng;
let child;
let gatewayCookie;

async function startDemo({ editCatalog = false } = {}) {
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
      BOLT_DEMO_EDIT_CATALOG: editCatalog ? '1' : '0',
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

async function stopDemo() {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, 'exit');
  child.kill('SIGTERM');
  await exited;
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
  await admin('/inventory/photo', {
    method: 'PUT', token: coordination, expected: 404,
    body: { productId: product.id, variantId: sku, target: 'variant', expectedImage: '', dataUrl: photoDataUrl },
  });
  assert.deepEqual((await inventory(suba)).items, inventoryRows);
  const after = (await catalog()).presentaciones.find(variant => variant.varianteId === sku);
  assert.equal(after.price, price);
  assert.equal(after.stockByStore[storeId], stock);
  assert.equal(after.reservedStockByStore[storeId], quantity);
  return { catalog, reserved, storeId };
}

async function verifyUnifiedNoChargeCheckout() {
  const endpoint = '/api/v1/simulation/customer-checkout';
  const gated = await fetch(origin + endpoint);
  assert.equal(gated.status, 401);
  const [{ token: suba }, { token: kennedy }] = await Promise.all([demoLogin('suba'), demoLogin('kennedy')]);
  const scenario = await api(endpoint);
  assert.equal(scenario.enabled, true);
  assert.equal(scenario.storeId, 'HUB_SUBA');
  assert.equal(scenario.deliveryMode, 'TURBO');
  assert.equal(scenario.cashToCollect, 0);
  assert.equal(scenario.items[0].quantity, 1);
  const productId = scenario.items[0].productId;
  const inventory = async token => (await admin('/inventory?storeId=HUB_SUBA&query=' + encodeURIComponent(scenario.items[0].sku), { token })).items
    .find(row => row.productId === productId);
  const before = await inventory(suba);
  const baseline = await admin('/sales?storeId=HUB_SUBA', { token: suba });
  const checkout = { method: 'POST', idempotency: crypto.randomUUID(), body: {} };
  await api(endpoint, { ...checkout, idempotency: 'bad-key', expected: 400 });
  const { order, guestAccessToken, trackingPath } = await api(endpoint, checkout);
  assert.equal(order.demoCustomerCheckout, true);
  assert.equal(order.payment.cashToCollect, 0);
  assert.equal(order.fulfillmentStatus, 'PENDIENTE_CONFIRMACION');
  assert.equal(order.storeId, 'HUB_SUBA');
  assert.deepEqual(order.dispatches, []);
  assert.equal(trackingPath, '/pedido/' + order.id);
  assert.equal((await api(endpoint, checkout)).order.id, order.id);
  const after = await inventory(suba);
  assert.deepEqual([after.stock, after.reserved, after.available], [before.stock, before.reserved + 1, before.available - 1]);
  const path = '/orders/' + order.id;
  const ops = { method: 'POST', token: suba, body: {} };
  await admin(path + '/demo-dispatch', { ...ops, expected: 409 });
  await admin(path + '/quote', { ...ops, token: kennedy, expected: 403 });
  await admin(path + '/demo-dispatch', { ...ops, token: kennedy, expected: 403 });
  const list = (await admin('/orders?storeId=HUB_SUBA', { token: suba })).orders;
  assert.deepEqual(list.filter(row => row.id === order.id).map(row => row.demoCustomerCheckout), [true]);

  const quote = await admin(path + '/quote', { ...ops, body: { deliveryMode: 'TURBO' } });
  assert.equal(quote.recommendedMode, 'TURBO', quote.message);
  assert.equal(quote.assignedStoreId, 'HUB_SUBA');
  assert.ok(quote.confirmationToken);
  const confirmation = {
    ...ops, expected: [200, 201],
    body: {
      deliveryMode: 'TURBO', confirmationToken: quote.confirmationToken, customerAccepted: true,
      customerAgreementReference: 'Simulación: comprador acepta el pedido de prueba sin cobro.',
    },
  };
  const confirmed = await admin(path + '/confirm', confirmation);
  assert.equal(confirmed.id, order.id);
  assert.equal(confirmed.purchaseCode, order.purchaseCode);
  assert.equal(confirmed.fulfillmentStatus, 'CONFIRMADO');
  assert.equal(confirmed.payment.cashToCollect, 0);
  assert.equal((await admin(path + '/confirm', confirmation)).id, order.id);
  const [first, retry] = await Promise.all([
    admin(path + '/demo-dispatch', ops),
    admin(path + '/demo-dispatch', ops),
  ]);
  assert.deepEqual(first.order.dispatch, retry.order.dispatch);
  assert.equal(first.order.fulfillmentStatus, 'EN_CAMINO');
  assert.equal(first.order.dispatch.status, 'PICKED_UP');
  assert.equal(first.order.dispatch.providerId, 'OWN');
  const trackingUrl = '/api/v1' + path + '/tracking';
  await api(trackingUrl, { expected: 403 });
  const getTracking = () => api(trackingUrl, { guestToken: guestAccessToken });
  const tracking = await getTracking();
  assert.equal(tracking.orderId, order.id);
  assert.equal(tracking.status, 'EN_CAMINO');
  assert.equal(tracking.simulation, true);
  assert.equal(tracking.locationStatus, 'LIVE');
  assert.ok(tracking.telemetry && tracking.timing.dueAt);
  assert.deepEqual(tracking.dispatches.map(row => row.cashToCollect), [0]);
  assert.deepEqual((await admin('/sales?storeId=HUB_SUBA', { token: suba })).summary, baseline.summary);
  assert.deepEqual(await inventory(suba), after);
  console.log('PASS: BOLT Cliente → reserva en Suba → despacho simulado y GPS privado del mismo pedido, sin cobro ni venta real.');
}

async function verifyDemoCatalogEditing({ catalog, reserved, storeId }) {
  await stopDemo();
  await startDemo({ editCatalog: true });
  const [{ token: suba }, { token: coordination }] = await Promise.all([demoLogin('suba'), demoLogin('coordinacion')]);
  const { productId, variantId } = reserved;
  const query = new URLSearchParams({ storeId, query: variantId });
  const inventory = async token => (await admin('/inventory?' + query, { token })).items
    .find(item => item.productId === productId && item.variantId === variantId);
  const [before, editable, readOnly] = await Promise.all([catalog(), inventory(coordination), inventory(suba)]);
  const capabilities = item => [item.canEditStock, item.canEditPrice, item.canEditPhoto];
  assert.deepEqual(capabilities(editable), [true, true, true]);
  assert.deepEqual(capabilities(readOnly), [false, false, false]);
  assert.deepEqual([editable.stock, editable.reserved, editable.available, editable.price, editable.image],
    [reserved.stock, reserved.reserved, reserved.available, reserved.price, reserved.image]);

  const unassigned = (await admin('/inventory?' + new URLSearchParams({
    storeId: 'HUB_KENNEDY', query: variantId, scope: 'catalog',
  }), { token: coordination })).items.find(item => item.productId === productId && item.variantId === variantId);
  assert.equal(unassigned.assignedToStore, false);
  assert.deepEqual(capabilities(unassigned), [false, true, true]);
  const stockEdit = {
    storeId, productId, variantId, expectedRevision: editable.revision, stock: 9, reason: 'Reconteo de prueba en Suba',
  };
  const adjustStock = (token, body, expected = 200) => admin('/inventory', { method: 'PUT', token, body, expected });
  await adjustStock(suba, stockEdit, 403);
  await adjustStock(coordination, { ...stockEdit, storeId: 'HUB_KENNEDY' }, 404);
  const rejected = await adjustStock(coordination, { ...stockEdit, stock: editable.reserved - 1 }, 400);
  assert.match(rejected.error, /reservadas/);
  const { item: adjusted } = await adjustStock(coordination, stockEdit);
  assert.deepEqual([adjusted.stock, adjusted.reserved, adjusted.available], [9, reserved.reserved, 9 - reserved.reserved]);
  assert.deepEqual([adjusted.price, adjusted.image], [reserved.price, reserved.image]);
  await adjustStock(coordination, stockEdit, 409);

  const priceEdit = {
    productId, variantId, expectedRevision: adjusted.revision, regularPriceCOP: reserved.price, promoPriceCOP: 21_900,
    reason: 'Promoción de prueba por presentación',
  };
  await admin('/prices', { method: 'PUT', token: suba, body: priceEdit, expected: 403 });
  await admin('/prices', { method: 'PUT', token: coordination, body: priceEdit });
  const photoRoute = '/inventory/photo';
  const photo = await admin(photoRoute + '?' + new URLSearchParams({ productId, variantId }), { token: coordination });
  const upload = { productId, variantId, target: 'variant', expectedImage: photo.variantImage, dataUrl: photoDataUrl };
  await admin(photoRoute, { method: 'PUT', token: suba, body: upload, expected: 403 });
  const { image } = await admin(photoRoute, { method: 'PUT', token: coordination, body: upload });
  assert.match(image, /^\/uploads\/catalog\/[^/]+\.png$/);

  const after = await catalog();
  const previousVariant = before.presentaciones.find(variant => variant.varianteId === variantId);
  const updatedVariant = after.presentaciones.find(variant => variant.varianteId === variantId);
  assert.deepEqual(updatedVariant.stockByStore, { ...previousVariant.stockByStore, [storeId]: 9 });
  assert.deepEqual(updatedVariant.reservedStockByStore, previousVariant.reservedStockByStore);
  assert.deepEqual([updatedVariant.price, updatedVariant.originalPrice, updatedVariant.foto], [21_900, reserved.price, image]);
  assert.deepEqual(after.presentaciones.filter(variant => variant.varianteId !== variantId),
    before.presentaciones.filter(variant => variant.varianteId !== variantId));
  const { adjustments } = await admin('/inventory/adjustments?storeId=' + storeId, { token: coordination });
  const audit = adjustments.find(item => item.reason === stockEdit.reason);
  assert.ok(audit);
  assert.deepEqual([audit.before, audit.after, audit.actorName], [reserved.stock, 9, 'Coordinación']);
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
  for (const alias of ['/admin', '/operacion?tab=DESPACHOS']) {
    const redirected = await fetch(origin + alias, { headers: { Cookie: gatewayCookie } });
    assert.equal(new URL(redirected.url).pathname, entry);
    assert.match(await redirected.text(), /<title>BOLT Admin<\/title>/);
    if (alias.includes('DESPACHOS')) assert.equal(new URL(redirected.url).searchParams.get('view'), 'dispatch');
  }

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
  const activeWarehouseIds = ['HUB_ALAMOS', 'HUB_KENNEDY', 'HUB_SUBA'];
  const storeIds = stores => stores.map(store => store.id).sort();
  const operators = initial.profiles.filter(profile => profile.role === 'SEDE');
  assert.deepEqual(operators.map(profile => profile.storeId).sort(), activeWarehouseIds);
  assert.equal(operators.find(profile => profile.id === 'alamos')?.name, 'Operador de Álamos');
  const { token: alamos, actor: alamosActor } = await demoLogin('alamos');
  assert.equal(alamosActor.role, 'SEDE');
  assert.deepEqual(alamosActor.storeIds, ['HUB_ALAMOS']);
  assert.equal(alamosActor.canConfirm, true);
  assert.equal(alamosActor.canAdjustInventory, false);
  assert.equal(alamosActor.canAdjustPrices, false);
  const alamosSession = await admin('/session', { token: alamos });
  assert.deepEqual(storeIds(alamosSession.stores), ['HUB_ALAMOS']);
  for (const endpoint of ['/orders', '/inventory', '/sales']) {
    await admin(endpoint + '?storeId=HUB_ALAMOS', { token: alamos });
    for (const otherStore of ['HUB_KENNEDY', 'HUB_SUBA']) {
      await admin(endpoint + '?storeId=' + otherStore, { token: alamos, expected: 403 });
    }
  }
  await admin('/inventory?scope=catalog', { token: alamos, expected: 403 });
  const alamosSales = await admin('/sales?storeId=all', { token: alamos });
  assert.deepEqual(storeIds(alamosSales.stores), ['HUB_ALAMOS']);
  console.log('PASS: Operador de Álamos consulta únicamente los pedidos, inventario y ventas de su sede.');
  const simulation = await api('/api/v1/simulation');
  const { token: adminToken } = await api('/api/v1/auth/login', { method: 'POST', body: simulation.admin });
  const [publicStores, adminSession, shopify] = await Promise.all([
    api('/api/v1/stores'),
    admin('/session', { token: coordination }),
    api('/api/v1/shopify/status', { token: adminToken }),
  ]);
  assert.deepEqual(storeIds(publicStores), activeWarehouseIds);
  assert.ok(publicStores.every(store => store.isActive));
  assert.deepEqual(storeIds(adminSession.stores), activeWarehouseIds);
  assert.deepEqual(shopify.locations.map(location => location.storeId).sort(), activeWarehouseIds);
  assert.ok(shopify.inventoryItems.every(item => Object.keys(item.quantitiesByLocation).every(id => activeWarehouseIds.includes(id))));
  assert.deepEqual(storeIds((await api('/api/v1/admin/transport', { token: adminToken })).stores), activeWarehouseIds);
  for (const storeId of ['HUB_CENTRO', 'HUB_FONTIBON']) {
    await admin('/inventory?storeId=' + storeId, { token: coordination, expected: 403 });
    assert.deepEqual(await api('/api/v1/catalog?storeId=' + storeId), []);
    await api('/api/v1/stores/' + storeId + '/verify-entrance', {
      method: 'POST', token: adminToken, body: { coordinates: { lat: 4.65, lng: -74.12 } }, expected: 404,
    });
  }
  console.log('PASS: clientes y administración muestran únicamente Kennedy, Álamos y Suba.');
  await admin('/orders?storeId=HUB_SUBA', { token: kennedy, expected: 403 });
  await admin('/inventory?storeId=HUB_SUBA', { token: kennedy, expected: 403 });
  await admin('/inventory?storeId=HUB_SUBA&scope=catalog', { token: suba, expected: 403 });
  const kennedyCatalog = await admin('/inventory?storeId=HUB_KENNEDY&scope=catalog', { token: coordination });
  const subaProduct = 'SIM-BOLT-ADMIN-SUBA';
  const galleryProduct = 'SIM-BOLT-GALERIA-PAWISE';
  const galleryVariants = ['01', '02', '03', '04', '05', '06'].map(suffix => galleryProduct + '-' + suffix);
  const expectedVariants = [subaProduct + '-1KG', ...galleryVariants].sort();
  assert.equal(kennedyCatalog.total, expectedVariants.length);
  assert.deepEqual(kennedyCatalog.items.map(row => row.variantId).sort(), expectedVariants);
  for (const row of kennedyCatalog.items) {
    const isGalleryVariant = galleryVariants.includes(row.variantId);
    assert.equal(row.productId, isGalleryVariant ? galleryProduct : subaProduct);
    assert.equal(row.storeId, 'HUB_KENNEDY');
    assert.equal(row.assignedToStore, isGalleryVariant, row.variantId);
    assert.equal(row.canEditStock, false);
    assert.equal(row.canEditPrice, !isGalleryVariant);
    assert.equal(row.canEditPhoto, true);
  }
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
  await admin(orderUrl, { token: alamos, expected: 403 });
  assert.ok(!(await admin('/orders', { token: alamos })).orders.some(order => order.id === fixture.orderId));
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

  const photoRoute = '/inventory/photo';
  const photoIds = { productId: reservedStock.productId, variantId: reservedStock.variantId };
  assert.equal(photoIds.productId, 'SIM-BOLT-ADMIN-SUBA');
  const photoQuery = photoRoute + '?' + new URLSearchParams(photoIds);
  const beforePhoto = await admin(photoQuery, { token: coordination });
  assert.deepEqual(beforePhoto, { productImage: '', variantImage: '', gallery: [] });
  const upload = { ...photoIds, target: 'variant', expectedImage: beforePhoto.variantImage, dataUrl: photoDataUrl, filename: 'simulacion.png' };
  await admin(photoRoute, { method: 'PUT', token: suba, body: upload, expected: 403 });
  const { image } = await admin(photoRoute, { method: 'PUT', token: coordination, body: upload });
  assert.match(image, /^\/uploads\/catalog\/[^/]+\.png$/);
  assert.deepEqual(await admin(photoQuery, { token: coordination }), { productImage: '', variantImage: image, gallery: [] });
  assert.equal(findStock(await inventory()).image, image);
  const asset = await fetch(origin + image, { headers: { Cookie: gatewayCookie } });
  assert.equal(asset.status, 200);
  assert.match(asset.headers.get('content-type') || '', /^image\/png/);
  assert.deepEqual(Buffer.from(await asset.arrayBuffer()), Buffer.from(photoPng, 'base64'));
  assert.deepEqual(await api('/api/v1/catalog?all=true&q=SIM-BOLT-ADMIN-SUBA'), []);
  console.log('PASS demo: Coordinación guarda una foto de variante, Suba solo consulta y el producto simulado sigue oculto en tienda.');
  console.log('PASS BOLT Admin: pedidos y ventas por sede, seguimiento privado, recaudo cero, reservas, ajuste autorizado e historial.');
  const checkout = await verifyCustomerCheckout({ suba, kennedy, coordination });
  console.log('PASS checkout de invitado → Programados de Suba: reserva única de la variante, acceso privado y permisos de solo consulta.');
  await verifyDemoCatalogEditing(checkout);
  console.log('PASS catálogo habilitado de la demo: Coordinación conserva y edita existencias, precios y fotos por presentación.');
  await verifyUnifiedNoChargeCheckout();
} finally {
  await stopDemo();
  fs.rmSync(volume, { recursive: true, force: true });
}
