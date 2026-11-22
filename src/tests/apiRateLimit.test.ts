import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { test, type TestContext } from 'node:test';
import express from 'express';
import { apiRateConfig, mountApiRateLimit, RateWindow } from '../lib/apiRateLimit';

async function runtime(t: TestContext, options: { trust?: boolean; ip?: number; principal?: number; auth?: number; recovery?: number } = {}) {
  const app = express();
  const config = { ...apiRateConfig({}), ...options };
  if (options.trust) app.set('trust proxy', 'loopback');
  let clock = 1000;
  mountApiRateLimit(app, {
    staff: token => token === 'staff-a' || token === 'staff-b' ? 'staff-account' : undefined,
    driver: token => token === 'driver-a' ? 'driver-account' : null,
    customer: async req => req.get('Cookie') === 'bolt_customer.session_token=fixture' ? 'customer-account' : undefined,
  }, config, () => clock);
  app.use('/api', (_req, res) => res.json({ authenticatedLimit: Boolean(res.locals.rateLimitPrincipal) }));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => { const waiting = once(server, 'close'); server.close(); server.closeAllConnections(); await waiting; });
  const origin = 'http://127.0.0.1:' + (server.address() as AddressInfo).port;
  return { nextWindow: () => { clock += 60000; }, call: (path: string, headers?: Record<string, string>) =>
    fetch(origin + path, { headers }) };
}

test('numeric settings and bounded windows leave active counters intact at capacity', () => {
  assert.throws(() => apiRateConfig({ BOLT_API_RATE_IP_PER_MINUTE: '0' }));
  assert.throws(() => apiRateConfig({ BOLT_API_RATE_MAX_KEYS: 'Infinity' }));
  let now = 100;
  const table = new RateWindow(2, 60000, () => now);
  assert.equal(table.take('limited', 1), 0);
  assert.equal(table.take('other', 2), 0);
  assert.equal(table.take('new', 2), 60);
  assert.equal(table.take('limited', 1), 60);
  now += 59000;
  assert.equal(table.take('new', 2), 1);
  now += 1000;
  assert.equal(table.take('new', 2), 0);
});

test('the direct peer shares its IP budget across routes; probes remain available during cooldown', async t => {
  const { call, nextWindow } = await runtime(t, { ip: 2 });
  assert.equal((await call('/api/v1/stores', { 'X-Forwarded-For': '192.0.2.1' })).status, 200);
  assert.equal((await call('/api/v1/catalog', { 'X-Forwarded-For': '192.0.2.2' })).status, 200);
  const limited = await call('/api/v1/orders');
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get('retry-after'), '60');
  assert.equal((await limited.json()).code, 'RATE_LIMITED');
  assert.equal((await call('/api/v1/health')).status, 200);
  nextWindow();
  assert.equal((await call('/api/v1/catalog')).status, 200);
});

test('authenticated principal quota spans IPs and sessions without counting arbitrary actor headers as identity', async t => {
  const { call } = await runtime(t, { trust: true, ip: 20, principal: 1 });
  const route = '/api/v1/stores';
  const first = await call(route, { Authorization: 'Bearer staff-a', 'X-Forwarded-For': '192.0.2.1' });
  assert.deepEqual(await first.json(), { authenticatedLimit: true });
  assert.equal((await call(route, { Authorization: 'Bearer staff-b', 'X-Forwarded-For': '192.0.2.2' })).status, 429);
  assert.equal((await call(route, { Authorization: 'Bearer driver-a' })).status, 200);
  assert.equal((await call(route, { Authorization: 'Bearer driver-a', 'X-Forwarded-For': '192.0.2.3' })).status, 429);
  assert.equal((await call(route, { Cookie: 'bolt_customer.session_token=fixture' })).status, 200);
  assert.equal((await call(route, { Cookie: 'bolt_customer.session_token=fixture', 'X-Forwarded-For': '192.0.2.4' })).status, 429);
  const anonymous = await call(route, { 'X-Actor-Id': 'staff-account', 'X-Actor-Role': 'ADMINISTRADOR', Authorization: 'Bearer unknown' });
  assert.deepEqual(await anonymous.json(), { authenticatedLimit: false });
});

test('IPv6 prefixes share IP limits, and auth and recovery budgets are separate from normal polling', async t => {
  const ipv6 = await runtime(t, { trust: true, ip: 1 });
  assert.equal((await ipv6.call('/api/v1/catalog', { 'X-Forwarded-For': '2001:db8:1::1' })).status, 200);
  assert.equal((await ipv6.call('/api/v1/catalog', { 'X-Forwarded-For': '2001:db8:1::2' })).status, 429);
  const { call } = await runtime(t, { auth: 1, recovery: 1 });
  assert.equal((await call('/api/v1/auth/login')).status, 200);
  assert.equal((await call('/api/v1/driver/auth/login')).status, 429);
  assert.equal((await call('/api/v1/tracking-recovery')).status, 200);
  assert.equal((await call('/api/customer-auth/request-password-reset')).status, 429);
  assert.equal((await call('/api/v1/orders/example/tracking')).status, 200);
  assert.equal((await call('/api/v1/tracking-recovery/status')).status, 200);
});
