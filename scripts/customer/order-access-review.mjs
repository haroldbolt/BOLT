/** Local review of six fixed fictional identities against BOLT's actual HTTP handlers. */
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LEGAL_VERSION } from '../../src/customer/legal.ts';

const source = fileURLToPath(new URL('../../', import.meta.url));
const loopback = '127.0.0.1';
process.umask(0o077);
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'bolt-review-orders-'));
const runtime = path.join(temporary, 'bolt-dispatch-simulation-r2');
const checking = process.argv.includes('--check');
const portProbe = http.createServer();
portProbe.listen(0, loopback);
await once(portProbe, 'listening');
const port = portProbe.address().port;
await new Promise(resolve => portProbe.close(resolve));
const origin = 'http://' + loopback + ':' + port;
// Start with an empty isolated warehouse instead of the unrelated historical-custody fixtures.
execFileSync(process.execPath, ['--import', 'tsx', 'scripts/dispatch-simulation.ts', runtime], { cwd: source, stdio:'pipe' });
const child = spawn(process.execPath, ['--import', 'tsx', 'scripts/customer/browser-review.ts', runtime], {
  cwd: source, stdio: 'ignore', env: { PATH: process.env.PATH, TMPDIR: os.tmpdir(), BOLT_CUSTOMER_REVIEW_PORT: String(port) },
});
const stopped = once(child, 'exit');
let review;
async function close() {
  review?.close();
  if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
  await stopped;
  fs.rmSync(temporary, { recursive: true, force: true });
}
function browser() {
  const cookies = new Map();
  let bearer;
  return {
    setToken(value) { assert.ok(typeof value === 'string' && value.length); bearer = value; },
    async request(route, body, extra = {}) {
      const response = await fetch(origin + route, {
        method: body === undefined ? 'GET' : 'POST', redirect: 'manual', signal: AbortSignal.timeout(10000),
        headers: { Origin: origin, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
          Cookie: [...cookies.values()].join('; '), ...(bearer && { Authorization: 'Bearer ' + bearer }), ...extra },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      for (const cookie of response.headers.getSetCookie()) {
        const pair = cookie.split(';')[0]; cookies.set(pair.split('=')[0], pair);
      }
      return { status: response.status, data: await response.json().catch(() => null) };
    },
  };
}
async function ok(client, route, body, headers) {
  const { data, status } = await client.request(route, body, headers);
  assert.ok(status >= 200 && status < 300, 'No se completó el paso de revisión ' + route.split('?')[0] + ' (HTTP ' + status + ', ' + (data?.code || data?.error?.message || (typeof data?.error === 'string' ? data.error : 'sin código')) + ')');
  return data;
}
async function createCustomer(suffix) {
  const client = browser(), email = 'revision-' + suffix + '@example.invalid', password = randomUUID();
  await ok(client, '/api/customer-auth/sign-up/email', { email, password, name: 'Cuenta de revisión ' + suffix.toUpperCase(),
    legalConsent: { version: LEGAL_VERSION, terms: true, privacy: true, marketing: false }, callbackURL: '/cuenta' });
  const mail = JSON.parse(fs.readFileSync(path.join(runtime, '.bolt-private/customer-mail.json'), 'utf8')).findLast(m => m.to === email);
  const link = new URL(mail.url);
  assert.equal(link.origin, origin);
  assert.equal((await client.request(link.pathname + link.search)).status, 302);
  await ok(client, '/api/customer-auth/sign-in/email', { email, password });
  assert.ok((await ok(client, '/api/customer/me')).user.emailVerified);
  return client;
}
async function purchase(client, label) {
  const address = { address: 'Carrera 107 #143-31, Bogotá — prueba aislada', municipality: 'Bogotá', locality: 'Suba',
    coordinates: { lat: 4.747154, lng: -74.098137 } };
  const items = [{ productId: 'SIM-FOOD-20KG', quantity: 1, price: 10000 }];
  const quote = await ok(client, '/api/v1/delivery/quote', { destination: address, items, requestedMode: 'TURBO' });
  assert.equal(quote.eligibilityStatus, 'ELIGIBLE', JSON.stringify({label, status:quote.eligibilityStatus, mode:quote.effectiveMode, planned:quote.recommendedMode, text:quote.message}));
  assert.ok(quote.confirmationToken, quote.reasonCode);
  await ok(client, '/api/v1/checkout/attempt', {});
  return ok(client, '/api/v1/orders', { items, deliveryAddress: address, deliveryMode: 'TURBO', storeId: 'HUB_SUBA',
    customer: { name: 'Revisión ' + label, email: label + '@example.invalid', phone: '0000000000' },
    confirmationToken: quote.confirmationToken, paymentMethod: 'CASH_ON_DELIVERY' }, { 'Idempotency-Key': randomUUID() });
}
function checkDenied(reply) {
  assert.ok(reply.status === 403 || reply.status === 404);
  assert.ok(reply.data && Object.keys(reply.data).every(k => ['code', 'error'].includes(k)));
}
async function prepare() {
  const admin = browser();
  let ready = false;
  for (let i = 0; i < 250; i++) {
    if (child.exitCode !== null) break;
    try { ready = (await admin.request('/api/customer/config')).status === 200; } catch {}
    if (ready) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(ready, 'No arrancó la instalación temporal.');
  const marker = JSON.parse(fs.readFileSync(path.join(runtime, '.bolt-private/dispatch-simulation.json'), 'utf8'));
  assert.equal(marker.kind, 'DISPATCH_SIMULATION');
  admin.setToken((await ok(admin, '/api/v1/auth/login', marker.admin)).token);
  await ok(admin, '/api/v1/admin/simulation/fleet', { count: 2 });
  const profiles = new Map();
  for (const type of ['cliente', 'invitado']) {
    for (const side of ['a', 'b']) {
      const key = type + '-' + side;
      const client = type === 'cliente' ? await createCustomer(side) : browser();
      // Review direct ownership and an assisted historical purchase already linked by its private receipt.
      const sample = key === 'cliente-a' ? null : await ok(admin, '/api/v1/admin/simulation/purchases', { requestId: randomUUID() });
      const order = sample ? { ...sample.order, guestAccessToken: sample.guestAccessToken } : await purchase(client, key);
      if (key === 'cliente-b') {
        const { user } = await ok(client, '/api/customer/me');
        await ok(client, '/api/customer/orders/' + order.id + '/link', {}, { 'X-Customer-Id': user.id, 'X-Order-Token': order.guestAccessToken });
      }
      if (type === 'invitado') assert.ok(order.guestAccessToken);
      const headers = type === 'invitado' ? { 'X-Order-Token': order.guestAccessToken } : {};
      profiles.set(key, { client, id: order.id, code: order.purchaseCode, type, headers });
    }
  }
  const drivers = [];
  for (const driver of marker.drivers) {
    const client = browser();
    client.setToken((await ok(client, '/api/v1/driver/auth/login', { email: driver.email, password: driver.password })).token);
    drivers.push(client);
  }
  // Assign the two parcels of a single guest purchase. Sharing a purchase never grants access to its sibling parcel.
  const split = profiles.get('invitado-a');
  const receipt = await ok(split.client, '/api/v1/orders/' + split.id, undefined, split.headers);
  assert.equal(receipt.childShipments.length, 2);
  for (const shipment of receipt.childShipments) {
    for (const status of ['EN_ALISTAMIENTO', 'LISTO_PARA_DESPACHO']) {
      await ok(admin, '/api/v1/operations/orders/' + split.id + '/status', { status, shipmentId: shipment.shipmentId });
    }
  }
  const view = await ok(admin, '/api/v1/admin/dispatch');
  for (const run of view.orders.find(o => o.id === split.id).dispatches) {
    await ok(admin, '/api/v1/admin/dispatch/' + run.id + '/search', {});
  }
  for (const [index, client] of drivers.entries()) {
    const { assignments } = await ok(client, '/api/v1/driver/assignments');
    assert.equal(assignments.length, 1, 'ofertas de la prueba: '+JSON.stringify((await ok(admin, '/api/v1/admin/dispatch')).orders.find(o=>o.id===split.id).dispatches.map(d=>({estado:d.status,reason:d.reason}))));
    const task = assignments[0];
    assert.equal(task.orderId, split.id);
    await ok(client, '/api/v1/driver/assignments/' + task.dispatchId + '/accept', { offerId: task.offer.id });
    profiles.set('conductor-' + ['a','b'][index], { client, id: task.dispatchId, code: task.dispatchCode, type: 'conductor', headers: {} });
  }
  assert.notEqual(profiles.get('conductor-a').id, profiles.get('conductor-b').id);
  async function checkProfile(key, own) {
    const profile = profiles.get(key), other = profiles.get(key.slice(0, -1) + (key.endsWith('a') ? 'b' : 'a'));
    const target = own ? profile : other;
    const { type, client, headers } = profile;
    const prefix = type === 'conductor' ? '/api/v1/driver/assignments/' : '/api/v1/orders/';
    const detail = await client.request(prefix + target.id, undefined, headers);
    let list;
    if (type === 'cliente') {
      const history = await ok(client, '/api/customer/orders');
      assert.deepEqual(history.map(order => order.id), [profile.id]); list = history.map(order => order.purchaseCode);
    } else if (type === 'conductor') {
      const { assignments } = await ok(client, '/api/v1/driver/assignments');
      assert.deepEqual(assignments.map(task => task.dispatchId), [profile.id]); list = assignments.map(task => task.dispatchCode);
    }
    if (type !== 'conductor') {
      const track = await client.request('/api/v1/orders/' + target.id + '/tracking', undefined, headers);
      if (own) { assert.equal(track.status, 200); assert.equal(track.data.orderId, profile.id); }
      else checkDenied(track);
    }
    if (!own) {
      checkDenied(detail);
      return { tipo: type, permitido: false, esperado: true, estadoHTTP: detail.status };
    }
    assert.equal(detail.status, 200);
    const data = detail.data;
    const code = type === 'conductor' ? data.dispatchCode : data.purchaseCode;
    assert.equal(code, profile.code);
    return { tipo: type, permitido: true, esperado: true, estadoHTTP: detail.status, codigo: code,
      estado: data.fulfillmentStatus ?? data.status, elementos: data.items.map(item => item.name), lista: list };
  }
  for (const key of profiles.keys()) for (const own of [true, false]) await checkProfile(key, own);
  // A signed-in shopper cannot read another guest's purchase just by knowing its visible order number.
  const customer = profiles.get('cliente-a'), guest = profiles.get('invitado-b');
  for (const suffix of ['', '/tracking']) {
    checkDenied(await customer.client.request('/api/v1/orders/' + guest.id + suffix));
    checkDenied(await browser().request('/api/v1/orders/' + guest.id + suffix));
  }
  console.log('Seis perfiles verificados: historial, detalle, tracking y despachos de revisión.');
  return { checkProfile, profiles };
}
try {
  const { checkProfile, profiles } = await prepare();
  if (!checking) {
    const html = fs.readFileSync(new URL('./order-access-review.html', import.meta.url));
    review = http.createServer(async (req, res) => {
      if (req.headers.host !== loopback + ':' + review.address().port || req.method !== 'GET' || req.headers['sec-fetch-site'] === 'cross-site') {
        res.writeHead(403).end(); return;
      }
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('X-Content-Type-Options','nosniff');
      res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
      if (req.url === '/') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(html); return; }
      const match = /^\/casos\/([a-z]+-[ab])\/(propio|otro)$/.exec(req.url);
      if (!match || !profiles.has(match[1])) { res.writeHead(404).end(); return; }
      try {
        const result = await checkProfile(match[1], match[2] === 'propio');
        res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(result));
      } catch { res.writeHead(503, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: 'No se comprobó el aislamiento. Reabre la demo para renovar sus sesiones.' })); }
    });
    review.listen(0, loopback); await once(review, 'listening');
    console.log('Demo de revisión http://' + loopback + ':' + review.address().port + '/');
    await Promise.race([once(process, 'SIGINT'), once(process, 'SIGTERM'), stopped]);
  }
} finally { await close(); }
