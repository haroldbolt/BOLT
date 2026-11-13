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
const orderFixtureId = 'SIM-BOLT-ADMIN-SUBA';
const galleryFixtureId = 'SIM-BOLT-GALERIA-PAWISE';
const photoPng = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC';
const photoDataUrl = 'data:image/png;base64,' + photoPng;
let child;
let gatewayCookie;

async function startDemo({ initializeInventory = false } = {}) {
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
      BOLT_DEMO_INITIALIZE_INVENTORY: initializeInventory ? '1' : '0',
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
  if (child?.exitCode !== null) return;
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

async function verifyDemoGallery({ suba, coordination }) {
  const storeId = 'HUB_SUBA';
  const publicProduct = async () => {
    const catalog = await api('/api/v1/catalog?all=true&q=' + galleryFixtureId);
    const product = catalog.find(item => item.id === galleryFixtureId);
    assert.ok(product, 'La muestra de galería debe existir también en el catálogo del cliente');
    return product;
  };
  const before = await publicProduct();
  assert.equal(before.sku, galleryFixtureId);
  assert.deepEqual(before.presentaciones.map(variant => variant.nombre), ['XS', 'S', 'M', 'L', 'XL', 'XXL']);
  assert.ok(before.presentaciones.every(variant => (variant.stockByStore[storeId] ?? 0) === 0));
  const variant = before.presentaciones[1];
  const productId = before.id;
  const variantId = variant.varianteId;
  const inventory = async token => (await admin('/inventory?storeId=' + storeId, { token })).items
    .find(item => item.productId === productId && item.variantId === variantId);
  const row = await inventory(coordination);
  assert.ok(row, 'Coordinación debe poder seleccionar la variante de prueba');
  assert.equal(row.demoGalleryEdit, true);
  assert.equal(row.demoReadOnly, true);
  assert.deepEqual([row.stock, row.reserved, row.available], [0, 0, 0]);
  assert.equal((await inventory(suba))?.demoReadOnly, true);

  const photoRoute = '/inventory/photo';
  const photoQuery = photoRoute + '?' + new URLSearchParams({ productId, variantId });
  const initial = await admin(photoQuery, { token: coordination });
  assert.equal(initial.gallery.length, 6);
  assert.equal(new Set(initial.gallery).size, 6);
  assert.equal(initial.gallery[0], initial.productImage);
  assert.equal(initial.productImage, before.image);
  const upload = { productId, variantId, target: 'variant', expectedImage: initial.variantImage, dataUrl: photoDataUrl, filename: 'pawise-prueba.png' };
  await admin(photoQuery, { token: suba, expected: 403 });
  await admin(photoRoute, { method: 'PUT', token: suba, body: upload, expected: 403 });
  const { image } = await admin(photoRoute, { method: 'PUT', token: coordination, body: upload });
  assert.match(image, /^\/uploads\/catalog\/[^/]+\.png$/);
  assert.deepEqual(await admin(photoQuery, { token: coordination }), { ...initial, variantImage: image });
  assert.equal((await inventory(suba))?.image, image);
  const asset = await fetch(origin + image, { headers: { Cookie: gatewayCookie } });
  assert.equal(asset.status, 200);
  assert.deepEqual(Buffer.from(await asset.arrayBuffer()), Buffer.from(photoPng, 'base64'));

  const gallery = [...initial.gallery.slice(1), initial.gallery[0]];
  const updated = await admin(photoRoute, { method: 'PUT', token: coordination, body: {
    productId, variantId, target: 'product', expectedImage: initial.productImage, expectedGallery: initial.gallery,
    photos: gallery.map(url => ({ url })),
  } });
  assert.equal(updated.image, gallery[0]);
  assert.deepEqual(await admin(photoQuery, { token: coordination }), { productImage: gallery[0], variantImage: image, gallery });

  const edit = { productId, variantId, expectedRevision: row.revision, reason: 'Ajuste prohibido en producto de galería' };
  await admin('/inventory', { method: 'PUT', token: coordination, body: { ...edit, storeId, stock: 1 }, expected: 404 });
  await admin('/prices', { method: 'PUT', token: coordination, body: { ...edit, regularPriceCOP: Math.max(row.price, 1) + 1, promoPriceCOP: null }, expected: 404 });
  const after = await publicProduct();
  assert.equal(after.image, gallery[0]);
  assert.deepEqual([...new Set([after.image, ...(after.gallery ?? [])])], gallery);
  assert.deepEqual(after.presentaciones, before.presentaciones.map(item => item.varianteId === variantId ? { ...item, foto: image } : item));
}

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
  return { catalog, sku, quantity };
}

async function verifyDemoInventoryInitialization({ suba, coordination, checkout }) {
  const storeId = 'HUB_SUBA';
  const productName = 'Agility Gold Adulto Raza Grande';
  const variantId = 'gid://shopify/ProductVariant/48875669717272';
  const knownProduct = async () => {
    const catalog = await api('/api/v1/catalog?' + new URLSearchParams({ q: productName, storeId }));
    const product = catalog.find(item => item.id === 'gid://shopify/Product/9400676647192');
    assert.ok(product, 'La presentación comercial conocida debe existir en el catálogo');
    return product;
  };
  const photoFixture = async () => (await api('/api/v1/catalog?all=true&q=' + galleryFixtureId))
    .find(item => item.id === galleryFixtureId);
  const inventoryRow = async (token, selectedStore, query, matchVariant) => {
    const search = new URLSearchParams({ storeId: selectedStore, query });
    const { items } = await admin('/inventory?' + search, { token });
    return items.find(row => row.variantId === matchVariant);
  };
  const commercialRow = (token, selectedStore) => inventoryRow(token, selectedStore, productName, variantId);
  const oldFixtureRow = token => inventoryRow(token, storeId, orderFixtureId, orderFixtureId + '-1KG');
  const receipt = () => JSON.parse(fs.readFileSync(path.join(
    volume, 'bolt-dispatch-simulation-meeting', '.bolt-private', 'catalog-operations.json',
  ), 'utf8')).demoInventory;
  const [before, beforePhoto, fixtureBefore, stores] = await Promise.all([
    knownProduct(), photoFixture(), oldFixtureRow(suba), api('/api/v1/stores'),
  ]);
  const beforeVariant = before.presentaciones.find(variant => variant.varianteId === variantId);
  assert.ok(beforeVariant);
  assert.ok(beforePhoto && fixtureBefore, 'Las dos muestras de simulación deben existir antes del lote');
  const storeIds = stores.filter(store => store.isActive).map(store => store.id).sort();
  assert.ok(storeIds.length > 1);
  assert.equal(await commercialRow(suba, storeId), undefined);
  assert.equal(receipt(), undefined);

  await stopDemo();
  await startDemo({ initializeInventory: true });
  suba = (await demoLogin('suba')).token;
  coordination = (await demoLogin('coordinacion')).token;
  const batch = receipt();
  assert.ok(batch.batchId);
  assert.ok(Number.isFinite(Date.parse(batch.appliedAt)));
  assert.equal(batch.stockPerStore, 100);
  assert.deepEqual([...batch.storeIds].sort(), storeIds);
  assert.ok(batch.products > 0 && batch.variants >= batch.products);
  assert.equal(batch.rows, batch.variants * storeIds.length);
  assert.ok(batch.changedRows > 0 && batch.changedRows <= batch.rows);

  for (const activeStoreId of storeIds) {
    const row = await commercialRow(coordination, activeStoreId);
    assert.ok(row?.assignedToStore, 'La variante comercial debe mostrarse en ' + activeStoreId);
    assert.equal(row.stock, 100);
    assert.ok(!row.demoReadOnly);
    assert.equal(row.available, 100 - row.reserved);
  }
  const subaRow = await commercialRow(suba, storeId);
  assert.equal(subaRow?.stock, 100);
  assert.ok(!subaRow.canEditCatalog);
  const checkoutRow = await inventoryRow(suba, storeId, checkout.sku, checkout.sku);
  assert.deepEqual([checkoutRow?.stock, checkoutRow?.reserved, checkoutRow?.available], [100, checkout.quantity, 100 - checkout.quantity]);
  const checkoutVariant = (await checkout.catalog()).presentaciones.find(item => item.varianteId === checkout.sku);
  assert.equal(checkoutVariant.reservedStockByStore[storeId], checkout.quantity);
  assert.equal(checkoutVariant.stockByStore[storeId], 100);
  const after = await knownProduct();
  const afterVariant = after.presentaciones.find(variant => variant.varianteId === variantId);
  assert.deepEqual([after.image, after.gallery, afterVariant.foto, afterVariant.price], [before.image, before.gallery, beforeVariant.foto, beforeVariant.price]);
  assert.deepEqual(afterVariant.reservedStockByStore, beforeVariant.reservedStockByStore);
  for (const store of stores.filter(store => !store.isActive)) {
    assert.equal(afterVariant.stockByStore[store.id], beforeVariant.stockByStore[store.id]);
  }
  assert.deepEqual(await photoFixture(), beforePhoto, 'El lote conserva las fotos y stock cero de Pawise');
  assert.deepEqual(await oldFixtureRow(suba), fixtureBefore, 'El lote conserva el inventario y reservas del escenario de pedidos');

  const editable = await commercialRow(coordination, storeId);
  assert.equal(editable.canEditCatalog, true);
  const ids = { productId: editable.productId, variantId: editable.variantId };
  const priceEdit = {
    ...ids, expectedRevision: editable.revision, regularPriceCOP: 240_000, promoPriceCOP: 180_000,
    reason: 'Promoción de prueba por presentación',
  };
  await admin('/prices', { method: 'PUT', token: suba, body: priceEdit, expected: 403 });
  const { item: promoted } = await admin('/prices', { method: 'PUT', token: coordination, body: priceEdit });
  assert.deepEqual([promoted.price, promoted.originalPrice], [180_000, 240_000]);
  await admin('/prices', { method: 'PUT', token: coordination, body: priceEdit, expected: 409 });

  const photoRoute = '/inventory/photo';
  const photoQuery = photoRoute + '?' + new URLSearchParams(ids);
  const photoBefore = await admin(photoQuery, { token: coordination });
  const photoEdit = {
    ...ids, target: 'variant', expectedImage: photoBefore.variantImage, dataUrl: photoDataUrl, filename: 'agility-15kg-prueba.png',
  };
  await admin(photoRoute, { method: 'PUT', token: suba, body: photoEdit, expected: 403 });
  const { image } = await admin(photoRoute, { method: 'PUT', token: coordination, body: photoEdit });
  assert.match(image, /^\/uploads\/catalog\/[^/]+\.png$/);
  assert.deepEqual(await admin(photoQuery, { token: coordination }), { ...photoBefore, variantImage: image });
  await admin(photoRoute, { method: 'PUT', token: coordination, body: photoEdit, expected: 409 });
  const asset = await fetch(origin + image, { headers: { Cookie: gatewayCookie } });
  assert.equal(asset.status, 200);
  assert.deepEqual(Buffer.from(await asset.arrayBuffer()), Buffer.from(photoPng, 'base64'));

  const edited = await knownProduct();
  const editedVariant = edited.presentaciones.find(variant => variant.varianteId === variantId);
  assert.deepEqual([editedVariant.price, editedVariant.originalPrice, editedVariant.foto], [180_000, 240_000, image]);
  assert.deepEqual([editedVariant.stockByStore, editedVariant.reservedStockByStore], [afterVariant.stockByStore, afterVariant.reservedStockByStore]);
  assert.deepEqual(edited.presentaciones.filter(variant => variant.varianteId !== variantId),
    after.presentaciones.filter(variant => variant.varianteId !== variantId));
  assert.deepEqual([edited.image, edited.gallery], [after.image, after.gallery]);

  const updatedInventory = await commercialRow(suba, storeId);
  assert.deepEqual([updatedInventory.price, updatedInventory.originalPrice, updatedInventory.image],
    [180_000, 240_000, image]);
  assert.deepEqual([updatedInventory.stock, updatedInventory.reserved, updatedInventory.available],
    [subaRow.stock, subaRow.reserved, subaRow.available]);

  const edit = {
    ...ids, storeId, expectedRevision: updatedInventory.revision, stock: 97,
    reason: 'Prueba de reconteo posterior a la inicialización',
  };
  const adjustStock = (token, body, expected = 200) => admin('/inventory', { method: 'PUT', token, body, expected });
  await adjustStock(suba, edit, 403);
  const checkoutEdit = {
    storeId, productId: checkoutRow.productId, variantId: checkoutRow.variantId,
    expectedRevision: checkoutRow.revision, stock: checkout.quantity,
    reason: 'Reconteo con pedido reservado',
  };
  const invalidStock = await adjustStock(coordination, { ...checkoutEdit, stock: checkout.quantity - 1 }, 400);
  assert.match(invalidStock.error, /reservadas/);
  assert.deepEqual(await inventoryRow(suba, storeId, checkout.sku, checkout.sku), checkoutRow);
  const { item: reservedAdjustment } = await adjustStock(coordination, checkoutEdit);
  assert.deepEqual([reservedAdjustment.stock, reservedAdjustment.reserved, reservedAdjustment.available],
    [checkout.quantity, checkout.quantity, 0]);

  const { item: adjusted } = await adjustStock(coordination, edit);
  assert.deepEqual([adjusted.stock, adjusted.reserved, adjusted.available], [97, updatedInventory.reserved, 97 - updatedInventory.reserved]);
  assert.equal(adjusted.canEditCatalog, true);
  assert.deepEqual([adjusted.price, adjusted.originalPrice, adjusted.image], [180_000, 240_000, image]);
  await adjustStock(coordination, edit, 409);
  assert.equal((await commercialRow(suba, storeId)).stock, 97);
  const afterStock = await knownProduct();
  const stockVariant = afterStock.presentaciones.find(variant => variant.varianteId === variantId);
  assert.deepEqual(stockVariant.stockByStore, { ...editedVariant.stockByStore, [storeId]: 97 });
  assert.deepEqual([stockVariant.reservedStockByStore, stockVariant.price, stockVariant.originalPrice, stockVariant.foto],
    [editedVariant.reservedStockByStore, 180_000, 240_000, image]);
  assert.deepEqual(afterStock.presentaciones.filter(variant => variant.varianteId !== variantId),
    edited.presentaciones.filter(variant => variant.varianteId !== variantId));

  const history = await admin('/inventory/adjustments?storeId=' + storeId, { token: coordination });
  const adjustment = history.adjustments.find(entry => entry.reason === edit.reason);
  assert.ok(adjustment, 'El ajuste comercial debe aparecer en el historial de la sede');
  assert.deepEqual([adjustment.before, adjustment.after, adjustment.actorName], [100, 97, 'Coordinación']);

  await stopDemo();
  await startDemo({ initializeInventory: true });
  const { token: restarted } = await demoLogin('coordinacion');
  const persisted = await commercialRow(restarted, storeId);
  assert.deepEqual([persisted.stock, persisted.price, persisted.originalPrice, persisted.image], [97, 180_000, 240_000, image]);
  const persistedReservation = await inventoryRow(restarted, storeId, checkout.sku, checkout.sku);
  assert.deepEqual([persistedReservation.stock, persistedReservation.reserved, persistedReservation.available],
    [checkout.quantity, checkout.quantity, 0]);
  assert.ok((await admin('/inventory/adjustments?storeId=' + storeId, { token: restarted })).adjustments
    .some(entry => entry.id === adjustment.id));
  assert.deepEqual(receipt(), batch);
  assert.deepEqual(await photoFixture(), beforePhoto);
  assert.deepEqual(await oldFixtureRow(restarted), fixtureBefore);
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
  assert.ok(unassignedInventory.items.every(item => item.productId === orderFixtureId || item.productId === galleryFixtureId),
    'El catálogo administrativo de la demo mantiene el alcance de sus productos de prueba');
  assert.equal(unassignedInventory.items.find(item => item.productId === orderFixtureId)?.assignedToStore, false);
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

  const photoRoute = '/inventory/photo';
  const photoIds = { productId: reservedStock.productId, variantId: reservedStock.variantId };
  assert.equal(photoIds.productId, orderFixtureId);
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
  await verifyDemoGallery({ suba, coordination });
  console.log('PASS demo: seis fotos de Pawise, principal y variante visibles en catálogo público, operación de galería acotada a Coordinación.');
  const checkout = await verifyCustomerCheckout({ suba, kennedy, coordination });
  console.log('PASS checkout de invitado → Programados de Suba: reserva única de la variante, acceso privado y permisos de solo consulta.');
  await verifyDemoInventoryInitialization({ suba, coordination, checkout });
  console.log('PASS inventario demo: Coordinación ajusta existencias por sede y presentación, conserva reservas e historial y el lote no se repite tras reiniciar.');
  console.log('PASS catálogo demo: Coordinación edita promoción y foto de una presentación desde Inventario, se reflejan en BOLT Cliente y persisten tras reiniciar.');
} finally {
  await stopDemo();
  fs.rmSync(volume, { recursive: true, force: true });
}
