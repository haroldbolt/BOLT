import { readFile, writeFile, mkdir, rename, unlink } from 'node:fs/promises';
import { mkdirSync, writeFileSync, renameSync } from 'node:fs';
import { randomUUID, createHmac, timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import { normalizeShopifySnapshot, type ShopifySnapshot } from '../src/lib/shopifyMapper';
import type { ShopifyConnectionStatus } from '../src/types';
import type { ShopifyInventory } from './shopifyInventory';
import { createShopifyTokenProvider } from './shopify-auth.mjs';
import { readShopifySnapshot } from './shopify-readonly.mjs';

const CANONICAL_DOMAIN = '1c76bc-08.myshopify.com';
const MAX_WEBHOOK_BYTES = 2 * 1024 * 1024;
const LEDGER_LIMIT = 2000;
const LEDGER_AGE_MS = 24 * 60 * 60 * 1000;
const WEBHOOK_TOPICS = new Set([
  'inventory_levels/update', 'inventory_levels/connect', 'inventory_levels/disconnect',
  'inventory_items/update', 'inventory_items/delete', 'products/create', 'products/update', 'products/delete',
  'locations/create', 'locations/update', 'locations/delete', 'locations/activate', 'locations/deactivate',
]);
const SAFE_CODES = new Set([
  'INVALID_DOMAIN', 'INVALID_CREDENTIAL', 'INVALID_CONFIGURATION', 'MISSING_CREDENTIAL',
  'AUTHORIZATION_REQUIRED', 'MISSING_SCOPES', 'SHOP_NOT_PERMITTED', 'NETWORK_ERROR', 'REQUEST_TIMEOUT',
  'HTTP_ERROR', 'RATE_LIMITED', 'INVALID_RESPONSE', 'INVALID_CURSOR', 'INVALID_API_VERSION',
  'DUPLICATE_RECORD', 'REPEATED_CURSOR', 'PAGINATION_LIMIT', 'STORE_MISMATCH', 'GRAPHQL_ERROR',
  'READ_ONLY_REQUIRED', 'SERVER_ONLY_REQUIRED', 'FETCH_UNAVAILABLE', 'INCOMPLETE_SNAPSHOT',
]);

export interface ShopifyRuntimeStatus {
  mode: 'READ_ONLY_SNAPSHOT' | 'SHOPIFY_LIVE_READ_ONLY' | 'UNCONFIGURED';
  status: ShopifyConnectionStatus;
  automaticSync: boolean;
  schedulerRunning: boolean;
  liveVerified: boolean;
  isStale: boolean;
  credentialsConfigured: boolean;
  fetchedAt?: string;
  lastSuccessfulSync?: string;
  lastLiveReadAt?: string;
  lastAttemptedSync?: string;
  errorCode?: string;
  errorMessage?: string;
  reconciliationIntervalMinutes: number;
  nextSyncAt?: string;
  storeDomain: string;
  apiVersion: string;
}

interface RuntimeOptions {
  projectRoot: string;
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  onInventory?: (inventory: ShopifyInventory) => void;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  timers?: {
    setInterval: (callback: () => void, ms: number) => any;
    clearInterval: (handle: any) => void;
    setTimeout: (callback: () => void, ms: number) => any;
    clearTimeout: (handle: any) => void;
  };
}

function inside(directory: string, file: string) {
  const relative = path.relative(directory, file);
  return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative));
}

export function createShopifyInventoryRuntime({
  projectRoot, env = process.env, fetchImpl = globalThis.fetch, onInventory,
  now = Date.now, sleep, timers = { setInterval, clearInterval, setTimeout, clearTimeout },
}: RuntimeOptions) {
  const root = path.resolve(projectRoot);
  const snapshotPath = path.resolve(root, env.BOLT_SHOPIFY_SNAPSHOT_PATH || '.bolt-private/shopify/snapshot.json');
  if (inside(path.join(root, 'public'), snapshotPath) || inside(path.join(root, 'dist'), snapshotPath)
    || (inside(root, snapshotPath) && !inside(path.join(root, '.bolt-private'), snapshotPath))) {
    throw new Error('El inventario debe guardarse en una ruta privada del servidor.');
  }
  const ledgerPath = path.join(path.dirname(snapshotPath), 'webhook-deliveries.json');
  const domain = (env.SHOPIFY_STORE_DOMAIN || CANONICAL_DOMAIN).trim().toLowerCase();
  const apiVersion = env.SHOPIFY_API_VERSION || '2026-10';
  const intervalInput = Number(env.SHOPIFY_SYNC_INTERVAL_MINUTES || 10);
  const intervalMinutes = Number.isFinite(intervalInput) && intervalInput >= 1 && intervalInput <= 1440 ? intervalInput : 10;
  const intervalMs = intervalMinutes * 60_000;
  const credentialsConfigured = !!(env.SHOPIFY_ADMIN_ACCESS_TOKEN?.trim()
    || (env.SHOPIFY_CLIENT_ID?.trim() && env.SHOPIFY_CLIENT_SECRET?.trim()));
  const webhookSecret = env.SHOPIFY_WEBHOOK_SECRET || env.SHOPIFY_CLIENT_SECRET || '';
  let inventory: ShopifyInventory | null = null;
  let initialized = false, running = false, liveVerified = false, syncing = false;
  let intervalHandle: any, webhookHandle: any;
  let lastSuccessfulSync: string | undefined, lastAttemptedSync: string | undefined, nextSyncAt: string | undefined;
  let errorCode: string | undefined = credentialsConfigured ? undefined : 'MISSING_CREDENTIAL';
  let tokenProvider: ReturnType<typeof createShopifyTokenProvider> | undefined;
  let inFlight: Promise<ShopifyRuntimeStatus> | undefined;
  let ledger = new Map<string, number>();

  const stamp = () => new Date(now()).toISOString();

  function normalize(raw: ShopifySnapshot): ShopifyInventory {
    if (raw?.complete !== true || raw.shop?.myshopifyDomain?.toLowerCase() !== domain || raw.shop?.currencyCode !== 'COP') {
      throw Object.assign(new Error('La lectura de inventario no es completa o no corresponde a esta tienda en COP.'), { code: 'INCOMPLETE_SNAPSHOT' });
    }
    const mapped = normalizeShopifySnapshot(raw);
    if (!mapped.status.complete) throw Object.assign(new Error('La lectura contiene páginas de inventario pendientes.'), { code: 'INCOMPLETE_SNAPSHOT' });
    return mapped;
  }

  function install(next: ShopifyInventory) {
    const previousProducts = new Map(inventory?.products.map(product => [product.shopifyVariantGid, product]) || []);
    for (const product of next.products) {
      const previous = previousProducts.get(product.shopifyVariantGid);
      if (previous) product.reservedStockByStore = { ...previous.reservedStockByStore };
    }
    const previousStores = new Map(inventory?.stores.map(store => [store.id, store]) || []);
    for (const store of next.stores) {
      const previous = previousStores.get(store.id);
      if (previous?.verificationStatus === 'VERIFIED' && previous.verifiedEntrance) {
        store.verifiedEntrance = { ...previous.verifiedEntrance };
        store.verificationStatus = previous.verificationStatus;
        store.verifiedAt = previous.verifiedAt;
        store.verifiedBy = previous.verifiedBy;
        store.placeId = previous.placeId;
      }
    }
    inventory = next;
    onInventory?.(next);
  }

  async function atomicWrite(raw: ShopifySnapshot) {
    await mkdir(path.dirname(snapshotPath), { recursive: true });
    const temporaryPath = snapshotPath + '.tmp-' + randomUUID();
    try {
      await writeFile(temporaryPath, JSON.stringify(raw), { encoding: 'utf8', mode: 0o600, flag: 'wx' });
      await rename(temporaryPath, snapshotPath);
    } catch {
      await unlink(temporaryPath).catch(() => undefined);
      throw Object.assign(new Error('No se pudo guardar la lectura privada de inventario.'), { code: 'CACHE_WRITE_FAILED' });
    }
  }

  function pruneLedger() {
    const minimum = now() - LEDGER_AGE_MS;
    ledger = new Map([...ledger].filter(([, at]) => at >= minimum && at <= now()).slice(-LEDGER_LIMIT));
  }

  function getStatus(): ShopifyRuntimeStatus {
    const fetchedAt = inventory?.status.fetchedAt;
    const age = fetchedAt ? now() - Date.parse(fetchedAt) : Infinity;
    const authorizationMissing = ['MISSING_CREDENTIAL', 'AUTHORIZATION_REQUIRED', 'MISSING_SCOPES', 'SHOP_NOT_PERMITTED', 'INVALID_CREDENTIAL'].includes(errorCode || '');
    const isStale = !liveVerified || !Number.isFinite(age) || age > intervalMs * 2 || age < -60_000 || authorizationMissing;
    let status: ShopifyConnectionStatus;
    if (!credentialsConfigured) status = 'PENDIENTE_AUTORIZACION';
    else if (syncing) status = 'SINCRONIZANDO';
    else if (errorCode) status = authorizationMissing ? 'PENDIENTE_AUTORIZACION' : 'ERROR_SINCRONIZACION';
    else status = liveVerified && !isStale ? 'CONECTADO' : 'PENDIENTE_AUTORIZACION';
    return {
      mode: liveVerified ? 'SHOPIFY_LIVE_READ_ONLY' : inventory ? 'READ_ONLY_SNAPSHOT' : 'UNCONFIGURED', status,
      automaticSync: running && credentialsConfigured, schedulerRunning: running && credentialsConfigured,
      liveVerified, isStale, credentialsConfigured, fetchedAt, lastSuccessfulSync, lastLiveReadAt: lastSuccessfulSync,
      lastAttemptedSync, nextSyncAt, reconciliationIntervalMinutes: intervalMinutes,
      errorCode,
      errorMessage: errorCode ? authorizationMissing
        ? 'Falta autorizar la aplicación de Shopify con lectura de productos, inventario y ubicaciones.'
        : 'No se pudo actualizar el inventario. Se conserva la última lectura completa disponible.' : undefined,
      storeDomain: /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.myshopify\.com$/.test(domain) ? domain : '',
      apiVersion: /^\d{4}-(?:01|04|07|10)$/.test(apiVersion) ? apiVersion : '',
    };
  }

  async function initialize() {
    if (initialized) return;
    initialized = true;
    try { install(normalize(JSON.parse(await readFile(snapshotPath, 'utf8')))); }
    catch { if (credentialsConfigured) errorCode = 'CACHE_UNAVAILABLE'; }
    try {
      const entries = JSON.parse(await readFile(ledgerPath, 'utf8'));
      if (Array.isArray(entries)) ledger = new Map(entries.filter(entry => Array.isArray(entry) && /^[A-Za-z0-9._:-]{1,200}$/.test(entry[0]) && Number.isFinite(entry[1])));
      pruneLedger();
    } catch { ledger = new Map(); }
  }

  async function syncNow(): Promise<ShopifyRuntimeStatus> {
    if (inFlight) return inFlight;
    if (!credentialsConfigured) { errorCode = 'MISSING_CREDENTIAL'; return getStatus(); }
    syncing = true;
    lastAttemptedSync = stamp();
    const task = async () => {
      try {
        tokenProvider ||= createShopifyTokenProvider({ domain, clientId: env.SHOPIFY_CLIENT_ID, clientSecret: env.SHOPIFY_CLIENT_SECRET, accessToken: env.SHOPIFY_ADMIN_ACCESS_TOKEN, fetchImpl, now });
        const raw = await readShopifySnapshot({ domain, tokenProvider, apiVersion, fetchImpl, now, sleep }) as ShopifySnapshot;
        const next = normalize(raw);
        await atomicWrite(raw);
        install(next);
        lastSuccessfulSync = raw.fetchedAt;
        liveVerified = true;
        errorCode = undefined;
      } catch (error: any) {
        errorCode = SAFE_CODES.has(error?.code) || error?.code === 'CACHE_WRITE_FAILED' ? error.code : 'SYNC_FAILED';
      } finally { syncing = false; }
      return getStatus();
    };
    inFlight = task().finally(() => { inFlight = undefined; });
    return inFlight;
  }

  function start() {
    if (running || !credentialsConfigured) return;
    running = true;
    nextSyncAt = new Date(now() + intervalMs).toISOString();
    void syncNow();
    intervalHandle = timers.setInterval(() => {
      nextSyncAt = new Date(now() + intervalMs).toISOString();
      void syncNow();
    }, intervalMs);
    intervalHandle?.unref?.();
  }

  function stop() {
    running = false;
    nextSyncAt = undefined;
    if (intervalHandle !== undefined) timers.clearInterval(intervalHandle);
    if (webhookHandle !== undefined) timers.clearTimeout(webhookHandle);
    intervalHandle = undefined; webhookHandle = undefined;
  }

  function acceptWebhook(rawBody: Buffer, headers: Record<string, string | undefined>) {
    if (!running || !credentialsConfigured || !webhookSecret) return { accepted: false, status: 503 };
    if (!Buffer.isBuffer(rawBody) || rawBody.length === 0 || rawBody.length > MAX_WEBHOOK_BYTES) return { accepted: false, status: 413 };
    const header = (name: string) => Object.entries(headers).find(([key]) => key.toLowerCase() === name)?.[1] || '';
    const signature = header('x-shopify-hmac-sha256');
    const id = header('x-shopify-webhook-id');
    if (header('x-shopify-shop-domain').toLowerCase() !== domain || !WEBHOOK_TOPICS.has(header('x-shopify-topic'))
      || !/^[A-Za-z0-9._:-]{1,200}$/.test(id) || !/^[A-Za-z0-9+/]{43}=$/.test(signature)) return { accepted: false, status: 401 };
    const expected = createHmac('sha256', webhookSecret).update(rawBody).digest();
    const received = Buffer.from(signature, 'base64');
    if (received.length !== expected.length || !timingSafeEqual(expected, received)) return { accepted: false, status: 401 };
    try { const payload = JSON.parse(rawBody.toString('utf8')); if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return { accepted: false, status: 400 }; }
    catch { return { accepted: false, status: 400 }; }
    pruneLedger();
    if (ledger.has(id)) return { accepted: true, status: 200, duplicate: true };
    const nextLedger = new Map([...ledger, [id, now()] as [string, number]].slice(-LEDGER_LIMIT));
    try {
      mkdirSync(path.dirname(ledgerPath), { recursive: true });
      const temporaryPath = ledgerPath + '.tmp-' + randomUUID();
      writeFileSync(temporaryPath, JSON.stringify([...nextLedger]), { mode: 0o600, flag: 'wx' });
      renameSync(temporaryPath, ledgerPath);
      ledger = nextLedger;
    } catch { return { accepted: false, status: 503 }; }
    if (webhookHandle === undefined) {
      webhookHandle = timers.setTimeout(() => { webhookHandle = undefined; if (running) void syncNow(); }, 1000);
      webhookHandle?.unref?.();
    }
    return { accepted: true, status: 200, duplicate: false };
  }

  return { initialize, getInventory: () => inventory, getStatus, start, stop, syncNow, acceptWebhook };
}
