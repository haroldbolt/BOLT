import { backendFetch, isBoltSplitDeployment } from './backendRequest';

export class CheckoutAttemptNeedsReview extends Error {
  constructor(public requestId: string) { super('Revisa la confirmación anterior antes de iniciar otra compra.'); }
}

type Attempt = { fingerprint: string; requestId: string; proof?: string };
const key = 'bolt_checkout_request';
const sharedKey = 'bolt_checkout_pending_v2';
let pending: Attempt | undefined;

function read(storage: Storage, name: string, fingerprint: string): Attempt | undefined {
  const value = JSON.parse(storage.getItem(name) || 'null');
  if (value?.fingerprint === fingerprint && typeof value.requestId === 'string') return value;
}

function remember(attempt: Attempt, shared: boolean) {
  pending = attempt;
  try {
    sessionStorage.setItem(key, JSON.stringify(attempt));
    if (shared) localStorage.setItem(sharedKey, JSON.stringify({ fingerprint: attempt.fingerprint, requestId: attempt.requestId }));
  } catch { /* Memory still supports retries in this page. */ }
}

let preparing = Promise.resolve();
export async function prepareCheckout(fingerprint: string, explicitRequestId?: string) {
  const split = isBoltSplitDeployment();
  async function prepare() {
    let prior = pending?.fingerprint === fingerprint ? pending : undefined;
    try {
      prior = read(sessionStorage, key, fingerprint) ?? prior;
      if (!prior && !split && !explicitRequestId) prior = read(localStorage, sharedKey, fingerprint);
    } catch { /* Private browsing may disable storage. */ }
    const attempt = prior && (!explicitRequestId || prior.requestId === explicitRequestId) ? prior
      : { fingerprint, requestId: explicitRequestId ?? crypto.randomUUID() } as Attempt;
    if (!split || !attempt.proof) {
      const response = await backendFetch('/api/v1/checkout/attempt', { method: 'POST', cache: 'no-store' });
      if (!response.ok) throw Error('No pudimos preparar el acceso privado a tu compra. Intenta nuevamente.');
      if (split) {
        const { proof } = await response.json();
        if (typeof proof !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(proof)) throw Error('No pudimos preparar la sesión de compra.');
        attempt.proof = proof;
      }
    }
    remember(attempt, !split && !explicitRequestId);
    return { 'Idempotency-Key': attempt.requestId, ...(attempt.proof && { 'X-Bolt-Checkout-Proof': attempt.proof }) };
  }
  // Two tabs confirming the same pending cart share the first-party cookie and request id.
  if (typeof navigator !== 'undefined' && navigator.locks) return navigator.locks.request('bolt-checkout-prepare', prepare);
  const job = preparing.then(prepare);
  preparing = job.then(() => {}, () => {});
  return job;
}

export function finishCheckout(requestId: string) {
  if (pending?.requestId === requestId) pending = undefined;
  try {
    if (JSON.parse(sessionStorage.getItem(key) || 'null')?.requestId === requestId) sessionStorage.removeItem(key);
    if (JSON.parse(localStorage.getItem(sharedKey) || 'null')?.requestId === requestId) localStorage.removeItem(sharedKey);
  } catch { /* The purchase is already confirmed. */ }
}
