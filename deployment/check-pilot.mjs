import assert from 'node:assert/strict';

const [input, mode, ...rest] = process.argv.slice(2);
if (!input || rest.length || (mode && mode !== '--checkout-abierto')) {
  throw Error('Uso: node deployment/check-pilot.mjs https://<origen-del-piloto> [--checkout-abierto]');
}
const checkoutOpen = mode === '--checkout-abierto';
const base = new URL(input);
const local = base.protocol === 'http:' && base.hostname === '127.0.0.1';
assert.ok(base.protocol === 'https:' || local, 'Usa HTTPS. Solo se permite HTTP en 127.0.0.1.');
assert.equal(base.href, base.origin + '/', 'Indica el origen sin ruta, credenciales ni parámetros.');

const get = pathname => fetch(new URL(pathname, base), {
  redirect: 'error',
  signal: AbortSignal.timeout(15_000),
});

async function json(pathname) {
  const response = await get(pathname);
  assert.equal(response.status, 200, pathname);
  assert.match(response.headers.get('content-type') ?? '', /^application\/json/, pathname);
  return response.json();
}

const [health, stores, session, manifest] = await Promise.all([
  json('/api/v1/health'),
  json('/api/v1/stores'),
  json('/api/v1/bolt-admin/session'),
  json('/manifest.json'),
]);

assert.equal(health.status, 'ok');
const storeIds = ['HUB_ALAMOS', 'HUB_KENNEDY', 'HUB_SUBA'];
assert.deepEqual(health.pilot?.storeIds, storeIds, 'El servidor no inició con las tres sedes operativas.');
if (checkoutOpen) assert.equal(health.pilot.checkoutHold, undefined);
else assert.ok(['RAPPI_CASH_UNCONFIRMED', 'PILOT_CHECKOUT_CLOSED'].includes(health.pilot.checkoutHold),
  'El checkout del piloto debe estar cerrado.');
assert.deepEqual(stores.map(store => store.id).sort(), storeIds);
for (const store of stores) {
  assert.ok(store.enabledModes?.includes('TURBO') && store.enabledModes?.includes('PROGRAMADO'),
    store.id + ' debe tener Turbo y Programado en su configuración.');
}
assert.equal(session.mode, 'live', 'BOLT Admin debe estar en modo operativo.');
assert.equal(session.actor, null, 'El administrador requiere una sesión.');
assert.deepEqual(session.profiles, []);
assert.equal(manifest.start_url, '/');
assert.equal(manifest.scope, '/');
assert.equal(manifest.display, 'standalone');

for (const size of [192, 512]) {
  const icon = manifest.icons.find(entry => entry.type === 'image/png' && entry.sizes === size + 'x' + size);
  assert.ok(icon, 'Falta el icono PWA de ' + size + ' px.');
  assert.equal(new URL(icon.src, base).origin, base.origin);
  const response = await get(icon.src);
  assert.equal(response.status, 200, icon.src);
  assert.match(response.headers.get('content-type') ?? '', /^image\/png/);
  const png = Buffer.from(await response.arrayBuffer());
  assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  assert.equal(png.readUInt32BE(16), size);
  assert.equal(png.readUInt32BE(20), size);
}

const pages = ['/', '/admin/nuevo/', '/admin/nuevo/?view=dispatch', '/conductor'];
for (const id of storeIds) {
  pages.push('/admin/nuevo/?view=turbo&sede=' + id, '/admin/nuevo/?view=scheduled&sede=' + id);
}
for (const route of pages) {
  const page = await get(route);
  assert.equal(page.status, 200, route);
  assert.match(page.headers.get('content-type') ?? '', /^text\/html/, route);
  assert.match(await page.text(), /\/manifest\.json/, route);
}

for (const route of ['/api/v1/admin/dispatch', '/api/v1/driver/profile']) {
  const response = await get(route);
  assert.ok([401, 403].includes(response.status), route + ' debe exigir autenticación.');
}

assert.deepEqual(await json('/api/v1/simulation'), { enabled: false });
for (const route of ['/api/v1/simulation/customer-checkout', '/api/v1/simulation/cash-checkout']) {
  const response = await get(route);
  // The SPA fallback may render an HTML page for an unmounted API route.
  assert.ok(!response.ok || !response.headers.get('content-type')?.startsWith('application/json'),
    route + ' está disponible en este despliegue.');
}

console.log('PWA de Álamos, Kennedy y Suba. Cliente, Admin, Despachos y Conductor accesibles. ' +
  (checkoutOpen ? 'Apertura del checkout configurada.' : 'Checkout real cerrado.'));
