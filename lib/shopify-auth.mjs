// Server-only credential exchange. Never import this module into a client component.
// https://shopify.dev/docs/apps/build/authentication-authorization/client-credentials-grant
const REQUIRED_SCOPES = ['read_products', 'read_inventory', 'read_locations'];
const RENEW_EARLY_MS = 60_000;
const REQUEST_TIMEOUT_MS = 30_000;

export class ShopifyAuthError extends Error {
  constructor(code, message, metadata = {}) {
    super(message);
    this.name = 'ShopifyAuthError';
    this.code = code;
    Object.assign(this, metadata);
  }
}

function assertServer() {
  if (typeof window !== 'undefined') {
    throw new ShopifyAuthError('SERVER_ONLY_REQUIRED', 'La autorización de Shopify debe ejecutarse únicamente en el servidor.');
  }
}

function canonicalShopDomain(domain) {
  if (typeof domain !== 'string') throw new ShopifyAuthError('INVALID_DOMAIN', 'Configura el dominio canónico de la tienda Shopify.');
  const value = domain.trim().toLowerCase();
  if (value.length > 253 || !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.myshopify\.com$/.test(value)) {
    throw new ShopifyAuthError('INVALID_DOMAIN', 'El dominio debe terminar en .myshopify.com, sin rutas, puertos ni protocolo.');
  }
  return value;
}

function credential(value) {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value !== 'string' || /[\x00-\x1f\x7f]/.test(value)) {
    throw new ShopifyAuthError('INVALID_CREDENTIAL', 'La configuración de credenciales Shopify no es válida.');
  }
  return value.trim();
}

/**
 * Returns an async getToken() function. Tokens only exist in this closure's memory.
 * client_credentials requires an installed app and shop in the same Shopify org.
 * A server-owned accessToken may instead come from legacy/custom OAuth setup;
 * its issuer is responsible for scope selection and renewal outside this module.
 * This exchange never requests product/inventory writes or tries another shop.
 * @param {{domain?: string, clientId?: string, clientSecret?: string, accessToken?: string, fetchImpl?: typeof fetch, now?: () => number}} [options]
 */
export function createShopifyTokenProvider({
  domain,
  clientId,
  clientSecret,
  accessToken,
  fetchImpl = globalThis.fetch,
  now = Date.now,
} = {}) {
  assertServer();
  const shopDomain = canonicalShopDomain(domain);
  let cachedToken = null, expiresAt = 0, inFlight = null;

  function clock() {
    let value;
    try { value = now(); }
    catch { throw new ShopifyAuthError('INVALID_CONFIGURATION', 'No se pudo comprobar la vigencia de la autorización Shopify.'); }
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
      throw new ShopifyAuthError('INVALID_CONFIGURATION', 'No se pudo comprobar la vigencia de la autorización Shopify.');
    }
    return value;
  }

  async function exchange(id, secret) {
    if (typeof fetchImpl !== 'function') throw new ShopifyAuthError('FETCH_UNAVAILABLE', 'No está disponible la conexión HTTP del servidor.');
    const requestedAt = clock();
    let response;
    try {
      response = await fetchImpl('https://' + shopDomain + '/admin/oauth/access_token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'client_credentials', client_id: id, client_secret: secret }).toString(),
        redirect: 'error',
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      const timedOut = error?.name === 'AbortError' || error?.name === 'TimeoutError';
      throw new ShopifyAuthError(timedOut ? 'REQUEST_TIMEOUT' : 'NETWORK_ERROR', timedOut
        ? 'Shopify no respondió a la autorización dentro del tiempo permitido.'
        : 'No se pudo conectar con Shopify para autorizar la aplicación.');
    }
    // Bodies can contain credentials or other sensitive data. They are never included
    // in errors, attached as a cause, logged or returned to the caller.
    let text;
    try { text = await response.text(); }
    catch { throw new ShopifyAuthError('INVALID_RESPONSE', 'No se pudo leer la respuesta de autorización de Shopify.'); }
    let payload;
    try { payload = JSON.parse(text); }
    catch { payload = null; }
    const status = Number.isInteger(response.status) ? response.status : 502;
    if (!response.ok) {
      // Match only this known code. Never display Shopify's raw error description.
      if (/\bshop_not_permitted\b/i.test(text.slice(0, 16384))) {
        throw new ShopifyAuthError('SHOP_NOT_PERMITTED', 'Esta tienda y la aplicación deben pertenecer a la misma organización Shopify para usar estas credenciales. Si pertenecen a organizaciones distintas, configura la instalación mediante OAuth; no cambies de dominio para intentar autorizar.', { status });
      }
      if (status === 401 || status === 403 || status === 400) {
        throw new ShopifyAuthError('AUTHORIZATION_REQUIRED', 'Shopify no autorizó las credenciales. Revisa la aplicación instalada y su configuración de acceso.', { status });
      }
      if (status === 429) {
        throw new ShopifyAuthError('RATE_LIMITED', 'Shopify limitó temporalmente la autorización. Intenta nuevamente más tarde.', { status });
      }
      throw new ShopifyAuthError('HTTP_ERROR', 'Shopify no pudo completar la autorización de la aplicación.', { status });
    }
    if (!payload || typeof payload !== 'object' || typeof payload.access_token !== 'string' ||
      !payload.access_token.trim() || /[\s\x00-\x1f\x7f]/.test(payload.access_token) ||
      !Number.isSafeInteger(payload.expires_in) || payload.expires_in <= 0 ||
      typeof payload.scope !== 'string') {
      throw new ShopifyAuthError('INVALID_RESPONSE', 'La respuesta de autorización de Shopify no contiene un token válido con su vigencia y permisos.');
    }
    const grantedScopes = new Set(payload.scope.split(/[\s,]+/).filter(Boolean));
    const missingScopes = REQUIRED_SCOPES.filter(scope => !grantedScopes.has(scope));
    if (missingScopes.length) {
      throw new ShopifyAuthError('MISSING_SCOPES', 'La aplicación necesita aprobar los permisos de lectura de productos, inventario y ubicaciones en Shopify.', { missingScopes });
    }
    const tokenExpiresAt = requestedAt + payload.expires_in * 1000;
    if (!Number.isSafeInteger(tokenExpiresAt) || tokenExpiresAt <= clock()) {
      throw new ShopifyAuthError('INVALID_RESPONSE', 'La respuesta de autorización de Shopify no contiene una vigencia utilizable.');
    }
    cachedToken = payload.access_token;
    expiresAt = tokenExpiresAt;
    return cachedToken;
  }

  async function getToken() {
    assertServer();
    const directToken = credential(accessToken);
    if (directToken) return directToken;
    const id = credential(clientId), secret = credential(clientSecret);
    if (!id || !secret) {
      throw new ShopifyAuthError('MISSING_CREDENTIAL', 'Configura el Client ID y Client secret de la aplicación Shopify o un token de acceso autorizado en el servidor.');
    }
    if (cachedToken && clock() < expiresAt - RENEW_EARLY_MS) return cachedToken;
    if (!inFlight) inFlight = exchange(id, secret).finally(() => { inFlight = null; });
    return inFlight;
  }
  // A 401 may invalidate an otherwise unexpired token. Only credentials issued
  // by this provider can be renewed here; an external OAuth issuer owns its token.
  getToken.canRenew = !credential(accessToken);
  getToken.invalidate = () => { cachedToken = null; expiresAt = 0; };
  return getToken;
}
