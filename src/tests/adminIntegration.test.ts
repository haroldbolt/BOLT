import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { INITIAL_PRODUCTS, INITIAL_STORES, INITIAL_DRIVERS } from '../data/seedData';
import { AdminRepository } from '../lib/adminRepository';

const dir = mkdtempSync(path.join(tmpdir(), 'bolt-admin-http-'));
const previousDataDir = process.env.BOLT_DATA_DIR;
process.env.BOLT_DATA_DIR = path.join(dir, 'module-default');
const { createBoltApp } = await import('../../server');
const { OrdersRepository } = await import('../lib/ordersRepository');
const products = structuredClone(INITIAL_PRODUCTS.slice(0, 2));
const stores = structuredClone(INITIAL_STORES);
for (const product of products) {
  product.price = 20000;
  product.weightKg = 1;
  product.status = 'ACTIVE';
  product.stockByStore = Object.fromEntries(stores.map(s => [s.id, s.id === 'HUB_KENNEDY' ? 30 : 0]));
  product.reservedStockByStore = Object.fromEntries(stores.map(s => [s.id, 0]));
  Object.assign(product, { inventoryVerifiedByStore: { HUB_KENNEDY: true } });
}
const product = products[0];
const repository = new OrdersRepository({ dataDir: dir, initialOrders: [], initialDrivers: structuredClone(INITIAL_DRIVERS) });
const adminRepository = new AdminRepository({ dataDir: dir, products, stores });
const admin = adminRepository.createAdministrator('qa.http', 'Clave-Aislada-HTTP-2026', 'QA HTTP');
const app = await createBoltApp({ serveFrontend: false, products, stores, repository, adminRepository });
const server = app.listen(0, '127.0.0.1');
await new Promise<void>(resolve => server.once('listening', resolve));
const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/v1`;
let passed = 0;
let cookie = '';
let csrf = '';
let openStream: AbortController | undefined;
function check(label: string, test: () => void) { test(); passed++; console.log(`PASS: ${label}`); }
async function request(route: string, options: { method?: string; body?: unknown; authorized?: boolean; headers?: Record<string, string> } = {}) {
  const response = await fetch(base + route, {
    method: options.method || 'GET',
    headers: { ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(options.authorized ? { Cookie: cookie, 'X-CSRF-Token': csrf } : {}), ...options.headers },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  const body = await response.json().catch(() => ({})) as any;
  return { response, status: response.status, body };
}
const payload = {
  storeId: 'HUB_KENNEDY', deliveryMode: 'TURBO',
  items: [{ productId: product.id, quantity: 1, price: 1, weightKg: 0.0001 }],
  customer: { name: 'Pedido temporal QA', phone: '0000000000', email: 'qa@example.invalid', isGuest: true },
  deliveryAddress: { address: 'Dirección de prueba, Kennedy, Bogotá', details: '', porteriaPolicy: 'DEJAR_EN_PORTERIA', coordinates: { lat: 4.6325, lng: -74.1520 } },
  paymentMethod: 'WOMPI_CARD', tip: 0,
};
try {
  const before = await request('/admin/session');
  check('el navegador comienza sin sesión y no expone información privada', () => {
    assert.equal(before.status, 200);
    assert.equal(before.body.authenticated, false);
    assert.equal(before.body.setupRequired, false);
    assert.equal(before.body.user, undefined);
    assert.equal(before.body.csrfToken, undefined);
  });
  for (const route of ['/admin/products', '/admin/promotions', '/admin/audit', '/admin/events', '/orders', '/driver/profile', '/driver/assignments', '/inventory/status', '/integrations/status']) {
    const result = await request(route, { headers: { 'x-actor-role': 'ADMINISTRADOR', 'x-actor-id': admin.id } });
    check(`sin sesión no hay acceso administrativo a ${route}`, () => assert.equal(result.status, 401));
  }
  const badLogin = await request('/admin/login', { method: 'POST', body: { username: admin.username, password: 'clave-incorrecta' } });
  check('una contraseña incorrecta no crea cookies administrativas', () => {
    assert.equal(badLogin.status, 401);
    assert.equal(badLogin.response.headers.get('set-cookie'), null);
  });
  const crossLogin = await request('/admin/login', { method: 'POST', body: { username: admin.username, password: 'Clave-Aislada-HTTP-2026' }, headers: { Origin: 'https://otro-origen.invalid' } });
  check('rechaza el inicio de sesión solicitado desde otro sitio', () => assert.equal(crossLogin.status, 403));
  const login = await request('/admin/login', { method: 'POST', body: { username: admin.username, password: 'Clave-Aislada-HTTP-2026' } });
  assert.equal(login.status, 200, JSON.stringify(login.body));
  cookie = login.response.headers.get('set-cookie')!.split(';')[0];
  csrf = login.body.csrfToken;
  check('el acceso correcto usa una sesión HttpOnly con SameSite y token CSRF', () => {
    const header = login.response.headers.get('set-cookie')!;
    assert.match(header, /HttpOnly/i);
    assert.match(header, /SameSite=Strict/i);
    assert.ok(csrf?.length >= 40);
    assert.equal(login.body.user.username, admin.username);
    assert.equal(login.body.password, undefined);
    assert.equal(login.body.token, undefined);
  });
  const noCsrf = await request('/admin/products', { method: 'POST', body: { name: 'No debe crearse' }, headers: { Cookie: cookie } });
  const badOrigin = await request('/admin/products', { method: 'POST', body: { name: 'No debe crearse' }, authorized: true, headers: { Origin: 'https://otro-origen.invalid' } });
  check('tener cookie no permite modificar datos sin CSRF o desde otro origen', () => {
    assert.equal(noCsrf.status, 403);
    assert.equal(badOrigin.status, 403);
    assert.equal(products.length, 2);
  });
  const adminList = await request('/admin/products?q=' + encodeURIComponent(product.name) + '&pageSize=1', { authorized: true });
  check('la búsqueda administrativa entrega paginación y campos de edición', () => {
    assert.equal(adminList.status, 200);
    assert.equal(adminList.body.pageSize, 1);
    assert.ok(adminList.body.products.length <= 1);
    assert.ok(Number.isSafeInteger(adminList.body.products[0].version));
  });
  const encoded = encodeURIComponent(product.id);
  const archived = await request(`/admin/products/${encoded}/archive`, { method: 'POST', body: { version: adminRepository.getProduct(product.id).version }, authorized: true });
  assert.equal(archived.status, 200, JSON.stringify(archived.body));
  const catalogArchived = await request('/catalog');
  const buyArchived = await request('/orders', { method: 'POST', body: payload });
  check('archivar retira el producto de la tienda y bloquea nuevos pedidos', () => {
    assert.equal(catalogArchived.body.some((p: any) => p.id === product.id), false);
    assert.ok([400, 409].includes(buyArchived.status));
    assert.equal(repository.getAllOrders().length, 0);
    assert.equal(product.reservedStockByStore.HUB_KENNEDY, 0);
  });
  const restored = await request(`/admin/products/${encoded}/restore`, { method: 'POST', body: { version: archived.body.version }, authorized: true });
  assert.equal(restored.status, 200, JSON.stringify(restored.body));
  const promotion = await request('/admin/promotions', { method: 'POST', authorized: true, body: {
    name: 'QA diez por ciento', type: 'PERCENTAGE', value: 10,
    productIds: [product.id], variantIds: [], storeIds: ['HUB_KENNEDY'],
    startsAt: new Date(Date.now() - 60_000).toISOString(), endsAt: new Date(Date.now() + 3_600_000).toISOString(), minSubtotal: 0, active: true,
  } });
  assert.equal(promotion.status, 201, JSON.stringify(promotion.body));
  const created = await request('/orders', { method: 'POST', body: { ...payload, discount: 19000, total: 1, promotionId: 'PROMO-INVENTADA' } });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const orderId = created.body.id;
  const customerToken = created.body.customerAccessToken;
  check('el pedido usa precio y descuento del servidor y conserva envío y pago pendiente', () => {
    assert.equal(created.body.totals.subtotal, 20000);
    assert.equal(created.body.totals.discount, 2000);
    assert.equal(created.body.totals.shipping, 4900);
    assert.equal(created.body.totals.serviceFee, 0);
    assert.equal(created.body.totals.total, 22900);
    assert.equal(created.body.payment.status, 'PENDIENTE');
    assert.equal(created.body.payment.transactionId, undefined);
    assert.equal(product.reservedStockByStore.HUB_KENNEDY, 1);
    assert.ok(customerToken?.length >= 32);
  });
  const list = await request('/orders', { authorized: true });
  const noTokenDetail = await request(`/orders/${orderId}`);
  const noTokenTracking = await request(`/orders/${orderId}/tracking`);
  const clientDetail = await request(`/orders/${orderId}`, { headers: { 'x-order-token': customerToken } });
  const foreignTokenDetail = await request(`/orders/${orderId}`, { headers: { 'x-order-token': 'token-ajeno' } });
  check('el administrador ve el pedido y el cliente solo accede mediante su autorización privada', () => {
    assert.equal(list.status, 200);
    assert.equal(list.body.length, 1);
    assert.ok([401, 403].includes(noTokenDetail.status));
    assert.ok([401, 403].includes(noTokenTracking.status));
    assert.equal(clientDetail.status, 200);
    assert.ok([401, 403].includes(foreignTokenDetail.status));
    assert.equal(list.body[0].secretDeliveryCode, undefined);
  });
  const unauthorizedStatus = await request(`/operations/orders/${orderId}/status`, { method: 'POST', body: { status: 'EN_ALISTAMIENTO', role: 'ADMINISTRADOR' }, headers: { 'x-actor-role': 'ADMINISTRADOR' } });
  const authorizedStatus = await request(`/operations/orders/${orderId}/status`, { method: 'POST', body: { status: 'EN_ALISTAMIENTO' }, authorized: true });
  check('el cambio de estado se autoriza por sesión y no por el rol enviado', () => {
    assert.equal(unauthorizedStatus.status, 401);
    assert.equal(authorizedStatus.status, 200, JSON.stringify(authorizedStatus.body));
    assert.equal(repository.getOrderById(orderId)!.fulfillmentStatus, 'EN_ALISTAMIENTO');
    const history = repository.getOrderById(orderId)!.statusHistory!;
    assert.equal(history.at(-1)!.actor.id, admin.id);
  });
  const cancelForeign = await request(`/orders/${orderId}/cancel`, { method: 'POST', body: { role: 'ADMINISTRADOR', reason: 'No autorizado' }, headers: { 'x-actor-role': 'ADMINISTRADOR' } });
  check('nadie puede cancelar un pedido ajeno falsificando el rol', () => assert.ok([401, 403].includes(cancelForeign.status)));
  const clientAfterPicking = await request(`/orders/${orderId}/cancel`, { method: 'POST', body: { role: 'ADMINISTRADOR', reason: 'No debe elevar permisos' }, headers: { 'x-order-token': customerToken, 'x-actor-role': 'ADMINISTRADOR' } });
  check('el comprador no obtiene permisos administrativos usando su autorización de pedido', () => {
    assert.equal(clientAfterPicking.status, 400);
    assert.equal(product.reservedStockByStore.HUB_KENNEDY, 1);
  });
  const cancelled = await request(`/orders/${orderId}/cancel`, { method: 'POST', body: { reason: 'Cancelación administrativa de la prueba aislada' }, authorized: true });
  check('la cancelación autorizada libera exactamente la reserva del pedido', () => {
    assert.equal(cancelled.status, 200, JSON.stringify(cancelled.body));
    assert.equal(product.reservedStockByStore.HUB_KENNEDY, 0);
    assert.equal(product.stockByStore.HUB_KENNEDY, 30);
  });
  const halfPrice = await request(`/admin/promotions/${encodeURIComponent(promotion.body.id)}`, { method: 'PUT', authorized: true, body: { ...promotion.body, value: 50 } });
  assert.equal(halfPrice.status, 200, JSON.stringify(halfPrice.body));
  const cartPrice = await request('/cart/price', { method: 'POST', body: { storeId: 'HUB_KENNEDY', items: [{ productId: product.id, quantity: 4, price: 1 }], discount: 0 } });
  check('la cotización del checkout conserva envío gratis aunque el descuento baje el total de productos', () => {
    assert.equal(cartPrice.status, 200, JSON.stringify(cartPrice.body));
    assert.equal(cartPrice.body.subtotal, 80000);
    assert.equal(cartPrice.body.discount, 40000);
    assert.equal(cartPrice.body.shipping, 0);
    assert.equal(cartPrice.body.serviceFee, 0);
    assert.equal(cartPrice.body.total, 40000);
  });
  const restorePromotion = await request(`/admin/promotions/${encodeURIComponent(promotion.body.id)}`, { method: 'PUT', authorized: true, body: { ...halfPrice.body, value: 10 } });
  assert.equal(restorePromotion.status, 200, JSON.stringify(restorePromotion.body));

  const variantCreated = await request('/admin/products', { method: 'POST', authorized: true, body: {
    name: 'QA HTTP presentaciones', sku: 'HTTP-VARIANTE-BASE', price: 17000, weightKg: 1, status: 'ACTIVE',
    image: 'https://example.invalid/qa.webp', bodegaIds: ['HUB_KENNEDY'],
    presentaciones: [
      { varianteId: 'VAR-HTTP-UNO', nombre: '1 kg', sku: 'HTTP-VARIANTE-BASE', foto: 'https://example.invalid/uno.webp', bodegaIds: ['HUB_KENNEDY'] },
      { varianteId: 'VAR-HTTP-DOS', nombre: '2 kg', sku: 'HTTP-VARIANTE-DOS', price: 42000, weightKg: 2, foto: 'https://example.invalid/dos.webp', bodegaIds: ['HUB_KENNEDY'] },
    ],
  } });
  assert.equal(variantCreated.status, 201, JSON.stringify(variantCreated.body));
  const variantAdjusted = await request(`/admin/products/${encodeURIComponent(variantCreated.body.id)}/inventory`, { method: 'POST', authorized: true, body: { version: variantCreated.body.version, variantId: 'VAR-HTTP-DOS', storeId: 'HUB_KENNEDY', quantity: 5, reason: 'Conteo físico de presentación temporal' } });
  assert.equal(variantAdjusted.status, 200, JSON.stringify(variantAdjusted.body));
  const variantPromotion = await request('/admin/promotions', { method: 'POST', authorized: true, body: { ...promotion.body, id: undefined, version: undefined, name: 'QA solo presentación 2 kg', productIds: [], variantIds: ['VAR-HTTP-DOS'], value: 15 } });
  assert.equal(variantPromotion.status, 201, JSON.stringify(variantPromotion.body));
  const secondaryQuote = await request('/cart/price', { method: 'POST', body: { storeId: 'HUB_KENNEDY', items: [{ productId: variantCreated.body.id, variantId: 'VAR-HTTP-DOS', quantity: 1, price: 1, weightKg: 0.001 }] } });
  const primaryQuote = await request('/cart/price', { method: 'POST', body: { storeId: 'HUB_KENNEDY', items: [{ productId: variantCreated.body.id, variantId: 'VAR-HTTP-UNO', quantity: 1 }] } });
  check('el checkout cotiza la presentación elegida con su precio y promoción independientes', () => {
    assert.equal(secondaryQuote.status, 200, JSON.stringify(secondaryQuote.body));
    assert.equal(secondaryQuote.body.subtotal, 42000);
    assert.equal(secondaryQuote.body.discount, 6300);
    assert.equal(secondaryQuote.body.total, 40600);
    assert.equal(primaryQuote.body.subtotal, 17000);
    assert.equal(primaryQuote.body.discount, 0);
  });
  const operationalBeforeFailure = adminRepository.readOperationalState();
  adminRepository.db.exec("CREATE TRIGGER qa_fail_order BEFORE INSERT ON operational_state BEGIN SELECT RAISE(ABORT, 'fallo de persistencia deliberado'); END");
  let failedVariant: Awaited<ReturnType<typeof request>>;
  try {
    failedVariant = await request('/orders', { method: 'POST', body: { ...payload, items: [{ productId: variantCreated.body.id, variantId: 'VAR-HTTP-DOS', quantity: 1 }] } });
  } finally { adminRepository.db.exec('DROP TRIGGER qa_fail_order'); }
  check('un fallo de guardado revierte la reserva de una presentación sin dejarla huérfana', () => {
    assert.equal(failedVariant.status, 500, JSON.stringify(failedVariant.body));
    assert.equal(repository.getAllOrders().length, 1);
    const actualVariant = adminRepository.getProduct(variantCreated.body.id).presentaciones!.find(v => v.varianteId === 'VAR-HTTP-DOS')!;
    assert.equal(actualVariant.stockByStore!.HUB_KENNEDY, 5);
    assert.equal(actualVariant.reservedStockByStore!.HUB_KENNEDY, 0);
    assert.deepEqual(adminRepository.readOperationalState(), operationalBeforeFailure);
  });

  const sseAbort = new AbortController();
  openStream = sseAbort;
  const initialTimeout = setTimeout(() => sseAbort.abort(), 5000);
  const sse = await fetch(base + '/admin/events', { headers: { Cookie: cookie }, signal: sseAbort.signal });
  check('el canal de pedidos en vivo está autenticado y usa eventos del servidor', () => {
    assert.equal(sse.status, 200);
    assert.match(sse.headers.get('content-type') || '', /text\/event-stream/);
  });
  const sseReader = sse.body!.getReader();
  let sseText = '';
  const decoder = new TextDecoder();
  // Drenar el mensaje de conexión antes de la nueva compra permite comprobar el evento posterior.
  const initialChunk = await sseReader.read();
  clearTimeout(initialTimeout);
  sseText += decoder.decode(initialChunk.value);
  const second = await request('/orders', { method: 'POST', body: payload });
  assert.equal(second.status, 201, JSON.stringify(second.body));
  let eventText = '';
  const timer = setTimeout(() => sseAbort.abort(), 5000);
  try {
    while (!/event:\s*orders/.test(eventText)) {
      const next = await sseReader.read();
      if (next.done) break;
      eventText += decoder.decode(next.value);
    }
    check('una compra nueva emite aviso de pedidos y se recupera al consultar nuevamente', () => assert.match(eventText, /event:\s*orders/));
  } finally { clearTimeout(timer); sseAbort.abort(); await sseReader.cancel().catch(() => undefined); }
  const afterReconnect = await request('/orders', { authorized: true });
  check('reconectar recupera cada pedido una sola vez desde el servidor', () => {
    assert.equal(afterReconnect.body.length, 2);
    assert.equal(new Set(afterReconnect.body.map((o: any) => o.id)).size, 2);
    assert.ok(afterReconnect.body.some((o: any) => o.id === second.body.id));
  });
  const logoutStreamAbort = new AbortController();
  openStream = logoutStreamAbort;
  const logoutStream = await fetch(base + '/admin/events', { headers: { Cookie: cookie }, signal: logoutStreamAbort.signal });
  const logoutReader = logoutStream.body!.getReader();
  await logoutReader.read();
  const logout = await request('/admin/logout', { method: 'POST', authorized: true });
  const afterLogout = await request('/admin/products', { authorized: true });
  check('cerrar sesión invalida las cookies anteriores para todas las herramientas', () => {
    assert.equal(logout.status, 200);
    assert.equal(afterLogout.status, 401);
  });
  const afterLogoutOrder = await request('/orders', { method: 'POST', body: payload });
  assert.equal(afterLogoutOrder.status, 201, JSON.stringify(afterLogoutOrder.body));
  const logoutTimeout = setTimeout(() => logoutStreamAbort.abort(), 7000);
  try {
    let logoutReceived = '', completed = false;
    while (!completed) {
      const chunk = await logoutReader.read();
      completed = chunk.done;
      logoutReceived += decoder.decode(chunk.value);
    }
    check('cerrar sesión también termina un canal en vivo abierto antes del cierre', () => assert.doesNotMatch(logoutReceived, /event:\s*orders/));
  } finally { clearTimeout(logoutTimeout); logoutStreamAbort.abort(); await logoutReader.cancel().catch(() => undefined); }
  const replayProducts: typeof products = [];
  const replayAdmin = new AdminRepository({ dataDir: dir, products: replayProducts, stores });
  try {
    const replayOrders = new OrdersRepository({ dataDir: path.join(dir, 'replay-json'), initialOrders: [], initialDrivers: [] });
    replayOrders.connectPersistence({ read: () => replayAdmin.readOperationalState(), write: state => replayAdmin.writeOperationalState(state) });
    check('instancias nuevas recuperan pedidos, cancelación y reservas desde el mismo SQLite', () => {
      assert.equal(replayOrders.getAllOrders().length, 3);
      assert.equal(replayOrders.getOrderById(orderId)!.fulfillmentStatus, 'CANCELADO');
      assert.equal(replayOrders.getOrderById(second.body.id)!.fulfillmentStatus, 'CONFIRMADO');
      assert.equal(replayAdmin.getProduct(product.id).stockByStore.HUB_KENNEDY, 30);
      assert.equal(replayAdmin.getProduct(product.id).reservedStockByStore.HUB_KENNEDY, 2);
      assert.equal(replayAdmin.getProduct(variantCreated.body.id).presentaciones![1].reservedStockByStore!.HUB_KENNEDY, 0);
    });
  } finally { replayAdmin.close(); }
  console.log(`ADMIN API: ${passed} comprobaciones aprobadas.`);
} finally {
  openStream?.abort();
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  app.locals.closeAdmin();
  if (previousDataDir === undefined) delete process.env.BOLT_DATA_DIR; else process.env.BOLT_DATA_DIR = previousDataDir;
  if (path.dirname(dir) !== path.resolve(tmpdir()) || !path.basename(dir).startsWith('bolt-admin-http-')) throw new Error('Directorio temporal inválido');
  rmSync(dir, { recursive: true, force: true });
}
