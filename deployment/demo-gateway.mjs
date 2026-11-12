/** Private staging gateway. The existing BOLT simulator remains loopback-only. */
import http from 'node:http';
import crypto from 'node:crypto';

const COOKIE = '__Host-bolt_demo';
const SESSION_MS = 12 * 60 * 60 * 1000;
const checkoutPreviewPath = '/demo/checkout';
const digest = value => crypto.createHash('sha256').update(value).digest();
const equal = (a, b) => crypto.timingSafeEqual(digest(a), digest(b));

export function createDemoGateway({ origin, password, sessionKey, upstreamPort, allowLocalHttp = false, customerAuth = { enabled: false, google: false, apple: false } }) {
  const publicUrl = new URL(origin);
  const local = allowLocalHttp && publicUrl.protocol === 'http:' && publicUrl.hostname === '127.0.0.1';
  if ((!local && publicUrl.protocol !== 'https:') || publicUrl.origin !== origin || publicUrl.username || publicUrl.password)
    throw Error('A canonical HTTPS public origin is required.');
  if (typeof password !== 'string' || password.length < 16 || sessionKey.length < 32)
    throw Error('Configure a private demo password of at least 16 characters.');
  const cookieName = local ? 'bolt_demo_local_test' : COOKIE;
  const customerEnabled = customerAuth.enabled === true;
  const gateSameSite = customerEnabled ? 'Lax' : 'Strict';
  const returnCookie = local ? 'bolt_demo_return_test' : '__Host-bolt_demo_return';
  const customerCookie = new RegExp(`^${local ? '' : '__Secure-'}bolt_customer\\.(session_token|session_data|account_data|dont_remember|state|oauth_state)(\\.\\d+)?$`);
  const getCookie = (req, name) => (req.headers.cookie || '').split(';').map(x => x.trim()).find(x => x.startsWith(name + '='))?.slice(name.length + 1);
  const customerRoute = p => p === '/api/customer' || p.startsWith('/api/customer/') || p.startsWith('/api/customer-auth/');
  const cookieRoute = p => customerRoute(p) || p === '/api/v1/orders' || p.startsWith('/api/v1/orders/');
  const safeReturn = value => {
    if (typeof value !== 'string' || value.length > 1800 || !value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return null;
    try {
      const u = new URL(value, origin);
      if (u.origin !== origin) return null;
      if (u.pathname === checkoutPreviewPath) {
        const state = u.searchParams.get('estado');
        return state === 'pendiente' || state === 'confirmado' ? `${checkoutPreviewPath}?estado=${state}` : checkoutPreviewPath;
      }
      const customerPath = ['/cuenta', '/eliminar-cuenta'].includes(u.pathname) || u.pathname.startsWith('/api/customer-auth/');
      return customerEnabled && customerPath ? value : null;
    } catch { return null; }
  };
  const continuationKey = crypto.createHmac('sha256', sessionKey).update('customer-return:' + password).digest();
  const sealReturn = value => {
    const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', continuationKey, iv);
    const encrypted = Buffer.concat([cipher.update(JSON.stringify({ path: value, expires: Date.now() + 600000 })), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64url');
  };
  const readReturn = req => {
    try {
      const value = getCookie(req, returnCookie); if (!value || value.length > 3500) return null;
      const bytes = Buffer.from(value, 'base64url'), decipher = crypto.createDecipheriv('aes-256-gcm', continuationKey, bytes.subarray(0, 12));
      decipher.setAuthTag(bytes.subarray(12, 28));
      const data = JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString());
      return data.expires > Date.now() && data.expires <= Date.now() + 600000 ? safeReturn(data.path) : null;
    } catch { return null; }
  };
  const returnHeader = (value, maxAge) => `${returnCookie}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${local ? '' : '; Secure'}`;
  const key = crypto.createHmac('sha256', sessionKey).update(password).digest();
  const sign = body => crypto.createHmac('sha256', key).update(body).digest('base64url');
  const session = () => {
    const body = Buffer.from(JSON.stringify({ expires: Date.now() + SESSION_MS, nonce: crypto.randomUUID() })).toString('base64url');
    return body + '.' + sign(body);
  };
  const authorized = req => {
    const token = (req.headers.cookie || '').split(';').map(x => x.trim()).find(x => x.startsWith(cookieName + '='))?.slice(cookieName.length + 1);
    if (!token || token.length > 600) return false;
    const [body, signature, extra] = token.split('.');
    if (!body || !signature || extra || !equal(signature, sign(body))) return false;
    try {
      const data = JSON.parse(Buffer.from(body, 'base64url').toString());
      return Number.isFinite(data.expires) && data.expires > Date.now() && data.expires <= Date.now() + SESSION_MS;
    } catch { return false; }
  };
  let failures = [];
  const send = (res, code, body, type = 'text/html; charset=utf-8') => {
    res.writeHead(code, { 'Content-Type': type }); res.end(body);
  };
  const sendGatePage = (res, code, body) => {
    // Native form POST + no-referrer produces Origin:null in browsers. Keep the
    // canonical Origin for login/logout, without exposing any URL path or token
    // (the gate may be displaying an email verification/reset continuation).
    // All other responses retain the existing no-referrer policy.
    res.setHeader('Referrer-Policy', 'strict-origin');
    return send(res, code, body);
  };
  const form = (message = '') => `<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>BOLT · Demo privada</title><style>body{font:18px system-ui;background:#f7f8fa;color:#122039;margin:0;padding:28px}main{max-width:480px;margin:8vh auto;background:white;padding:28px;border-radius:24px;border:1px solid #dce2ea}h1{margin-top:0}label{display:block;margin:24px 0 8px}input,button{box-sizing:border-box;width:100%;padding:15px;border-radius:12px;font:inherit}input{border:1px solid #64748b}button{margin-top:18px;border:0;background:#ed0018;color:white;font-weight:700}small{display:block;margin-top:24px;line-height:1.6}.error{color:#b00020}</style><main><h1>BOLT <span style="color:#ed0018">DEMO</span></h1><p>Pruebas privadas con datos ficticios. Sin cobros ni entregas reales.</p><p role="alert" class="error">${message}</p><form method="post" action="/__demo/login"><label for="password">Clave de la reunión</label><input id="password" name="password" type="password" autocomplete="current-password" required minlength="16"><button>Entrar a la demo</button></form><small>Comparte esta clave únicamente con quienes participen en la revisión. Utiliza datos ficticios; las direcciones y el carrito se guardan por dispositivo.</small></main></html>`;
  return http.createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', customerEnabled ? 'no-referrer' : 'same-origin');
    res.setHeader('X-Frame-Options', 'DENY');
    if (!local) res.setHeader('Strict-Transport-Security', 'max-age=86400');
    const pathname = (req.url || '/').split('?')[0];
    // Platform health checks do not expose app data or bypass authentication elsewhere.
    if (pathname === '/__demo/health' && req.method === 'GET') {
      try {
        const health = await fetch(`http://127.0.0.1:${upstreamPort}/api/v1/health`, { signal: AbortSignal.timeout(3000) });
        return send(res, health.ok ? 200 : 503, JSON.stringify({ ready: health.ok }), 'application/json');
      } catch { return send(res, 503, '{"ready":false}', 'application/json'); }
    }
    if (req.headers.host !== publicUrl.host) return send(res, 421, 'Origen no autorizado.');
    // Only configured OAuth callbacks may arrive without the private demo cookie.
    // Better Auth still verifies the state cookie, one-use DB state, PKCE and provider response.
    const applePost = customerEnabled && customerAuth.apple && pathname === '/api/customer-auth/callback/apple' && req.method === 'POST' && req.headers.origin === 'https://appleid.apple.com';
    const oauthGet = customerEnabled && req.method === 'GET' && (
      customerAuth.google && pathname === '/api/customer-auth/callback/google' ||
      customerAuth.apple && pathname === '/api/customer-auth/callback/apple');
    if (!applePost && req.headers.origin && req.headers.origin !== origin) return send(res, 403, 'Origen no autorizado.');
    if (!applePost && !['GET', 'HEAD', 'OPTIONS'].includes(req.method || '') && req.headers.origin !== origin)
      return send(res, 403, 'Confirma la operación desde la demo.');
    if (pathname === '/__demo/logout' && req.method === 'POST') {
      res.setHeader('Set-Cookie', `${cookieName}=; Path=/; HttpOnly; SameSite=${gateSameSite}; Max-Age=0${local ? '' : '; Secure'}`);
      res.writeHead(303, { Location: '/' }); return res.end();
    }
    if (pathname === '/__demo/login' && req.method === 'POST') {
      failures = failures.filter(t => t > Date.now() - 60000);
      if (failures.length >= 10) return sendGatePage(res, 429, form('Demasiados intentos. Espera un minuto.'));
      let body = '';
      try {
        for await (const chunk of req) { body += chunk; if (Buffer.byteLength(body) > 4096) { send(res, 413, 'Solicitud demasiado grande.'); return; } }
      } catch { return res.destroy(); }
      if (!equal(new URLSearchParams(body).get('password') || '', password)) {
        failures.push(Date.now()); return sendGatePage(res, 401, form('Clave incorrecta.'));
      }
      const continuation = readReturn(req);
      res.setHeader('Set-Cookie', [`${cookieName}=${session()}; Path=/; HttpOnly; SameSite=${gateSameSite}; Max-Age=${SESSION_MS / 1000}${local ? '' : '; Secure'}`, ...(customerEnabled || continuation ? [returnHeader('', 0)] : [])]);
      res.writeHead(303, { Location: continuation || '/__demo' }); return res.end();
    }
    if (!authorized(req) && !applePost && !oauthGet) {
      const continuation = req.method === 'GET' && safeReturn(req.url);
      if (continuation) {
        res.setHeader('Set-Cookie', returnHeader(sealReturn(continuation), 600));
        return sendGatePage(res, 200, form());
      }
      if (pathname.startsWith('/api/')) return send(res, 401, '{"error":"Acceso privado de demo requerido"}', 'application/json');
      return sendGatePage(res, 200, form());
    }
    if (pathname === '/__demo') return sendGatePage(res, 200, `<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>BOLT · Revisión</title><style>body{font:18px system-ui;color:#122039;max-width:760px;padding:24px;margin:auto}a,button{display:inline-block;margin:8px;padding:16px;border-radius:12px;border:1px solid #ed0018;color:#b90016;background:white;font:inherit}li{margin:12px 0}strong{color:#ed0018}</style><h1>BOLT · Demo de revisión</h1><p><strong>SIMULACIÓN</strong> · No se cobran pagos ni se solicitan entregas reales.</p><p>Revisión de Marcas con imágenes de Shopify y pedido pendiente sin cobro. Cambios pendientes de integrar a main.</p><p>${customerEnabled ? '<strong>Pruebas privadas de cuentas.</strong> Mi cuenta indica los métodos habilitados. Usa únicamente tu propio correo y datos mínimos para las pruebas autorizadas; los pedidos y repartos siguen siendo simulados.' : '<strong>Registro real pendiente de configuración.</strong> Puedes revisar la bienvenida, formularios y documentos legales. Google, Apple y correo están deshabilitados hasta configurar sus servicios.'} La clave de esta demo no es una cuenta de cliente.</p><nav><a href="/cuenta">Registro y Mi cuenta</a><a href="/">Cliente</a><a href="${checkoutPreviewPath}">Checkout de prueba</a><a href="/simulacion">Preparar simulación</a><a href="/operacion?tab=DESPACHOS">Administración</a><a href="/conductor">BOLT Conductor</a></nav><ol><li>En Preparar simulación, inicia sesión y habilita dos conductores ficticios.</li><li>Abre Cliente → Marcas, selecciona una marca y revisa sus presentaciones. Los productos de prueba se retiraron del catálogo; sus pedidos históricos se conservan.</li><li>Prueba Cedritos, Chía y Cajicá con entrega programada desde Suba. Cota debe bloquear la entrega.</li><li>Puedes enviar una solicitud pendiente de confirmación, sin cobro. La asignación de entregas requiere los datos y la capacidad logística correspondientes.</li><li>En administración revisa HIST-READY, HIST-WAY y HIST-CLOSED. La recuperación de HIST-CLOSED no debe reabrirlo.</li></ol><p>Las cuentas del simulador permiten intervenir todos los datos de esta demo. No uses datos personales reales. La ubicación vence: actualiza los conductores libres desde el simulador si no aparecen disponibles.</p><p>La cámara y el GPS requieren permisos del navegador. No equivalen a seguimiento en segundo plano.</p><form method="post" action="/__demo/logout"><button>Salir de la demo</button></form></html>`);
    const headers = { ...req.headers, host: `127.0.0.1:${upstreamPort}` };
    if (headers.origin && !customerEnabled) headers.origin = `http://127.0.0.1:${upstreamPort}`;
    delete headers.cookie;
    if (customerEnabled && cookieRoute(pathname)) {
      const selected = (req.headers.cookie || '').split(';').map(x => x.trim()).filter(x => customerCookie.test(x.split('=')[0]));
      if (selected.length) headers.cookie = selected.join('; ');
    }
    for (const header of Object.keys(headers)) if (header.startsWith('x-forwarded-') || header === 'forwarded') delete headers[header];
    // Preserve the app's admin/driver bearer and guest token; never replace them with demo access.
    const proxy = http.request({ hostname: '127.0.0.1', port: upstreamPort, method: req.method, path: req.url, headers }, incoming => {
      const outgoing = { ...incoming.headers };
      delete outgoing['access-control-allow-origin'];
      delete outgoing['set-cookie'];
      if (customerEnabled && cookieRoute(pathname)) {
        const selected = (incoming.headers['set-cookie'] || []).filter(x => customerCookie.test(x.split('=')[0]) && !/;\s*Domain=/i.test(x) && /;\s*HttpOnly(?:;|$)/i.test(x) && (local || /;\s*Secure(?:;|$)/i.test(x)));
        if (selected.length) outgoing['set-cookie'] = selected;
      }
      outgoing['cache-control'] = 'no-store';
      res.writeHead(incoming.statusCode || 502, outgoing);
      incoming.pipe(res);
    });
    proxy.setTimeout(30000, () => proxy.destroy());
    proxy.on('error', () => { if (!res.headersSent) send(res, 502, '{"error":"La demo se está iniciando. Intenta de nuevo."}', 'application/json'); else res.destroy(); });
    req.on('aborted', () => proxy.destroy());
    req.pipe(proxy);
  });
}
