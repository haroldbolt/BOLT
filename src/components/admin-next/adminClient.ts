import type { DeliveryQuote } from '../../lib/deliveryService';
import type { BoltAdminSalesReport, SalesPeriod } from '../../lib/boltAdminSales';
import type { Order } from '../../types';

export interface AdminActor {
  id: string;
  name: string;
  role: 'COORDINACION' | 'SEDE';
  storeIds: string[];
  canConfirm: boolean;
  canAdjustInventory: boolean;
  canAdjustPrices: boolean;
}

export interface AdminSession {
  mode: 'demo' | 'live';
  actor: AdminActor | null;
  stores: { id: string; name: string }[];
  profiles: { id: string; name: string; role: AdminActor['role']; storeId?: string }[];
}

export type AdminOrder = Pick<Order, 'id' | 'orderNumber' | 'purchaseCode' | 'createdAt' | 'storeId' | 'storeName' |
  'fulfillmentStatus' | 'deliveryMode' | 'scheduledWindow' | 'items' | 'totals' | 'timestamps' | 'isSplitOrder' | 'statusHistory'> & {
  deliveryReview?: Pick<NonNullable<Order['deliveryReview']>, 'status' | 'requestedAt' | 'requestedMode' | 'confirmedAt' | 'reasonCode'>;
  customer?: Pick<Order['customer'], 'name' | 'phone' | 'email'>;
  deliveryAddress?: Pick<Order['deliveryAddress'], 'address' | 'details' | 'locality'>;
  payment?: Pick<Order['payment'], 'status' | 'method'>;
  demoReadOnly?: boolean;
};

export type DemoOrderMode = Extract<Order['deliveryMode'], 'TURBO' | 'PROGRAMADO'>;

export type InventoryScope = 'store' | 'catalog';

export interface InventoryItem extends PriceItem {
  image: string;
  storeId: string | null;
  assignedToStore: boolean;
  stock: number;
  reserved: number;
  available: number;
  countedAt: string | null;
  demoReadOnly?: boolean;
  demoGalleryEdit?: boolean;
  canEditCatalog?: boolean;
}

export interface InventoryAdjustment {
  id: string;
  timestamp: string;
  name: string;
  sku: string;
  presentation: string;
  before: number;
  after: number;
  reason: string;
  actorName: string;
}

export interface PriceItem {
  productId: string;
  variantId: string;
  name: string;
  brand: string;
  sku: string;
  presentation: string;
  status?: string;
  price: number;
  originalPrice: number | null;
  revision: string;
}

export interface PriceAdjustment {
  productId: string;
  variantId: string;
  expectedRevision: string;
  regularPriceCOP: number;
  promoPriceCOP: number | null;
  reason: string;
}

export interface InventoryPhotoSources {
  productImage: string;
  variantImage: string | null;
  gallery: string[];
}

export type InventoryPhotoTarget = 'product' | 'variant';

export type NewInventoryPhoto = { dataUrl: string; filename: string };
export type InventoryGalleryPhoto = { url: string } | NewInventoryPhoto;

export type InventoryPhotoUpdate = {
  productId: string;
  variantId: string;
  expectedImage: string;
} & ({ target: 'variant' } & NewInventoryPhoto | {
  target: 'product';
  expectedGallery: string[];
  photos: InventoryGalleryPhoto[];
});

export class AdminRequestError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'AdminRequestError';
  }
}

const sessionTokenKey = 'bolt_admin_next_token';

export function readAdminToken() {
  try { return sessionStorage.getItem(sessionTokenKey); } catch { return null; }
}

export function storeAdminToken(token: string | null) {
  try {
    if (token) sessionStorage.setItem(sessionTokenKey, token);
    else sessionStorage.removeItem(sessionTokenKey);
  } catch { /* The current page can still hold the session in memory. */ }
}

async function request<T>(url: string, token: string | null, options: { body?: unknown; signal?: AbortSignal; method?: 'POST' | 'PUT'; idempotencyKey?: string } = {}): Promise<T> {
  const headers = new Headers({ Accept: 'application/json' });
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (options.body !== undefined) headers.set('Content-Type', 'application/json');
  if (options.idempotencyKey) headers.set('Idempotency-Key', options.idempotencyKey);
  const response = await fetch(url, {
    method: options.method ?? (options.body === undefined ? 'GET' : 'POST'), headers, credentials: 'same-origin',
    cache: 'no-store', redirect: 'error', signal: options.signal,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || (result === null && response.status !== 204)) {
    throw new AdminRequestError(typeof result?.error === 'string' ? result.error : 'No se pudo completar la consulta.', response.status);
  }
  return result as T;
}

const base = '/api/v1/bolt-admin';
const orderPath = (orderId: string) => `${base}/orders/${encodeURIComponent(orderId)}`;

export const boltAdmin = {
  session: (token: string | null, signal?: AbortSignal) => request<AdminSession>(`${base}/session`, token, { signal }),
  login: (email: string, password: string) => request<{ token: string }>('/api/v1/auth/login', null, { body: { email, password } }),
  demoLogin: (profileId: string) => request<{ token: string; actor: AdminActor }>(`${base}/demo/session`, null, { body: { profileId } }),
  logout: (token: string | null) => request<{ ok: boolean }>(`${base}/logout`, token, { body: {} }),
  orders: (token: string | null, storeId: string, signal?: AbortSignal) => request<{ orders: AdminOrder[] }>(
    `${base}/orders?${new URLSearchParams({ storeId })}`, token, { signal },
  ),
  inventory: (token: string | null, storeId: string | undefined, query: string, offset: number, scope: InventoryScope, signal?: AbortSignal) => request<{ items: InventoryItem[]; total: number; offset: number; limit: number }>(
    `${base}/inventory?${new URLSearchParams({ ...(storeId ? { storeId } : {}), query, scope, offset: String(offset), limit: '40' })}`, token, { signal },
  ),
  inventoryPhoto: (token: string | null, productId: string, variantId: string, signal?: AbortSignal) => request<InventoryPhotoSources>(
    `${base}/inventory/photo?${new URLSearchParams({ productId, variantId })}`, token, { signal },
  ),
  updateInventoryPhoto: (token: string | null, update: InventoryPhotoUpdate) => request<{ image: string }>(
    `${base}/inventory/photo`, token, { method: 'PUT', body: update },
  ),
  inventoryAdjustments: (token: string | null, storeId: string, signal?: AbortSignal) => request<{ adjustments: InventoryAdjustment[] }>(
    `${base}/inventory/adjustments?${new URLSearchParams({ storeId })}`, token, { signal },
  ),
  sales: (token: string | null, storeId: string, period: SalesPeriod, signal?: AbortSignal) => request<BoltAdminSalesReport>(
    `${base}/sales?${new URLSearchParams({ storeId, period })}`, token, { signal },
  ),
  adjustPrice: (token: string | null, adjustment: PriceAdjustment) => request<{ item: PriceItem }>(
    `${base}/prices`, token, { method: 'PUT', body: adjustment },
  ),
  adjustInventory: (token: string | null, item: InventoryItem, stock: number, reason: string) => request<{ item: InventoryItem }>(
    `${base}/inventory`, token, { method: 'PUT', body: { storeId: item.storeId, productId: item.productId, variantId: item.variantId, stock, expectedRevision: item.revision, reason } },
  ),
  createDemoOrder: (token: string | null, idempotencyKey: string, deliveryMode: DemoOrderMode) => request<{ orderId: string; guestAccessToken: string; trackingPath: string }>(
    `${base}/demo/orders`, token, { body: { deliveryMode }, idempotencyKey },
  ),
  quote: (token: string | null, orderId: string, body: unknown) => request<DeliveryQuote>(`${orderPath(orderId)}/quote`, token, { body }),
  confirm: (token: string | null, orderId: string, body: unknown) => request<AdminOrder>(`${orderPath(orderId)}/confirm`, token, { body }),
  startPreparation: (token: string | null, orderId: string) => request<AdminOrder>(`${orderPath(orderId)}/start-preparation`, token, { body: {} }),
};
