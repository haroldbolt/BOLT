/** Runs only on this computer. Each button starts a fresh application-auth fixture. */
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

const cases = new Map([
  ['identidad-valida', 'valid'],
  ['identidad-rechazada', 'untrusted-signature'],
  ['claves-indisponibles', 'keys-unavailable'],
]);

function publicResult(result) {
  const { cuentas, vinculos, sesiones, sesionActiva, retornoAutorizado } = result;
  if (![cuentas, vinculos, sesiones].every(n => Number.isSafeInteger(n) && n >= 0) ||
      typeof sesionActiva !== 'boolean' || typeof retornoAutorizado !== 'boolean') {
    throw Error('Resultado incompleto del servidor de identidad');
  }
  return { cuentas, vinculos, sesiones, sesionActiva, retornoAutorizado };
}

async function runWorker(caseId) {
  if (!cases.has(caseId) || !process.send) throw Error('Se requiere un caso de revisión local');
  const { createGoogleCallbackHarness } = await import('../../src/tests/customer/googleCallbackHarness.ts');
  const auth = await createGoogleCallbackHarness();
  let result;
  try {
    result = publicResult(await auth.run(cases.get(caseId)));
  } finally {
    await auth.close();
  }
  process.send(result, () => process.disconnect());
}

function checkCase(caseId) {
  return new Promise((resolve, reject) => {
    const child = fork(fileURLToPath(import.meta.url), ['--case', caseId], {
      cwd: fileURLToPath(new URL('../../', import.meta.url)),
      execArgv: ['--import', 'tsx'],
      env: { PATH: process.env.PATH, NODE_ENV: 'test', LANG: 'C' },
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    });
    // The worker receives no hosted credentials; only aggregate counts cross IPC.
    let receipt;
    const deadline = setTimeout(() => child.kill('SIGKILL'), 30_000);
    child.once('message', value => { receipt = value; });
    child.once('error', error => { clearTimeout(deadline); reject(error); });
    child.once('exit', code => {
      clearTimeout(deadline);
      try {
        if (code !== 0 || !receipt) throw Error('No se completó el recorrido local de Google');
        const result = publicResult(receipt);
        const accept = caseId === 'identidad-valida';
        const expectedCount = Number(accept);
        const coincide = result.sesionActiva === accept && result.retornoAutorizado === accept &&
          [result.cuentas, result.vinculos, result.sesiones].every(count => count === expectedCount);
        resolve({ caso: caseId, ...result, coincide });
      } catch (error) { reject(error); }
    });
  });
}

async function serve(port = 0) {
  const html = await readFile(new URL('./google-identity-review.html', import.meta.url));
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw Error('Puerto local inválido');
  const { createBrowserReview } = await import('./google-browser-review.ts');
  const browser = await createBrowserReview();
  const server = http.createServer();
  let busy = false;
  server.on('request', async (request, response) => {
    const host = '127.0.0.1:' + server.address().port;
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'");
    if (request.headers.host !== host || request.headers['sec-fetch-site'] === 'cross-site') {
      response.writeHead(403).end();
      return;
    }
    if (request.method === 'GET' && ['/', '/?resultado=error'].includes(request.url)) {
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(html);
      return;
    }
    try {
      if (await browser.handle(request, response, 'http://' + host)) return;
    } catch {
      response.writeHead(503).end(); return;
    }
    const caseId = request.url?.match(/^\/casos\/([a-z-]+)$/)?.[1];
    if (!cases.has(caseId) || request.method !== 'POST') { response.writeHead(404).end(); return; }
    if (request.headers.origin !== 'http://' + host) { response.writeHead(403).end(); return; }
    if (busy) { response.writeHead(429).end(); return; }
    busy = true;
    try {
      const result = await checkCase(caseId);
      response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' }).end(JSON.stringify(result));
    } catch {
      response.writeHead(503).end();
    } finally { busy = false; }
  });
  server.listen(port, '127.0.0.1');
  try { await once(server, 'listening'); } catch (error) { await browser.close(); throw error; }
  async function close() {
    await new Promise(resolve => { server.close(resolve); server.closeIdleConnections(); });
    await browser.close();
  }
  return { origin: 'http://127.0.0.1:' + server.address().port, close };
}

async function checkBrowserSession() {
  const localFetch = globalThis.fetch;
  const demo = await serve();
  const jar = new Map();
  let privateSessionCookie = false;
  async function request(path, method = 'GET') {
    const response = await localFetch(demo.origin + path, { method, redirect:'manual', signal:AbortSignal.timeout(10_000),
      headers:{ Origin:demo.origin, Cookie:[...jar.values()].join('; ') } });
    for (const cookie of response.headers.getSetCookie()) {
      const pair = cookie.split(';')[0];
      jar.set(pair.slice(0,pair.indexOf('=')),pair);
      if (pair.includes('bolt_customer.session_token=') && /;\s*HttpOnly\b/i.test(cookie) &&
          /;\s*SameSite=Lax\b/i.test(cookie)) privateSessionCookie = true;
    }
    return response;
  }
  async function me() {
    const response = await request('/api/customer/me');
    assert.equal(response.status,200);
    return (await response.json()).user;
  }
  try {
    assert.equal(await me(),null);
    const google = await request('/navegador/google','POST');
    assert.equal(google.status,200);
    const callback = new URL((await google.json()).returnTo,demo.origin);
    assert.equal(callback.origin,demo.origin);
    assert.equal(callback.pathname,'/api/customer-auth/callback/google');
    const authorized = await request(callback.pathname + callback.search);
    assert.equal(authorized.status,303);
    assert.equal(authorized.headers.get('location'),'/#sesion-navegador');
    assert.ok(privateSessionCookie);
    assert.deepEqual((await me()).providers,['google']);
    const other = await localFetch(demo.origin + '/api/customer/me');
    assert.equal((await other.json()).user,null);
    assert.equal((await request('/api/customer-auth/sign-out','POST')).status,204);
    assert.equal(await me(),null);
    privateSessionCookie = false;
    assert.equal((await request('/api/customer-auth/sign-in/email','POST')).status,204);
    assert.ok(privateSessionCookie);
    assert.deepEqual((await me()).providers,['credential']);
    assert.equal((await request('/api/customer-auth/sign-out','POST')).status,204);
    assert.equal(await me(),null);
    console.log('Sesiones HTTP de navegador verificadas con Google simulado y correo de prueba, cierre y segunda sesión aislada.');
  } finally { await demo.close(); }
}

if (process.argv[2] === '--case') {
  await runWorker(process.argv[3]);
} else if (process.argv[2] === '--check') {
  for (const caseId of cases.keys()) {
    const result = await checkCase(caseId);
    assert.equal(result.coincide, true, caseId);
    console.log(`${caseId} · cuentas ${result.cuentas}, vínculos ${result.vinculos}, sesiones ${result.sesiones}`);
  }
  await checkBrowserSession();
} else {
  const demo = await serve(Number(process.env.BOLT_GOOGLE_REVIEW_PORT || 0));
  console.log('Demo local de identidad Google ' + demo.origin + '/');
  process.once('SIGINT', demo.close);
  process.once('SIGTERM', demo.close);
}
