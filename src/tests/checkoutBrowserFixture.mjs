// A private first-party cookie jar for checkout contract tests. The gateway cookie
// (when present) is forwarded only to the same origin to prepare the purchase.
export function checkoutBrowserFixture() {
  const jars = new Map();
  return async (input, options = {}) => {
    const url = new URL(input);
    if (options.method !== 'POST' || !['/api/v1/orders','/api/v1/simulation/customer-checkout'].includes(url.pathname)) {
      return fetch(input, options);
    }
    if (!['localhost','127.0.0.1','[::1]'].includes(url.hostname)) throw Error('Checkout de pruebas requiere una instalación local.');
    const headers = new Headers(options.headers);
    const key = url.origin + (headers.get('Cookie') ?? '');
    if (!jars.has(key)) {
      const prepareHeaders = new Headers();
      for (const name of ['Cookie','Origin']) if (headers.has(name)) prepareHeaders.set(name, headers.get(name));
      jars.set(key, (async () => {
        const response = await fetch(new URL('/api/v1/checkout/attempt',url), { method:'POST', headers:prepareHeaders, redirect:'error' });
        if (response.status !== 204) throw Error('No se preparó la sesión de checkout aislada: ' + response.status);
        const cookie = response.headers.getSetCookie().find(c => c.startsWith('bolt_checkout_local='));
        if (!cookie) throw Error('La sesión local de checkout no emitió la cookie.');
        return cookie.split(';')[0];
      })());
    }
    const session = await jars.get(key);
    headers.set('Cookie', [headers.get('Cookie'), session].filter(Boolean).join('; '));
    return fetch(url, { ...options, headers });
  };
}
export const checkoutFetch = checkoutBrowserFixture();
