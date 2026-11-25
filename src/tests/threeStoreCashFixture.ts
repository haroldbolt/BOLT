import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { WAREHOUSES } from '../data/warehouseConfig';
import { FulfillmentStorage } from '../lib/fulfillmentStorage';
import { newDispatchState } from '../types/dispatch';
import { fixtureConfig, fixtureDrivers, fixtureProduct } from './transportFixtures';

export const testSku = 'RDI-EFECTIVO-1KG';
export const testPrice = 59_000;
export const testStock = 8;
const storeIds = ['HUB_ALAMOS', 'HUB_KENNEDY', 'HUB_SUBA'];
export const testStores = storeIds.map(id => {
  const warehouse = WAREHOUSES.find(store => store.id === id)!;
  const { address, coordinates } = warehouse;
  return { id, destination: { address, coordinates, municipality: 'Bogotá' } };
});
const source = fileURLToPath(new URL('../../', import.meta.url));
type RequestOptions = { method?: string; body?: unknown; token?: string; key?: string; guest?: string; status?: number };

/** Empty temporary installation using the Express checkout and real auth, without demo orders or dispatch shortcuts. */
export async function createThreeStoreCashFixture(options: { respondAsCargo?: boolean; ownFleetOnly?: boolean } = {}) {
  const socket = net.createServer();
  socket.listen(0, '127.0.0.1');
  await once(socket, 'listening');
  const port = (socket.address() as net.AddressInfo).port;
  await new Promise<void>(resolve => socket.close(() => resolve()));
  const origin = 'http://127.0.0.1:' + port;
  const runtime = fs.mkdtempSync(path.join(os.tmpdir(), 'bolt-rdi-checkout-'));
  const privateDir = path.join(runtime, '.bolt-private');
  const dataDir = path.join(privateDir, 'orders');
  const localData = path.join(runtime, 'src/data');
  const egressLog = path.join(runtime, 'egress.log');
  const cargoLog = path.join(runtime, 'cargo-fixture.log');
  const adminCredentials = { email: 'coordination@rdi.invalid', password: randomUUID() };
  let child: ChildProcess | undefined;

  async function request<T>(route: string, options: RequestOptions = {}): Promise<T> {
    assert.ok(route.startsWith('/') && !route.startsWith('//'));
    const method = options.method ?? (options.body === undefined ? 'GET' : 'POST');
    const response = await fetch(origin + '/api/v1' + route, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(options.token && { Authorization: 'Bearer ' + options.token }),
        ...(options.guest && { 'X-Order-Token': options.guest }),
        ...(options.key && { 'Idempotency-Key': options.key }),
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
    });
    const result = await response.json();
    assert.equal(response.status, options.status ?? 200, [method, route, result.code, result.error].filter(Boolean).join(' '));
    return result as T;
  }

  async function stop() {
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    const stopped = once(child, 'exit');
    child.kill('SIGTERM');
    await stopped;
  }

  async function start(checkoutEnabled: boolean) {
    assert.ok(!child || child.exitCode !== null || child.signalCode !== null);
    let startupLog = '';
    const fakeSites = Object.fromEntries(storeIds.map(storeId => [storeId, {
      pickingPointId: 'FIXTURE-' + storeId, vehicleType: 'BIKE', maxLoadGrams: 55_000,
      packagingGrams: 500, maxVolumeCm3: 288_000, cargoDimensionsCm: [80, 60, 60],
    }]));
    child = spawn(process.execPath, ['--import', path.join(source, 'src/tests/threeStoreCashNetworkGuard.mjs'),
      '--import', 'tsx', path.join(source, 'server.ts')], {
      cwd: runtime,
      env: {
        PATH: process.env.PATH, NODE_ENV: 'production', BOLT_BIND_LOOPBACK_ONLY: '1', PORT: String(port),
        BOLT_DATA_DIR: dataDir, BOLT_TEST_EGRESS_LOG: egressLog, BOLT_PILOT_STORE_IDS: storeIds.join(','),
        ...(options.respondAsCargo && { BOLT_TEST_CARGO_LOG: cargoLog }),
        BOLT_ADMIN_EMAIL: adminCredentials.email, BOLT_ADMIN_PASSWORD: adminCredentials.password,
        ...(options.ownFleetOnly && { BOLT_PILOT_OWN_FLEET_ONLY: '1' }),
        ...(checkoutEnabled && { BOLT_PILOT_CHECKOUT_ENABLED: '1' }),
        ...(checkoutEnabled && !options.ownFleetOnly ? {
          BOLT_RAPPI_CARGO_ENABLED: '1', BOLT_RAPPI_CARGO_USER_TOKEN: randomUUID(),
          BOLT_RAPPI_CARGO_SETTINGS: JSON.stringify({ cashCollectionApproved: true,
            cashApprovalReference: 'FICTICIO-SOLO-PRUEBA-LOCAL', maxCashCOP: 200_000, externalBudgetCOP: 20_000, sites: fakeSites }),
        } : {}),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout?.on('data', chunk => { startupLog += chunk; });
    child.stderr?.on('data', chunk => { startupLog += chunk; });
    for (let attempt = 0; attempt < 150; attempt++) {
      if (child.exitCode !== null || child.signalCode !== null) throw Error('Servidor local interrumpido. ' + startupLog);
      const healthy = await fetch(origin + '/api/v1/health', { signal: AbortSignal.timeout(500) }).then(r => r.ok, () => false);
      if (healthy) return;
      await delay(80);
    }
    throw Error('No inició la instalación temporal de BOLT. ' + startupLog);
  }

  const login = async () => (await request<{ token: string }>('/auth/login', { body: adminCredentials })).token;
  async function registerFleet(admin: string) {
    const tokens = new Map<string, string>();
    for (const store of testStores) {
      const driver = fixtureDrivers.find(d => d.id === 'SIM-' + store.id + '-1')!;
      const credentials = { email: store.id.toLowerCase() + '@rdi.invalid', password: randomUUID() };
      await request('/admin/dispatch/drivers', { token: admin, body: { driver, ...credentials, storeIds: [store.id] } });
      const { token } = await request<{token: string}>('/driver/auth/login', { body: credentials });
      await request('/driver/shift', { token, body: { action: 'START' } });
      const { lat, lng } = store.destination.coordinates;
      await request('/driver/location', { token, body: { latitude: lat, longitude: lng, accuracy: 8, timestamp: Date.now() } });
      tokens.set(store.id, token);
    }
    return tokens;
  }

  function cargoCalls(): { operation: string; reference?: string }[] {
    return fs.existsSync(cargoLog) ? fs.readFileSync(cargoLog, 'utf8').trim().split('\n').map(line => JSON.parse(line)) : [];
  }
  function verifyNoEgress() { assert.equal(fs.existsSync(egressLog), false, 'Hubo un intento de usar un servicio de red externo.'); }
  async function dispose() { try { await stop(); verifyNoEgress(); } finally { fs.rmSync(runtime, { recursive: true, force: true }); } }
  try {
    fs.mkdirSync(localData, { recursive: true });
    for (const folder of ['catalogo-local', 'geography']) fs.symlinkSync(path.join(source, 'src/data', folder), path.join(localData, folder), 'dir');
    fs.symlinkSync(fs.realpathSync(path.join(source, 'node_modules')), path.join(runtime, 'node_modules'), 'dir');
    new FulfillmentStorage(dataDir).commit({ orders: [], drivers: [], audit: [], telemetry: {}, dispatch: newDispatchState() });
    const config = fixtureConfig();
    config.vehicles = config.vehicles.filter(v => storeIds.some(id => v.driverId === 'SIM-' + id + '-1'));
    fs.writeFileSync(path.join(privateDir, 'transport-config.json'), JSON.stringify({ config, revision: 'rdi-fixture-only', audit: [] }));
    const product = {
      ...fixtureProduct(testSku, 1_000), name: 'Alimento de prueba RDI', price: testPrice, bodegaIds: storeIds,
      stockByStore: Object.fromEntries(storeIds.map(id => [id, testStock])),
    };
    fs.writeFileSync(path.join(localData, 'persisted-catalog-overrides.json'), JSON.stringify({ version: 1, overrides: {}, customProducts: [product] }));
    return { origin, adminCredentials, start, stop, request, login, registerFleet, cargoCalls, verifyNoEgress, dispose };
  } catch (error) { await dispose(); throw error; }
}
