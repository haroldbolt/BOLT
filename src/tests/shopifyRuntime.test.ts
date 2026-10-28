import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHmac } from 'node:crypto';
import { createShopifyInventoryRuntime } from '../../lib/shopifyRuntime';
import { createShopifyTokenProvider } from '../../lib/shopify-auth.mjs';
import type { ShopifySnapshot } from '../lib/shopifyMapper';

const projectRoot = fileURLToPath(new URL('../..', import.meta.url));
const testParent = path.join(projectRoot, '.bolt-private', 'runtime-tests');
await mkdir(testParent, { recursive: true });
const directory = await mkdtemp(path.join(testParent, 'case-'));
let passed = 0;
function check(condition: unknown, message: string) {
  assert.ok(condition, message); passed++; console.log('PASS: ' + message);
}
const domain = '1c76bc-08.myshopify.com';
const kennedy = 'gid://shopify/Location/115617857816', suba = 'gid://shopify/Location/115617923352';
let clock = Date.parse('2026-10-28T15:00:00.000Z');
let stock = 7, authCalls = 0, readCalls = 0, force401 = false;
let failure: 'none' | 'server' | 'cursor' = 'none';
const mutations: string[] = [];
const requests: string[] = [];
const location = (id: string, name: string, lat: number, lng: number) => ({ id, name, isActive: true, fulfillsOnlineOrders: true,
  address: { address1: name, city: 'Bogotá', country: 'Colombia', latitude: lat, longitude: lng } });
const levels = (id: string, available: number) => ({ location: { id }, quantities: [
  { name: 'available', quantity: available }, { name: 'on_hand', quantity: available + 2 }, { name: 'committed', quantity: 2 },
] });
const variant = (number: number) => ({ id: `gid://shopify/ProductVariant/${number}`, title: '2 kg', sku: '', price: '25000',
  selectedOptions: [{ name: 'Tamaño', value: '2 kg' }], media: { nodes: [], pageInfo: { hasNextPage: false } },
  product: { id: `gid://shopify/Product/${number}`, title: `Producto de prueba ${number}`, handle: `fixture-${number}`, status: 'ACTIVE', vendor: 'Fixture', productType: 'Alimentos', tags: ['Perros'], description: 'Prueba aislada', media: { nodes: [], pageInfo: { hasNextPage: false } } },
  inventoryItem: { id: `gid://shopify/InventoryItem/${number}`, tracked: true, requiresShipping: true,
    measurement: { weight: { value: 2, unit: 'KILOGRAMS' } },
    inventoryLevels: { nodes: [levels(kennedy, stock)], pageInfo: { hasNextPage: true, endCursor: 'level-one' } } },
});
const snapshot = (): ShopifySnapshot => ({
  shop: { name: 'Fixture', myshopifyDomain: domain, currencyCode: 'COP' },
  fetchedAt: '2026-10-26T14:16:43.296Z', complete: true, apiVersion: '2026-10',
  locations: [location(kennedy, 'Kennedy', 4.632, -74.151), location(suba, 'Suba', 4.747, -74.098)],
  variants: [11, 22].map(number => ({ ...variant(number), inventoryItem: { ...variant(number).inventoryItem,
    inventoryLevels: { nodes: [levels(kennedy, stock), levels(suba, 0)], pageInfo: { hasNextPage: false } } } })),
});
const response = (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
const fetchImpl: typeof fetch = async (input, init) => {
  const url = String(input);
  requests.push(url);
  assert.ok(url.startsWith('https://' + domain + '/admin/'));
  assert.equal(init?.method, 'POST');
  if (url.endsWith('/oauth/access_token')) {
    authCalls++;
    return response({ access_token: `fixture-access-${authCalls}`, expires_in: 3600, scope: 'read_products,read_inventory,read_locations' });
  }
  const payload = JSON.parse(String(init?.body));
  if (/\bmutation\b/.test(payload.query)) mutations.push(payload.query);
  assert.ok(/^query\s/.test(payload.query));
  assert.ok(new Headers(init?.headers).get('X-Shopify-Access-Token')?.startsWith('fixture-access-'));
  readCalls++;
  if (force401) { force401 = false; return response({}, 401); }
  if (failure === 'server') return response({ detail: 'fixture-secret-must-not-leak' }, 500);
  const { query, variables } = payload;
  if (query.includes('query BoltShopLocations')) {
    const first = !variables.after;
    return response({ data: { shop: snapshot().shop, locations: {
      nodes: [snapshot().locations[first ? 0 : 1]], pageInfo: { hasNextPage: first, endCursor: first ? 'location-one' : null },
    } } });
  }
  if (query.includes('query BoltInventoryLevels')) {
    return response({ data: { inventoryItem: { id: variables.id,
      inventoryLevels: { nodes: [levels(suba, 0)], pageInfo: { hasNextPage: false, endCursor: null } },
    } } });
  }
  assert.ok(query.includes('query BoltVariants'));
  if (failure === 'cursor') return response({ data: { productVariants: { nodes: [], pageInfo: { hasNextPage: true } } } });
  const first = !variables.after;
  return response({ data: { productVariants: {
    nodes: [variant(first ? 11 : 22)], pageInfo: { hasNextPage: first, endCursor: first ? 'variant-one' : null },
  } } });
};
const intervals: (() => void)[] = [], timeouts: (() => void)[] = [];
const timers = {
  setInterval(callback: () => void, ms: number) { assert.equal(ms, 600000); intervals.push(callback); return { unref() {} }; },
  clearInterval() {},
  setTimeout(callback: () => void, ms: number) { assert.equal(ms, 1000); timeouts.push(callback); return { unref() {} }; },
  clearTimeout() {},
};
const env = { SHOPIFY_STORE_DOMAIN: domain, SHOPIFY_CLIENT_ID: 'fixture-client', SHOPIFY_CLIENT_SECRET: 'fixture-client-secret' };
const cachePath = path.join(directory, '.bolt-private/shopify/snapshot.json');
let runtime: ReturnType<typeof createShopifyInventoryRuntime> | undefined;
let restarted: ReturnType<typeof createShopifyInventoryRuntime> | undefined;
try {
  const noCredentials = createShopifyInventoryRuntime({ projectRoot: path.join(directory, 'empty'), env: {}, fetchImpl, now: () => clock, timers });
  await noCredentials.initialize(); noCredentials.start();
  check(noCredentials.getInventory() === null && noCredentials.getStatus().status === 'PENDIENTE_AUTORIZACION', 'Sin credenciales ni caché no se inventan productos ni conexión');
  check(!noCredentials.getStatus().automaticSync && requests.length === 0, 'Sin autorización no hay llamadas remotas ni conciliación ficticia');
  assert.throws(() => createShopifyInventoryRuntime({ projectRoot: directory, env: { BOLT_SHOPIFY_SNAPSHOT_PATH: 'public/snapshot.json' } }), /privada/);
  passed++;
  await mkdir(path.dirname(cachePath), { recursive: true });
  await writeFile(cachePath, JSON.stringify(snapshot()));
  const installed: unknown[] = [];
  runtime = createShopifyInventoryRuntime({ projectRoot: directory, env, fetchImpl, now: () => clock, timers, sleep: async () => {}, onInventory: inventory => installed.push(inventory) });
  await runtime.initialize();
  check(installed.length === 1 && runtime.getInventory()?.products.length === 2, 'Inicializar instala la lectura privada completa mediante el callback');
  check(runtime.getStatus().isStale && !runtime.getStatus().liveVerified && !runtime.getStatus().lastSuccessfulSync, 'La caché no se presenta como lectura en vivo ni recibe una fecha nueva');
  runtime.start();
  let state = await runtime.syncNow();
  check(state.status === 'CONECTADO' && state.liveVerified && state.automaticSync && !state.isStale, 'Una lectura autenticada completa habilita el estado conectado y la tarea automática');
  check(state.lastSuccessfulSync === new Date(clock).toISOString() && state.fetchedAt === state.lastSuccessfulSync, 'La fecha exitosa se asigna solo después de completar la lectura y guardar la caché');
  check(runtime.getInventory()?.products.every(product => product.inventoryByStore.HUB_SUBA.available === 0), 'Se completan las páginas anidadas de inventario para ambas variantes');
  check(runtime.getInventory()?.stores.length === 2 && runtime.getInventory()?.products.length === 2, 'Se completan las páginas de ubicaciones y variantes sin colisiones por SKU vacío');
  check(authCalls === 1 && readCalls >= 6, 'El token se reutiliza durante todas las páginas de una lectura');
  const product = runtime.getInventory()!.products[0];
  product.reservedStockByStore.HUB_KENNEDY = 2;
  const store = runtime.getInventory()!.stores.find(store => store.id === 'HUB_KENNEDY')!;
  store.verifiedEntrance = { lat: 4.633, lng: -74.152 }; store.verificationStatus = 'VERIFIED'; store.verifiedAt = '2026-10-28T15:00:00.000Z';
  clock += 600000; stock = 10;
  intervals[0](); state = await runtime.syncNow();
  check(runtime.getInventory()?.products[0].stockByStore.HUB_KENNEDY === 10 && installed.length >= 3, 'La tarea del servidor actualiza las cantidades sin un navegador abierto');
  check(runtime.getInventory()?.products[0].reservedStockByStore.HUB_KENNEDY === 2, 'Una actualización conserva las reservas locales por GID de variante');
  check(runtime.getInventory()?.stores.find(store => store.id === 'HUB_KENNEDY')?.verifiedEntrance?.lat === 4.633, 'La lectura conserva la entrada de despacho verificada localmente');
  const encodedCache = await readFile(cachePath, 'utf8');
  check(!encodedCache.includes('fixture-access') && !encodedCache.includes('fixture-client-secret') && !encodedCache.includes('reservedStockByStore'), 'El archivo privado no guarda tokens, secretos ni reservas como inventario de Shopify');
  const beforeRefresh = authCalls;
  force401 = true; await runtime.syncNow();
  check(authCalls === beforeRefresh + 1 && runtime.getStatus().status === 'CONECTADO', 'Un 401 renueva una vez el token propio y repite la consulta');
  const preserved = runtime.getInventory();
  const lastGoodDate = runtime.getStatus().fetchedAt;
  failure = 'server'; await runtime.syncNow();
  check(runtime.getInventory() === preserved && runtime.getStatus().fetchedAt === lastGoodDate && runtime.getStatus().status === 'ERROR_SINCRONIZACION', 'Un fallo conserva datos y fecha originales sin fingir una conciliación exitosa');
  check(await readFile(cachePath, 'utf8') === encodedCache, 'Un fallo no reemplaza la última caché completa');
  check(!JSON.stringify(runtime.getStatus()).includes('fixture-secret'), 'El estado público no revela errores o credenciales del proveedor');
  clock += 1201000;
  check(runtime.getStatus().isStale, 'El estado señala que la disponibilidad superó el límite de antigüedad');
  failure = 'cursor'; await runtime.syncNow();
  check(runtime.getStatus().errorCode === 'INVALID_CURSOR' && runtime.getInventory() === preserved, 'Una página incompleta se rechaza antes de instalar datos parciales');
  failure = 'none'; await runtime.syncNow();
  check(!runtime.getStatus().isStale && runtime.getStatus().status === 'CONECTADO', 'Una lectura completa posterior recupera el estado real');
  const body = Buffer.from(JSON.stringify({ inventory_item_id: 11, location_id: 115617857816, available: 10 }));
  const headers = { 'x-shopify-shop-domain': domain, 'x-shopify-topic': 'inventory_levels/update', 'x-shopify-webhook-id': 'fixture-delivery-1',
    'x-shopify-hmac-sha256': createHmac('sha256', env.SHOPIFY_CLIENT_SECRET).update(body).digest('base64') };
  check(runtime.acceptWebhook(body, { ...headers, 'x-shopify-hmac-sha256': 'A'.repeat(43) + '=' }).status === 401, 'El receptor rechaza firmas HMAC incorrectas');
  check(runtime.acceptWebhook(body, { ...headers, 'x-shopify-shop-domain': 'other.myshopify.com' }).status === 401, 'El receptor rechaza eventos de una tienda diferente');
  check(runtime.acceptWebhook(body, headers).accepted && timeouts.length === 1, 'Un evento verificado encola una lectura sin bloquear la respuesta');
  check(runtime.acceptWebhook(body, headers).duplicate === true && timeouts.length === 1, 'Una entrega repetida no genera trabajos duplicados');
  const beforeWebhook = readCalls; timeouts[0](); await runtime.syncNow();
  check(readCalls > beforeWebhook, 'La cola de webhooks ejecuta una nueva lectura real a través del lector');
  runtime.stop();
  restarted = createShopifyInventoryRuntime({ projectRoot: directory, env, fetchImpl, now: () => clock, timers, sleep: async () => {} });
  await restarted.initialize();
  check(restarted.getStatus().isStale && !restarted.getStatus().liveVerified, 'Reiniciar requiere una nueva verificación en vivo aunque exista caché reciente');
  restarted.start(); await restarted.syncNow();
  check(restarted.acceptWebhook(body, headers).duplicate === true, 'El control de duplicados se conserva después de reiniciar');
  check(JSON.stringify(restarted.getStatus()).includes('fixture-client-secret') === false, 'El estado de sincronización solo contiene metadatos públicos');
  assert.deepEqual(mutations, []); passed++;
  const getToken = createShopifyTokenProvider({ domain, clientId: 'fixture-client', clientSecret: 'fixture-client-secret', now: () => clock,
    fetchImpl: async () => response({ access_token: 'fixture-token', expires_in: 3600, scope: 'read_products' }) });
  await assert.rejects(getToken(), (error: any) => error.code === 'MISSING_SCOPES'); passed++;
  let managedClock = clock, tokenExchanges = 0;
  const managed = createShopifyTokenProvider({ domain, clientId: 'fixture-client', clientSecret: 'fixture-client-secret', accessToken: ' ', now: () => managedClock,
    fetchImpl: async () => response({ access_token: `fixture-managed-${++tokenExchanges}`, expires_in: 120, scope: 'read_products,read_inventory,read_locations' }) });
  const concurrent = await Promise.all([managed(), managed(), managed()]);
  check(tokenExchanges === 1 && concurrent.every(token => token === concurrent[0]), 'Peticiones simultáneas comparten un único intercambio de autorización');
  managedClock += 61000;
  const renewed = await managed();
  check(tokenExchanges === 2 && renewed !== concurrent[0] && managed.canRenew, 'Las credenciales propias renuevan el token antes del vencimiento');
  restarted.stop();
  check(!restarted.getStatus().automaticSync && !restarted.getStatus().nextSyncAt, 'Detener el runtime cancela la programación anunciada');
  console.log(`${passed} comprobaciones del runtime Shopify aprobadas.`);
} finally {
  runtime?.stop(); restarted?.stop();
  const relative = path.relative(testParent, directory);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Ruta de prueba fuera del directorio previsto');
  await rm(directory, { recursive: true, force: true });
}
