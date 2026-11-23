import type { Request, Response } from 'express';
import { createDailyProviderBudget, secondsUntilBogotaMidnight } from './dailyProviderBudget';

const defaults = {
  GEOCODE: { perIdentity: 30, total: 300, concurrency: 8, daily: 2000 },
  WOMPI: { perIdentity: 12, total: 60, concurrency: 4, daily: 500 },
  MAIL: { perIdentity: 5, total: 30, concurrency: 1, daily: 500 },
  CARGO_QUOTE: { perIdentity: 2, total: 60, concurrency: 4, daily: 2000 },
  CARGO_BOOKING: { perIdentity: 2, total: 60, concurrency: 4, daily: 2000 },
  CARGO_TRACKING: { perIdentity: 12, total: 120, concurrency: 8, daily: 10000 },
} as const;
type Provider = keyof typeof defaults;

export function providerQuota(provider: Provider, env = process.env, clock = Date.now) {
  const numbers = defaults[provider];
  function limit(suffix: string, fallback: number) {
    const number = Number(env['BOLT_' + provider + '_' + suffix]);
    return Number.isSafeInteger(number) && number > 0 && number <= 1_000_000 ? number : fallback;
  }
  const perIdentity = limit('PER_IDENTITY_PER_MINUTE', numbers.perIdentity);
  const totalLimit = limit('TOTAL_PER_MINUTE', numbers.total);
  const maxConcurrent = limit('MAX_CONCURRENT', numbers.concurrency);
  const dailyLimit = limit('DAILY_LIMIT', numbers.daily);
  const dailyBudget = createDailyProviderBudget(env, clock);
  const counts = new Map<string, number>();
  let minute = -1, total = 0, concurrent = 0;

  return {
    take(identities: string[]): { retryAfter: number } | { release: () => void } {
      const now = clock();
      const window = Math.floor(now / 60000);
      if (window !== minute) {
        minute = window;
        total = 0;
        counts.clear();
      }
      if (concurrent >= maxConcurrent) return { retryAfter: 1 };
      if (total >= totalLimit || identities.some(id => (counts.get(id) ?? 0) >= perIdentity ||
          (!counts.has(id) && counts.size >= 4096))) return { retryAfter: Math.ceil((60000 - now % 60000) / 1000) };
      if (!dailyBudget.take(provider, dailyLimit)) return { retryAfter: secondsUntilBogotaMidnight(now) };
      ++total;
      ++concurrent;
      for (const id of identities) counts.set(id, (counts.get(id) ?? 0) + 1);
      let released = false;
      return { release() { if (!released) { --concurrent; released = true; } } };
    },
  };
}

export function providerRouteLimit(provider: 'GEOCODE' | 'WOMPI', env = process.env) {
  const quota = providerQuota(provider, env);
  return async (req: Request, res: Response, operation: () => Promise<unknown>) => {
    const identities = ['ip:' + (req.ip || req.socket.remoteAddress || 'unknown')];
    const principal = res.locals.rateLimitPrincipal || (req as Request & { adminSession?: { userId: string } }).adminSession?.userId;
    if (principal) identities.push('principal:' + principal);
    let slot: ReturnType<typeof quota.take>;
    try { slot = quota.take(identities); } catch {
      return res.status(503).set('Cache-Control', 'no-store').json({ code: 'PROVIDER_BUDGET_UNAVAILABLE', error: 'El servicio no está disponible temporalmente.' });
    }
    if ('retryAfter' in slot) return res.status(429).set({
      'Retry-After': String(slot.retryAfter), 'Cache-Control': 'no-store',
    }).json({ code: 'PROVIDER_RATE_LIMIT', error: 'Espera antes de volver a consultar este servicio.' });
    try { return await operation(); }
    finally { slot.release(); }
  };
}
