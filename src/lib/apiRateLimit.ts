import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
import type { Express, Request } from 'express';

type RateConfig = { ip: number; principal: number; auth: number; recovery: number; maxKeys: number };

export function apiRateConfig(env: NodeJS.ProcessEnv): RateConfig {
  function value(name: string, fallback: number, max: number) {
    const raw = env['BOLT_API_RATE_' + name];
    if (raw === undefined || raw === '') return fallback;
    const n = Number(raw);
    if (!/^[1-9]\d*$/.test(raw) || !Number.isSafeInteger(n) || n > max) throw Error('BOLT_API_RATE_' + name + ' requiere un entero positivo dentro del límite permitido.');
    return n;
  }
  return { ip: value('IP_PER_MINUTE', 600, 1000000), principal: value('USER_PER_MINUTE', 300, 1000000),
    auth: value('AUTH_PER_MINUTE', 20, 1000000), recovery: value('RECOVERY_PER_MINUTE', 8, 1000000),
    maxKeys: value('MAX_KEYS', 50000, 1000000) };
}

/** All keys expire together. A full table rejects new identities until expiry, without evicting active limits. */
export class RateWindow {
  private counts = new Map<string, number>();
  private until = 0;
  constructor(private readonly maxKeys: number, private readonly durationMs = 60000, private readonly now = Date.now) {}
  take(key: string, max: number) {
    const now = this.now();
    if (now >= this.until) {
      this.counts.clear();
      this.until = now + this.durationMs;
    }
    const count = this.counts.get(key) ?? 0;
    if (count >= max || (!count && this.counts.size >= this.maxKeys)) return Math.max(1, Math.ceil((this.until - now) / 1000));
    this.counts.set(key, count + 1);
    return 0;
  }
}

const digest = (value: string) => createHash('sha256').update(value).digest('hex');

// Group temporary IPv6 addresses in the same /64. Normalise IPv4-mapped peers to their IPv4 account.
function network(ip: string) {
  if (isIP(ip) === 4) return ip;
  if (isIP(ip) !== 6) return 'unknown';
  const [left, right = ''] = ip.split('%')[0].toLowerCase().split('::');
  function words(part: string) {
    if (!part) return [] as number[];
    return part.split(':').flatMap(word => {
      if (!word.includes('.')) return [parseInt(word, 16)];
      const [a, b, c, d] = word.split('.').map(Number);
      return [(a << 8) + b, (c << 8) + d];
    });
  }
  const start = words(left), end = words(right);
  const all = [...start, ...Array(8 - start.length - end.length).fill(0), ...end];
  if (all.slice(0, 5).every(n => n === 0) && all[5] === 65535) {
    return [all[6] >> 8, all[6] & 255, all[7] >> 8, all[7] & 255].join('.');
  }
  return all.slice(0, 4).join(':') + '/64';
}

function sensitive(path: string): 'auth' | 'recovery' | undefined {
  if (path === '/api/v1/tracking-recovery' || /^\/api\/customer-auth\/(request-password-reset|forget-password|reset-password|send-verification-email)(\/|$)/.test(path)) return 'recovery';
  if (/^\/api\/v1\/(?:driver\/)?auth\/(login|setup-admin)$/.test(path) ||
      /^\/api\/customer-auth\/(sign-in|sign-up|callback|verify-email)(\/|$)/.test(path)) return 'auth';
}

type Identity = {
  staff: (bearer: string) => string | undefined;
  driver: (bearer: string) => string | null | undefined;
  customer: (req: Request) => Promise<string | undefined>;
};

export function mountApiRateLimit(app: Express, identity: Identity, config = apiRateConfig(process.env), now = Date.now) {
  const window = new RateWindow(config.maxKeys, 60000, now);
  app.use('/api', async (req, res, next) => {
    const path = req.originalUrl.split('?')[0].toLowerCase().replace(/\/+$/, '');
    if ((req.method === 'GET' || req.method === 'HEAD') && path === '/api/v1/health') return next();
    const category = sensitive(path);
    function take(type: 'ip' | 'principal', value: string) {
      const key = type + ':' + digest(value);
      const wait = window.take(key, config[type]) || (category ? window.take(key + ':' + category, config[category]) : 0);
      if (!wait) {
        if (type === 'principal') res.locals.rateLimitPrincipal = key;
        return true;
      }
      res.set({ 'Retry-After': String(wait), 'Cache-Control': 'no-store' }).status(429).json({
        code: 'RATE_LIMITED', error: 'Hay demasiadas solicitudes. Intenta nuevamente en unos segundos.', requestId: res.locals.requestId,
      });
      return false;
    }
    if (!take('ip', network(req.ip || req.socket.remoteAddress || ''))) return;
    try {
      const bearer = /^Bearer ([^\s]{1,512})$/.exec(req.get('Authorization') || '')?.[1];
      if (bearer) {
        const staff = identity.staff(bearer);
        if (staff && !take('principal', 'staff:' + staff)) return;
        const driver = !staff && identity.driver(bearer);
        if (driver && !take('principal', 'driver:' + driver)) return;
      }
      if (/(?:^|;\s*)(?:__Secure-)?bolt_customer\.session_token=/.test(req.get('Cookie') || '')) {
        const customer = await identity.customer(req);
        if (customer && !take('principal', 'customer:' + customer)) return;
      }
      next();
    } catch (error) { next(error); }
  });
}
