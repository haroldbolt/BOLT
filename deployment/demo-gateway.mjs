/** Private staging gateway. The existing BOLT simulator remains loopback-only. */
import http from 'node:http';
import crypto from 'node:crypto';

const COOKIE = '__Host-bolt_demo';
const SESSION_MS = 12 * 60 * 60 * 1000;
const digest = value => crypto.createHash('sha256').update(value).digest();
const equal = (a, b) => crypto.timingSafeEqual(digest(a), digest(b));

export function createDemoGateway({ origin, password, sessionKey, upstreamPort, allowLocalHttp = false }) {
  const publicUrl = new URL(origin);
  const local = allowLocalHttp && publicUrl.protocol === 'http:' && publicUrl.hostname === '127.0.0.1';
  if ((!local && publicUrl.protocol !== 'https:') || publicUrl.origin !== origin || publicUrl.username || publicUrl.password)
    throw Error('A canonical HTTPS public origin is required.');
  if (typeof password !== 'string' || password.length < 16 || sessionKey.length < 32)
    throw Error('Configure a private demo password of at least 16 characters.');
  const cookieName = local ? 'bolt_demo_local_test' : COOKIE;
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
  const form = (message = '') => `<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>BOLT · Demo privada</title><style>body{font:18px system-ui;background:#f7f8fa;color:#122039;margin:0;padding:28px}main{max-width:480px;margin:8vh auto;background:white;padding:28px;border-radius:24px;border:1px solid #dce2ea}h1{margin-top:0}label{display:block;margin:24px 0 8px}input,button{box-sizing:border-box;width:100%;padding:15px;border-radius:12px;font:inherit}input{border:1px solid #64748b}button{margin-top:18px;border:0;background:#ed0018;color:white;font-weight:700}small{display:block;margin-top:24px;line-height:1.6}.error{color:#b00020}</style><main><h1>BOLT <span style="color:#ed0018">DEMO</span></h1><p>Pruebas privadas con datos ficticios. Sin cobros ni entregas reales.</p><p role="alert" class="error">${message}</p><form method="post" action="/__demo/login"><label for="password">Clave de la reunión</label><input id="password" name="password" type="password" autocomplete="current-password" required minlength="16"><button>Entrar a la demo</button></form><small>Comparte esta clave únicamente con quienes participen en la revisión. Utiliza datos ficticios; las direcciones y el carrito se guardan por dispositivo.</small></main></html>`;
  return http.createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
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
    if (req.headers.origin && req.headers.origin !== origin) return send(res, 403, 'Origen no autorizado.');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method || '') && req.headers.origin !== origin)
      return send(res, 403, 'Confirma la operación desde la demo.');
    if (pathname === '/__demo/logout' && req.method === 'POST') {
      res.setHeader('Set-Cookie', `${cookieName}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${local ? '' : '; Secure'}`);
      res.writeHead(303, { Location: '/' }); return res.end();
    }
    if (pathname === '/__demo/login' && req.method === 'POST') {
      failures = failures.filter(t => t > Date.now() - 60000);
      if (failures.length >= 10) return send(res, 429, form('Demasiados intentos. Espera un minuto.'));
      let body = '';
      try {
        for await (const chunk of req) { body += chunk; if (Buffer.byteLength(body) > 4096) { send(res, 413, 'Solicitud demasiado grande.'); return; } }
      } catch { return res.destroy(); }
      if (!equal(new URLSearchParams(body).get('password') || '', password)) {
        failures.push(Date.now()); return send(res, 401, form('Clave incorrecta.'));
      }
      res.setHeader('Set-Cookie', `${cookieName}=${session()}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_MS / 1000}${local ? '' : '; Secure'}`);
      res.writeHead(303, { Location: '/__demo' }); return res.end();
    }
    if (!authorized(req)) {
      if (pathname.startsWith('/api/')) return send(res, 401, '{"error":"Acceso privado de demo requerido"}', 'application/json');
      return send(res, 200, form());
    }
    if (pathname === '/__demo') return send(res, 200, `<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>BOLT · Revisión</title><style>body{font:18px system-ui;color:#122039;max-width:760px;padding:24px;margin:auto}a,button{display:inline-block;margin:8px;padding:16px;border-radius:12px;border:1px solid #ed0018;color:#b90016;background:white;font:inherit}li{margin:12px 0}strong{color:#ed0018}</style><h1>BOLT · Demo de revisión</h1><p><strong>SIMULACIÓN</strong> · No se cobran pagos ni se solicitan entregas reales.</p><p>Revisión del PR #16: registro y Mi cuenta, junto con las mejoras de ubicación de la demo. Cambios pendientes de integrar a main.</p><p><strong>Registro real pendiente de configuración.</strong> Puedes revisar la bienvenida, formularios y documentos legales. Google, Apple y correo están deshabilitados hasta configurar sus servicios. La clave de esta demo no es una cuenta de cliente.</p><nav><a href="/cuenta">Registro y Mi cuenta</a><a href="/">Cliente</a><a href="/simulacion">Preparar simulación</a><a href="/operacion?tab=DESPACHOS">Administración</a><a href="/conductor">BOLT Conductor</a></nav><ol><li>En Preparar simulación, inicia sesión y habilita dos conductores ficticios.</li><li>Consulta el catálogo y las presentaciones. Para crear pedidos usa el alimento de prueba SIM-FOOD-20KG; tiene medidas ficticias explícitas.</li><li>Prueba Cedritos, Chía y Cajicá con entrega programada desde Suba. Cota debe bloquear la entrega.</li><li>Crea una compra dividida, prepara cada entrega y acepta la oferta en Conductor.</li><li>En administración revisa HIST-READY, HIST-WAY y HIST-CLOSED. La recuperación de HIST-CLOSED no debe reabrirlo.</li></ol><p>Las cuentas del simulador permiten intervenir todos los datos de esta demo. No uses datos personales reales. La ubicación vence: actualiza los conductores libres desde el simulador si no aparecen disponibles.</p><p>La cámara y el GPS requieren permisos del navegador. No equivalen a seguimiento en segundo plano.</p><form method="post" action="/__demo/logout"><button>Salir de la demo</button></form></html>`);
    const headers = { ...req.headers, host: `127.0.0.1:${upstreamPort}` };
    if (headers.origin) headers.origin = `http://127.0.0.1:${upstreamPort}`;
    delete headers.cookie;
    for (const header of Object.keys(headers)) if (header.startsWith('x-forwarded-') || header === 'forwarded') delete headers[header];
    // Preserve the app's admin/driver bearer and guest token; never replace them with demo access.
    const proxy = http.request({ hostname: '127.0.0.1', port: upstreamPort, method: req.method, path: req.url, headers }, incoming => {
      const outgoing = { ...incoming.headers };
      delete outgoing['access-control-allow-origin'];
      delete outgoing['set-cookie'];
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
