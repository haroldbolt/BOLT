import express, { Request, Response } from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { randomUUID, randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { createServer as createViteServer } from 'vite';
import { INITIAL_PRODUCTS, INITIAL_STORES } from './src/data/seedData';
import { Order, Product, Store, GPSTelemetry, OrderActor, ActorRole } from './src/types';
import { evaluateDeliveryQuote, DELIVERY_CONFIG, deliveryQuoteEndpoint, validateScheduledBooking } from './src/lib/deliveryService';
import { isScheduledWarehouse } from './src/lib/scheduledDispatch';
import { shopifyService } from './src/lib/shopifyService';
import { loadPrivateInventorySnapshot, PrivateInventoryResult } from './src/lib/privateInventoryLoader';
import { localCatalogService } from './src/lib/localCatalogService';
import { OrdersRepository } from './src/lib/ordersRepository';
import { AdminRepository, AdminError } from './src/lib/adminRepository';
import { adminToken, createAdminRouter, requireAdmin, requireMutation, resolveAdmin } from './src/lib/adminRouter';
import { getOperationalCatalog, resolveCatalogProduct } from './src/lib/catalogVariants';
import { NEW_ORDER_SERVICE_FEE, isNewOrderPorteriaPolicy } from './src/lib/checkoutPolicy';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Helper para extraer el actor autenticado u operacional desde cabeceras/payload
function extractActor(req: Request, defaultRole: ActorRole = 'BODEGA'): OrderActor {
  const user = (req as any).adminUser;
  if (user) return { role: 'ADMINISTRADOR', id: user.id, name: user.displayName };
  // El cliente autorizado por capacidad solo puede actuar como cliente.
  return { role: 'CLIENTE', name: 'Cliente Web' };
}

// Authoritative in-memory state initialized from local catalog (3.830 productos agrupados, 5.652 variantes, 5 bodegas)
const catalogStores: Store[] = localCatalogService.getStores().length > 0 ? localCatalogService.getStores() : JSON.parse(JSON.stringify(INITIAL_STORES));
const catalogProducts: Product[] = localCatalogService.getAllGroupedProducts().length > 0 ? localCatalogService.getAllGroupedProducts() : JSON.parse(JSON.stringify(INITIAL_PRODUCTS));

// Registro de carga de catálogo local
console.log(`[Catálogo Local] Iniciado con ${catalogProducts.length} productos agrupados, ${localCatalogService.getTotalVariantsCount()} variantes y ${catalogStores.length} bodegas.`);

// Comprobación de inventario privado (.bolt-private/shopify/snapshot.json no bloqueante)
const privateInventoryStatus: PrivateInventoryResult = loadPrivateInventorySnapshot();
console.log(`[Inventario Privado] ${privateInventoryStatus.message} Se utiliza el catálogo local estructurado.`);
export async function createBoltApp(options: {
  serveFrontend?: boolean;
  products?: Product[];
  stores?: Store[];
  repository?: OrdersRepository;
  adminRepository?: AdminRepository;
} = {}) {
  const app = express();
  const products = options.products ?? catalogProducts;
  const stores = options.stores ?? catalogStores;
  const ordersRepository = options.repository ?? new OrdersRepository();
  const administration = options.adminRepository ?? new AdminRepository({ products, stores });
  ordersRepository.connectPersistence({ read: () => administration.readOperationalState(), write: state => administration.writeOperationalState(state) });
  app.locals.adminRepository = administration;
  const operationalCatalog = () => getOperationalCatalog(products);
  // Capacity remains shared across all hubs, including historical Centro orders.
  const scheduledSlotOrderCount = (slot: { date: string; slotId?: string; startTime: string }) => ordersRepository.getAllOrders().filter(order =>
    order.deliveryMode === 'PROGRAMADO' && order.fulfillmentStatus !== 'CANCELADO' && order.scheduledWindow?.date === slot.date &&
    (order.scheduledWindow.slotId === slot.slotId || order.scheduledWindow.startTime === slot.startTime)).length;
  app.use(express.json({ limit: '15mb' }));
  const streams = new Set<{ response: Response; token: string }>();
  const announce = (event: string) => {
    for (const stream of streams) {
      if (!administration.getSession(stream.token)) { stream.response.end(); streams.delete(stream); continue; }
      stream.response.write(`event: ${event}\ndata: ${JSON.stringify({ at: Date.now() })}\n\n`);
    }
  };
  const unsubscribeOrders = ordersRepository.subscribe(() => { announce('orders'); announce('catalog'); });
  app.locals.closeAdmin = () => { unsubscribeOrders(); for (const stream of streams) stream.response.end(); administration.close(); };
  const adminOnly = requireAdmin(administration);
  const adminMutation = requireMutation(administration);
  app.use('/api/v1', (req, res, next) => {
    const requestPath = req.path.toLowerCase();
    res.set('Cache-Control', 'no-store');
    res.set('X-Content-Type-Options', 'nosniff');
    const user = resolveAdmin(req, administration);
    if (user) (req as any).adminUser = user;
    // Credenciales del destinatario y hashes nunca se entregan al personal operativo.
    const originalJson = res.json.bind(res);
    res.json = ((body: unknown) => {
      if (!requestPath.startsWith('/orders') && !requestPath.startsWith('/operations') && !requestPath.startsWith('/driver')) return originalJson(body);
      const clean = JSON.parse(JSON.stringify(body, (key, value) => key === 'customerAccessTokenHash' || (user && key === 'secretDeliveryCode') ? undefined : value));
      return originalJson(clean);
    }) as typeof res.json;
    next();
  });
  app.get('/api/v1/admin/events', adminOnly, (req, res) => {
    const token = adminToken(req)!;
    res.set({ 'Content-Type': 'text/event-stream', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.flushHeaders();
    res.write('event: orders\ndata: {"connected":true}\n\n');
    const stream = { response: res, token };
    streams.add(stream);
    const heartbeat = setInterval(() => {
      if (!administration.getSession(token)) return res.end();
      res.write(': connected\n\n');
    }, 5000);
    req.on('close', () => { clearInterval(heartbeat); streams.delete(stream); });
  });
  app.get('/api/v1/admin/drivers', adminOnly, (_req, res) => res.json(ordersRepository.getAllDrivers()));
  app.use('/api/v1/admin', createAdminRouter(administration, { onCatalogChange: () => announce('catalog'), onPromotionChange: () => announce('promotions') }));
  app.use(['/api/v1/operations', '/api/v1/driver', '/api/v1/shopify', '/api/v1/integrations', '/api/v1/inventory'], adminOnly, adminMutation);
  app.use('/api/v1/stores', (req, res, next) => req.method === 'GET' ? next() : adminOnly(req, res, () => adminMutation(req, res, next)));
  app.use('/api/v1/orders', (req, res, next) => {
    // Express admite mayúsculas y una barra final; la autorización debe resolver
    // exactamente las mismas rutas que los manejadores de consulta y escritura.
    const requestPath = req.path.replace(/\/+$/, '') || '/';
    if (requestPath === '/' && req.method === 'POST') return next();
    if (requestPath === '/' || /\/(history|telemetry\/history|verify-delivery)$/i.test(requestPath)) return adminOnly(req, res, () => adminMutation(req, res, next));
    if ((req as any).adminUser) return adminMutation(req, res, next);
    const id = decodeURIComponent(req.path.split('/')[1] || '');
    const order = ordersRepository.getOrderById(id);
    const token = req.get('x-order-token') || '';
    const expected = (order as any)?.customerAccessTokenHash;
    const actual = createHash('sha256').update(token).digest('hex');
    if (!token || token.length > 256 || !expected || actual.length !== expected.length || !timingSafeEqual(Buffer.from(actual), Buffer.from(expected))) return res.status(401).json({ error: 'Este pedido requiere el acceso privado del comprador.', code: 'ORDER_ACCESS_REQUIRED' });
    next();
  });

  // ==========================================
  // /api/v1 ROUTES
  // ==========================================

  // Health check
  app.get('/api/v1/health', (_req: Request, res: Response) => {
    res.json({
      status: 'ok',
      service: 'Bolt Pets Authoritative Backend',
      appId: 'bolt-pets-actual',
      version: '1.0.0',
      catalogSource: 'LOCAL_CATALOG (src/data/catalogo-local)',
      timezone: 'America/Bogota',
      locale: 'es-CO',
      storesCount: stores.length,
      totalProductosAgrupados: products.length,
      totalVariantes: products.reduce((sum, product) => sum + Math.max(1, product.presentaciones?.length || 0), 0),
      productosActivos: products.filter(p => p.status === 'ACTIVE').length,
      ordersCount: ordersRepository.getAllOrders().length,
      privateInventory: {
        found: privateInventoryStatus.fileFound,
        message: privateInventoryStatus.message,
      },
      timestamp: new Date().toISOString(),
    });
  });

  // Resumen del catálogo local estructurado
  app.get('/api/v1/catalog/summary', (_req: Request, res: Response) => {
    res.json({ totalProductosAgrupados: products.length, totalVariantes: products.reduce((sum, p) => sum + Math.max(1, p.presentaciones?.length || 0), 0), totalBodegas: stores.length, productosActivos: products.filter(p => p.status === 'ACTIVE').length, bodegas: stores.map(s => ({ id: s.shopifyLocationGid || s.id, boltId: s.id, name: s.name, isActive: s.isActive })) });
  });

  // Inventario privado status
  app.get('/api/v1/inventory/status', (_req: Request, res: Response) => {
    res.json({
      targetFile: privateInventoryStatus.filePath,
      found: privateInventoryStatus.fileFound,
      message: privateInventoryStatus.message,
      productsCount: products.length,
    });
  });

  // Stores
  app.get('/api/v1/stores', (_req: Request, res: Response) => {
    res.json(stores);
  });

  // Catalog
  app.get('/api/v1/catalog', (req: Request, res: Response) => {
    const { category, species, storeId, q, all } = req.query;
    let filtered = [...products];

    // 4. Para clientes muestra productos ACTIVE (salvo que se solicite all=true)
    if (all !== 'true' || !(req as any).adminUser) {
      filtered = filtered.filter(p => !p.status || p.status === 'ACTIVE');
    }

    // 3. Organiza los productos según bodegaIds. Una lista vacía no significa disponibilidad en todas las bodegas.
    if (storeId) {
      const storeIdStr = String(storeId);
      const storeObj = stores.find(s => s.id === storeIdStr || s.shopifyLocationGid === storeIdStr);
      const targetGid = storeObj?.shopifyLocationGid || storeIdStr;

      filtered = filtered.filter(p => {
        if (!p.bodegaIds) return true;
        if (p.bodegaIds.length === 0) return false; // Una lista vacía no significa disponibilidad en todas las bodegas
        return p.bodegaIds.includes(targetGid) || p.bodegaIds.includes(storeIdStr);
      });
    }

    if (category && category !== 'Todo') {
      filtered = filtered.filter(p => p.category === category || p.pharmacySubcategory === category);
    }
    if (species && species !== 'Todos') {
      filtered = filtered.filter(p => p.species === species || p.species === 'Ambos');
    }
    if (q) {
      const queryStr = String(q).toLowerCase();
      filtered = filtered.filter(p =>
        p.name.toLowerCase().includes(queryStr) ||
        p.brand.toLowerCase().includes(queryStr) ||
        p.sku.toLowerCase().includes(queryStr) ||
        (p.activeIngredient && p.activeIngredient.toLowerCase().includes(queryStr)) ||
        (p.tags && p.tags.some(t => t.toLowerCase().includes(queryStr)))
      );
    }

    const promotionTime = Date.now();
    const activePromotions = administration.getActivePromotions(promotionTime);
    res.json(filtered.map(product => {
      const variants = getOperationalCatalog([product]);
      const promotion = administration.calculateDiscount([{ productId: product.id, variantId: variants[0].variantId, price: product.price, quantity: 1 }], String(storeId || ''), promotionTime, activePromotions);
      return { ...product, promotionLabel: promotion.discount > 0 ? promotion.promotionName : undefined, promotionUnitDiscount: promotion.discount, presentaciones: product.presentaciones?.map((v, i) => {
        const variant = variants[i];
        const discount = administration.calculateDiscount([{ productId: product.id, variantId: v.varianteId, price: variant.price, quantity: 1 }], String(storeId || ''), promotionTime, activePromotions);
        return { ...v, promotionLabel: discount.discount > 0 ? discount.promotionName : undefined, promotionUnitDiscount: discount.discount };
      }) };
    }));
  });

  app.post('/api/v1/cart/price', (req, res) => {
    const storeId = req.body?.storeId;
    if (typeof storeId !== 'string' || !stores.some(s => s.id === storeId && s.isActive) || !Array.isArray(req.body?.items) || !req.body.items.length || req.body.items.length > 200) return res.status(400).json({ error: 'Selecciona una bodega y un carrito válidos.' });
    const items = [];
    for (const line of req.body.items) {
      const product = resolveCatalogProduct(products, line?.productId, line?.variantId);
      if (!product || product.status && product.status !== 'ACTIVE' || !Number.isSafeInteger(line.quantity) || line.quantity < 1 || !(product.price > 0) || !(product.weightKg > 0)) return res.status(409).json({ error: 'Un producto necesita actualizarse o tiene datos pendientes.' });
      items.push({ productId: product.parentProductId || product.id, variantId: product.variantId, price: product.price, quantity: line.quantity });
    }
    const subtotal = items.reduce((sum, i) => sum + i.price * i.quantity, 0);
    const discount = administration.calculateDiscount(items, storeId);
    res.json({ subtotal, ...discount, shipping: subtotal >= 70000 ? 0 : 4900, serviceFee: NEW_ORDER_SERVICE_FEE, total: subtotal - discount.discount + (subtotal >= 70000 ? 0 : 4900) + NEW_ORDER_SERVICE_FEE });
  });

  // Authoritative Delivery Quote Endpoint
  app.post('/api/v1/delivery/quote', (req: Request, res: Response) => {
    const submittedItems = req.body?.items ?? [];
    if (!req.body?.destination || typeof req.body.destination !== 'object' || Array.isArray(req.body.destination) || !Array.isArray(submittedItems) || submittedItems.length > 200 || submittedItems.some((item: any) => !item || !Number.isSafeInteger(item.quantity) || item.quantity < 1 || !resolveCatalogProduct(products, item.productId, item.variantId))) return res.status(400).json({ error: 'La cotización necesita productos y cantidades válidos.' });
    const quoteItems = submittedItems.map((item: any) => ({ productId: resolveCatalogProduct(products, item.productId, item.variantId)!.id, quantity: item.quantity }));
    const totalGrams = quoteItems.reduce((sum: number, item: any) => sum + Math.max(1, Math.round((resolveCatalogProduct(products, item.productId)!.weightKg || 0.2) * 1000)) * item.quantity, 0);
    if (!Number.isSafeInteger(totalGrams)) return res.status(400).json({ error: 'El peso solicitado supera el rango permitido.' });
    req.body = { ...req.body, items: quoteItems };
    return deliveryQuoteEndpoint(req, {
      status: code => ({ json: data => res.status(code).json(data) }),
      json: quote => res.json({ ...quote, scheduledSlots: quote.scheduledSlots.map((slot: any) => ({
        ...slot,
        maxCapacity: DELIVERY_CONFIG.scheduledDelivery.maxCapacityPerSlot,
        availableCapacity: Math.max(0, DELIVERY_CONFIG.scheduledDelivery.maxCapacityPerSlot - scheduledSlotOrderCount(slot)),
      })) }),
    }, stores, operationalCatalog());
  });

  // Reverse Geocoding Proxy (Google Maps Platform Geocoding API)
  // Preserve Google's precision/partial-match information; clients must not treat
  // a broad or ambiguous search result as a confirmed delivery address.
  const geocodingCandidates = (results: any[]) => results.slice(0, 10).map(result => ({
    address: typeof result.formatted_address === 'string' ? result.formatted_address : '',
    coordinates: Number.isFinite(result.geometry?.location?.lat) && Number.isFinite(result.geometry?.location?.lng)
      ? { lat: result.geometry.location.lat, lng: result.geometry.location.lng } : null,
    partialMatch: result.partial_match === true,
    locationType: result.geometry?.location_type,
    types: Array.isArray(result.types) ? result.types : [],
    placeId: result.place_id,
  }));
  app.get('/api/v1/geocode/reverse', async (req: Request, res: Response) => {
    const { lat, lng } = req.query;
    if (!lat || !lng) {
      return res.status(400).json({ error: 'Faltan parámetros lat y lng' });
    }
    if (typeof lat !== 'string' || typeof lng !== 'string' || !Number.isFinite(Number(lat)) || !Number.isFinite(Number(lng)) || Math.abs(Number(lat)) > 90 || Math.abs(Number(lng)) > 180) {
      return res.status(400).json({ error: 'Las coordenadas no son válidas' });
    }

    const apiKey = process.env.VITE_GOOGLE_MAPS_API_KEY || 'AIzaSyBeZD10ABWRpSpwChGlSzPR-6wxdD9oJcE';
    try {
      const response = await fetch(
        `https://maps.googleapis.com/maps/api/geocode/json?latlng=${Number(lat)},${Number(lng)}&key=${apiKey}&language=es&region=co`,
        { signal: AbortSignal.timeout(10000) }
      );
      const data: any = await response.json();

      if (data.status === 'OK' && data.results && data.results.length > 0) {
        const raw = data.results[0].formatted_address;
        let address = raw
          .replace(/,\s*Bogotá,\s*D\.C\.,\s*Bogotá,\s*Bogotá,\s*D\.C\./gi, ', Bogotá')
          .replace(/,\s*Bogotá,\s*D\.C\./gi, ', Bogotá')
          .replace(/,\s*Cundinamarca/gi, '')
          .trim();
        return res.json({
          address,
          formattedAddress: address,
          rawAddress: raw,
          candidates: geocodingCandidates(data.results),
          status: 'OK',
        });
      } else {
        return res.status(404).json({ error: 'No se encontraron resultados de dirección', status: data.status });
      }
    } catch (err: any) {
      console.error('Error en geocodificación inversa:', err);
      return res.status(500).json({ error: 'Error del servidor al consultar geocodificación' });
    }
  });

  // Forward Geocoding Proxy (Google Maps Platform Geocoding API)
  app.get('/api/v1/geocode/forward', async (req: Request, res: Response) => {
    const { address } = req.query;
    if (typeof address !== 'string' || !address.trim() || address.length > 500) {
      return res.status(400).json({ error: 'Parámetro address requerido' });
    }

    const apiKey = process.env.VITE_GOOGLE_MAPS_API_KEY || 'AIzaSyBeZD10ABWRpSpwChGlSzPR-6wxdD9oJcE';
    try {
      const searchTarget = String(address).toLowerCase().includes('bogot') ? String(address) : `${address}, Bogotá, Colombia`;
      const response = await fetch(
        `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(searchTarget)}&key=${apiKey}&components=country:CO&language=es&region=co`,
        { signal: AbortSignal.timeout(10000) }
      );
      const data: any = await response.json();

      if (data.status === 'OK' && data.results && data.results.length > 0) {
        const first = data.results[0];
        const location = first.geometry?.location;
        const raw = first.formatted_address;
        let formatted = raw
          .replace(/,\s*Bogotá,\s*D\.C\.,\s*Bogotá,\s*Bogotá,\s*D\.C\./gi, ', Bogotá')
          .replace(/,\s*Bogotá,\s*D\.C\./gi, ', Bogotá')
          .replace(/,\s*Cundinamarca/gi, '')
          .trim();
        return res.json({
          coordinates: location ? { lat: Number(location.lat.toFixed(6)), lng: Number(location.lng.toFixed(6)) } : null,
          formattedAddress: formatted,
          candidates: geocodingCandidates(data.results),
          status: 'OK',
        });
      } else {
        return res.status(404).json({ error: 'Dirección no encontrada', status: data.status });
      }
    } catch (err: any) {
      console.error('Error en geocodificación directa:', err);
      return res.status(500).json({ error: 'Error al consultar geocodificación directa' });
    }
  });

  // Create Order with transactional stock reservation & delivery policy validation
  app.post('/api/v1/orders', (req: Request, res: Response) => {
    try {
      const {
        storeId,
        items: submittedItems,
        customer,
        deliveryAddress,
        paymentMethod,
        tip = 0,
        deliveryMode: requestedDeliveryMode,
        scheduledWindow,
      } = req.body;

      if (!Array.isArray(submittedItems) || !submittedItems.length || submittedItems.length > 200 || !customer || typeof customer !== 'object' || Array.isArray(customer) || !deliveryAddress || typeof deliveryAddress !== 'object' || Array.isArray(deliveryAddress) || !paymentMethod) {
        return res.status(400).json({ error: 'Faltan campos obligatorios para crear el pedido.' });
      }
      const validText = (value: unknown, maximum: number, required = false): value is string => typeof value === 'string' && value.length <= maximum && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value) && (!required || !!value.trim());
      if (!validText(customer.name, 150, true) || !validText(customer.phone, 40, true) || !validText(customer.email ?? '', 254) || (customer.isGuest !== undefined && typeof customer.isGuest !== 'boolean') || !validText(deliveryAddress.address, 500, true) || !validText(deliveryAddress.details ?? '', 1000)) {
        return res.status(400).json({ error: 'Revisa el nombre, teléfono, correo y dirección del comprador.', code: 'CUSTOMER_DATA_INVALID' });
      }
      if (requestedDeliveryMode !== undefined && !['TURBO', 'TURBO_DIVIDIDO', 'PROGRAMADO'].includes(requestedDeliveryMode)) return res.status(400).json({ error: 'La modalidad de entrega no es válida.' });
      if (!isNewOrderPorteriaPolicy(deliveryAddress.porteriaPolicy)) return res.status(400).json({ error: 'Selecciona «Llamar al llegar» o «Dejar en portería».', code: 'DELIVERY_INSTRUCTION_INVALID' });
      const safeCustomer: Order['customer'] = { name: customer.name.trim(), phone: customer.phone.trim(), email: (customer.email || '').trim(), isGuest: customer.isGuest !== false };
      const safeAddress: Order['deliveryAddress'] = { address: deliveryAddress.address.trim(), details: (deliveryAddress.details || '').trim(), porteriaPolicy: deliveryAddress.porteriaPolicy, coordinates: { lat: deliveryAddress.coordinates?.lat, lng: deliveryAddress.coordinates?.lng } };

      if (!Number.isFinite(tip) || tip < 0 || tip > 1_000_000_000) {
        return res.status(400).json({ error: 'La propina debe ser un valor válido igual o mayor a cero.' });
      }
      if (!['WOMPI_CARD', 'WOMPI_PSE', 'WOMPI_BANCOLOMBIA', 'CASH_ON_DELIVERY'].includes(paymentMethod)) {
        return res.status(400).json({ error: 'Método de pago no válido.' });
      }
      if (!deliveryAddress.coordinates || !Number.isFinite(deliveryAddress.coordinates.lat) || !Number.isFinite(deliveryAddress.coordinates.lng) || Math.abs(deliveryAddress.coordinates.lat) > 90 || Math.abs(deliveryAddress.coordinates.lng) > 180) {
        return res.status(400).json({ error: 'Confirma la ubicación de entrega antes de crear el pedido.' });
      }
      const items: Order['items'] = [];
      for (const submitted of submittedItems) {
        if (!submitted || !Number.isSafeInteger(submitted.quantity) || submitted.quantity <= 0) {
          return res.status(400).json({ error: 'Cada producto debe tener una cantidad entera positiva.' });
        }
        const product = resolveCatalogProduct(products, submitted.productId, submitted.variantId);
        if (!product) return res.status(400).json({ error: 'Producto no encontrado en el catálogo.' });
        if (product.status && product.status !== 'ACTIVE') return res.status(409).json({ error: 'Este producto está retirado de la venta.', code: 'PRODUCT_ARCHIVED' });
        if (!Number.isFinite(product.price) || product.price <= 0 || !Number.isFinite(product.weightKg) || product.weightKg <= 0) {
          return res.status(409).json({ error: 'Este producto requiere precio y peso verificados antes de recibir pedidos.', code: 'PRODUCT_DATA_PENDING' });
        }
        items.push({
          productId: product.id, sku: product.sku, name: product.name, brand: product.brand,
          presentation: product.presentation, price: product.price, weightKg: product.weightKg,
          image: product.image, requiresPrescription: !!product.requiresPrescription,
          quantity: submitted.quantity, picked: false,
        });
      }

      // Validar cobertura y límite de tiempo con el motor autoritativo si hay coordenadas
      let assignedStoreId = storeId;
      let evaluatedQuote: any = null;
      let effectiveDeliveryMode: Order['deliveryMode'] = requestedDeliveryMode;
      let selectedScheduledWindow: Order['scheduledWindow'];
      const requestedQuantities = new Map<string, number>();
      for (const item of items) requestedQuantities.set(item.productId, (requestedQuantities.get(item.productId) || 0) + item.quantity);
      const storeCanFulfill = (store: Store) => store.isActive && [...requestedQuantities].every(([productId, quantity]) => {
        const product = resolveCatalogProduct(products, productId)!;
        const associated = !product.bodegaIds || product.bodegaIds.includes(store.id) || (!!store.shopifyLocationGid && product.bodegaIds.includes(store.shopifyLocationGid));
        const physical = product.stockByStore[store.id];
        const reserved = product.reservedStockByStore[store.id] ?? 0;
        return associated && product.inventoryVerifiedByStore?.[store.id] === true && Number.isSafeInteger(physical) && Number.isSafeInteger(reserved) && reserved >= 0 && physical - reserved >= quantity;
      });

      if (deliveryAddress.coordinates && !isNaN(deliveryAddress.coordinates.lat) && !isNaN(deliveryAddress.coordinates.lng)) {
        evaluatedQuote = evaluateDeliveryQuote({
          destination: {
            address: deliveryAddress.address,
            details: deliveryAddress.details,
            coordinates: deliveryAddress.coordinates,
          },
          items: items.map((i: any) => ({ productId: i.productId, quantity: i.quantity })),
        }, stores, operationalCatalog());

        effectiveDeliveryMode ||= evaluatedQuote.recommendedMode || undefined;
        // El cliente no puede convertir un plan dividido en una sola moto ni
        // prometer Turbo cuando la cotización autoritativa solo permite Programado.
        if (!effectiveDeliveryMode) return res.status(400).json({ error: evaluatedQuote.message || 'La dirección no tiene cobertura de entrega.' });
        if (effectiveDeliveryMode === 'PROGRAMADO') {
          if (!evaluatedQuote.scheduledEligible) {
            return res.status(400).json({
              error: evaluatedQuote.message || 'Dirección fuera de la zona de cobertura metropolitana de entrega programada.',
              eligibilityStatus: evaluatedQuote.eligibilityStatus,
              code: evaluatedQuote.reasonCode,
            });
          }

          const candidates = (evaluatedQuote.scheduledSlots || []).filter((slot: any) => !slot.cutoffPassed);
          selectedScheduledWindow = scheduledWindow
            ? candidates.find((slot: any) => scheduledWindow && typeof scheduledWindow === 'object' && slot.date === scheduledWindow.date && (scheduledWindow.slotId ? slot.slotId === scheduledWindow.slotId : scheduledWindow.windowId ? slot.windowId === scheduledWindow.windowId : slot.startTime === scheduledWindow.startTime))
            : candidates[0];
          if (!selectedScheduledWindow || !validateScheduledBooking(selectedScheduledWindow).valid) {
              return res.status(400).json({
                error: 'La franja de entrega programada seleccionada ya no está disponible. Elige una franja vigente.',
                code: 'CUTOFF_EXPIRED',
              });
          }
          // Los pedidos cancelados liberan el cupo; los campos de presentación
          // de la franja siempre proceden del servidor y no del navegador.
          if (scheduledSlotOrderCount(selectedScheduledWindow) >= DELIVERY_CONFIG.scheduledDelivery.maxCapacityPerSlot) {
              return res.status(400).json({
                error: 'La franja seleccionada ha alcanzado su capacidad máxima. Por favor selecciona otro horario.',
                code: 'SLOT_CAPACITY_EXCEEDED',
              });
          }
        } else {
          const modeAvailable = effectiveDeliveryMode === 'TURBO' ? evaluatedQuote.availableModes?.turbo : evaluatedQuote.availableModes?.turboDividido && evaluatedQuote.turboDividido?.feasible && evaluatedQuote.turboDividido.shipments?.length;
          if (!modeAvailable || evaluatedQuote.eligibilityStatus !== 'ELIGIBLE') {
            return res.status(400).json({
              error: evaluatedQuote.message,
              eligibilityStatus: evaluatedQuote.eligibilityStatus,
              geographicDistanceMeters: evaluatedQuote.geographicDistanceMeters,
              roadDistanceMeters: evaluatedQuote.roadDistanceMeters,
              code: 'DELIVERY_MODE_UNAVAILABLE',
              recommendedMode: evaluatedQuote.recommendedMode,
            });
          }
        }

        // Asignación automática de bodega autoritativa
        if (effectiveDeliveryMode === 'PROGRAMADO') {
          const assignment = evaluatedQuote.scheduledAssignment;
          const responsible = stores.find(store => store.id === assignment?.storeId);
          if (assignment?.status !== 'CONFIRMADA' || !responsible || !isScheduledWarehouse(responsible) || !storeCanFulfill(responsible)) {
            return res.status(409).json({ error: assignment?.reason || 'La bodega responsable requiere revisar la disponibilidad verificada de este pedido.', code: 'STOCK_UNAVAILABLE', scheduledAssignment: assignment });
          }
          assignedStoreId = responsible.id;
          // Never silently fulfill/price a different warehouse than the one
          // shown by checkout. Reconfirm before creating an order or reservation.
          if (storeId !== undefined && storeId !== assignedStoreId) {
            return res.status(409).json({ error: 'La bodega de envío programado cambió. Revisa la disponibilidad y el total antes de confirmar.', code: 'WAREHOUSE_CHANGED', assignedStoreId, scheduledAssignment: assignment });
          }
        } else assignedStoreId = evaluatedQuote.assignedStoreId;
      }

      const assignedStore = stores.find(s => s.id === assignedStoreId && s.isActive);
      if (!assignedStore) return res.status(400).json({ error: 'No se encontró una bodega activa para este pedido.' });
      assignedStoreId = assignedStore.id;
      if (!storeCanFulfill(assignedStore)) return res.status(409).json({ error: 'Revisa la disponibilidad verificada de los productos en la bodega asignada.', code: 'STOCK_UNAVAILABLE' });

      // Check stock availability in assigned warehouse and reserve
      for (const item of items) {
        const prod = resolveCatalogProduct(products, item.productId);
        if (!prod) {
          return res.status(400).json({ error: `Producto no encontrado: ${item.productId}` });
        }
        const currentStock = prod.stockByStore[assignedStoreId] || 0;
        const currentReserved = prod.reservedStockByStore[assignedStoreId] || 0;
        const availableToSell = currentStock - currentReserved;

        // Regla operativa: venta normal se pausa cuando quedan <= 2 unidades para evitar roturas
        if (availableToSell - item.quantity < 0) {
          return res.status(400).json({
            error: `Inventario insuficiente para ${prod.name} en ${assignedStore.name}. Disponibles para venta: ${Math.max(0, availableToSell)}`,
          });
        }
      }

      // La única reserva se aplica en createOrder después de validar todas las líneas.

      const hasPrescriptionItem = items.some((i: any) => i.requiresPrescription);
      const subtotal = items.reduce((acc: number, curr: any) => acc + (curr.price * curr.quantity), 0);
      const totalWeightKg = items.reduce((acc: number, curr: any) => acc + ((curr.weightKg || 0.2) * curr.quantity), 0);
      const totalWeightGrams = Math.round(totalWeightKg * 1000);
      const shipping = subtotal >= 70000 ? 0 : 4900;
      const serviceFee = NEW_ORDER_SERVICE_FEE;
      const promotion = administration.calculateDiscount(items.map(item => { const product = resolveCatalogProduct(products, item.productId)!; return { productId: product.parentProductId || product.id, variantId: product.variantId, price: item.price, quantity: item.quantity }; }), assignedStoreId);
      const total = subtotal - promotion.discount + shipping + serviceFee + tip;
      const expectedAmounts = [['expectedTotal', total], ['expectedDiscount', promotion.discount]] as const;
      for (const [field, authoritative] of expectedAmounts) {
        const expected = req.body[field];
        if (expected === undefined) continue;
        if (typeof expected !== 'number' || !Number.isFinite(expected) || expected < 0 || expected > Number.MAX_SAFE_INTEGER / 100) return res.status(400).json({ error: 'Los importes de confirmación no son válidos.' });
        if (Math.round(expected * 100) !== Math.round(authoritative * 100)) return res.status(409).json({ error: 'El precio o la promoción cambiaron. Revisa el total actualizado antes de confirmar.', code: 'PRICE_CHANGED', totals: { subtotal, discount: promotion.discount, shipping, serviceFee, tip, total } });
      }

      const random4DigitCode = Math.floor(1000 + Math.random() * 9000).toString();
      const orderUuid = randomUUID();
      const newOrderNum = `#BP-${orderUuid.slice(0, 8).toUpperCase()}`;

      const isSplitOrder = effectiveDeliveryMode === 'TURBO_DIVIDIDO';

      // ETA calculado dinámicamente según la cotización
      const estimatedMinutes = evaluatedQuote?.estimatedMinutes || (effectiveDeliveryMode === 'PROGRAMADO' ? 180 : 25);
      const promiseEnd = effectiveDeliveryMode === 'PROGRAMADO' && selectedScheduledWindow
        ? new Date(`${selectedScheduledWindow.date}T${selectedScheduledWindow.endTime}:00-05:00`).toISOString()
        : new Date(Date.now() + estimatedMinutes * 60 * 1000).toISOString();

      const newOrderId = `ORD-${orderUuid}`;

      // Generar envíos hijos si es Turbo Dividido
      let childShipments: any[] | undefined = undefined;
      if (isSplitOrder && evaluatedQuote?.turboDividido?.shipments) {
        let accumulatedCash = 0;
        childShipments = evaluatedQuote.turboDividido.shipments.map((plan: any, idx: number) => {
          const isLast = idx === evaluatedQuote.turboDividido.shipments.length - 1;
          
          // Asignación proporcional de efectivo contra entrega
          let shipmentCash = 0;
          if (paymentMethod === 'CASH_ON_DELIVERY') {
            if (isLast) {
              shipmentCash = Math.max(0, total - accumulatedCash);
            } else {
              const proportion = subtotal > 0 ? plan.subtotal / subtotal : 1 / evaluatedQuote.turboDividido.shipments.length;
              shipmentCash = Math.round(total * proportion);
              accumulatedCash += shipmentCash;
            }
          }

          // Convertir ítems del plan a OrderItem completo
          const shipmentItems = plan.items.map((pi: any) => {
            const catalogItem = items.find((it: any) => it.productId === pi.productId);
            return {
              productId: pi.productId,
              sku: catalogItem?.sku || `SKU-${pi.productId}`,
              name: pi.name,
              brand: catalogItem?.brand || 'Bolt Pets',
              presentation: catalogItem?.presentation || '',
              price: pi.price,
              quantity: pi.quantity,
              image: catalogItem?.image || 'https://images.unsplash.com/photo-1589924691995-400dc9ecc119?w=800',
              weightKg: pi.unitWeightKg,
              requiresPrescription: !!catalogItem?.requiresPrescription,
              picked: false,
            };
          });

          return {
            shipmentId: `SHP-${orderUuid}-${idx + 1}`,
            shipmentIndex: idx + 1,
            shipmentCount: evaluatedQuote.turboDividido.shipments.length,
            parentOrderId: newOrderId,
            childOrderId: `${newOrderId}-${String.fromCharCode(65 + idx)}`,
            items: shipmentItems,
            weightKg: plan.weightKg,
            weightGrams: plan.weightGrams,
            subtotal: plan.subtotal,
            cashToCollect: shipmentCash,
            fulfillmentStatus: 'CONFIRMADO',
            secretDeliveryCode: Math.floor(1000 + Math.random() * 9000).toString(),
            estimatedDeliveryMinutes: estimatedMinutes,
            driver: undefined,
            timestamps: {
              confirmedAt: new Date().toISOString(),
            },
          };
        });
      }

      const newOrder: Order = {
        id: newOrderId,
        orderNumber: newOrderNum,
        createdAt: new Date().toISOString(),
        storeId: assignedStoreId,
        storeName: assignedStore.name,
        deliveryMode: effectiveDeliveryMode,
        scheduledWindow: effectiveDeliveryMode === 'PROGRAMADO' ? selectedScheduledWindow : undefined,
        scheduledDispatch: effectiveDeliveryMode === 'PROGRAMADO' ? {
          localityCode: evaluatedQuote.scheduledAssignment.localityCode,
          localityName: evaluatedQuote.scheduledAssignment.localityName,
          policyVersion: evaluatedQuote.scheduledAssignment.policyVersion,
          status: 'CONFIRMADA',
        } : undefined,
        isSplitOrder,
        shipmentCount: childShipments ? childShipments.length : undefined,
        childShipments,
        customer: safeCustomer,
        deliveryAddress: safeAddress,
        items,
        totals: {
          subtotal,
          discount: promotion.discount,
          shipping,
          serviceFee,
          tip,
          total,
          totalWeightKg,
        },
        payment: {
          method: paymentMethod,
          status: 'PENDIENTE',
          cashToCollect: paymentMethod === 'CASH_ON_DELIVERY' ? total : 0,
          cashSettled: false,
          // Solo una confirmación verificada de la pasarela puede acreditar el pago.
          transactionId: undefined,
        },
        prescriptionReview: {
          status: hasPrescriptionItem ? 'PENDIENTE_REVISION' : 'NO_REQUIERE',
        },
        fulfillmentStatus: 'CONFIRMADO',
        secretDeliveryCode: random4DigitCode,
        estimatedDeliveryMinutes: estimatedMinutes,
        originalPromiseWindow: {
          start: new Date().toISOString(),
          end: promiseEnd,
        },
        deliveryQuoteSnapshot: evaluatedQuote ? {
          quoteId: evaluatedQuote.quoteId,
          geographicDistanceMeters: evaluatedQuote.geographicDistanceMeters,
          roadDistanceMeters: evaluatedQuote.roadDistanceMeters,
          totalSeconds: evaluatedQuote.etaComponents?.totalSeconds || (estimatedMinutes * 60),
          estimatedMinutes,
          configVersion: evaluatedQuote.configVersion || DELIVERY_CONFIG.configVersion,
          assignedStoreId,
        } : undefined,
        timestamps: {
          confirmedAt: new Date().toISOString(),
        },
      };

      const customerAccessToken = randomBytes(32).toString('base64url');
      (newOrder as any).customerAccessTokenHash = createHash('sha256').update(customerAccessToken).digest('hex');
      const createResult = ordersRepository.createOrder(newOrder, operationalCatalog());
      if (!createResult.success) {
        return res.status(400).json({ error: createResult.error });
      }
      return res.status(201).json({ ...createResult.order, customerAccessToken });
    } catch (e: any) {
      if (e instanceof AdminError) return res.status(e.status).json({ error: e.message, code: e.code });
      console.error('Error creating order:', e);
      return res.status(500).json({ error: 'No se pudo guardar el pedido. Vuelve a intentarlo.', code: 'ORDER_SAVE_FAILED' });
    }
  });

  // Get orders
  app.get('/api/v1/orders', (req: Request, res: Response) => {
    const { storeId, status } = req.query;
    let list = ordersRepository.getAllOrders();
    if (storeId) list = list.filter(o => o.storeId === storeId);
    if (status) list = list.filter(o => o.fulfillmentStatus === status);
    res.json(list);
  });

  // Get specific order
  app.get('/api/v1/orders/:orderId', (req: Request, res: Response) => {
    const order = ordersRepository.getOrderById(req.params.orderId);
    if (!order) return res.status(404).json({ error: 'Pedido no encontrado' });
    res.json(order);
  });

  // Get audit history of an order
  app.get('/api/v1/orders/:orderId/history', (req: Request, res: Response) => {
    const order = ordersRepository.getOrderById(req.params.orderId);
    if (!order) return res.status(404).json({ error: 'Pedido no encontrado' });
    res.json({
      orderId: order.id,
      orderNumber: order.orderNumber,
      status: order.fulfillmentStatus,
      history: order.statusHistory || ordersRepository.getAuditHistory(order.id),
    });
  });

  // Cancel order (Cliente solo antes de despacho; Bodega con motivo)
  app.post('/api/v1/orders/:orderId/cancel', (req: Request, res: Response) => {
    const { reason, role, actorName } = req.body;
    if (reason !== undefined && (typeof reason !== 'string' || reason.length > 1000)) return res.status(400).json({ error: 'El motivo de cancelación debe ser un texto válido.' });
    const actor = extractActor(req, role || 'CLIENTE');

    const result = ordersRepository.transitionStatus(req.params.orderId, 'CANCELADO', actor, {
      reason: reason || 'Cancelación de pedido solicitada',
      catalogProducts: operationalCatalog(),
    });

    if (!result.success) {
      return res.status(result.code || 400).json({ error: result.error });
    }

    res.json({ message: 'Pedido cancelado exitosamente', order: result.order });
  });

  // Upload or update prescription document
  app.post('/api/v1/orders/:orderId/prescription', (req: Request, res: Response) => {
    const order = ordersRepository.getOrderById(req.params.orderId);
    if (!order) return res.status(404).json({ error: 'Pedido no encontrado' });

    const { documentUrl, documentName, vetName, vetLicense } = req.body;
    if (typeof documentUrl !== 'string' || documentUrl.length > 2_000_000 || (documentUrl && !/^(https:\/\/|data:(image\/(png|jpeg|webp)|application\/pdf);base64,)/i.test(documentUrl)) || typeof documentName !== 'string' || !documentName.trim() || documentName.length > 250 || [vetName, vetLicense].some(value => value !== undefined && (typeof value !== 'string' || value.length > 200))) return res.status(400).json({ error: 'Revisa el documento y los datos de la fórmula veterinaria.' });
    ordersRepository.updateOrder(order.id, stored => { stored.prescriptionReview = {
      status: 'PENDIENTE_REVISION',
      documentUrl,
      documentName,
      uploadedAt: new Date().toISOString(),
      vetName,
      vetLicense,
    }; });

    res.json({ message: 'Fórmula veterinaria enviada a revisión', order });
  });

  // Customer and Operational tracking endpoint (sanitized real GPS)
  app.get('/api/v1/orders/:orderId/tracking', (req: Request, res: Response) => {
    const order = ordersRepository.getOrderById(req.params.orderId);
    if (!order) return res.status(404).json({ error: 'Pedido no encontrado' });

    const shipmentId = req.query.shipmentId ? String(req.query.shipmentId) : undefined;
    const child = shipmentId ? order.childShipments?.find(s => s.shipmentId === shipmentId) : undefined;
    if (shipmentId && !child) return res.status(404).json({ error: 'Envío hijo no encontrado' });
    const target = child ?? order;
    const driver = child ? child.driver : (order.isSplitOrder ? undefined : order.driver);
    const latestTelemetry = ordersRepository.getLatestTelemetry(order.id, shipmentId);
    const serverTimestamp = Date.now();

    res.json({
      orderId: order.id,
      orderNumber: order.orderNumber,
      status: target.fulfillmentStatus,
      shipmentId,
      assignmentId: target.assignmentId,
      tripId: target.tripId,
      nextSequenceNumber: ordersRepository.getNextTelemetrySequence(order.id, shipmentId),
      serverTimestamp,
      deliveryMode: order.deliveryMode || 'TURBO',
      scheduledWindow: order.scheduledWindow,
      isSplitOrder: !!order.isSplitOrder,
      shipmentCount: order.shipmentCount || (order.childShipments ? order.childShipments.length : 1),
      childShipments: order.childShipments,
      estimatedMinutes: order.estimatedDeliveryMinutes,
      secretDeliveryCode: target.secretDeliveryCode,
      driver: driver ? {
        id: driver.id,
        name: driver.name,
        phone: driver.phone,
        vehiclePlate: driver.vehiclePlate,
        vehicleType: driver.vehicleType,
        photo: driver.photo,
        rating: driver.rating,
      } : null,
      telemetry: latestTelemetry ? {
        pointId: latestTelemetry.pointId,
        orderId: latestTelemetry.orderId,
        shipmentId: latestTelemetry.shipmentId,
        driverId: latestTelemetry.driverId,
        latitude: latestTelemetry.latitude,
        longitude: latestTelemetry.longitude,
        accuracy: latestTelemetry.accuracy,
        heading: latestTelemetry.heading,
        speed: latestTelemetry.speed,
        timestamp: latestTelemetry.timestamp,
        sequenceNumber: latestTelemetry.sequenceNumber,
        secondsAgo: Math.max(0, Math.floor((serverTimestamp - latestTelemetry.timestamp) / 1000)),
      } : null,
      hubCoordinates: stores.find(s => s.id === order.storeId)?.coordinates || { lat: 4.6284, lng: -74.1539 },
      customerCoordinates: order.deliveryAddress.coordinates,
    });
  });

  // GPS Telemetry History (breadcrumbs for audit and live route rendering)
  app.get('/api/v1/orders/:orderId/telemetry/history', (req: Request, res: Response) => {
    const order = ordersRepository.getOrderById(req.params.orderId);
    if (!order) return res.status(404).json({ error: 'Pedido no encontrado' });

    const shipmentId = req.query.shipmentId ? String(req.query.shipmentId) : undefined;
    if (shipmentId && !order.childShipments?.some(s => s.shipmentId === shipmentId)) {
      return res.status(404).json({ error: 'Envío hijo no encontrado' });
    }
    const history = ordersRepository.getTelemetryHistory(order.id, shipmentId);

    res.json({
      orderId: order.id,
      shipmentId,
      pointsCount: history.length,
      count: history.length,
      history,
    });
  });

  // Verify delivery with customer secret code (supports entire order or individual child shipment)
  app.post('/api/v1/orders/:orderId/verify-delivery', (req: Request, res: Response) => {
    const { deliveryCode, shipmentId } = req.body;
    if (!deliveryCode) {
      return res.status(400).json({ error: 'Se requiere el código secreto de entrega de 4 dígitos.' });
    }

    const actor = extractActor(req, 'CONDUCTOR');
    const result = ordersRepository.verifyDelivery(req.params.orderId, deliveryCode, actor, shipmentId, operationalCatalog());

    if (!result.success) {
      return res.status(result.code || 403).json({ error: result.error });
    }

    res.json({
      message: shipmentId ? 'Envío verificado y entregado exitosamente' : 'Entrega verificada exitosamente',
      childShipment: result.childShipment,
      order: result.order,
    });
  });

  // ==========================================
  // BOLT CONDUCTOR ANDROID SHARED CONTRACT ROUTES
  // ==========================================

  app.get('/api/v1/driver/profile', (_req: Request, res: Response) => {
    const currentDrivers = ordersRepository.getAllDrivers();
    res.json(currentDrivers[0]);
  });

  app.post('/api/v1/driver/shift', (req: Request, res: Response) => {
    const { action, driverId } = req.body;
    if (!['START', 'END'].includes(action) || (driverId !== undefined && typeof driverId !== 'string')) return res.status(400).json({ error: 'Selecciona un conductor y una acción de turno válidos.' });
    const currentDrivers = ordersRepository.getAllDrivers();
    const target = driverId ? currentDrivers.find(driver => driver.id === driverId) : currentDrivers[0];
    if (!target) return res.status(404).json({ error: 'Conductor no encontrado.' });
    const driver = ordersRepository.updateDriver(target.id, stored => {
      stored.isOnline = action === 'START';
      stored.currentStatus = stored.isOnline ? 'DISPONIBLE' : 'FUERA_DE_TURNO';
    })!;
    res.json({ message: `Turno ${driver.isOnline ? 'iniciado' : 'finalizado'}`, driver });
  });

  app.get('/api/v1/driver/assignments', (_req: Request, res: Response) => {
    const all = ordersRepository.getAllOrders();
    const activeOrder = all.find(o => 
      (o.driver?.id === 'DRV-CARLOS-01' && o.fulfillmentStatus !== 'ENTREGADO' && o.fulfillmentStatus !== 'CANCELADO') ||
      (o.childShipments?.some(c => c.driver?.id === 'DRV-CARLOS-01' && c.fulfillmentStatus !== 'ENTREGADO' && c.fulfillmentStatus !== 'CANCELADO'))
    );
    res.json({ activeAssignment: activeOrder || null });
  });

  app.post('/api/v1/driver/assignments/:assignmentId/accept', (req: Request, res: Response) => {
    const assignmentId = req.params.assignmentId;
    const all = ordersRepository.getAllOrders();
    let targetOrder = all.find(o => o.assignmentId === assignmentId);
    let targetShipmentId: string | undefined;

    if (!targetOrder) {
      for (const o of all) {
        const child = o.childShipments?.find(c => c.assignmentId === assignmentId);
        if (child) {
          targetOrder = o;
          targetShipmentId = child.shipmentId;
          break;
        }
      }
    }

    if (!targetOrder) {
      return res.status(404).json({ error: `Asignación no encontrada: ${assignmentId}` });
    }

    res.json({
      message: 'Asignación aceptada por el conductor',
      assignmentId,
      orderId: targetOrder.id,
      shipmentId: targetShipmentId,
    });
  });

  app.post('/api/v1/driver/assignments/:assignmentId/pickup', (req: Request, res: Response) => {
    const assignmentId = req.params.assignmentId;
    const all = ordersRepository.getAllOrders();
    let targetOrder = all.find(o => o.assignmentId === assignmentId);
    let targetShipmentId: string | undefined;

    if (!targetOrder) {
      for (const o of all) {
        const child = o.childShipments?.find(c => c.assignmentId === assignmentId);
        if (child) {
          targetOrder = o;
          targetShipmentId = child.shipmentId;
          break;
        }
      }
    }

    if (!targetOrder) {
      return res.status(404).json({ error: `Asignación no encontrada: ${assignmentId}` });
    }

    const actor = extractActor(req, 'CONDUCTOR');
    const result = ordersRepository.confirmPickup(targetOrder.id, actor, targetShipmentId);
    if (!result.success) {
      return res.status(result.code || 400).json({
        error: result.error,
      });
    }

    res.json({
      message: 'Recogida física verificada en bodega. Pedido en camino.',
      order: result.order,
      childShipment: result.childShipment,
    });
  });

  app.post('/api/v1/driver/assignments/:assignmentId/delivered', (req: Request, res: Response) => {
    const assignmentId = req.params.assignmentId;
    const { deliveryCode, recipientNotes } = req.body;

    if (!deliveryCode) {
      return res.status(400).json({ error: 'Se requiere el código de entrega de 4 dígitos.' });
    }

    const all = ordersRepository.getAllOrders();
    let targetOrder = all.find(o => o.assignmentId === assignmentId);
    let targetShipmentId: string | undefined;

    if (!targetOrder) {
      for (const o of all) {
        const child = o.childShipments?.find(c => c.assignmentId === assignmentId);
        if (child) {
          targetOrder = o;
          targetShipmentId = child.shipmentId;
          break;
        }
      }
    }

    if (!targetOrder) {
      return res.status(404).json({ error: `Asignación no encontrada: ${assignmentId}` });
    }

    const actor = extractActor(req, 'CONDUCTOR');
    const result = ordersRepository.verifyDelivery(targetOrder.id, deliveryCode, actor, targetShipmentId, operationalCatalog());
    if (!result.success) {
      return res.status(result.code || 403).json({ error: result.error });
    }

    res.json({
      message: 'Entrega verificada exitosamente',
      order: result.order,
      childShipment: result.childShipment,
      recipientNotes,
    });
  });

  app.post('/api/v1/driver/assignments/:assignmentId/incident', (req: Request, res: Response) => {
    const assignmentId = req.params.assignmentId;
    const { incidentType, description } = req.body;

    const all = ordersRepository.getAllOrders();
    let targetOrder = all.find(o => o.assignmentId === assignmentId);
    let targetShipmentId: string | undefined;

    if (!targetOrder) {
      for (const o of all) {
        const child = o.childShipments?.find(c => c.assignmentId === assignmentId);
        if (child) {
          targetOrder = o;
          targetShipmentId = child.shipmentId;
          break;
        }
      }
    }

    if (!targetOrder) {
      return res.status(404).json({ error: `Asignación no encontrada: ${assignmentId}` });
    }

    const actor = extractActor(req, 'CONDUCTOR');
    const result = ordersRepository.reportIncident(
      targetOrder.id,
      actor,
      incidentType || 'NOVEDAD_RUTA',
      description || 'Incidencia en ruta',
      targetShipmentId
    );

    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    res.json({
      message: 'Incidencia registrada exitosamente',
      order: result.order,
    });
  });

  app.post('/api/v1/driver/gps', (req: Request, res: Response) => {
    const telemetry: GPSTelemetry = req.body;
    if (!telemetry || !telemetry.orderId || typeof telemetry.latitude !== 'number' || typeof telemetry.longitude !== 'number') {
      return res.status(400).json({ error: 'Datos de telemetría incompletos (se requieren orderId, latitude y longitude)' });
    }

    const actor = extractActor(req, 'CONDUCTOR');

    const result = ordersRepository.recordTelemetry(telemetry, actor);
    if (!result.success) {
      return res.status(result.code || 400).json({
        error: result.error,
        nextSequenceNumber: ordersRepository.getNextTelemetrySequence(telemetry.orderId, telemetry.shipmentId),
      });
    }

    const totalCount = ordersRepository.getTelemetryHistory(telemetry.orderId, telemetry.shipmentId).length;
    res.json({
      status: 'telemetry_received',
      point: result.point,
      count: totalCount,
    });
  });

  // ==========================================
  // OPERATIONS DASHBOARD ROUTES
  // ==========================================

  app.post('/api/v1/operations/orders/:orderId/status', (req: Request, res: Response) => {
    const { status, shipmentId, reason, deliveryCode, notes } = req.body;
    if (!status) {
      return res.status(400).json({ error: 'Se requiere especificar el parámetro status' });
    }
    if ([reason, notes].some(value => value !== undefined && (typeof value !== 'string' || value.length > 1000))) return res.status(400).json({ error: 'El motivo y las notas deben ser textos válidos.' });

    const actor = extractActor(req, 'BODEGA');
    const result = ordersRepository.transitionStatus(req.params.orderId, status, actor, {
      shipmentId,
      reason,
      deliveryCode,
      catalogProducts: operationalCatalog(),
      notes,
    });

    if (!result.success) {
      return res.status(result.code || 400).json({ error: result.error });
    }

    res.json({
      message: `Estado actualizado exitosamente a ${status}`,
      order: result.order,
      childShipment: result.childShipment,
    });
  });

  app.post('/api/v1/operations/orders/:orderId/prescription/review', (req: Request, res: Response) => {
    const order = ordersRepository.getOrderById(req.params.orderId);
    if (!order) return res.status(404).json({ error: 'Pedido no encontrado' });

    const { status, reviewNotes, reviewerName } = req.body;
    if (!['APROBADA', 'RECHAZADA'].includes(status)) return res.status(400).json({ error: 'Estado de revisión no válido.' });
    ordersRepository.updateOrder(order.id, stored => { stored.prescriptionReview = {
      ...order.prescriptionReview,
      status,
      reviewNotes,
      reviewedBy: (req as any).adminUser.displayName,
      reviewedAt: new Date().toISOString(),
    }; });

    res.json({ message: 'Revisión farmacéutica registrada', order });
  });

  app.post('/api/v1/operations/orders/:orderId/assign-driver', (req: Request, res: Response) => {
    const { driverId, shipmentId } = req.body;
    if (typeof driverId !== 'string' || !driverId) {
      return res.status(400).json({ error: 'Selecciona un conductor antes de asignar el envío.' });
    }
    const actor = extractActor(req, 'COORDINADOR');
    const result = ordersRepository.assignDriver(req.params.orderId, driverId, actor, shipmentId);

    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    res.json({
      message: 'Conductor asignado exitosamente',
      order: result.order,
      childShipment: result.childShipment,
    });
  });

  // Confirm physical return of cancelled dispatched order
  app.post('/api/v1/operations/orders/:orderId/confirm-physical-return', (req: Request, res: Response) => {
    const { inspectorName, notes, shipmentId } = req.body;
    const result = ordersRepository.confirmPhysicalReturn(
      req.params.orderId,
      (req as any).adminUser.displayName,
      operationalCatalog(),
      notes,
      shipmentId
    );

    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    res.json({
      message: 'Devolución física confirmada. Inventario reingresado a disponible.',
      order: result.order,
    });
  });

  // Integrations status
  app.get('/api/v1/integrations/status', (_req: Request, res: Response) => {
    res.json({
      shopifyOlfato: {
        name: 'Shopify / Olfato',
        status: 'En pruebas',
        lastSync: new Date(Date.now() - 45 * 60 * 1000).toISOString(),
        mappedSkusCount: 42,
      },
      siigoNube: {
        name: 'Siigo Nube (Facturación Electrónica DIAN)',
        status: 'En pruebas',
        lastSync: new Date(Date.now() - 15 * 60 * 1000).toISOString(),
        pendingInvoices: 2,
      },
      wompi: {
        name: 'Wompi Colombia (Bancolombia, Tarjetas, PSE)',
        status: 'Conectada (Ambiente Sandbox)',
        lastTransaction: new Date(Date.now() - 12 * 60 * 1000).toISOString(),
      },
      whatsappBot: {
        name: 'WhatsApp Business API Bot',
        status: 'Conectada (Simulador Activo)',
        activeConversations: 3,
      },
    });
  });

  // Verify and calibrate warehouse dispatch entrance
  app.post('/api/v1/stores/:id/verify-entrance', (req: Request, res: Response) => {
    const store = stores.find(s => s.id === req.params.id);
    if (!store) return res.status(404).json({ error: 'Bodega no encontrada' });

    const { coordinates, verifiedBy = 'Administrador Logística Bolt' } = req.body;
    if (!coordinates || typeof coordinates.lat !== 'number' || typeof coordinates.lng !== 'number') {
      return res.status(400).json({ error: 'Coordenadas de entrada inválidas' });
    }

    const verifiedCoords = {
      lat: Number(coordinates.lat.toFixed(6)),
      lng: Number(coordinates.lng.toFixed(6)),
    };

    store.verifiedEntrance = verifiedCoords;
    store.coordinates = verifiedCoords; // Actualizar origen operacional de rutas
    store.verificationStatus = 'VERIFIED';
    store.verifiedAt = new Date().toISOString();
    store.verifiedBy = verifiedBy;

    res.json({
      message: `Entrada física de cargue verificada para ${store.name}`,
      store,
    });
  });

  // Shopify sync state & triggers
  app.get('/api/v1/shopify/status', (_req: Request, res: Response) => {
    res.json(shopifyService.getState());
  });

  app.post('/api/v1/shopify/sync', async (_req: Request, res: Response) => {
    try {
      const state = await shopifyService.triggerReconciliation();
      res.json({
        message: 'Conciliación de inventario con Shopify (Agrocentro Pets) completada exitosamente',
        state,
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message || 'Error en conciliación de inventario con Shopify' });
    }
  });

  app.post('/api/v1/shopify/webhook', (req: Request, res: Response) => {
    const topic = req.headers['x-shopify-topic'] || 'inventory_levels/update';
    console.log(`[Shopify Webhook] Evento recibido: ${topic}`);
    res.status(200).json({ received: true });
  });

  // Simulador de webhook de Shopify (inventory_levels/update) para pruebas operativas seguras
  app.post('/api/v1/shopify/simulate-webhook', (req: Request, res: Response) => {
    return res.status(409).json({ error: 'Gestiona las existencias reales en Inventario. El simulador no puede modificar el catálogo operativo.' });
  });

  // ==========================================
  // FRONTEND MOUNTING (VITE IN DEV / STATIC IN PROD)
  // ==========================================

  if (options.serveFrontend !== false && process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else if (options.serveFrontend !== false) {
    app.use(express.static(path.join(__dirname, 'dist')));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(__dirname, 'dist', 'index.html'));
    });
  }

  // Express ya atiende errores de escritura como fallos, sin responder éxito ficticio.
  app.use((error: Error, _req: Request, res: Response, _next: express.NextFunction) => {
    if (error instanceof AdminError) return res.status(error.status).json({ error: error.message, code: error.code });
    if (error instanceof SyntaxError && 'body' in error) return res.status(400).json({ error: 'La solicitud no contiene datos JSON válidos.' });
    console.error('[Bolt Pets] Falló una operación:', error.message);
    res.status(500).json({ error: 'No se pudo guardar la operación. Vuelve a intentarlo.' });
  });
  return app;
}

export async function startServer() {
  const app = await createBoltApp();
  const port = Number(process.env.PORT || 4327);
  const host = process.env.HOST || '127.0.0.1';
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT debe ser un puerto válido.');
  return new Promise<ReturnType<typeof app.listen>>((resolve, reject) => {
    const server = app.listen(port, host, () => {
      console.log(`Bolt Pets disponible en http://${host}:${port}`);
      resolve(server);
    });
    server.once('error', reject);
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  startServer().catch(err => {
    console.error('Failed to start server:', err);
    process.exitCode = 1;
  });
}
