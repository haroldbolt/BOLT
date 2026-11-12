import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

async function freePort() { const s = net.createServer(); s.listen(0, '127.0.0.1'); await once(s, 'listening'); const p = s.address().port; s.close(); await once(s, 'close'); return p; }
const volume = fs.mkdtempSync(path.join(os.tmpdir(), 'bolt-hosted-demo-test-'));
const port = await freePort(), upstream = await freePort(), origin = `http://127.0.0.1:${port}`;
const password = crypto.randomBytes(24).toString('hex');
let child, cookie = '', admin = '', output = '';
async function start() {
  child = spawn(process.execPath, ['deployment/start-demo.mjs', '--local-test'], { cwd: process.cwd(), env: { ...process.env, NODE_ENV: 'test', PORT: String(port), BOLT_DEMO_INTERNAL_PORT: String(upstream), BOLT_DEMO_PUBLIC_ORIGIN: origin, BOLT_DEMO_PASSWORD: password, BOLT_DEMO_VOLUME: volume, BOLT_PHOTO_SEARCH_ENABLED: 'true', BOLT_PHOTO_SEARCH_OPENAI_API_KEY: 'local-test-placeholder' }, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', b => output += b); child.stderr.on('data', b => output += b);
  for (let i = 0; i < 200; i++) {
    if (child.exitCode !== null) throw Error('Demo exited: ' + output);
    try { if ((await fetch(origin + '/__demo/health')).ok) return; } catch {}
    await new Promise(r => setTimeout(r, 100));
  }
  throw Error('Demo did not start: ' + output);
}
async function stop() { if (child && child.exitCode === null) { child.kill('SIGTERM'); await once(child, 'exit'); } }
async function call(p, method = 'GET', body, token = admin, expected = 200) {
  const response = await fetch(origin + '/api/v1' + p, { method, headers: { Cookie: cookie, Origin: origin, 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const json = await response.json(); assert.equal(response.status, expected, p + ': ' + JSON.stringify(json)); return json;
}
try {
  await start();
  assert.equal((await fetch(origin + '/api/v1/simulation')).status, 401);
  assert.equal((await fetch(origin + '/api/v1/catalog/photo-search/status')).status, 401);
  const login = await fetch(origin + '/__demo/login', { method: 'POST', redirect: 'manual', headers: { Origin: origin }, body: new URLSearchParams({ password }) });
  assert.equal(login.status, 303); cookie = login.headers.get('set-cookie').split(';')[0];
  assert.deepEqual(await call('/catalog/photo-search/status', 'GET', undefined, ''), { enabled: true });
  const accounts=await fetch(origin+'/api/customer/config',{headers:{Cookie:cookie}}).then(r=>r.json());
  assert.equal(accounts.configured,false);assert.equal(accounts.email,false);assert.equal(accounts.google,false);assert.equal(accounts.apple,false);
  assert.equal((await fetch(origin+'/api/customer/me',{headers:{Cookie:cookie}}).then(r=>r.json())).user,null);
  assert.equal((await fetch(origin+'/cuenta',{headers:{Cookie:cookie}})).status,200);
  const info = await call('/simulation', 'GET', undefined, '');
  await call('/admin/dispatch', 'GET', undefined, '', 401);
  admin = (await call('/auth/login', 'POST', info.admin, '')).token;
  const historical = await call('/orders');
  assert.equal(historical.length, 3); assert.equal(historical.find(o => o.id === 'HIST-CLOSED').fulfillmentStatus, 'ENTREGADO');
  await call('/admin/simulation/fleet', 'POST', { count: 2 });
  const requestId = crypto.randomUUID();
  const purchase = await call('/admin/simulation/purchases', 'POST', { requestId });
  assert.equal(purchase.order.childShipments.length, 2);
  const retry = await call('/admin/simulation/purchases', 'POST', { requestId });
  assert.equal(purchase.order.id, retry.order.id);
  const codes = purchase.order.childShipments.map(s => s.shipmentId);
  const id = crypto.randomUUID(), secret = crypto.randomBytes(32).toString('hex');
  await call('/tracking-recovery', 'POST', { id, secret, reference: 'HIST-CLOSED' }, '');
  await call('/admin/dispatch/recoveries/' + id + '/approve', 'POST', { method: 'IN_PERSON_DOCUMENT_REVIEW', evidenceReference: 'CASE-demo-isolated-test', verifiedOwner: true });
  const recovered = await call('/tracking-recovery/status', 'POST', { id, secret }, '');
  assert.ok(recovered.guestAccessToken);
  assert.equal((await call('/orders/HIST-CLOSED')).fulfillmentStatus, 'ENTREGADO');
  await stop(); await start();
  // Gateway cookie, simulator credentials, all data, codes and closed state survive a restart.
  const restored = await call('/simulation', 'GET', undefined, '');
  assert.deepEqual(restored.admin, info.admin);
  admin = (await call('/auth/login', 'POST', restored.admin, '')).token;
  const saved = await call('/orders/' + purchase.order.id);
  assert.deepEqual(saved.childShipments.map(s => s.shipmentId), codes);
  assert.equal((await call('/orders')).length, 4);
  assert.equal((await call('/orders/HIST-CLOSED')).fulfillmentStatus, 'ENTREGADO');
  assert.equal((await call('/tracking-recovery/status', 'POST', { id, secret }, '')).status, 'APPROVED');
  console.log('PASS: isolated durable runtime, anonymous/admin permission separation, 3 historical fixtures, 2 deliveries, idempotent purchase, private recovery without reopening, restart preserving cookie/data/codes.');
} finally { await stop(); fs.rmSync(volume, { recursive: true, force: true }); }
