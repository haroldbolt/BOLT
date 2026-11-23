import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { checkAvailability } from './check-availability.mjs';

const env = { BOLT_MONITOR_ORIGIN: 'https://monitor.invalid' };
const now = () => Date.parse('2026-11-22T14:10:00.000Z');
const health = { status: 'ok', service: 'Bolt Pets Authoritative Backend', timezone: 'America/Bogota',
  storesCount: 1, timestamp: new Date(now()).toISOString() };
const stores = [{ id: 'warehouse-a', isActive: true, name: 'Sede de prueba', extra: 'private-content' }];
const check = (get, customEnv = env) => checkAvailability(customEnv, (url, init) => get(url.pathname, init), now);
const storesRoute = '/api/v1/stores';
const healthRoute = '/api/v1/health';

test('comprueba sólo las dos rutas públicas y publica resultados mínimos', async () => {
  const routes = [];
  const result = await check((path, options) => {
    routes.push(path);
    assert.equal(options.method, 'GET');
    assert.equal(options.redirect, 'manual');
    assert.equal(options.credentials, 'omit');
    assert.equal(options.cache, 'no-store');
    return Response.json(path === healthRoute ? health : stores);
  });
  assert.deepEqual(routes.sort(), [healthRoute, storesRoute]);
  assert.equal(result.code, 0);
  assert.equal(result.report.ok, true);
  assert.ok(result.report.checks.every(probe => probe.ok && probe.latencyMs >= 0 && probe.count === 1));
  assert.doesNotMatch(JSON.stringify(result.report), /private-content|monitor\.invalid|Sede de prueba|warehouse-a/);
});

test('rechaza páginas intermedias, redirects, errores y sedes inactivas o duplicadas', async () => {
  for (const [response, expected] of [
    [() => new Response('private-content', { headers: { 'Content-Type': 'text/html' } }), 'CONTENT_TYPE'],
    [() => Response.redirect('https://example.invalid/private-content', 302), 'REDIRECT'],
    [() => Response.json({ private: 'private-content' }, { status: 503 }), 'HTTP_STATUS'],
    [() => new Response('{', { headers: { 'Content-Type': 'application/json' } }), 'INVALID_JSON'],
    [() => Response.json([{ ...stores[0], isActive: false }]), 'STORES_CONTRACT'],
    [() => Response.json([stores[0], stores[0]]), 'STORES_CONTRACT'],
    [() => new Response('x'.repeat(131073), { headers: { 'Content-Type': 'application/json' } }), 'BODY_LIMIT'],
  ]) {
    const result = await check(path => path === storesRoute ? response() : Response.json(health));
    assert.equal(result.code, 1);
    assert.equal(result.report.checks[1].reason, expected);
    assert.doesNotMatch(JSON.stringify(result.report), /private-content/);
  }
});

test('una página falsa, una respuesta antigua o sedes incoherentes no prueban disponibilidad', async () => {
  for (const changed of [{ service: 'Other' }, { status: 'unknown' }, { timestamp: '2026-11-22T13:00:00Z' }]) {
    const result = await check(path => Response.json(path === healthRoute ? { ...health, ...changed } : stores));
    assert.equal(result.report.checks[0].reason, 'HEALTH_CONTRACT');
    assert.equal(result.code, 1);
  }
  const mismatch = await check(path => Response.json(path === healthRoute ? { ...health, storesCount: 2 } : stores));
  assert.equal(mismatch.code, 1);
  assert.equal(mismatch.report.reason, 'STORE_COUNT_MISMATCH');
});

test('aplica plazo también durante la lectura del cuerpo y redacta fallos de transporte', async () => {
  const result = await check((path, { signal }) => {
    if (path === storesRoute) throw new Error('private-content');
    return new Response(new ReadableStream({
      start(stream) { signal.addEventListener('abort', () => stream.error(new Error('private-content')), { once: true }); },
    }), { headers: { 'Content-Type': 'application/json' } });
  }, { ...env, BOLT_MONITOR_TIMEOUT_MS: '20' });
  assert.equal(result.code, 1);
  assert.deepEqual(result.report.checks.map(probe => probe.reason), ['TIMEOUT', 'NETWORK_ERROR']);
  assert.doesNotMatch(JSON.stringify(result.report), /private-content/);
});

test('configuración incorrecta produce salida 2 sin peticiones ni impresión del origen', async () => {
  const unexpected = () => assert.fail('No debe consultar con una configuración inválida');
  for (const origin of [undefined, 'http://example.invalid', 'https://foo:private-content@example.invalid',
    'https://example.invalid/adm', 'https://example.invalid/?key=private-content', 'https://example.invalid/#fragment']) {
    assert.equal((await check(unexpected, { BOLT_MONITOR_ORIGIN: origin })).code, 2);
  }
  for (const extra of [{ NODE_TLS_REJECT_UNAUTHORIZED: '0' }, { BOLT_MONITOR_TIMEOUT_MS: '0' }]) {
    assert.equal((await check(unexpected, { ...env, ...extra })).code, 2);
  }
  const script = fileURLToPath(new URL('./check-availability.mjs', import.meta.url));
  const run = spawnSync(process.execPath, [script], { env: { BOLT_MONITOR_ORIGIN: 'private-content' }, encoding: 'utf8' });
  assert.equal(run.status, 2);
  assert.deepEqual(JSON.parse(run.stdout), { ok: false, reason: 'INVALID_CONFIGURATION' });
  assert.equal(run.stderr, '');
});
