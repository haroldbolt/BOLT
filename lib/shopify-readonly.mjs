import { LOCATIONS_QUERY, VARIANTS_QUERY, INVENTORY_LEVELS_QUERY } from './shopify-queries.mjs';

const PAGE_SIZE = 20;
const MAX_PAGES = 2000;
const MAX_ATTEMPTS = 3;
const REQUEST_TIMEOUT_MS = 30000;
const MAX_WAIT_MS = 30000;

export class ShopifyReadError extends Error {
  constructor(code, message, metadata = {}) {
    super(message);
    this.name = 'ShopifyReadError';
    this.code = code;
    Object.assign(this, metadata);
  }
}

function connection(value, key) {
  if (!value || !Array.isArray(value.nodes) || typeof value.pageInfo?.hasNextPage !== 'boolean') {
    throw new ShopifyReadError('INVALID_RESPONSE', 'Shopify devolvió datos incompletos para ' + key + '.');
  }
  if (value.pageInfo.hasNextPage && (typeof value.pageInfo.endCursor !== 'string' || !value.pageInfo.endCursor)) {
    throw new ShopifyReadError('INVALID_CURSOR', 'Shopify no devolvió un cursor utilizable para ' + key + '.');
  }
  return value;
}

function retryDelay(header, attempt, now) {
  if (header) {
    const seconds = Number(header);
    if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
    const date = Date.parse(header);
    if (Number.isFinite(date)) return Math.max(0, date - now());
  }
  return Math.min(500 * 2 ** attempt, MAX_WAIT_MS);
}

/**
 * Only authenticated queries are sent. No product, inventory or order mutations.
 * @param {{domain?: string, token?: string, tokenProvider?: (() => Promise<string>) & {canRenew?: boolean, invalidate?: () => void}, apiVersion?: string, fetchImpl?: typeof fetch, onProgress?: (progress: {phase: string, pages: number, records: number, hasNextPage: boolean}) => void, now?: () => number, sleep?: (ms: number) => Promise<void>}} [options]
 */
export async function readShopifySnapshot({
  domain, token, tokenProvider, apiVersion = '2026-10', fetchImpl = globalThis.fetch,
  onProgress, now = Date.now, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
} = {}) {
  if (typeof window !== 'undefined') throw new ShopifyReadError('SERVER_ONLY_REQUIRED', 'La lectura de Shopify pertenece al servidor.');
  const canonicalDomain = String(domain || '').trim().toLowerCase();
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.myshopify\.com$/.test(canonicalDomain)) throw new ShopifyReadError('INVALID_DOMAIN', 'Configura un dominio canónico de Shopify válido.');
  if (!/^\d{4}-(?:01|04|07|10)$/.test(apiVersion)) throw new ShopifyReadError('INVALID_API_VERSION', 'Configura una versión estable de Shopify.');
  if (typeof fetchImpl !== 'function') throw new ShopifyReadError('FETCH_UNAVAILABLE', 'No está disponible la conexión HTTP.');
  const getToken = typeof tokenProvider === 'function' ? tokenProvider : async () => token;
  const endpoint = 'https://' + canonicalDomain + '/admin/api/' + apiVersion + '/graphql.json';
  let pendingThrottleMs = 0;

  async function wait(ms) {
    if (!Number.isFinite(ms) || ms > MAX_WAIT_MS) throw new ShopifyReadError('RATE_LIMITED', 'Shopify solicita esperar antes de volver a leer.', { retryAfterSeconds: Math.ceil(ms / 1000) });
    if (ms > 0) await sleep(ms);
  }

  async function execute(query, variables) {
    if (!/^\s*query\b/.test(query) || /\bmutation\b/.test(query)) throw new ShopifyReadError('READ_ONLY_REQUIRED', 'Solo se admiten consultas de lectura.');
    let renewed = false;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      await wait(pendingThrottleMs); pendingThrottleMs = 0;
      const secret = await getToken();
      if (typeof secret !== 'string' || !secret.trim() || /[\s\x00-\x1f\x7f]/.test(secret)) throw new ShopifyReadError('MISSING_CREDENTIAL', 'Falta una credencial autorizada de Shopify.');
      let response;
      try {
        response = await fetchImpl(endpoint, {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': secret },
          body: JSON.stringify({ query, variables }), signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS), redirect: 'error',
        });
      } catch (error) {
        if (attempt < MAX_ATTEMPTS - 1) { await wait(retryDelay(null, attempt, now)); continue; }
        const timedOut = error?.name === 'AbortError' || error?.name === 'TimeoutError';
        throw new ShopifyReadError(timedOut ? 'REQUEST_TIMEOUT' : 'NETWORK_ERROR', 'No se pudo completar la conexión con Shopify.');
      }
      if (response.status === 401 && !renewed && getToken.canRenew && typeof getToken.invalidate === 'function') { renewed = true; getToken.invalidate(); continue; }
      if (response.status === 429 || response.status >= 500) {
        if (attempt === MAX_ATTEMPTS - 1) throw new ShopifyReadError(response.status === 429 ? 'RATE_LIMITED' : 'HTTP_ERROR', 'Shopify no pudo completar la lectura.', { status: response.status });
        await wait(retryDelay(response.headers?.get('Retry-After'), attempt, now)); continue;
      }
      if (!response.ok) throw new ShopifyReadError(response.status === 401 || response.status === 403 ? 'AUTHORIZATION_REQUIRED' : 'HTTP_ERROR', 'Shopify no autorizó o no pudo completar la lectura.', { status: response.status });
      let payload;
      try { payload = await response.json(); }
      catch { throw new ShopifyReadError('INVALID_RESPONSE', 'Shopify no devolvió una respuesta válida.'); }
      const throttle = payload.extensions?.cost?.throttleStatus;
      const requestedCost = Number(payload.extensions?.cost?.requestedQueryCost);
      const remaining = Number(throttle?.currentlyAvailable), restoreRate = Number(throttle?.restoreRate);
      if (Number.isFinite(requestedCost) && Number.isFinite(remaining) && restoreRate > 0) pendingThrottleMs = Math.max(0, Math.ceil((requestedCost - remaining) / restoreRate * 1000));
      if (Array.isArray(payload.errors) && payload.errors.length) {
        if (payload.errors.every(error => error?.extensions?.code === 'THROTTLED') && attempt < MAX_ATTEMPTS - 1) { if (!pendingThrottleMs) pendingThrottleMs = retryDelay(null, attempt, now); continue; }
        throw new ShopifyReadError(payload.errors.some(error => error?.extensions?.code === 'ACCESS_DENIED') ? 'AUTHORIZATION_REQUIRED' : 'GRAPHQL_ERROR', 'Shopify rechazó una consulta de lectura. Revisa los permisos y la versión de API.');
      }
      if (!payload.data || typeof payload.data !== 'object') throw new ShopifyReadError('INVALID_RESPONSE', 'Shopify devolvió una respuesta sin datos.');
      return payload.data;
    }
    throw new ShopifyReadError('AUTHORIZATION_REQUIRED', 'No se pudo renovar la autorización de Shopify.');
  }

  async function readConnection(query, key) {
    const nodes = [], ids = new Set(), cursors = new Set();
    let after = null, shop;
    for (let page = 1; page <= MAX_PAGES; page++) {
      const data = await execute(query, { first: PAGE_SIZE, after });
      if (data.shop) { if (data.shop.myshopifyDomain?.toLowerCase() !== canonicalDomain) throw new ShopifyReadError('STORE_MISMATCH', 'La lectura corresponde a una tienda distinta.'); shop = data.shop; }
      const result = connection(data[key], key);
      for (const node of result.nodes) {
        if (typeof node?.id !== 'string' || ids.has(node.id)) throw new ShopifyReadError('DUPLICATE_RECORD', 'Shopify devolvió identificadores ausentes o repetidos.');
        ids.add(node.id); nodes.push(node);
      }
      onProgress?.({ phase: key, pages: page, records: nodes.length, hasNextPage: result.pageInfo.hasNextPage });
      if (!result.pageInfo.hasNextPage) return { nodes, shop };
      if (cursors.has(result.pageInfo.endCursor)) throw new ShopifyReadError('REPEATED_CURSOR', 'Se recibió un cursor repetido.');
      cursors.add(result.pageInfo.endCursor); after = result.pageInfo.endCursor;
    }
    throw new ShopifyReadError('PAGINATION_LIMIT', 'Se alcanzó el límite de páginas antes de completar la lectura.');
  }

  const locationResult = await readConnection(LOCATIONS_QUERY, 'locations');
  if (!locationResult.shop) throw new ShopifyReadError('INVALID_RESPONSE', 'La lectura no incluye la identidad de la tienda.');
  const variantResult = await readConnection(VARIANTS_QUERY, 'productVariants');
  const warnings = [];
  for (const variant of variantResult.nodes) {
    const item = variant.inventoryItem;
    if (!item) throw new ShopifyReadError('INVALID_RESPONSE', 'Faltan los datos de inventario de una variante.');
    let levels = connection(item.inventoryLevels, 'inventoryLevels');
    const nodes = [...levels.nodes], seenLocations = new Set(nodes.map(level => level.location?.id)), seenCursors = new Set();
    if (seenLocations.size !== nodes.length) throw new ShopifyReadError('DUPLICATE_RECORD', 'Una ubicación de inventario está repetida.');
    for (let page = 1; levels.pageInfo.hasNextPage; page++) {
      if (page > MAX_PAGES || seenCursors.has(levels.pageInfo.endCursor)) throw new ShopifyReadError('REPEATED_CURSOR', 'No se pudo completar la paginación del inventario.');
      seenCursors.add(levels.pageInfo.endCursor);
      const data = await execute(INVENTORY_LEVELS_QUERY, { id: item.id, first: 100, after: levels.pageInfo.endCursor });
      if (data.inventoryItem?.id !== item.id) throw new ShopifyReadError('INVALID_RESPONSE', 'El inventario de la página no corresponde a la variante.');
      levels = connection(data.inventoryItem.inventoryLevels, 'inventoryLevels');
      for (const level of levels.nodes) {
        if (!level.location?.id || seenLocations.has(level.location.id)) throw new ShopifyReadError('DUPLICATE_RECORD', 'Una ubicación del inventario no es válida o está repetida.');
        seenLocations.add(level.location.id); nodes.push(level);
      }
    }
    item.inventoryLevels = { nodes, pageInfo: { hasNextPage: false, endCursor: levels.pageInfo.endCursor ?? null } };
    for (const [field, value, limit] of [['variantMedia', variant.media, 2], ['productMedia', variant.product?.media, 6]]) {
      if (value?.pageInfo?.hasNextPage) warnings.push({ code: 'MEDIA_CONNECTION_TRUNCATED', variantId: variant.id, field, limit });
    }
  }
  return {
    shop: locationResult.shop, locations: locationResult.nodes, variants: variantResult.nodes,
    fetchedAt: new Date(now()).toISOString(), complete: true, issues: [], warnings,
    mediaComplete: warnings.length === 0,
    galleryLimitNotice: 'La galería conserva hasta 2 medios por variante y 6 por producto; las cantidades de inventario se paginan completas.',
    source: 'SHOPIFY_ADMIN_READ_ONLY', apiVersion, consistency: 'PAGINATED_READ',
  };
}
