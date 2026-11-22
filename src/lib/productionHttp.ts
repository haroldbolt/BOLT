import { isIP } from 'node:net';
import type { TLSSocket } from 'node:tls';
import cors from 'cors';
import type { Express, Request } from 'express';

function exactHttpsOrigin(value: string) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.origin !== value || url.hostname.includes('*')) {
    throw Error('Configura orígenes HTTPS exactos, sin rutas ni comodines.');
  }
  return url;
}

function proxyRanges(value: string | undefined) {
  if (!value) return [];
  return value.split(',').map(entry => {
    const range = entry.trim();
    const [address, prefix, ...extra] = range.split('/');
    const family = isIP(address);
    if (!family || extra.length || (prefix !== undefined &&
      (!/^[1-9]\d*$/.test(prefix) || Number(prefix) > (family === 4 ? 32 : 128)))) {
      throw Error('BOLT_TRUSTED_PROXY_CIDRS requiere direcciones IP o rangos CIDR explícitos.');
    }
    return range;
  });
}

const loopback = new Set(['127.0.0.1', '::ffff:127.0.0.1', '::1']);
function isLocalConnection(req: Request) {
  const port = req.socket.localPort;
  const hosts = ['127.0.0.1', '[::1]', 'localhost'];
  const host = req.get('Host')?.toLowerCase();
  return loopback.has(req.socket.remoteAddress || '') &&
    hosts.some(item => host === item + ':' + port || (port === 80 && host === item)) &&
    !Object.keys(req.headers).some(key => key === 'forwarded' || key.startsWith('x-forwarded-'));
}

/** Public requests are accepted only on the configured host and a verified TLS hop. */
export function mountProductionHttp(app: Express, env: NodeJS.ProcessEnv, simulation: boolean) {
  const production = env.NODE_ENV === 'production' && !simulation;
  const configured = env.BOLT_PUBLIC_ORIGIN || env.BOLT_CUSTOMER_ORIGIN || env.RENDER_EXTERNAL_URL;
  const origin = production && configured ? exactHttpsOrigin(configured) : undefined;
  const allowed = (env.BOLT_PWA_ORIGINS || '').split(',').filter(Boolean).map(entry => exactHttpsOrigin(entry.trim()).origin);
  const proxies = production ? proxyRanges(env.BOLT_TRUSTED_PROXY_CIDRS) : [];
  app.set('trust proxy', proxies);
  const trusted = app.get('trust proxy fn') as (ip: string, hop: number) => boolean;
  const allowCors = cors({
    origin: allowed,
    allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key', 'X-Order-Token', 'X-Photo-Id', 'X-Photo-Destination'],
    exposedHeaders: ['X-Request-Id', 'Retry-After'],
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    maxAge: 300,
  });
  app.use((req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'SAMEORIGIN',
      'Content-Security-Policy': "base-uri 'self'; object-src 'none'; frame-ancestors 'self'",
      'Referrer-Policy': 'strict-origin',
      'Permissions-Policy': 'camera=(self), geolocation=(self), microphone=()',
    });
    if (simulation) return next(); // The private gateway and acceptsDemoOrigin validate the forwarded browser origin.
    const requestOrigin = req.get('Origin');
    const host = req.get('Host')?.toLowerCase();
    if (production) {
      const healthProbe = (req.method === 'GET' || req.method === 'HEAD') && req.path === '/api/v1/health';
      const peerTrusted = trusted(req.socket.remoteAddress || '', 0);
      const tls = Boolean((req.socket as TLSSocket).encrypted) || (peerTrusted && req.get('X-Forwarded-Proto') === 'https');
      const correctHost = origin && (host === origin.host || (!origin.port && host === origin.host + ':443'));
      if (tls && correctHost) res.set('Strict-Transport-Security', 'max-age=31536000');
      if (healthProbe && !(tls && correctHost)) return next();
      if (!origin && !isLocalConnection(req)) {
        return res.status(503).json({ code: 'PUBLIC_ORIGIN_REQUIRED', error: 'El origen público no está configurado.' });
      }
      if (origin && !correctHost) return res.status(421).json({ code: 'HOST_NOT_ALLOWED', error: 'Origen de servicio no autorizado.' });
      if (origin && !tls) return res.status(403).json({ code: 'HTTPS_REQUIRED', error: 'Esta operación requiere una conexión HTTPS.' });
      // Consumers such as the auth SDK can read raw forwarding headers. Present only
      // the client that Express resolved from the configured proxy chain.
      const client = req.ip;
      for (const name of Object.keys(req.headers)) {
        if (name === 'forwarded' || name.startsWith('x-forwarded-') ||
            ['cf-connecting-ip', 'x-real-ip', 'true-client-ip', 'x-client-ip'].includes(name)) delete req.headers[name];
      }
      if (peerTrusted && tls) {
        req.headers['x-forwarded-proto'] = 'https';
        if (client && isIP(client)) req.headers['x-forwarded-for'] = client;
      }
    }
    res.vary('Origin');
    if (!requestOrigin) return next();
    const sameOrigin = origin?.origin || req.protocol + '://' + host;
    if (requestOrigin === sameOrigin) return next();
    // Apple sends form_post from its web origin. Better Auth still validates state and the identity token.
    if (requestOrigin === 'https://appleid.apple.com' && req.method === 'POST' &&
        req.path === '/api/customer-auth/callback/apple' && env.BOLT_APPLE_SERVICE_ID && env.BOLT_APPLE_CLIENT_SECRET) return next();
    if (/^\/api\/v1(?:\/|$)/i.test(req.path) && allowed.includes(requestOrigin)) return allowCors(req, res, next);
    return res.status(403).json({ code: 'ORIGIN_NOT_ALLOWED', error: 'Origen de solicitud no autorizado.' });
  });
}
