/** The public gateway is the only process allowed to forward a real customer origin. */
export function acceptsDemoOrigin(input: { host?: string; origin?: string; path: string; method: string; remoteAddress?: string }, port: number, env = process.env) {
  if (!/^127\.0\.0\.1(:\d+)?$/.test(input.host || '')) return false;
  if (!input.origin || input.origin === `http://127.0.0.1:${port}`) return true;
  const loopback = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(input.remoteAddress || '');
  if (!loopback || env.BOLT_DEMO_CUSTOMER_ACCOUNTS !== '1' || !env.BOLT_CUSTOMER_ORIGIN) return false;
  if (input.origin === env.BOLT_CUSTOMER_ORIGIN) return true;
  return !!env.BOLT_APPLE_SERVICE_ID && !!env.BOLT_APPLE_CLIENT_SECRET &&
    input.origin === 'https://appleid.apple.com' && input.method === 'POST' && input.path === '/api/customer-auth/callback/apple';
}
