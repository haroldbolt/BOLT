import crypto from 'node:crypto';
import type { Express, Request, Response } from 'express';
import type { Order, Product, Store } from '../types';
import type { AdminAuthService } from './adminAuthService';
import type { CatalogOperations } from './catalogOperations';
import { saleVariant } from './variantCommerce';

const base = '/api/v1/bolt-admin';
const subaId = 'HUB_SUBA';
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
};

type PendingDeliveryAction = (req: Request, res: Response, order: Order, actor: Actor) => void;

type Options = {
  adminAuth: Pick<AdminAuthService, 'verifySession' | 'logout'>;
  catalog: Pick<CatalogOperations, 'edit'>;
  getProducts: () => Product[];
  getStores: () => Store[];
  getOrders: () => Order[];
  getOrder: (id: string) => Order | undefined;
  quote: PendingDeliveryAction;
  confirm: PendingDeliveryAction;
  startPreparation: PendingDeliveryAction;
  demo?: {
    productId: string;
    isOrder: (order: Order) => boolean;
    createOrder: (requestId: string | undefined) => Order;
    guestToken: (order: Order) => string;
  };
};

function sessionActor({ email: _email, ...actor }: Actor) {
  return actor;
}

export function boltAdminOrder(order: Order) {
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
    customer: order.customer,
    deliveryAddress: {
      address: order.deliveryAddress.address,
      details: order.deliveryAddress.details,
      locality: order.deliveryAddress.locality,
    },
    items: order.items,
    totals: order.totals,
    payment: { method: order.payment.method, status: order.payment.status },
    timestamps: order.timestamps,
    statusHistory: order.statusHistory?.map(({ previousStatus, newStatus, timestamp, actor }) => ({
      previousStatus, newStatus, timestamp, actor,
    })),
  };
}

function belongsToStore(product: Product, store: Store) {
  return product.bodegaIds
    ? product.bodegaIds.includes(store.id) || (!!store.shopifyLocationGid && product.bodegaIds.includes(store.shopifyLocationGid))
    : Object.hasOwn(product.stockByStore, store.id);
}

function inventoryItem(product: Product, store: Store) {
  const stock = product.stockByStore[store.id] ?? 0;
  const reserved = product.reservedStockByStore[store.id] ?? 0;
  return {
    productId: product.parentProductId ?? product.id,
    variantId: product.variantId ?? product.id,
    name: product.name,
    brand: product.brand,
    sku: product.sku,
    presentation: product.presentation,
    storeId: store.id,
    stock,
    reserved,
    available: Math.max(0, stock - reserved),
    countedAt: null,
    revision: product.commerceRevision,
  };
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
  const isVisibleOrder = (order: Order) => !options.demo || options.demo.isOrder(order);
  const isVisibleProduct = (product: Product) => options.demo
    ? (product.parentProductId ?? product.id) === options.demo.productId
    : !product.status || product.status === 'ACTIVE';

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
      storeIds: activeStores().map(store => store.id), canConfirm: true, canAdjustInventory: true,
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

  function selectOrder(req: Request, res: Response, actor: Actor) {
    const order = options.getOrder(req.params.orderId);
    if (!order || !isVisibleOrder(order)) {
      res.status(404).json({ error: 'Pedido no encontrado.' });
      return undefined;
    }
    if (!actor.storeIds.includes(order.storeId)) {
      res.status(403).json({ error: 'Tu cuenta no tiene acceso al pedido de otra sede.' });
      return undefined;
    }
    return order;
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
      try {
        const order = demo.createOrder(req.get('Idempotency-Key'));
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
      .map(boltAdminOrder);
    res.json({ orders });
  });

  app.get(base + '/orders/:orderId', (req, res) => {
    const actor = authorize(req, res);
    if (!actor) return;
    const order = selectOrder(req, res, actor);
    if (order) res.json({ order: boltAdminOrder(order) });
  });

  app.post(base + '/orders/:orderId/quote', (req, res) => {
    const actor = authorize(req, res);
    if (!actor) return;
    const order = selectOrder(req, res, actor);
    if (order) options.quote(req, res, order, actor);
  });

  app.post(base + '/orders/:orderId/confirm', (req, res) => {
    const actor = authorize(req, res);
    if (!actor) return;
    if (!actor.canConfirm) return res.status(403).json({ error: 'Tu cuenta no puede confirmar entregas.' });
    const order = selectOrder(req, res, actor);
    if (order) options.confirm(req, res, order, actor);
  });

  app.post(base + '/orders/:orderId/start-preparation', (req, res) => {
    const actor = authorize(req, res);
    if (!actor) return;
    if (!actor.canConfirm) return res.status(403).json({ error: 'Tu cuenta no puede iniciar el alistamiento.' });
    const order = selectOrder(req, res, actor);
    if (order) options.startPreparation(req, res, order, actor);
  });

  app.get(base + '/inventory', (req, res) => {
    const actor = authorize(req, res);
    if (!actor) return;
    const store = selectStore(req, res, actor);
    if (!store) return;
    const query = typeof req.query.query === 'string' ? normalizeQuery(req.query.query.slice(0, 120)) : '';
    const limit = Math.max(1, pageParam(req.query.limit, 80, 200));
    const offset = pageParam(req.query.offset, 0, 100000);
    const products = options.getProducts().filter(product =>
      isVisibleProduct(product) && belongsToStore(product, store) &&
      (!query || normalizeQuery([product.name, product.brand, product.sku, product.presentation].join(' ')).includes(query)));
    res.json({ items: products.slice(offset, offset + limit).map(product => inventoryItem(product, store)), total: products.length, offset, limit });
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
      (candidate.variantId ?? candidate.id) === variantId && isVisibleProduct(candidate) && belongsToStore(candidate, store));
    if (!product) return res.status(404).json({ error: 'La presentación no está disponible para esta sede.' });
    if (product.commerceRevision !== expectedRevision) return res.status(409).json({ error: 'El inventario cambió. Actualiza el saldo antes de guardar.' });
    if (stock < (product.reservedStockByStore[store.id] ?? 0)) {
      return res.status(400).json({ error: 'La existencia no puede quedar por debajo de las unidades reservadas.' });
    }
    try {
      const updated = options.catalog.edit(productId, { variantId, stockByStore: { [store.id]: stock }, expectedRevision, reason: description }, actor);
      res.json({ item: inventoryItem(saleVariant(updated, variantId), store) });
    } catch {
      res.status(409).json({ error: 'No se pudo guardar el ajuste. Actualiza el inventario e inténtalo nuevamente.' });
    }
  });
}
