import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, type TestContext } from 'node:test';
import { preparePilot } from './start-pilot';
import { FulfillmentStorage } from '../src/lib/fulfillmentStorage';

function fixture(t: TestContext) {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'bolt-pilot-test-'));
  t.after(() => fs.rmSync(sandbox, { recursive: true, force: true }));
  const source = path.join(sandbox, 'code');
  const volume = path.join(sandbox, 'volume');
  fs.mkdirSync(path.join(source, 'dist'), { recursive: true });
  fs.mkdirSync(path.join(source, 'src/data/catalogo-local'), { recursive: true });
  fs.mkdirSync(path.join(source, 'src/data/geography'), { recursive: true });
  fs.writeFileSync(path.join(source, 'dist/index.html'), '<!DOCTYPE html>');
  fs.writeFileSync(path.join(source, 'server.js'), '');
  fs.copyFileSync(path.join(import.meta.dirname, '../storage-contract.json'), path.join(source, 'storage-contract.json'));
  fs.mkdirSync(volume);
  return {
    source,
    volume,
    env: {
      BOLT_PILOT_STORE_ID: 'HUB_SUBA',
      BOLT_PILOT_VOLUME: volume,
      BOLT_ADMIN_SETUP_TOKEN: randomBytes(32).toString('hex'),
    },
  };
}

test('piloto de Suba arranca sin semillas y conserva los datos tras un reinicio', t => {
  const { source, env } = fixture(t);
  const first = preparePilot(source, env);
  const storage = new FulfillmentStorage(first.data);
  const initial = storage.read();
  assert.equal(initial.version, 2);
  assert.deepEqual(initial.orders, []);
  assert.deepEqual(initial.drivers, []);
  assert.deepEqual(initial.dispatch.runs, {});
  assert.deepEqual(initial.telemetry, {});
  assert.equal(fs.realpathSync(path.join(first.runtime, 'src/data/geography')), fs.realpathSync(path.join(source, 'src/data/geography')));
  assert.throws(() => preparePilot(source, env), /bloqueo de escritura/);
  const adminPath = path.join(first.runtime, 'src/data/persisted-admin-auth.json');
  const upload = path.join(first.runtime, 'public/uploads/operacion.png');
  const transport = path.join(first.runtime, '.bolt-private/transport-config.json');
  const persistedAdmin = { version: '1.0.0', admins: [{ email: 'pilot@example.invalid', passwordHash: 'fixture', salt: 'fixture', role: 'ADMINISTRADOR' }] };
  fs.writeFileSync(adminPath, JSON.stringify(persistedAdmin));
  fs.writeFileSync(upload, 'fixture-de-archivo');
  fs.writeFileSync(transport, '{}');
  first.release();
  const second = preparePilot(source, { ...env, BOLT_ADMIN_SETUP_TOKEN: undefined });
  assert.deepEqual(storage.read(), initial);
  assert.deepEqual(JSON.parse(fs.readFileSync(adminPath, 'utf8')), persistedAdmin);
  assert.equal(fs.readFileSync(upload, 'utf8'), 'fixture-de-archivo');
  assert.equal(fs.readFileSync(transport, 'utf8'), '{}');
  second.release();
});

test('volumen faltante, modo demo y arranque de Railway sin montaje fallan antes de crear datos', t => {
  const { source, volume, env } = fixture(t);
  assert.throws(() => preparePilot(source, { ...env, BOLT_PILOT_STORE_ID: undefined }), /HUB_SUBA/);
  assert.throws(() => preparePilot(source, { ...env, BOLT_PILOT_VOLUME: undefined }), /BOLT_PILOT_VOLUME/);
  assert.throws(() => preparePilot(source, { ...env, BOLT_PILOT_VOLUME: source }), /volumen operativo/);
  assert.throws(() => preparePilot(source, { ...env, BOLT_DISPATCH_SIMULATION: '1' }), /servicio independiente/);
  assert.throws(() => preparePilot(source, { ...env, RAILWAY_PROJECT_ID: 'fixture' }), /volumen montado/);
  assert.throws(() => preparePilot(source, { ...env, BOLT_ADMIN_SETUP_TOKEN: undefined }), /BOLT_ADMIN_SETUP_TOKEN/);
  assert.deepEqual(fs.readdirSync(volume), []);
  fs.mkdirSync(path.join(volume, 'bolt-dispatch-simulation-meeting'));
  assert.throws(() => preparePilot(source, env), /instalación de simulación/);
  assert(!fs.existsSync(path.join(volume, 'bolt-piloto-suba')));
});

test('un volumen ya inicializado falla si falta el almacenamiento de pedidos', t => {
  const { source, env } = fixture(t);
  const first = preparePilot(source, env);
  const storage = new FulfillmentStorage(first.data);
  fs.unlinkSync(storage.file);
  first.release();
  assert.throws(() => preparePilot(source, env), /almacenamiento operativo v2/);
  assert(!fs.existsSync(storage.file));
});

test('un volumen común inicia las tres sedes, rechaza mezclas y conserva el esquema', t => {
  const { source, volume, env } = fixture(t);
  const unified = { ...env, BOLT_PILOT_STORE_ID: undefined, BOLT_PILOT_STORE_IDS: 'HUB_SUBA,HUB_KENNEDY,HUB_ALAMOS' };
  assert.throws(() => preparePilot(source, { ...unified, BOLT_PILOT_STORE_IDS: 'HUB_SUBA,HUB_SUBA,HUB_ALAMOS' }), /HUB_KENNEDY/);
  assert.throws(() => preparePilot(source, { ...unified, BOLT_PILOT_STORE_ID: 'HUB_SUBA' }), /sola variable/);
  assert.deepEqual(fs.readdirSync(volume), []);
  const first = preparePilot(source, unified);
  assert.equal(first.runtime, path.join(fs.realpathSync(volume), 'bolt-operacion'));
  const marker = JSON.parse(fs.readFileSync(path.join(first.runtime, '.bolt-private/pilot.json'), 'utf8'));
  assert.deepEqual(marker.storeIds, ['HUB_ALAMOS', 'HUB_KENNEDY', 'HUB_SUBA']);
  assert.deepEqual(new FulfillmentStorage(first.data).read().orders, []);
  first.release();
  assert.throws(() => preparePilot(source, env), /alcance operativo diferente/);
  const restarted = preparePilot(source, { ...unified, BOLT_PILOT_STORE_IDS: 'HUB_ALAMOS,HUB_SUBA,HUB_KENNEDY' });
  assert.equal(restarted.data, first.data);
  restarted.release();
});
