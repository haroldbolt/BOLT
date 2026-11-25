import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, type TestContext } from 'node:test';
import { isPersistentMount, preparePilot } from './start-pilot';
import { FulfillmentStorage } from '../src/lib/fulfillmentStorage';

import { AdminAuthService } from '../src/lib/adminAuthService';
import { ADMIN_VOLUME_MARKER } from '../src/lib/adminBootstrap';
import { adminBootstrapFixture } from '../src/tests/adminBootstrapFixture.mjs';

function fixture(t: TestContext, directory = 'bolt-piloto-suba') {
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
  fs.mkdirSync(volume, { mode: 0o700 });
  const owner = { email: randomUUID() + '@example.invalid', password: randomBytes(32).toString('hex'), name: 'Coordinación de prueba' };
  const bootstrap = adminBootstrapFixture(volume, owner.email, path.join(volume, directory));
  t.after(bootstrap.dispose);
  return {
    source,
    volume, owner,
    env: {
      ...bootstrap.env,
      BOLT_PILOT_STORE_ID: 'HUB_SUBA',
      BOLT_PILOT_VOLUME: volume,
    },
  };
}

test('piloto de Suba arranca sin semillas y conserva los datos tras un reinicio', t => {
  const { source, owner, env } = fixture(t);
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
  const admin = new AdminAuthService(adminPath, { mode: 'managed', env });
  assert.equal(admin.setupState(), 'open');
  assert.equal(admin.setupMasterAdmin(owner).success, true);
  assert.equal(admin.setupState(), 'closed');
  const persistedAdmin = fs.readFileSync(adminPath);
  fs.writeFileSync(upload, 'fixture-de-archivo');
  fs.writeFileSync(transport, '{}');
  first.release();
  const second = preparePilot(source, { ...env, BOLT_ADMIN_SETUP_TOKEN: undefined });
  assert.deepEqual(storage.read(), initial);
  assert.ok(fs.readFileSync(adminPath).equals(persistedAdmin));
  const accounts = new AdminAuthService(adminPath, { mode: 'managed', env });
  assert.equal(accounts.setupState(), 'closed');
  assert.equal(accounts.login(owner.email, owner.password).success, true);
  assert.equal(accounts.setupMasterAdmin(owner).success, false);
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
  assert.deepEqual(fs.readdirSync(volume), [ADMIN_VOLUME_MARKER]);
  fs.mkdirSync(path.join(volume, 'bolt-dispatch-simulation-meeting'));
  assert.throws(() => preparePilot(source, env), /instalación de simulación/);
  assert(!fs.existsSync(path.join(volume, 'bolt-piloto-suba')));
});

test('una instalación con el alta consumida exige recuperación si su volumen se reemplaza', t => {
  const { source, env, volume, owner } = fixture(t);
  const first = preparePilot(source, env);
  const file = path.join(first.runtime, 'src/data/persisted-admin-auth.json');
  const service = new AdminAuthService(file, { mode: 'managed', env });
  assert.equal(service.setupMasterAdmin(owner).success, true);
  first.release();

  const original = volume + '-original';
  fs.renameSync(volume, original);
  fs.mkdirSync(volume, { mode: 0o700 });
  assert.throws(() => preparePilot(source, {
    ...env, BOLT_ADMIN_EMAIL: owner.email, BOLT_ADMIN_PASSWORD: owner.password,
  }), /recupera la instalación/i);
  assert.deepEqual(fs.readdirSync(volume), []);
  fs.rmdirSync(volume);
  fs.renameSync(original, volume);
  const restored = preparePilot(source, env);
  assert.equal(new AdminAuthService(file, { mode: 'managed', env }).setupState(), 'closed');
  restored.release();
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

test('producción distingue un volumen montado de archivos efímeros, de solo lectura o un volumen histórico', t => {
  const line = '123 99 8:1 / /var/data rw,relatime - ext4 /dev/sdb rw';
  assert.ok(isPersistentMount('/var/data', line));
  assert.ok(!isPersistentMount('/var', line));
  assert.ok(!isPersistentMount('/var/data', line.replace('rw,relatime', 'ro,relatime')));
  assert.ok(!isPersistentMount('/var/data', line.replace('ext4', 'tmpfs')));
  assert.ok(!isPersistentMount('/var/data', line.replace('ext4', 'fuse.gcsfuse')));
  const { source, volume, env } = fixture(t);
  fs.mkdirSync(path.join(volume, 'previous-instance'));
  assert.throws(() => preparePilot(source, env), /datos previos/);
  assert.deepEqual(fs.readdirSync(volume), [ADMIN_VOLUME_MARKER, 'previous-instance']);
});

test('un volumen común inicia las tres sedes, rechaza mezclas y conserva el esquema', t => {
  const { source, volume, owner, env } = fixture(t, 'bolt-operacion');
  const unified = { ...env, BOLT_PILOT_STORE_ID: undefined, BOLT_PILOT_STORE_IDS: 'HUB_SUBA,HUB_KENNEDY,HUB_ALAMOS' };
  assert.throws(() => preparePilot(source, { ...unified, BOLT_PILOT_STORE_IDS: 'HUB_SUBA,HUB_SUBA,HUB_ALAMOS' }), /HUB_KENNEDY/);
  assert.throws(() => preparePilot(source, { ...unified, BOLT_PILOT_STORE_ID: 'HUB_SUBA' }), /sola variable/);
  assert.deepEqual(fs.readdirSync(volume), [ADMIN_VOLUME_MARKER]);
  const first = preparePilot(source, unified);
  assert.equal(first.runtime, path.join(fs.realpathSync(volume), 'bolt-operacion'));
  const marker = JSON.parse(fs.readFileSync(path.join(first.runtime, '.bolt-private/pilot.json'), 'utf8'));
  assert.deepEqual(marker.storeIds, ['HUB_ALAMOS', 'HUB_KENNEDY', 'HUB_SUBA']);
  const storage = new FulfillmentStorage(first.data);
  assert.deepEqual(storage.read().orders, []);
  assert.throws(() => preparePilot(source, unified), /bloqueo de escritura/);
  const adminFile = path.join(first.runtime, 'src/data/persisted-admin-auth.json');
  const accounts = new AdminAuthService(adminFile, { mode: 'managed', env: unified });
  assert.equal(accounts.setupMasterAdmin(owner).success, true);
  for (const storeId of marker.storeIds) {
    accounts.createStoreOperator(randomUUID() + '@example.invalid', 'Operador de prueba', randomBytes(32).toString('hex'), storeId);
  }
  const rawAccounts = fs.readFileSync(adminFile);
  assert.deepEqual(JSON.parse(rawAccounts.toString()).admins.filter((a: {role: string}) => a.role === 'OPERADOR_SEDE')
    .map((a: {storeId: string}) => a.storeId).sort(), marker.storeIds);
  first.release();
  assert.throws(() => preparePilot(source, env), /alcance operativo diferente/);
  const restarted = preparePilot(source, { ...unified, BOLT_ADMIN_SETUP_TOKEN: undefined, BOLT_PILOT_STORE_IDS: 'HUB_ALAMOS,HUB_SUBA,HUB_KENNEDY' });
  assert.equal(restarted.data, first.data);
  assert.ok(fs.readFileSync(adminFile).equals(rawAccounts));
  restarted.release();
});

test('un volumen histórico de Suba se preserva al intentar arrancar las tres sedes', t => {
  const { source, env, volume } = fixture(t);
  const legacy = preparePilot(source, env);
  legacy.release();
  const storageFile = new FulfillmentStorage(legacy.data).file;
  const before = fs.readFileSync(storageFile);
  assert.throws(() => preparePilot(source, {
    ...env, BOLT_PILOT_STORE_ID: undefined, BOLT_PILOT_STORE_IDS: 'HUB_ALAMOS,HUB_KENNEDY,HUB_SUBA',
  }), /alcance operativo diferente/);
  assert.deepEqual(fs.readFileSync(storageFile), before);
  assert.deepEqual(fs.readdirSync(volume), [ADMIN_VOLUME_MARKER, 'bolt-piloto-suba']);
});
