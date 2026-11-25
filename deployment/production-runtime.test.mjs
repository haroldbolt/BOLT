import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';

import { adminBootstrapFixture, establishFixtureAdmin } from '../src/tests/adminBootstrapFixture.mjs';

const source = path.resolve(import.meta.dirname, '..');

test('built server starts twice with the pilot launcher, durable files and no simulated orders', { timeout: 60000 }, async t => {
  const volume = await fs.mkdtemp(path.join(os.tmpdir(), 'bolt-production-smoke-'));
  await fs.access(path.join(source, 'server.js'));
  const socket = net.createServer();
  socket.listen(0, '127.0.0.1');
  await once(socket, 'listening');
  const { port } = socket.address();
  socket.close();
  await once(socket, 'close');
  const origin = 'http://127.0.0.1:' + port;
  const get = name => fetch(origin + name, { signal: AbortSignal.timeout(3000) });
  const runtime = path.join(volume, 'bolt-operacion');
  const adminEmail = randomUUID() + '@example.invalid';
  const password = randomBytes(32).toString('hex');
  const bootstrap = adminBootstrapFixture(volume, adminEmail, runtime);
  t.after(bootstrap.dispose);
  const env = {
    ...bootstrap.env,
    PATH: process.env.PATH, NODE_ENV: 'production', PORT: String(port),
    BOLT_PILOT_VOLUME: volume, BOLT_PILOT_STORE_IDS: 'HUB_ALAMOS,HUB_KENNEDY,HUB_SUBA',
    BOLT_BIND_LOOPBACK_ONLY: '1',
  };
  let child;
  async function stop() {
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    const ended = once(child, 'close');
    child.kill('SIGTERM');
    const [exitCode] = await ended;
    assert.equal(exitCode, 0);
  }
  t.after(async () => {
    try { await stop(); } finally { await fs.rm(volume, { recursive: true, force: true }); }
  });
  const fixture = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jksQAAAAASUVORK5CYII=', 'base64');
  let persisted;
  for (let run = 0; run < 2; run++) {
    child = spawn(process.execPath, ['--import', 'tsx', 'deployment/start-pilot.ts'], { cwd: source, env, stdio: 'ignore' });
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      if (child.exitCode !== null || child.signalCode !== null) throw Error('El proceso de BOLT terminó antes de estar disponible.');
      try { ready = (await get('/api/v1/health')).ok; } catch {}
      if (ready) break;
      await delay(100);
    }
    assert.ok(ready);
    await promisify(execFile)(process.execPath, ['deployment/check-pilot.mjs', origin], {cwd: source, env});
    assert.equal((await (await get('/api/customer/config')).json()).configured, false);
    assert.ok((await (await get('/api/v1/catalog')).json()).length > 0);
    assert.equal((await get('/api/v1/orders')).status, 401);
    assert.match(await (await get('/')).text(), /<html/);
    assert.match(await (await get('/admin/nuevo/')).text(), /BOLT Admin/);
    if (!run) {
      assert.equal((await (await get('/api/v1/auth/status')).json()).setupState, 'open');
      await establishFixtureAdmin(origin, adminEmail, password, bootstrap.env.BOLT_ADMIN_SETUP_TOKEN);
      delete env.BOLT_ADMIN_SETUP_TOKEN;
      const images = path.join(runtime, 'public/uploads/catalog');
      await fs.mkdir(images, { recursive: true });
      await fs.writeFile(path.join(images, 'fixture.png'), fixture);
    }
    assert.equal((await (await get('/api/v1/auth/status')).json()).setupState, 'closed');
    const image = await get('/uploads/catalog/fixture.png');
    assert.equal(image.headers.get('content-type'), 'image/png');
    assert.deepEqual(Buffer.from(await image.arrayBuffer()), fixture);
    const snapshot = await fs.readFile(path.join(runtime, '.bolt-private/orders/persisted-fulfillment.json'), 'utf8');
    const { orders, drivers, dispatch } = JSON.parse(snapshot);
    assert.deepEqual(orders, []);
    assert.deepEqual(drivers, []);
    assert.deepEqual(dispatch.runs, {});
    if (run) assert.equal(snapshot, persisted);
    persisted = snapshot;
    await stop();
  }
});
