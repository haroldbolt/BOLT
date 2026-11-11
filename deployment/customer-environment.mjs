// Explicit server-only allowlist. Demo/admin/Shopify secrets never reach the customer adapter.
export const customerEnvironmentNames = [
  'BOLT_CUSTOMER_ORIGIN', 'BOLT_CUSTOMER_DATABASE_URL', 'BOLT_CUSTOMER_SECRET',
  'BOLT_LEGAL_APPROVED_VERSION', 'BOLT_SMTP_HOST', 'BOLT_SMTP_PORT', 'BOLT_SMTP_SECURE',
  'BOLT_SMTP_USER', 'BOLT_SMTP_PASSWORD', 'BOLT_SMTP_FROM',
  'BOLT_RESEND_API_KEY', 'BOLT_CUSTOMER_MAIL_FROM',
  'BOLT_GOOGLE_CLIENT_ID', 'BOLT_GOOGLE_CLIENT_SECRET', 'BOLT_APPLE_SERVICE_ID', 'BOLT_APPLE_CLIENT_SECRET',
];
export function demoCustomerEnvironment(env, origin) {
  if (env.BOLT_DEMO_CUSTOMER_ACCOUNTS !== '1') return { env: {}, enabled: false };
  if (env.BOLT_CUSTOMER_ORIGIN !== origin || !env.BOLT_CUSTOMER_DATABASE_URL || !env.BOLT_CUSTOMER_SECRET || env.BOLT_CUSTOMER_SECRET.length < 32)
    throw Error('Configure the customer database, secret and exact demo origin before enabling accounts.');
  return {
    enabled: true,
    google: !!(env.BOLT_GOOGLE_CLIENT_ID && env.BOLT_GOOGLE_CLIENT_SECRET),
    apple: !!(env.BOLT_APPLE_SERVICE_ID && env.BOLT_APPLE_CLIENT_SECRET),
    env: { ...Object.fromEntries(customerEnvironmentNames.filter(n => env[n] !== undefined).map(n => [n, env[n]])), BOLT_DEMO_CUSTOMER_ACCOUNTS: '1' },
  };
}
