import { config } from 'dotenv';

// Never print values or send credentials. This script performs public GETs only.
config({ quiet: true });
const args = new Set(process.argv.slice(2));
const urlIndex = process.argv.indexOf('--url');
const present = name => typeof process.env[name] === 'string' && process.env[name].trim().length > 0;
const clientCredentials = present('SHOPIFY_CLIENT_ID') && present('SHOPIFY_CLIENT_SECRET');
const tokenCredentials = present('SHOPIFY_ADMIN_ACCESS_TOKEN');
const exposedNames = Object.keys(process.env).filter(name => /^VITE_.*(?:SHOPIFY.*(?:SECRET|TOKEN)|BOLT_ADMIN_API_TOKEN)$/i.test(name) && present(name));
const allowedStatuses = new Set(['SIN_CONFIGURAR', 'PENDIENTE_AUTORIZACION', 'CONECTADO', 'SINCRONIZANDO', 'ERROR_SINCRONIZACION', 'SNAPSHOT_IMPORTADO']);
const report = {
  localEnvironment: {
    domainConfigured: /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i.test(process.env.SHOPIFY_STORE_DOMAIN || ''),
    credentialMode: clientCredentials ? 'client_credentials' : tokenCredentials ? 'access_token' : 'missing',
    bothAuthorizationMethodsConfigured: clientCredentials && tokenCredentials,
    partialClientCredentials: present('SHOPIFY_CLIENT_ID') !== present('SHOPIFY_CLIENT_SECRET'),
    administrativeProtectionConfigured: present('BOLT_ADMIN_API_TOKEN'),
    webhookSigningConfigured: present('SHOPIFY_WEBHOOK_SECRET') || present('SHOPIFY_CLIENT_SECRET'),
    exposedServerSecretVariableNames: exposedNames,
  },
  server: null,
  verifiedLiveSynchronization: false,
};

if (!args.has('--env-only')) {
  try {
    const candidate = urlIndex < 0 ? 'http://127.0.0.1:3000' : process.argv[urlIndex + 1];
    if (!candidate || candidate.startsWith('--')) throw new Error('INVALID_STATUS_URL');
    const url = new URL(candidate);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || (url.pathname !== '/' && url.pathname !== '')) throw new Error('INVALID_STATUS_URL');
    const response = await fetch(new URL('/api/v1/inventory/status', url.origin), {
      method: 'GET', signal: AbortSignal.timeout(10000), redirect: 'error', headers: { Accept: 'application/json' },
    });
    if (!response.ok) {
      report.server = { reachable: true, httpStatus: response.status, errorCode: 'STATUS_NOT_AVAILABLE' };
    } else {
      const status = await response.json();
      const validDate = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
      const count = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
      report.server = {
        reachable: true, httpStatus: response.status,
        mode: ['READ_ONLY_SNAPSHOT', 'SHOPIFY_LIVE_READ_ONLY', 'UNCONFIGURED'].includes(status.mode) ? status.mode : null,
        status: allowedStatuses.has(status.status) ? status.status : null,
        credentialsConfigured: status.credentialsConfigured === true,
        automaticSync: status.automaticSync === true,
        schedulerRunning: status.schedulerRunning === true,
        liveVerified: status.liveVerified === true,
        isStale: status.isStale !== false,
        fetchedAt: validDate(status.fetchedAt),
        lastSuccessfulSync: validDate(status.lastSuccessfulSync),
        lastAttemptedSync: validDate(status.lastAttemptedSync),
        nextSyncAt: validDate(status.nextSyncAt),
        products: count(status.importedProductCount ?? status.productsCount ?? status.productCount),
        variants: count(status.importedVariantCount ?? status.variantCount),
        locations: count(status.locationsCount ?? (Array.isArray(status.locations) ? status.locations.length : null)),
        hasError: typeof status.errorCode === 'string' && status.errorCode.length > 0,
      };
      report.verifiedLiveSynchronization = report.server.mode === 'SHOPIFY_LIVE_READ_ONLY'
        && report.server.liveVerified && report.server.credentialsConfigured
        && report.server.automaticSync && report.server.schedulerRunning
        && !report.server.isStale && !report.server.hasError && report.server.lastSuccessfulSync !== null;
    }
  } catch (error) {
    report.server = { reachable: false, errorCode: error?.message === 'INVALID_STATUS_URL' ? 'INVALID_STATUS_URL' : 'STATUS_UNREACHABLE' };
  }
}

console.log(JSON.stringify(report, null, 2));
if (exposedNames.length || (args.has('--require-live') && !report.verifiedLiveSynchronization)) process.exitCode = 2;
