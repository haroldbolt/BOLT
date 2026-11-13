import crypto from 'node:crypto';
import express, { type Express, type Request, type Response } from 'express';
import { INITIAL_ORDERS } from '../data/seedData';
import type { Order, Product, Store } from '../types';
import type { DispatchRun } from '../types/dispatch';
import type { AdminAuthService } from './adminAuthService';
import { isBoltAdminDemoOrder, type BoltAdminDemoMode } from './boltAdminDemo';
import { buildBoltAdminSalesReport } from './boltAdminSales';
import type { CatalogOperations } from './catalogOperations';
import type { CatalogImagePatch } from './catalogImagePatch';
import type { CatalogRepository } from './catalogRepository';
import { catalogPhotoGallery, MAX_PRODUCT_GALLERY_PHOTOS } from './productImages';
import { isDemoInventoryDeliveryOrder } from './demoInventoryDelivery';
import type { OrdersRepository } from './ordersRepository';
import { saleVariant, validOriginalPrice } from './variantCommerce';

const base = '/api/v1/bolt-admin';
export const boltAdminPhotoPath = base + '/inventory/photo';
const subaId = 'HUB_SUBA';
const seedOrderIds = new Set(INITIAL_ORDERS.map(order => order.id));
const demoProfiles = [
  { id: 'suba', name: 'Operador de Suba', role: 'SEDE', storeId: subaId },
  { id: 'kennedy', name: 'Operador de Kennedy', role: 'SEDE', storeId: 'HUB_KENNEDY' },
  { id: 'coordinacion', name: 'Coordinación', role: 'COORDINACION' },
] as const;

type Actor = {
  id: string;
  name: string;
  email: string;
  role: 'COORDINACION' | 'SEDE';
  storeIds: string[];
  canConfirm: boolean;
  canAdjustInventory: boolean;
  canAdjustPrices: boolean;
};

type PendingDeliveryAction = (req: Request, res: Response, order: Order, actor: Actor) => void;

type PhotoEntry = { url: string } | { dataUrl: string; filename?: string };

function validPhotoEntries(value: unknown, gallery: string[]): value is PhotoEntry[] {
  if (!Array.isArray(value) || value.length > MAX_PRODUCT_GALLERY_PHOTOS) return false;
  const seen = new Set<string>();
  return value.every(entry => {
    if (!entry || typeof entry !== 'object') return false;
    if ('url' in entry && ('dataUrl' in entry || typeof entry.url !== 'string' || !gallery.includes(entry.url))) return false;
    const source = 'url' in entry ? entry.url : entry.dataUrl;
    if (typeof source !== 'string' || !source || seen.has(source) ||
        (entry.filename !== undefined && typeof entry.filename !== 'string')) return false;
    seen.add(source);
    return true;
  });
}

type Options = {
  adminAuth: Pick<AdminAuthService, 'verifySession' | 'logout'>;
  catalog: Pick<CatalogOperations, 'edit' | 'getAuditLog'>;
  photos: Pick<CatalogRepository, 'getProductById' | 'applyImagePatches'>;
  uploadPhoto: (dataUrl: string, filename?: string) => { url: string; discard: () => void };
  getProducts: () => Product[];
  getStores: () => Store[];
  getOrders: () => Order[];
  getDispatchRuns: () => DispatchRun[];
  getOrder: (id: string) => Order | undefined;
  quote: PendingDeliveryAction;
  confirm: PendingDeliveryAction;
  startPreparation: PendingDeliveryAction;
  demo?: {
    productId: string;
    editCatalog?: boolean;
    galleryProductId?: string;
    completeInventoryDelivery: OrdersRepository['completeDemoInventoryDelivery'];
    isOrder: (order: Order) => boolean;
    createOrder: (requestId: string | undefined, requestedMode: BoltAdminDemoMode) => Order;
    guestToken: (order: Order) => string;
  };
};

function sessionActor({ email: _email, ...actor }: Actor) {
  return actor;
}

export function boltAdminOrder(order: Order, demoReadOnly = false) {
  const review = order.deliveryReview;
  return {
    id: order.id,
    orderNumber: order.orderNumber,
    purchaseCode: order.purchaseCode,
    storeId: order.storeId,
    storeName: order.storeName,
    createdAt: order.createdAt,
    fulfillmentStatus: order.fulfillmentStatus,
    deliveryMode: order.deliveryMode,
    isSplitOrder: order.isSplitOrder,
    scheduledWindow: order.scheduledWindow,
    deliveryReview: review && {
      status: review.status,
      requestedAt: review.requestedAt,
      requestedMode: review.requestedMode,
      confirmedAt: review.confirmedAt,
      reasonCode: review.reasonCode,
    },
    ...(demoReadOnly ? { demoReadOnly: true } : {
      customer: order.customer,
      deliveryAddress: {
        address: order.deliveryAddress.address,
        details: order.deliveryAddress.details,
        locality: order.deliveryAddress.locality,
      },
    }),
    items: demoReadOnly ? order.items.map(({ productId, sku, name, brand, presentation, price, quantity, image, weightKg, requiresPrescription }) => ({
      productId, sku, name, brand, presentation, price, quantity, image, weightKg, requiresPrescription,
    })) : order.items,
    totals: order.totals,
    payment: { method: order.payment.method, status: order.payment.status },
    timestamps: order.timestamps,
    statusHistory: order.statusHistory?.map(({ previousStatus, newStatus, timestamp, actor }) => ({
      previousStatus, newStatus, timestamp, ...(!demoReadOnly && { actor }),
    })),
  };
}

function belongsToStore(product: Product, store: Store) {
  return product.bodegaIds
    ? product.bodegaIds.includes(store.id) || (!!store.shopifyLocationGid && product.bodegaIds.includes(store.shopifyLocationGid))
    : Object.hasOwn(product.stockByStore, store.id);
}

function inventoryItem(product: Product, store: Store | undefined, permissions: {
  demoReadOnly: boolean;
  canEditStock: boolean;
  canEditPrice: boolean;
  canEditPhoto: boolean;
}) {
  const assignedToStore = !!store && belongsToStore(product, store);
  const stock = store && assignedToStore ? (product.stockByStore[store.id] ?? 0) : 0;
  const reserved = store && assignedToStore ? (product.reservedStockByStore[store.id] ?? 0) : 0;
  return {
    ...priceItem(product),
    image: product.image,
    ...(permissions.demoReadOnly && { demoReadOnly: true }),
    canEditStock: permissions.canEditStock,
    canEditPrice: permissions.canEditPrice,
    canEditPhoto: permissions.canEditPhoto,
    storeId: store?.id ?? null,
    assignedToStore,
    stock,
    reserved,
    available: Math.max(0, stock - reserved),
    countedAt: null,
  };
}

function priceItem(product: Product) {
  const { originalPrice, price } = product;
  return {
    productId: product.parentProductId ?? product.id,
    variantId: product.variantId ?? product.id,
    name: product.name,
    brand: product.brand,
    sku: product.sku,
    presentation: product.presentation,
    price,
    status: product.status,
    originalPrice: validOriginalPrice(price, originalPrice) ?? null,
    revision: product.commerceRevision,
  };
}

function validPriceCOP(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value <= Number.MAX_SAFE_INTEGER / 100;
}

function normalizeQuery(value: string) {
  return value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim();
}

function pageParam(value: unknown, fallback: number, max: number) {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) return fallback;
  return Math.min(Number(value), max);
}

export function mountBoltAdmin(app: Express, options: Options) {
  const demoSessions = new Map<string, { actor: Actor; expiresAt: number }>();
  const activeStores = () => options.getStores().filter(store => store.isActive);
  const isOperationalOrder = (order: Order) => !options.demo || options.demo.isOrder(order);
  // The checkout server generates the SHA-256 fingerprint. Seeded and standalone simulation orders use other formats.
  const isDemoCheckoutOrder = (order: Order) => !!options.demo && !!order.creationRequestId &&
    /^[a-f0-9]{64}$/.test(order.creationRequestFingerprint ?? '');
  const isVisibleOrder = (order: Order) => isOperationalOrder(order) || isDemoCheckoutOrder(order);
  const presentOrder = (order: Order) => ({
    ...boltAdminOrder(order, isDemoCheckoutOrder(order)),
    ...(options.demo && order.fulfillmentStatus === 'PENDIENTE_CONFIRMACION' &&
      order.deliveryReview?.status === 'PENDING' && isDemoInventoryDeliveryOrder(order) && { canSimulateDelivery: true }),
  });
  const isActiveProduct = (product: Product) => !product.status || product.status === 'ACTIVE';
  const isDemoFixture = (product: Product) => (product.parentProductId ?? product.id) === options.demo?.productId;
  const isDemoGalleryProduct = (product: Product) => (product.parentProductId ?? product.id) === options.demo?.galleryProductId;
  const canEditDemoProduct = (product: Product) =>
    options.demo?.editCatalog === true && !(product.parentProductId ?? product.id).startsWith('SIM-');
  const isStockProduct = (product: Product) =>
    isDemoFixture(product) || ((!options.demo || canEditDemoProduct(product)) && isActiveProduct(product));
  const isCatalogEditProduct = (product: Product) =>
    !options.demo || isDemoFixture(product) || canEditDemoProduct(product);

  function inventoryRow(product: Product, actor: Actor, store?: Store) {
    const canEditCatalog = actor.canAdjustPrices && isCatalogEditProduct(product);
    const canEditPhoto = actor.canAdjustPrices && (canEditCatalog || isDemoGalleryProduct(product));
    const canEditStock = actor.canAdjustInventory && !!store && belongsToStore(product, store) && isStockProduct(product);
    return inventoryItem(product, store, {
      demoReadOnly: !!options.demo && !canEditCatalog && !canEditStock && !canEditPhoto,
      canEditStock,
      canEditPrice: canEditCatalog,
      canEditPhoto,
    });
  }

  function bearer(req: Request) {
    const auth = req.get('Authorization');
    return auth?.startsWith('Bearer ') ? auth.slice(7).trim() : undefined;
  }

  function getActor(req: Request): Actor | null {
    const token = bearer(req);
    if (!token) return null;
    const demoSession = demoSessions.get(token);
    if (demoSession) {
      if (demoSession.expiresAt > Date.now()) return demoSession.actor;
      demoSessions.delete(token);
      return null;
    }
    const admin = options.adminAuth.verifySession(token);
    if (!admin || admin.role !== 'ADMINISTRADOR') return null;
    return {
      id: admin.userId, name: admin.name, email: admin.email, role: 'COORDINACION',
      storeIds: activeStores().map(store => store.id), canConfirm: true, canAdjustInventory: true, canAdjustPrices: true,
    };
  }

  function authorize(req: Request, res: Response) {
    const actor = getActor(req);
    if (!actor) res.status(401).json({ error: 'Inicia sesión en BOLT Admin.' });
    return actor;
  }

  function selectStore(req: Request, res: Response, actor: Actor, value: unknown = req.query.storeId) {
    const storeId = value ?? (actor.storeIds.length === 1 ? actor.storeIds[0] : undefined);
    if (typeof storeId !== 'string') {
      res.status(400).json({ error: 'Selecciona una sede.' });
      return undefined;
    }
    if (!actor.storeIds.includes(storeId)) {
      res.status(403).json({ error: 'Tu cuenta no tiene acceso a esta sede.' });
      return undefined;
    }
    const store = activeStores().find(candidate => candidate.id === storeId);
    if (!store) res.status(404).json({ error: 'Sede no disponible.' });
    return store;
  }

  function selectOrder(req: Request, res: Response, actor: Actor, forOperation = false) {
    const order = options.getOrder(req.params.orderId);
    if (!order || !isVisibleOrder(order)) {
      res.status(404).json({ error: 'Pedido no encontrado.' });
      return undefined;
    }
    if (!actor.storeIds.includes(order.storeId)) {
      res.status(403).json({ error: 'Tu cuenta no tiene acceso al pedido de otra sede.' });
      return undefined;
    }
    if (forOperation && !isOperationalOrder(order)) {
      res.status(403).json({ error: 'Los pedidos de BOLT Cliente están disponibles para consulta en esta demo.' });
      return undefined;
    }
    return order;
  }

  function selectPhoto(req: Request, res: Response, productId: unknown, variantId: unknown) {
    const actor = authorize(req, res);
    if (!actor) return;
    if (!actor.canAdjustPrices) {
      res.status(403).json({ error: 'Tu perfil solo puede consultar las fotos del catálogo.' });
      return;
    }
    if (typeof productId !== 'string' || typeof variantId !== 'string') {
      res.status(400).json({ error: 'Selecciona el producto y la presentación.' });
      return;
    }
    const product = options.photos.getProductById(productId);
    const variant = product?.presentaciones?.find(item => item.varianteId === variantId);
    if (!product || product.id !== productId || (!isCatalogEditProduct(product) && !isDemoGalleryProduct(product)) ||
        (!variant && (product.presentaciones?.length || variantId !== product.id))) {
      res.status(404).json({ error: 'La presentación no está disponible para editar fotos.' });
      return;
    }
    return { actor, product, variant };
  }

  app.use(base, (_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });

  app.get(base + '/session', (req, res) => {
    const actor = getActor(req);
    const stores = actor ? activeStores().filter(store => actor.storeIds.includes(store.id)) : [];
    res.json({
      mode: options.demo ? 'demo' : 'live',
      actor: actor ? sessionActor(actor) : null,
      stores: stores.map(({ id, name }) => ({ id, name })),
      profiles: options.demo ? demoProfiles : [],
    });
  });

  if (options.demo) {
    const demo = options.demo;
    app.post(base + '/demo/session', (req, res) => {
      const profile = demoProfiles.find(entry => entry.id === req.body?.profileId);
      if (!profile) return res.status(400).json({ error: 'Selecciona un perfil de prueba válido.' });
      const now = Date.now();
      for (const [token, session] of demoSessions) if (session.expiresAt <= now) demoSessions.delete(token);
      if (demoSessions.size >= 1024) return res.status(429).json({ error: 'Hay demasiadas sesiones de prueba abiertas.' });
      const coordination = profile.role === 'COORDINACION';
      const actor: Actor = {
        id: 'bolt-admin-demo-' + profile.id,
        name: profile.name,
        email: profile.id + '@demo.invalid',
        role: profile.role,
        storeIds: coordination ? activeStores().map(store => store.id) : [profile.storeId],
        canConfirm: true,
        canAdjustInventory: coordination,
        canAdjustPrices: coordination,
      };
      const token = 'bolt_ops_demo_' + crypto.randomBytes(32).toString('base64url');
      demoSessions.set(token, { actor, expiresAt: now + 2 * 60 * 60 * 1000 });
      res.status(201).json({ token, actor: sessionActor(actor) });
    });

    app.post(base + '/demo/orders', (req, res) => {
      const actor = authorize(req, res);
      if (!actor) return;
      if (!actor.canConfirm || !actor.storeIds.includes(subaId)) {
        return res.status(403).json({ error: 'El escenario de prueba pertenece a Suba.' });
      }
      const { deliveryMode = 'PROGRAMADO' } = req.body ?? {};
      if (deliveryMode !== 'TURBO' && deliveryMode !== 'PROGRAMADO') {
        return res.status(400).json({ error: 'Selecciona Turbo o Programado para el pedido de prueba.' });
      }
      try {
        const order = demo.createOrder(req.get('Idempotency-Key'), deliveryMode);
        res.status(201).json({
          orderId: order.id,
          guestAccessToken: demo.guestToken(order),
          trackingPath: '/simulacion/cliente/' + encodeURIComponent(order.id),
        });
      } catch (error) {
        const failure = error as { status?: number; message?: string };
        const status = failure.status === 400 || failure.status === 409 ? failure.status : 500;
        res.status(status).json({ error: status < 500 ? failure.message : 'No se pudo crear el pedido de prueba.' });
      }
    });
  }

  app.post(base + '/logout', (req, res) => {
    const token = bearer(req);
    if (token && !demoSessions.delete(token)) options.adminAuth.logout(token);
    res.status(204).end();
  });

  app.get(base + '/orders', (req, res) => {
    const actor = authorize(req, res);
    if (!actor) return;
    const store = selectStore(req, res, actor);
    if (!store) return;
    const orders = options.getOrders()
      .filter(order => order.storeId === store.id && isVisibleOrder(order))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map(presentOrder);
    res.json({ orders });
  });

  app.get(base + '/sales', (req, res) => {
    const actor = authorize(req, res);
    if (!actor) return;
    const period = req.query.period ?? 'today';
    if (period !== 'today' && period !== '7d' && period !== '30d') {
      return res.status(400).json({ error: 'Selecciona Hoy, Últimos 7 días o Últimos 30 días.' });
    }
    let stores: Store[];
    if (req.query.storeId === 'all') {
      stores = activeStores().filter(store => actor.storeIds.includes(store.id));
    } else {
      const store = selectStore(req, res, actor);
      if (!store) return;
      stores = [store];
    }
    const demo = !!options.demo;
    const allOrders = options.getOrders();
    const orders = allOrders.filter(order => demo ? isOperationalOrder(order) :
      !seedOrderIds.has(order.id) && order.creationRequestFingerprint !== 'SIMULATION' && !isBoltAdminDemoOrder(order));
    res.json(buildBoltAdminSalesReport({
      period, stores, orders, catalog: options.getProducts(), runs: demo ? [] : options.getDispatchRuns(), demo,
      testOrders: demo ? allOrders : [],
    }));
  });

  app.get(base + '/orders/:orderId', (req, res) => {
    const actor = authorize(req, res);
    if (!actor) return;
    const order = selectOrder(req, res, actor);
    if (order) res.json({ order: presentOrder(order) });
  });

  if (options.demo) {
    const demo = options.demo;
    app.post(base + '/orders/:orderId/simulate-inventory-delivery', (req, res) => {
      const actor = authorize(req, res);
      if (!actor) return;
      if (actor.role !== 'COORDINACION') return res.status(403).json({ error: 'Solo Coordinación puede simular esta entrega.' });
      const order = selectOrder(req, res, actor);
      if (!order) return;
      const result = demo.completeInventoryDelivery(order.id, { id: actor.id, name: actor.name, role: 'ADMINISTRADOR' });
      if (!result.success || !result.order) return res.status(result.code ?? 409).json({ error: result.error });
      res.json(presentOrder(result.order));
    });
  }

  app.post(base + '/orders/:orderId/quote', (req, res) => {
    const actor = authorize(req, res);
    if (!actor) return;
    const order = selectOrder(req, res, actor, true);
    if (order) options.quote(req, res, order, actor);
  });

  app.post(base + '/orders/:orderId/confirm', (req, res) => {
    const actor = authorize(req, res);
    if (!actor) return;
    if (!actor.canConfirm) return res.status(403).json({ error: 'Tu cuenta no puede confirmar entregas.' });
    const order = selectOrder(req, res, actor, true);
    if (order) options.confirm(req, res, order, actor);
  });

  app.post(base + '/orders/:orderId/start-preparation', (req, res) => {
    const actor = authorize(req, res);
    if (!actor) return;
    if (!actor.canConfirm) return res.status(403).json({ error: 'Tu cuenta no puede iniciar el alistamiento.' });
    const order = selectOrder(req, res, actor, true);
    if (order) options.startPreparation(req, res, order, actor);
  });

  app.get(base + '/inventory', (req, res) => {
    const actor = authorize(req, res);
    if (!actor) return;
    const scope = req.query.scope ?? 'store';
    if (scope !== 'store' && scope !== 'catalog') {
      return res.status(400).json({ error: 'Selecciona inventario de la sede o todas las presentaciones.' });
    }
    if (scope === 'catalog' && !actor.canAdjustPrices) {
      return res.status(403).json({ error: 'Tu perfil solo puede consultar las presentaciones de su sede.' });
    }
    const catalogWithoutStore = scope === 'catalog' && req.query.storeId === undefined && actor.storeIds.length === 0;
    const store = catalogWithoutStore ? undefined : selectStore(req, res, actor);
    if (!store && !catalogWithoutStore) return;
    const query = typeof req.query.query === 'string' ? normalizeQuery(req.query.query.slice(0, 120)) : '';
    const limit = Math.max(1, pageParam(req.query.limit, 80, 200));
    const offset = pageParam(req.query.offset, 0, 100000);
    const checkoutProductIds = new Set(options.demo && store && scope === 'store' ? options.getOrders()
      .filter(order => order.storeId === store.id && isDemoCheckoutOrder(order))
      .flatMap(order => order.items.map(item => item.productId)) : []);
    const products = options.getProducts().filter(product => {
      const visible = scope === 'catalog' ? isCatalogEditProduct(product) || isDemoGalleryProduct(product) : !!store && belongsToStore(product, store) &&
        (isStockProduct(product) || isDemoGalleryProduct(product) || checkoutProductIds.has(product.id));
      return visible && (!query || normalizeQuery([product.name, product.brand, product.sku, product.presentation].join(' ')).includes(query));
    });
    res.json({ items: products.slice(offset, offset + limit).map(product => inventoryRow(product, actor, store)),
      total: products.length, offset, limit });
  });

  app.get(base + '/inventory/adjustments', (req, res) => {
    const actor = authorize(req, res);
    if (!actor) return;
    if (!actor.canAdjustInventory) return res.status(403).json({ error: 'Tu cuenta solo puede consultar el inventario.' });
    const store = selectStore(req, res, actor);
    if (!store) return;
    const variants = new Map(options.getProducts()
      .filter(product => (isStockProduct(product) || canEditDemoProduct(product)) && belongsToStore(product, store))
      .map(product => [`${product.parentProductId ?? product.id}:${product.variantId ?? product.id}`, product]));
    const audit = options.catalog.getAuditLog();
    const adjustments = [];
    for (let index = audit.length - 1; index >= 0 && adjustments.length < 20; index--) {
      const entry = audit[index];
      if (entry.action !== 'MANUAL_VARIANT_EDIT' || !Array.isArray(entry.stockChanges)) continue;
      const variant = variants.get(`${entry.productId}:${entry.variantId}`);
      const change = entry.stockChanges.find((item: { storeId: string }) => item.storeId === store.id);
      if (!variant || !change || change.before === change.after) continue;
      adjustments.push({
        id: `${entry.at}:${index}`, timestamp: entry.at, name: variant.name, sku: variant.sku, presentation: variant.presentation,
        before: change.before, after: change.after, reason: entry.params?.reason || '', actorName: entry.actor?.name || '',
      });
    }
    res.json({ adjustments });
  });

  app.get(boltAdminPhotoPath, (req, res) => {
    const selected = selectPhoto(req, res, req.query.productId, req.query.variantId);
    if (!selected) return;
    const { product, variant } = selected;
    res.json({ productImage: product.image, variantImage: variant ? variant.foto || '' : null, gallery: catalogPhotoGallery(product) });
  });

  // Six 5 MiB files expand to just over 40 MiB in JSON. Authenticate before reading this body.
  app.put(boltAdminPhotoPath, (req, res, next) => {
    const actor = authorize(req, res);
    if (!actor) return;
    if (!actor.canAdjustPrices) return res.status(403).json({ error: 'Tu perfil solo puede consultar las fotos del catálogo.' });
    next();
  }, express.json({ limit: '42mb' }), (req, res) => {
    const { productId, variantId, target, expectedImage, expectedGallery, photos, dataUrl, filename } = req.body || {};
    const selected = selectPhoto(req, res, productId, variantId);
    if (!selected) return;
    const { actor, product, variant } = selected;
    if ((target !== 'product' && target !== 'variant') || (target === 'variant' && !variant) ||
        typeof expectedImage !== 'string') {
      return res.status(400).json({ error: 'Selecciona el destino y un archivo de imagen válido.' });
    }
    const before = target === 'variant' ? variant?.foto || '' : product.image;
    if (before !== expectedImage) return res.status(409).json({ error: 'La foto cambió. Carga la versión vigente antes de guardar.' });

    const editingGallery = target === 'product' && photos !== undefined;
    const gallery = target === 'product' ? catalogPhotoGallery(product) : [];
    let entries: PhotoEntry[];
    if (editingGallery) {
      if (!Array.isArray(expectedGallery) || expectedGallery.length !== gallery.length || gallery.some((url, index) => url !== expectedGallery[index])) {
        return res.status(409).json({ error: 'La galería cambió. Carga la versión vigente antes de guardar.' });
      }
      if (!validPhotoEntries(photos, gallery)) return res.status(400).json({ error: 'La galería admite hasta 6 fotos distintas del producto.' });
      entries = photos;
    } else {
      if (photos !== undefined || typeof dataUrl !== 'string' || (filename !== undefined && typeof filename !== 'string')) {
        return res.status(400).json({ error: 'Selecciona un archivo de imagen válido.' });
      }
      entries = [{ dataUrl, filename }, ...gallery.filter(url => url !== before).map(url => ({ url }))];
      if (entries.length > MAX_PRODUCT_GALLERY_PHOTOS) return res.status(400).json({ error: 'Edita la galería para elegir hasta 6 fotos.' });
    }

    const uploads: ReturnType<Options['uploadPhoto']>[] = [];
    let savedGallery: string[];
    try {
      savedGallery = entries.map(entry => {
        if ('url' in entry) return entry.url;
        const upload = options.uploadPhoto(entry.dataUrl, entry.filename);
        uploads.push(upload);
        return upload.url;
      });
    } catch (error) {
      uploads.forEach(upload => upload.discard());
      return res.status(400).json({ error: error instanceof Error ? error.message : 'No se pudo subir la foto.' });
    }

    const image = savedGallery[0] || '';
    const change = { before, after: image };
    const patch: CatalogImagePatch = {
      productId: product.id, source: image || 'BOLT Admin', checkedAt: new Date().toISOString(), reason: 'Fotos actualizadas desde BOLT Admin.',
      ...(target === 'variant' && variant ? { variants: [{ variantId: variant.varianteId, ...change }] }
        : { image: change, gallery: { before: product.gallery || [], after: savedGallery } }),
    };
    try {
      options.photos.applyImagePatches([patch], { name: actor.name, email: actor.email });
      res.json({ image });
    } catch {
      uploads.forEach(upload => upload.discard());
      res.status(500).json({ error: 'No se pudo guardar la foto. Vuelve a intentarlo.' });
    }
  });

  app.put(base + '/inventory', (req, res) => {
    const actor = authorize(req, res);
    if (!actor) return;
    if (!actor.canAdjustInventory) return res.status(403).json({ error: 'Tu cuenta solo puede consultar el inventario.' });
    const { storeId, productId, variantId, stock, expectedRevision, reason } = req.body || {};
    const store = selectStore(req, res, actor, storeId);
    if (!store) return;
    const description = typeof reason === 'string' ? reason.trim() : '';
    if (typeof productId !== 'string' || typeof variantId !== 'string' || typeof expectedRevision !== 'string' ||
        !Number.isSafeInteger(stock) || stock < 0 || description.length < 5 || description.length > 240) {
      return res.status(400).json({ error: 'Indica la presentación, la existencia registrada y un motivo de 5 a 240 caracteres.' });
    }
    const product = options.getProducts().find(candidate => (candidate.parentProductId ?? candidate.id) === productId &&
      (candidate.variantId ?? candidate.id) === variantId && isStockProduct(candidate) && belongsToStore(candidate, store));
    if (!product) return res.status(404).json({ error: 'La presentación no está disponible para esta sede.' });
    if (product.commerceRevision !== expectedRevision) return res.status(409).json({ error: 'El inventario cambió. Actualiza el saldo antes de guardar.' });
    if (stock < (product.reservedStockByStore[store.id] ?? 0)) {
      return res.status(400).json({ error: 'La existencia no puede quedar por debajo de las unidades reservadas.' });
    }
    try {
      const updated = options.catalog.edit(productId, { variantId, stockByStore: { [store.id]: stock }, expectedRevision, reason: description }, actor);
      res.json({ item: inventoryRow(saleVariant(updated, variantId), actor, store) });
    } catch {
      res.status(409).json({ error: 'No se pudo guardar el ajuste. Actualiza el inventario e inténtalo nuevamente.' });
    }
  });

  app.get(base + '/prices', (req, res) => {
    const actor = authorize(req, res);
    if (!actor) return;
    if (!actor.canAdjustPrices) return res.status(403).json({ error: 'Tu perfil no puede administrar precios y promociones.' });
    const query = typeof req.query.query === 'string' ? normalizeQuery(req.query.query.slice(0, 120)) : '';
    const limit = Math.max(1, pageParam(req.query.limit, 40, 100));
    const offset = pageParam(req.query.offset, 0, 100000);
    const matches = options.getProducts().filter(product => isCatalogEditProduct(product) &&
      (!query || normalizeQuery([product.name, product.brand, product.sku, product.presentation].join(' ')).includes(query)));
    res.json({ items: matches.slice(offset, offset + limit).map(priceItem), total: matches.length, offset, limit });
  });

  app.put(base + '/prices', (req, res) => {
    const actor = authorize(req, res);
    if (!actor) return;
    if (!actor.canAdjustPrices) return res.status(403).json({ error: 'Tu perfil no puede administrar precios y promociones.' });
    const { productId, variantId, expectedRevision, regularPriceCOP, promoPriceCOP, reason } = req.body || {};
    const description = typeof reason === 'string' ? reason.trim() : '';
    if (typeof productId !== 'string' || typeof variantId !== 'string' || typeof expectedRevision !== 'string' ||
        !validPriceCOP(regularPriceCOP) || description.length < 5 || description.length > 240) {
      return res.status(400).json({ error: 'Indica la presentación, un precio entero en COP y un motivo de 5 a 240 caracteres.' });
    }
    if (promoPriceCOP !== null && (!validPriceCOP(promoPriceCOP) || promoPriceCOP >= regularPriceCOP)) {
      return res.status(400).json({ error: 'El precio de oferta debe ser mayor que cero y menor que el precio normal.' });
    }
    const product = options.getProducts().find(candidate => (candidate.parentProductId ?? candidate.id) === productId &&
      (candidate.variantId ?? candidate.id) === variantId && isCatalogEditProduct(candidate));
    if (!product) return res.status(404).json({ error: 'La presentación no está disponible.' });
    if (product.commerceRevision !== expectedRevision) {
      return res.status(409).json({ error: 'La presentación cambió. Actualiza el precio antes de guardar.' });
    }
    const priceCOP = promoPriceCOP ?? regularPriceCOP;
    const originalPriceCOP = promoPriceCOP === null ? null : regularPriceCOP;
    const previous = priceItem(product);
    if (previous.price === priceCOP && previous.originalPrice === originalPriceCOP) return res.json({ item: previous });
    try {
      const updated = options.catalog.edit(productId, { variantId, priceCOP, originalPriceCOP, expectedRevision, reason: description }, actor);
      res.json({ item: priceItem(saleVariant(updated, variantId)) });
    } catch {
      res.status(409).json({ error: 'No se pudo guardar el precio. Actualiza la presentación e inténtalo nuevamente.' });
    }
  });
}
