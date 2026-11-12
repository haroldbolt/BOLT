import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import { once } from 'node:events';
import { createDemoGateway } from './demo-gateway.mjs';

const listen = async server => { server.listen(0, '127.0.0.1'); await once(server, 'listening'); return server.address().port; };
const password = crypto.randomBytes(24).toString('base64url');
const key = crypto.randomBytes(48).toString('hex');
let forwarded;
const backend = http.createServer((req, res) => { forwarded = req.headers; res.setHeader('Content-Type', 'application/json'); res.end('{"ok":true}'); });
const upstreamPort = await listen(backend);
assert.throws(() => createDemoGateway({ origin: 'http://public.example', password, sessionKey: key, upstreamPort }));
assert.throws(() => createDemoGateway({ origin: 'https://demo.example/path', password, sessionKey: key, upstreamPort }));
assert.throws(() => createDemoGateway({ origin: 'https://demo.example', password: 'short', sessionKey: key, upstreamPort }));
const origin = 'https://demo.example';
const gateway = createDemoGateway({ origin, password, sessionKey: key, upstreamPort });
const port = await listen(gateway);
const request = (url, options = {}) => new Promise((resolve, reject) => {
  const req = http.request({ hostname: '127.0.0.1', port, path: url, method: options.method || 'GET', headers: { Host: 'demo.example', ...options.headers } }, res => {
    let body = ''; res.on('data', chunk => body += chunk); res.on('end', () => resolve({ status: res.statusCode, text: async () => body, headers: { get: name => Array.isArray(res.headers[name]) ? res.headers[name].join('; ') : res.headers[name] } }));
  });
  req.on('error', reject); req.end(options.body?.toString());
});
try {
  assert.equal((await request('/api/v1/simulation')).status, 401);
  assert.match(await (await request('/')).text(), /Clave de la reunión/);
  assert.equal((await request('/api/v1/simulation', { headers: { Host: 'evil.example' } })).status, 421);
  assert.equal((await request('/__demo/health')).status, 200);
  assert.equal((await request('/__demo/login', { method: 'POST', body: 'password=x' })).status, 403);
  assert.equal((await request('/__demo/login', { method: 'POST', headers: { Origin: origin }, body: 'password=incorrect' })).status, 401);
  const login = await request('/__demo/login', { method: 'POST', headers: { Origin: origin }, body: new URLSearchParams({ password }) });
  assert.equal(login.status, 303);
  const setCookie = login.headers.get('set-cookie');
  for (const attribute of ['Secure', 'HttpOnly', 'SameSite=Strict', 'Path=/']) assert.ok(setCookie.includes(attribute));
  const cookie = setCookie.split(';')[0];
  const reviewPage=await (await request('/__demo', { headers: { Cookie: cookie } })).text();
  assert.match(reviewPage, /SIMULACIÓN/);
  assert.match(reviewPage, /href="\/cuenta"/);
  assert.match(reviewPage, /href="\/demo\/checkout"/);
  assert.match(reviewPage, /href="\/admin\/nuevo\/"/);
  assert.match(reviewPage, /Registro real pendiente de configuración/);
  assert.equal((await request('/api/v1/simulation', { headers: { Cookie: cookie } })).status, 200);
  assert.equal((await request('/api/v1/simulation/checkout-preview?estado=pendiente')).status, 401);
  assert.equal((await request('/api/v1/bolt-admin/demo/session')).status, 401);
  for (const estado of ['confirmado', 'pendiente']) {
    const previewPath = `/demo/checkout?estado=${estado}`;
    const entry = await request(previewPath);
    assert.match(await entry.text(), /Clave de la reunión/);
    const continuation = entry.headers.get('set-cookie').split(';')[0];
    const resumed = await request('/__demo/login', {
      method: 'POST',
      headers: { Origin: origin, Cookie: continuation },
      body: new URLSearchParams({ password }),
    });
    assert.equal(resumed.headers.get('location'), previewPath);
    assert.match(resumed.headers.get('set-cookie'), /__Host-bolt_demo_return=;.*Max-Age=0/);
  }
  for (const adminPath of ['/admin/nuevo', '/admin/nuevo/']) {
    const entry = await request(adminPath);
    assert.match(await entry.text(), /Clave de la reunión/);
    const continuation = entry.headers.get('set-cookie').split(';')[0];
    const resumed = await request('/__demo/login', {
      method: 'POST',
      headers: { Origin: origin, Cookie: continuation },
      body: new URLSearchParams({ password }),
    });
    assert.equal(resumed.headers.get('location'), '/admin/nuevo/');
  }
  assert.equal((await request('/api/v1/test', { method: 'POST', headers: { Cookie: cookie, Origin: 'https://evil.example' }, body: '{}' })).status, 403);
  assert.equal((await request('/api/v1/test', { method: 'POST', headers: { Cookie: cookie, Origin: origin, Authorization: 'Bearer fixture-admin', 'X-Order-Token': 'fixture-guest', 'X-Forwarded-Host': 'evil.example' }, body: '{}' })).status, 200);
  assert.equal(forwarded.host, `127.0.0.1:${upstreamPort}`);
  assert.equal(forwarded.origin, `http://127.0.0.1:${upstreamPort}`);
  assert.equal(forwarded.authorization, 'Bearer fixture-admin');
  assert.equal(forwarded['x-order-token'], 'fixture-guest');
  assert.equal(forwarded.cookie, undefined);
  assert.equal(forwarded['x-forwarded-host'], undefined);
  assert.equal((await request('/api/v1/simulation', { headers: { Cookie: cookie + 'tamper' } })).status, 401);
  const logout = await request('/__demo/logout', { method: 'POST', headers: { Cookie: cookie, Origin: origin } });
  assert.equal(logout.status, 303); assert.match(logout.headers.get('set-cookie'), /Max-Age=0/);
  console.log('PASS: HTTPS/origin guard, anonymous denial, login, signed cookie, CSRF rejection, token separation, tampering and logout.');
} finally { gateway.closeAllConnections(); backend.closeAllConnections(); gateway.close(); backend.close(); }
