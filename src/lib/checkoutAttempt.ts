import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Express, Request, Response } from 'express';
import type { Order } from '../types';

const proofPattern = /^[A-Za-z0-9_-]{43}$/;
const retryWindowMs = 24 * 60 * 60 * 1000;
function cookieSettings(req: Request) {
  const secure = req.secure || process.env.BOLT_DEMO_PUBLIC_ORIGIN?.startsWith('https://') ||
    !['127.0.0.1', 'localhost', '[::1]'].includes(req.hostname);
  return { secure, name: secure ? '__Host-bolt_checkout_attempt' : 'bolt_checkout_local' };
}

function cookieProof(req: Request, name: string) {
  const values = (req.get('cookie') || '').split(';').map(s => s.trim()).filter(s => s.startsWith(name + '='));
  if (values.length !== 1) return undefined;
  const proof = values[0].slice(name.length + 1);
  return proofPattern.test(proof) ? proof : undefined;
}

export function mountCheckoutAttempt(app: Express) {
  app.post('/api/v1/checkout/attempt', (req, res) => {
    // An approved split PWA deliberately omits cookies. Its separate retry capability
    // is scoped to a single pending submission and never grants order-detail access.
    if (res.locals.authorizedPwaOrigin) return res.json({ proof: randomBytes(32).toString('base64url') });
    const { secure, name } = cookieSettings(req);
    if (!cookieProof(req, name)) {
      res.cookie(name, randomBytes(32).toString('base64url'), {
        httpOnly: true, secure, sameSite: 'strict', path: '/', maxAge: retryWindowMs,
      });
    }
    return res.status(204).end();
  });
}

export function checkoutVerifier(req: Request, res: Response, requestId: string) {
  const origin: string | undefined = res.locals.authorizedPwaOrigin;
  const proof = origin ? req.get('X-Bolt-Checkout-Proof') : cookieProof(req, cookieSettings(req).name);
  if (!proof || !proofPattern.test(proof)) return undefined;
  return createHash('sha256').update(JSON.stringify(['bolt-checkout-v1', origin ?? '', requestId, proof])).digest('hex');
}

export function sameCheckoutAttempt(order: Order, verifier?: string) {
  const age = Date.now() - Date.parse(order.createdAt);
  if (!Number.isFinite(age) || age < 0 || age >= retryWindowMs) return false;
  const expected = order.checkoutAttemptVerifier;
  return !!expected && !!verifier && /^[a-f0-9]{64}$/.test(expected) &&
    /^[a-f0-9]{64}$/.test(verifier) && timingSafeEqual(Buffer.from(expected,'hex'), Buffer.from(verifier,'hex'));
}

export function checkoutProofRequired(res: Response) {
  return res.status(428).json({ code: 'CHECKOUT_SESSION_REQUIRED', error: 'Prepara la sesión de compra en este navegador y vuelve a confirmar.' });
}
