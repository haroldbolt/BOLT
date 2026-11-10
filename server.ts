import {searchDeliveryAddress} from './src/lib/forwardGeocoding';
import {mountEntrancePhotos} from './src/lib/entrancePhotoRoutes';
import {mountTrackingRecovery} from './src/lib/trackingRecovery';
import {simulationEnabled,LocalSimulationProvider,mountDispatchSimulation} from './src/lib/dispatchSimulation';
import {DispatchService} from './src/lib/dispatchService';
import {mountDispatchRoutes,mountOrderAccess} from './src/lib/dispatchRoutes';
import { COVERAGE_MUNICIPALITIES, scheduledServiceReady } from './src/data/coverageConfig';
import { TransportRepository } from './src/lib/transportRepository';
import { validateTransportAttributes } from './src/lib/transportPlanner';
import { CatalogOperations } from './src/lib/catalogOperations';
import { acquireCatalogWriterLock } from './src/lib/catalogWriterLock';
import { describeWarehouse } from './src/lib/warehouseAssignment';
import { enrichDestination } from './src/lib/serverGeography';
import { parseAddressComponents } from './src/lib/addressGeography';
// Set DISABLE_HMR per AI Studio environment constraints
if (process.env.DISABLE_HMR === undefined) {
  process.env.DISABLE_HMR = 'true';
}

import express, { Request, Response } from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import { INITIAL_PRODUCTS, INITIAL_STORES } from './src/data/seedData';
import { Order, Product, Store, DriverProfile, GPSTelemetry, OrderActor, ActorRole } from './src/types';
import { evaluateDeliveryQuote, DELIVERY_CONFIG, validateScheduledBooking, generateScheduledSlots } from './src/lib/deliveryService';
import { shopifyService } from './src/lib/shopifyService';
import { loadPrivateInventorySnapshot, PrivateInventoryResult } from './src/lib/privateInventoryLoader';
import { localCatalogService } from './src/lib/localCatalogService';
import { ordersRepository } from './src/lib/ordersRepository';
import { adminAuthService } from './src/lib/adminAuthService';
import { catalogRepository } from './src/lib/catalogRepository';
import {
  resolveTerritorialAssignment,
  canonicalizeBogotaLocality,
  isSoachaMunicipality,
  TerritorialAssignmentResult,
} from './src/lib/territoryConfig';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Identity is derived exclusively from verified server sessions or an order capability.
function extractActor(req:Request, _defaultRole?:ActorRole):OrderActor {
  const session=(req as any).adminSession;
  return session?{role:'ADMINISTRADOR',id:session.userId,name:session.name}:{role:'CLIENTE',id:(req as any).authorizedOrderId};
}

// Authoritative in-memory state initialized from local catalog repository (persisted overrides + 3.830 productos agrupados)
let stores: Store[] = localCatalogService.getStores().length > 0 ? localCatalogService.getStores() : JSON.parse(JSON.stringify(INITIAL_STORES));
let products: Product[] = catalogRepository.getAllProducts(true);

// Registro de carga de catálogo local
console.log(`[Catálogo Local] Iniciado con ${products.length} productos agrupados (${products.filter(p => p.status === 'ACTIVE').length} activos), ${localCatalogService.getTotalVariantsCount()} variantes y ${stores.length} bodegas.`);

// Comprobación de inventario privado (.bolt-private/shopify/snapshot.json no bloqueante)
const privateInventoryStatus: PrivateInventoryResult = loadPrivateInventorySnapshot();
console.log(`[Inventario Privado] ${privateInventoryStatus.message} Se utiliza el catálogo local estructurado.`);
let drivers: DriverProfile[] = ordersRepository.getAllDrivers();


const catalogOperations = new CatalogOperations({file:path.join(process.cwd(),'.bolt-private','catalog-operations.json'),products:()=>catalogRepository.getAllProducts(true),stores:()=>stores,orders:()=>ordersRepository.getAllOrders()});
const transportRepository = new TransportRepository();
const isDispatchSimulation=simulationEnabled();
const simulationProvider=isDispatchSimulation?new LocalSimulationProvider(()=>transportRepository.read().config.vehicles[0]):undefined;
const dispatchService=new DispatchService({repo:ordersRepository,stores:()=>stores,products:()=>products,transport:()=>transportRepository.read().config,simulation:isDispatchSimulation,providers:simulationProvider?[simulationProvider]:[]});
function transportContext() { const config=transportRepository.read().config; return {config:{...config,externalProviders:[]},drivers:dispatchService.quoteDrivers(),orders:ordersRepository.getAllOrders()}; }
function quoteForPurchase(request: any) {
  request={...request,destination:enrichDestination(request.destination)};
  const quote=evaluateDeliveryQuote(request,stores,products,ordersRepository.getAllOrders(),transportContext());
  if(quote.recommendedMode && quote.transportPlan?.feasible && quote.basketValidated) quote.confirmationToken=crypto.createHash('sha256').update(JSON.stringify({
    destination:{address:request.destination.address,coordinates:request.destination.coordinates,locality:request.destination.locality,municipality:request.destination.municipality},mode:quote.recommendedMode,slot:request.scheduledWindow ? {date:request.scheduledWindow.date,slotId:request.scheduledWindow.slotId}:null,
    charges:quote.charges,shipments:quote.transportPlan.shipments,items:(request.items||[]).map((i:any)=>[i.productId,i.quantity,products.find(p=>p.id===i.productId)?.price]).sort(),
  })).digest('hex');
  return quote;
}
async function startServer() {
  acquireCatalogWriterLock();
  acquireCatalogWriterLock(process.env.BOLT_DATA_DIR || path.join(process.cwd(),'src/data'));
  if(isDispatchSimulation && adminAuthService.isSetupRequired()) {const fixture=JSON.parse(fs.readFileSync(path.join(process.cwd(),'.bolt-private','dispatch-simulation.json'),'utf8'));adminAuthService.setupMasterAdmin({...fixture.admin,name:'Administración simulada'});}
  catalogOperations.initializeOrderTracking();
  const app = express();
  const PORT = parseInt(process.env.PORT || '3000', 10);

  if(isDispatchSimulation)app.use((req,res,next)=>{const origin=req.get('Origin');if(!/^127\.0\.0\.1(:\d+)?$/.test(req.get('Host')||'') || origin && origin!==`http://127.0.0.1:${PORT}`)return res.status(403).json({error:'Simulación disponible únicamente en su origen local'});next()});
  app.use(cors(isDispatchSimulation?{origin:`http://127.0.0.1:${PORT}`} : {}));
  app.use(express.json({ limit: '15mb' }));
  app.use('/api/v1', (_req,_res,next)=>{products=catalogOperations.getSalesProducts();next();});
  app.use('/uploads', express.static(path.join(process.cwd(), 'public', 'uploads')));

  // Función para validar encabezados binarios y guardar imagen en public/uploads/catalog
  function saveBase64Image(dataUrl: string, originalFilename?: string): { url: string; filename: string; size: number } {
    const match = dataUrl.match(/^data:(image\/[a-zA-Z0-9.+_-]+);base64,(.+)$/);
    if (!match) {
      throw new Error('Formato de imagen inválido. Debe ser una imagen en Base64 (data:image/...).');
    }

    const mimeType = match[1].toLowerCase();
    const base64Data = match[2];
    const buffer = Buffer.from(base64Data, 'base64');

    // Validar tamaño máximo 5 MB
    const maxSizeBytes = 5 * 1024 * 1024;
    if (buffer.length > maxSizeBytes) {
      throw new Error('La imagen excede el límite permitido de 5 MB.');
    }

    // Validar encabezados binarios (Magic Bytes) según el tipo de archivo
    let ext = 'jpg';
    if (mimeType === 'image/jpeg' || mimeType === 'image/jpg') {
      if (buffer.length < 3 || buffer[0] !== 0xFF || buffer[1] !== 0xD8 || buffer[2] !== 0xFF) {
        throw new Error('Encabezado de imagen JPEG corrupto o no válido.');
      }
      ext = 'jpg';
    } else if (mimeType === 'image/png') {
      if (buffer.length < 8 || buffer[0] !== 0x89 || buffer[1] !== 0x50 || buffer[2] !== 0x4E || buffer[3] !== 0x47) {
        throw new Error('Encabezado de imagen PNG corrupto o no válido.');
      }
      ext = 'png';
    } else if (mimeType === 'image/webp') {
      const riff = buffer.subarray(0, 4).toString('ascii');
      const webp = buffer.subarray(8, 12).toString('ascii');
      if (riff !== 'RIFF' || webp !== 'WEBP') {
        throw new Error('Encabezado de imagen WEBP corrupto o no válido.');
      }
      ext = 'webp';
    } else if (mimeType === 'image/gif') {
      const gif = buffer.subarray(0, 3).toString('ascii');
      if (gif !== 'GIF') {
        throw new Error('Encabezado de imagen GIF corrupto o no válido.');
      }
      ext = 'gif';
    } else {
      throw new Error(`Tipo de imagen no admitido (${mimeType}). Formatos soportados: JPEG, PNG, WEBP, GIF.`);
    }

    const uploadDir = path.join(process.cwd(), 'public', 'uploads', 'catalog');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }

    const cleanBaseName = originalFilename
      ? path.basename(originalFilename).replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 25)
      : 'foto';
    const uniqueFilename = `img-${Date.now()}-${crypto.randomBytes(4).toString('hex')}-${cleanBaseName}.${ext}`;
    const filePath = path.join(uploadDir, uniqueFilename);

    fs.writeFileSync(filePath, buffer);

    return {
      url: `/uploads/catalog/${uniqueFilename}`,
      filename: uniqueFilename,
      size: buffer.length,
    };
  }

  // Middleware estricto de autenticación administrativa (no permite bypass por x-actor-role sin token válido)
  function requireAdminAuth(req: Request, res: Response, next: () => void) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        error: 'Acceso denegado: Se requiere un token de sesión de administrador válido.',
        code: 'UNAUTHORIZED',
      });
    }

    const token = authHeader.substring(7).trim();
    const session = adminAuthService.verifySession(token);

    if (!session || session.role !== 'ADMINISTRADOR') {
      return res.status(403).json({
        error: 'Sesión administrativa inválida o expirada. Por favor inicia sesión nuevamente.',
        code: 'FORBIDDEN',
      });
    }

    (req as any).adminSession = session;
    next();
  }

  mountDispatchRoutes(app,dispatchService,ordersRepository,requireAdminAuth);
  mountTrackingRecovery(app,ordersRepository,dispatchService,requireAdminAuth);
  if(simulationProvider)mountDispatchSimulation(app,dispatchService,ordersRepository,transportRepository,()=>products,()=>stores,simulationProvider,requireAdminAuth);
  else app.get('/api/v1/simulation',(_q,res)=>res.json({enabled:false}));
  app.use('/api/v1/operations',requireAdminAuth);
  mountOrderAccess(app,dispatchService,token=>adminAuthService.verifySession(token));
  mountEntrancePhotos(app,ordersRepository,dispatchService,path.join(process.env.BOLT_DATA_DIR || path.join(process.cwd(),'src/data'),'private-entrance-photos'));
  // Real provider adapters are intentionally absent. Polling is durable and has no booking side effects on quotes.
  let dispatchTickRunning=false;
  const dispatchTimer=setInterval(async()=>{if(dispatchTickRunning||!Object.keys(ordersRepository.dispatchState.runs).length)return;dispatchTickRunning=true;try{await dispatchService.tick()}catch{console.error('[Dispatch] worker failed; durable state retained')}finally{dispatchTickRunning=false}},1000);
  dispatchTimer.unref();

  // ==========================================
  // /api/v1 ROUTES
  // ==========================================

  // Health check
  app.get('/api/v1/health', (_req: Request, res: Response) => {
    res.json({
      status: 'ok',
      service: 'Bolt Pets Authoritative Backend',
      version: '1.0.0',
      catalogSource: 'LOCAL_CATALOG (src/data/catalogo-local)',
      timezone: 'America/Bogota',
      locale: 'es-CO',
      storesCount: stores.length,
      totalProductosAgrupados: products.length,
      totalVariantes: localCatalogService.getTotalVariantsCount(),
      productosActivos: products.filter(p => p.status === 'ACTIVE').length,
      ordersCount: ordersRepository.getAllOrders().length,
      privateInventory: {
        targetFile: privateInventoryStatus.filePath,
        found: privateInventoryStatus.fileFound,
        message: privateInventoryStatus.message,
      },
      timestamp: new Date().toISOString(),
    });
  });

  // Resumen del catálogo local estructurado
  app.get('/api/v1/catalog/summary', (_req: Request, res: Response) => {
    res.json(localCatalogService.getSummary());
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
    let filtered = catalogOperations.getProducts();

    // 4. Para clientes muestra productos ACTIVE (salvo que se solicite all=true)
    if (all !== 'true') {
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

    res.json(filtered);
  });

  const presentOrder = (order: Order) => {
    const warehouse=stores.find(store=>store.id===order.storeId);
    return {...order, dispatchStatusMessage:dispatchService.customerMessage(order.id), dispatches:dispatchService.customerDispatches(order.id), warehouseAssignment:order.warehouseAssignment,
      storeName:order.warehouseAssignment?.store.name || warehouse?.name || '',
      warehouse:order.warehouseAssignment?.store || describeWarehouse(warehouse)};
  };

  // Authoritative Delivery Quote Endpoint
  app.post('/api/v1/delivery/quote', (req: Request, res: Response) => {
    res.set('Cache-Control', 'no-store');
    const quote=quoteForPurchase(req.body);
    return res.json({...quote,warehouse:describeWarehouse(stores.find(store=>store.id===quote.assignedStoreId))});
  });

  // Reverse Geocoding Proxy (Google Maps Platform Geocoding API)
  app.get('/api/v1/geocode/reverse', async (req: Request, res: Response) => {
    const { lat, lng } = req.query;
    if (!lat || !lng) {
      return res.status(400).json({ error: 'Faltan parámetros lat y lng' });
    }

    const apiKey = process.env.VITE_GOOGLE_MAPS_API_KEY || 'AIzaSyBeZD10ABWRpSpwChGlSzPR-6wxdD9oJcE';
    try {
      const response = await fetch(
        `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${apiKey}&language=es&region=co`
      );
      const data: any = await response.json();

      if (data.status === 'OK' && data.results && data.results.length > 0) {
        const first = data.results[0];
        const raw = first.formatted_address;
        let address = raw
          .replace(/,\s*Bogotá,\s*D\.C\.,\s*Bogotá,\s*Bogotá,\s*D\.C\./gi, ', Bogotá')
          .replace(/,\s*Bogotá,\s*D\.C\./gi, ', Bogotá')
          .replace(/,\s*Cundinamarca/gi, '')
          .trim();

        const territory = parseAddressComponents(first.address_components);
        const resolved = enrichDestination({...territory, coordinates: {lat:Number(lat),lng:Number(lng)}});

        return res.json({
          address,
          formattedAddress: address,
          rawAddress: raw,
          municipality: resolved.municipality || territory.municipality,
          countryCode: resolved.countryCode || territory.countryCode,
          locality: resolved.locality,
          neighborhood: territory.neighborhood,
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
    if (!address) {
      return res.status(400).json({ error: 'Parámetro address requerido' });
    }

    const apiKey = process.env.VITE_GOOGLE_MAPS_API_KEY || 'AIzaSyBeZD10ABWRpSpwChGlSzPR-6wxdD9oJcE';
    const municipality=typeof req.query.municipality==='string' ? req.query.municipality : '';
    const result=await searchDeliveryAddress(String(address).slice(0,500),municipality.slice(0,100),apiKey);
    res.set('Cache-Control','no-store');
    return res.json(result);
  });

  // Create Order with transactional stock reservation & delivery policy validation
  app.post('/api/v1/orders', (req: Request, res: Response) => {
    try {
      const creationRequestId=req.get('Idempotency-Key');
      if(!creationRequestId) return res.status(400).json({code:'IDEMPOTENCY_REQUIRED',error:'Falta el identificador estable de confirmación. Actualiza e intenta nuevamente.'});
      const creationRequestFingerprint=crypto.createHash('sha256').update(JSON.stringify(req.body)).digest('hex');
      if(creationRequestId) {
        if(creationRequestId.length>150) return res.status(400).json({error:'Identificador de solicitud inválido'});
        const previous=ordersRepository.getOrderByCreationRequest(creationRequestId);
        if(previous) return previous.creationRequestFingerprint===creationRequestFingerprint
          ? res.status(200).json({...presentOrder(previous),guestAccessToken:dispatchService.guestToken(previous)}) : res.status(409).json({error:'La solicitud ya fue utilizada con otros datos.'});
      }
      const {
        storeId,
        items: submittedItems,
        customer,
        deliveryAddress: rawDeliveryAddress,
        paymentMethod,
        tip = 0,
        deliveryMode: requestedDeliveryMode,
        scheduledWindow,
      } = req.body;

      if(!Array.isArray(submittedItems)||!submittedItems.length) return res.status(400).json({error:'Carrito vacío'});
      const canonicalItems=new Map<string,any>();
      for(const item of submittedItems) {
        const p=products.find(p=>p.id===item.productId);
        if(!p || p.status && p.status!=='ACTIVE' || !Number.isSafeInteger(item.quantity) || item.quantity<1) return res.status(400).json({error:'Variante o cantidad inválida'});
        if(!Number.isFinite(p.price)||p.price<=0 || item.price!==p.price) return res.status(409).json({code:'PRICE_CHANGED',error:'El precio cambió o está pendiente. Actualiza el carrito y confirma nuevamente.'});
        const existing=canonicalItems.get(p.id);
        canonicalItems.set(p.id,{...item,productId:p.id,sku:p.sku,name:p.name,brand:p.brand,presentation:p.presentation,image:p.image,price:p.price,weightKg:p.weightKg,requiresPrescription:p.requiresPrescription,quantity:(existing?.quantity||0)+item.quantity});
      }
      const items=Array.from(canonicalItems.values());
      const deliveryAddress = enrichDestination(rawDeliveryAddress);
      if (!items || !items.length || !customer || !deliveryAddress || !paymentMethod) {
        return res.status(400).json({ error: 'Faltan campos obligatorios para crear el pedido.' });
      }

      // 1. Resolución y validación territorial autoritativa
      const territoryAssignment = resolveTerritorialAssignment({
        municipality: deliveryAddress.municipality,
        locality: deliveryAddress.locality,
        address: deliveryAddress.address,
        coordinates: deliveryAddress.coordinates,
      });

      // Validar cobertura y límite de tiempo con el motor autoritativo si hay coordenadas
      let assignedStoreId = storeId;
      let evaluatedQuote: any = null;

      if (deliveryAddress.coordinates && !isNaN(deliveryAddress.coordinates.lat) && !isNaN(deliveryAddress.coordinates.lng)) {
        evaluatedQuote = quoteForPurchase({
          destination: deliveryAddress,
          items: items.map((i: any) => ({ productId: i.productId, quantity: i.quantity })),
          requestedMode: requestedDeliveryMode,
          scheduledWindow,
        });

        // Si el cliente pide Envío Programado, validar que tenga cobertura programada, no esté vencido el corte y haya cupo
        if (requestedDeliveryMode === 'PROGRAMADO') {
          if (!evaluatedQuote.scheduledEligible) {
            return res.status(400).json({
              error: evaluatedQuote.message || 'Dirección fuera de la zona de cobertura metropolitana de entrega programada.',
              eligibilityStatus: evaluatedQuote.eligibilityStatus,
              code: evaluatedQuote.reasonCode,
            });
          }

          // Regla autoritativa: La bodega para pedidos programados es ESTRICTAMENTE la territorial (previene manipulación del navegador)
          assignedStoreId = territoryAssignment.assignedStoreId!;

          if (!scheduledWindow) return res.status(400).json({code:'MODE_UNAVAILABLE',error:'Selecciona una franja de entrega programada.'});
          if (scheduledWindow) {
            const canonicalSlot = evaluatedQuote.scheduledSlots.find((slot: any) =>
              slot.date === scheduledWindow.date &&
              (!scheduledWindow.slotId || slot.slotId === scheduledWindow.slotId) &&
              (!scheduledWindow.startTime || slot.startTime === scheduledWindow.startTime) &&
              (!scheduledWindow.windowId || slot.windowId === scheduledWindow.windowId));
            if(!canonicalSlot || canonicalSlot.cutoffPassed || canonicalSlot.availableCapacity<=0) return res.status(400).json({code:'SLOT_CAPACITY_EXCEEDED',error:'La franja seleccionada ya no está disponible. Elige otra franja.'});
            Object.assign(scheduledWindow, canonicalSlot);
            const bookingVal = validateScheduledBooking(scheduledWindow);
            if (!bookingVal.valid) {
              return res.status(400).json({
                error: bookingVal.reason || 'La franja de entrega programada seleccionada ya no está disponible.',
                code: 'CUTOFF_EXPIRED',
              });
            }
          }
        } else {
          // Si es Turbo o Turbo Dividido, debe ser ELIGIBLE
          if (evaluatedQuote.eligibilityStatus !== 'ELIGIBLE') {
            return res.status(400).json({
              error: evaluatedQuote.message,
              eligibilityStatus: evaluatedQuote.eligibilityStatus,
              code: evaluatedQuote.reasonCode || 'MODE_UNAVAILABLE',
              geographicDistanceMeters: evaluatedQuote.geographicDistanceMeters,
              roadDistanceMeters: evaluatedQuote.roadDistanceMeters,
            });
          }

          // Para Turbo, se usa la bodega ganadora de Turbo
          assignedStoreId = evaluatedQuote.assignedStoreId;
        }
      } else {
        return res.status(400).json({code:'ADDRESS_INCOMPLETE',error:'Confirma las coordenadas del destino antes de crear el pedido.'});
      }

      if(!evaluatedQuote?.transportPlan?.feasible || !evaluatedQuote.basketValidated) return res.status(400).json({code:evaluatedQuote?.reasonCode || 'CAPACITY_PENDING',error:evaluatedQuote?.message || 'Capacidad pendiente de verificar.'});
      if(!req.body.confirmationToken || req.body.confirmationToken!==evaluatedQuote.confirmationToken) return res.status(409).json({code:'QUOTE_CHANGED',error:'La distribución, disponibilidad o el costo cambió. Actualiza la cotización y confirma nuevamente.'});
      if(!Number.isSafeInteger(tip) || tip<0) return res.status(400).json({error:'Propina inválida.'});
      const assignedStore = stores.find(s => s.id === assignedStoreId);
      if (!assignedStore || !assignedStore.isActive) {
        return res.status(400).json({
          error: `La bodega territorial asignada (${territoryAssignment?.assignedStoreName || assignedStoreId}) se encuentra inactiva. No es posible trasladar el pedido a otra bodega sin autorización.`,
          code: 'STORE_INACTIVE',
        });
      }
      assignedStoreId = assignedStore.id;

      // Check stock availability in assigned warehouse and reserve
      for (const item of items) {
        const prod = products.find(p => p.id === item.productId || p.productoId === item.productId || p.sku === item.productId);
        if (!prod) {
          return res.status(400).json({ error: `Producto no encontrado: ${item.productId}` });
        }
        if (prod.price <= 0) {
          return res.status(400).json({ error: `El producto "${prod.name}" es del catálogo referencial y no está habilitado para compra directa en línea.` });
        }
        if(prod.bodegaIds && !prod.bodegaIds.includes(assignedStore.id) && !prod.bodegaIds.includes(assignedStore.shopifyLocationGid||'')) return res.status(400).json({error:'Variante no asociada a la sede'});
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

      // OrdersRepository reserves once, then the persisted order drives the inventory projection.
      const hasPrescriptionItem = items.some((i: any) => i.requiresPrescription);
      const subtotal = items.reduce((acc: number, curr: any) => acc + (curr.price * curr.quantity), 0);
      const totalWeightKg = evaluatedQuote.totalWeightKg;
      const {shipping,serviceFee}=evaluatedQuote.charges;
      const total = subtotal + shipping + serviceFee + tip;
      const random4DigitCode = crypto.randomInt(1000,10000).toString();
      const usedDeliveryCodes=new Set([random4DigitCode]);
      const nextDeliveryCode=()=>{let code:string;do{code=crypto.randomInt(1000,10000).toString();}while(usedDeliveryCodes.has(code));usedDeliveryCodes.add(code);return code;};
      const newOrderNum = `#BP-${crypto.randomUUID().slice(0,8).toUpperCase()}`;
      const effectiveDeliveryMode = requestedDeliveryMode==='PROGRAMADO' ? 'PROGRAMADO' : evaluatedQuote.recommendedMode;
      const isSplitOrder = evaluatedQuote.transportPlan.shipments.length>1;

      // ETA calculado dinámicamente según la cotización
      const estimatedMinutes = evaluatedQuote?.estimatedMinutes || (effectiveDeliveryMode === 'PROGRAMADO' ? 180 : 25);
      const promiseEnd = effectiveDeliveryMode === 'PROGRAMADO' && scheduledWindow
        ? `${scheduledWindow.date}T${scheduledWindow.endTime}:00-05:00`
        : new Date(Date.now() + estimatedMinutes * 60 * 1000).toISOString();

      const newOrderId = `ORD-${crypto.randomUUID()}`;

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
              name: catalogItem?.name || pi.name,
              brand: catalogItem?.brand || 'Bolt Pets',
              presentation: catalogItem?.presentation || '',
              price: pi.price,
              quantity: pi.quantity,
              image: catalogItem?.image || '',
              weightKg: pi.unitWeightKg,
              requiresPrescription: !!catalogItem?.requiresPrescription,
              picked: false,
            };
          });

          return {
            shipmentId: `${newOrderId}-S${idx + 1}`,
            storeId: assignedStoreId,
            transportLoad: evaluatedQuote.transportPlan.shipments[idx],
            shipmentIndex: idx + 1,
            shipmentCount: evaluatedQuote.turboDividido.shipments.length,
            parentOrderId: newOrderId,
            childOrderId: `${newOrderId}-${String(idx+1).padStart(2,'0')}`,
            items: shipmentItems,
            weightKg: plan.weightKg,
            weightGrams: plan.weightGrams,
            subtotal: plan.subtotal,
            cashToCollect: shipmentCash,
            fulfillmentStatus: 'CONFIRMADO',
            secretDeliveryCode: nextDeliveryCode(),
            estimatedDeliveryMinutes: plan.estimatedArrivalSeconds/60 || estimatedMinutes,
            timestamps: {
              confirmedAt: new Date().toISOString(),
            },
          };
        });
      }

      const newOrder: Order = {
        creationRequestId, creationRequestFingerprint,
        transportConfirmation: evaluatedQuote.confirmationToken,
        transportLoad: !isSplitOrder ? evaluatedQuote.transportPlan.shipments[0] : undefined,
        id: newOrderId,
        orderNumber: newOrderNum,
        createdAt: new Date().toISOString(),
        storeId: assignedStoreId,
        storeName: assignedStore.name,
        deliveryMode: effectiveDeliveryMode,
        scheduledWindow: effectiveDeliveryMode === 'PROGRAMADO' ? (scheduledWindow || evaluatedQuote?.scheduledSlots?.[0]) : undefined,
        isSplitOrder,
        shipmentCount: childShipments ? childShipments.length : undefined,
        childShipments,
        customer,
        deliveryAddress: {
          ...deliveryAddress,
          municipality: territoryAssignment?.municipality || deliveryAddress.municipality || 'Bogotá D.C.',
          locality: territoryAssignment?.locality || deliveryAddress.locality,
          territoryInfo: territoryAssignment || undefined,
        },
        items,
        totals: {
          subtotal,
          discount: 0,
          shipping,
          serviceFee,
          tip,
          total,
          totalWeightKg,
        },
        payment: {
          method: paymentMethod,
          status: paymentMethod === 'CASH_ON_DELIVERY' ? 'PENDIENTE' : 'APROBADO',
          cashToCollect: paymentMethod === 'CASH_ON_DELIVERY' ? total : 0,
          cashSettled: false,
          transactionId: paymentMethod !== 'CASH_ON_DELIVERY' ? `TXN-WMP-${Date.now().toString().slice(-7)}` : undefined,
        },
        prescriptionReview: {
          status: hasPrescriptionItem ? 'APROBADA' : 'NO_REQUIERE',
          reviewedBy: hasPrescriptionItem ? 'Farmacia Bolt Pets (Despacho Directo)' : undefined,
          reviewedAt: hasPrescriptionItem ? new Date().toISOString() : undefined,
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

      const createResult = dispatchService.createOrder(newOrder, products, assignedStore);
      if (!createResult.success) {
        return res.status(400).json({ error: createResult.error });
      }
      return res.status(201).json({...presentOrder(createResult.order!),guestAccessToken:dispatchService.guestToken(createResult.order!)});
    } catch (e: any) {
      console.error('Error creating order:', e);
      return res.status(500).json({ error: e.message || 'Error interno del servidor' });
    }
  });

  // Get orders
  app.get('/api/v1/orders', requireAdminAuth, (req: Request, res: Response) => {
    const { storeId, status } = req.query;
    let list = ordersRepository.getAllOrders();
    if (storeId) list = list.filter(o => o.storeId === storeId);
    if (status) list = list.filter(o => o.fulfillmentStatus === status);
    res.json(list.map(presentOrder));
  });

  // Get specific order
  app.get('/api/v1/orders/:orderId', (req: Request, res: Response) => {
    const order = ordersRepository.getOrderById(req.params.orderId);
    if (!order) return res.status(404).json({ error: 'Pedido no encontrado' });
    res.json(presentOrder(order));
  });

  // Get audit history of an order
  app.get('/api/v1/orders/:orderId/history', requireAdminAuth, (req: Request, res: Response) => {
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
    const actor = extractActor(req, role || 'CLIENTE');


    const result = ordersRepository.transitionStatus(req.params.orderId, 'CANCELADO', actor, {
      shipmentId:req.body.shipmentId,
      reason: reason || 'Cancelación de pedido solicitada',
      catalogProducts: products,
    });

    if (!result.success) {
      return res.status(result.code || 400).json({ error: result.error });
    }

    dispatchService.synchronizeOrders();
    res.json({ message: 'Pedido cancelado exitosamente', order: result.order });
  });

  // Upload or update prescription document
  app.post('/api/v1/orders/:orderId/prescription', (req: Request, res: Response) => {
    const order = ordersRepository.getOrderById(req.params.orderId);
    if (!order) return res.status(404).json({ error: 'Pedido no encontrado' });

    const { documentUrl, documentName, vetName, vetLicense } = req.body;
    order.prescriptionReview = {
      status: 'PENDIENTE_REVISION',
      documentUrl,
      documentName,
      uploadedAt: new Date().toISOString(),
      vetName,
      vetLicense,
    };

    res.json({ message: 'Fórmula veterinaria enviada a revisión', order });
  });

  // Customer and Operational tracking endpoint (sanitized real GPS)
  app.get('/api/v1/orders/:orderId/tracking', (req: Request, res: Response) => {
    const order = ordersRepository.getOrderById(req.params.orderId);
    if (!order) return res.status(404).json({ error: 'Pedido no encontrado' });

    const shipmentId = req.query.shipmentId ? String(req.query.shipmentId) : undefined;
    const child=shipmentId ? order.childShipments?.find(s=>s.shipmentId===shipmentId) : undefined;
    if(shipmentId && !child) return res.status(404).json({error:'Entrega no encontrada en esta compra.'});
    const tracked=child || order;
    const lastPoint=ordersRepository.getLatestTelemetry(order.id,shipmentId);
    const latestTelemetry=tracked.fulfillmentStatus==='EN_CAMINO'&&lastPoint&&Date.now()-lastPoint.timestamp<=ordersRepository.dispatchState.config.locationMaxAgeSeconds*1000?lastPoint:null;

    res.json({
      orderId: order.id,
      shipmentId,
      orderNumber: order.orderNumber,
      status: tracked.fulfillmentStatus,
      dispatches:dispatchService.customerDispatches(order.id),
      dispatchStatusMessage:dispatchService.customerMessage(order.id),
      locationStale:!!lastPoint&&!latestTelemetry,
      deliveryMode: order.deliveryMode || 'TURBO',
      warehouse:presentOrder(order).warehouse,
      warehouseAssignment:order.warehouseAssignment,
      scheduledWindow: order.scheduledWindow,
      isSplitOrder: !!order.isSplitOrder,
      shipmentCount: order.shipmentCount || (order.childShipments ? order.childShipments.length : 1),
      childShipments: order.childShipments,
      estimatedMinutes: tracked.estimatedDeliveryMinutes,
      secretDeliveryCode: tracked.secretDeliveryCode,
      driver: tracked.driver ? {
        id: tracked.driver.id,
        name: tracked.driver.name,
        phone: tracked.driver.phone,
        vehiclePlate: tracked.driver.vehiclePlate,
        vehicleType: tracked.driver.vehicleType,
        photo: tracked.driver.photo,
        rating: tracked.driver.rating,
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
        secondsAgo: Math.max(0, Math.floor((Date.now() - latestTelemetry.timestamp) / 1000)),
      } : null,
      hubCoordinates: stores.find(s => s.id === order.storeId)?.coordinates || null,
      customerCoordinates: order.deliveryAddress.coordinates,
    });
  });

  // GPS Telemetry History (breadcrumbs for audit and live route rendering)
  app.get('/api/v1/orders/:orderId/telemetry/history', requireAdminAuth, (req: Request, res: Response) => {
    const order = ordersRepository.getOrderById(req.params.orderId);
    if (!order) return res.status(404).json({ error: 'Pedido no encontrado' });

    const shipmentId = req.query.shipmentId ? String(req.query.shipmentId) : undefined;
    const history = ordersRepository.getTelemetryHistory(order.id, shipmentId);

    res.json({
      orderId: order.id,
      shipmentId,
      pointsCount: history.length,
      history,
    });
  });

  // Verify delivery with customer secret code (supports entire order or individual child shipment)
  app.post('/api/v1/orders/:orderId/verify-delivery', (_req,res)=>res.status(409).json({error:'Confirma la entrega desde la asignación autenticada de BOLT Conductor.'}));

  // ==========================================
  // BOLT CONDUCTOR ANDROID SHARED CONTRACT ROUTES
  // ==========================================

  // ==========================================
  // OPERATIONS DASHBOARD ROUTES
  // ==========================================

  app.post('/api/v1/operations/orders/:orderId/status', (req: Request, res: Response) => {
    const { status, shipmentId, reason, deliveryCode, notes } = req.body;
    if (!status) {
      return res.status(400).json({ error: 'Se requiere especificar el parámetro status' });
    }

    if(['REPARTIDOR_ASIGNADO','EN_CAMINO','ENTREGADO'].includes(status))return res.status(409).json({error:'Usa el flujo autenticado del despacho para asignar, recoger o entregar.'});
    const order=ordersRepository.getOrderById(req.params.orderId);
    const selected=shipmentId?order?.childShipments?.find(s=>s.shipmentId===shipmentId):order;
    const run=selected?.assignmentId?ordersRepository.dispatchState.runs[selected.assignmentId]:undefined;
    if(status==='CANCELADO'&&run&&(['ASSIGNED','PICKED_UP','INCIDENT','OFFER_PENDING'].includes(run.status)||run.external&&!['CANCELLED','REJECTED'].includes(run.external.status)))return res.status(409).json({error:'Libera la asignación o gestiona la custodia antes de cancelar.'});
    const actor = extractActor(req, 'BODEGA');
    const result = ordersRepository.transitionStatus(req.params.orderId, status, actor, {
      shipmentId,
      reason,
      deliveryCode,
      catalogProducts: products,
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
    order.prescriptionReview = {
      ...order.prescriptionReview,
      status,
      reviewNotes,
      reviewedBy: reviewerName || 'Dra. Sandra Peña (Química Farmacéutica Veterinaria)',
      reviewedAt: new Date().toISOString(),
    };

    res.json({ message: 'Revisión farmacéutica registrada', order });
  });

  app.post('/api/v1/operations/orders/:orderId/assign-driver', async (req,res)=>{
    const order=ordersRepository.getOrderById(req.params.orderId);
    const target=req.body.shipmentId?order?.childShipments?.find(s=>s.shipmentId===req.body.shipmentId):order;
    if(!order||!target)return res.status(404).json({error:'Despacho no encontrado'});
    if(!ordersRepository.dispatchState.runs[target.assignmentId!])return res.status(409).json({error:'Registra y reconcilia la operación histórica antes de asignar.'});
    try{await dispatchService.search(target.assignmentId!,extractActor(req).id);return res.json({message:'Búsqueda iniciada; la asignación requiere aceptación.',dispatches:dispatchService.customerDispatches(order.id)})}catch{return res.status(409).json({error:'No se pudo iniciar la búsqueda'})}
  });

  // Confirm physical return of cancelled dispatched order
  app.post('/api/v1/operations/orders/:orderId/confirm-physical-return', (req: Request, res: Response) => {
    const { inspectorName, notes } = req.body;
    const result = ordersRepository.confirmPhysicalReturn(
      req.params.orderId,
      inspectorName || 'Supervisor de Bodega Kennedy',
      products,
      notes,
      req.body.shipmentId
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
  app.post('/api/v1/stores/:id/verify-entrance', requireAdminAuth, (req: Request, res: Response) => {
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

  app.post('/api/v1/shopify/sync', requireAdminAuth, (_req,res)=>res.status(409).json({error:'Sincronización automática desactivada. Usa un lote explícito de lectura de precios.'}));
  app.post('/api/v1/shopify/webhook', requireAdminAuth, (_req,res)=>res.status(409).json({error:'Sincronización automática desactivada. Usa un lote explícito de lectura de precios.'}));
  app.post('/api/v1/shopify/simulate-webhook', requireAdminAuth, (_req,res)=>res.status(409).json({error:'Sincronización automática desactivada. Usa un lote explícito de lectura de precios.'}));

  app.get('/api/v1/auth/status', (req: Request, res: Response) => {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.substring(7).trim() : undefined;
    const session = adminAuthService.verifySession(token);
    res.json({
      isSetupRequired: adminAuthService.isSetupRequired(),
      isAuthenticated: !!session,
      user: session ? { id: session.userId, email: session.email, name: session.name, role: session.role } : null,
    });
  });

  app.post('/api/v1/auth/setup-admin', (req: Request, res: Response) => {
    const { email, password, name } = req.body || {};
    const result = adminAuthService.setupMasterAdmin({ email, password, name });
    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }
    res.status(201).json({
      message: 'Administrador principal configurado exitosamente.',
      token: result.token,
      user: { id: result.user!.id, email: result.user!.email, name: result.user!.name, role: result.user!.role },
    });
  });

  app.post('/api/v1/auth/login', (req: Request, res: Response) => {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: 'Proporciona correo y contraseña.' });
    }
    const result = adminAuthService.login(email, password);
    if (!result.success) {
      return res.status(401).json({ error: result.error });
    }
    res.json({
      message: 'Inicio de sesión administrativo exitoso.',
      token: result.token,
      user: result.user,
    });
  });

  app.get('/api/v1/auth/me', requireAdminAuth, (req: Request, res: Response) => {
    const session = (req as any).adminSession;
    res.json({ user: session });
  });

  app.post('/api/v1/auth/logout', (req: Request, res: Response) => {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.substring(7).trim() : undefined;
    if (token) {
      adminAuthService.logout(token);
    }
    res.json({ message: 'Sesión cerrada correctamente.' });
  });

  // ==========================================
  // RUTAS DE GESTIÓN DE CATÁLOGO (PROTEGIDAS POR TOKEN)
  // ==========================================

  app.get('/api/v1/admin/transport', requireAdminAuth, (_req,res)=>res.json({...transportRepository.read(),drivers:ordersRepository.getAllDrivers(),stores,scheduledSlots:generateScheduledSlots(new Date())}));
  app.put('/api/v1/admin/transport', requireAdminAuth, (req,res)=>{
    try {res.json(transportRepository.update(req.body.config,req.body.revision,(req as any).adminSession,ordersRepository.getAllDrivers(),stores));}
    catch(error:any) {res.status(409).json({error:error.message});}
  });
  app.put('/api/v1/admin/catalog/transport', requireAdminAuth, (req,res)=>{
    const {productId,variantId,transport,previous}=req.body;
    if(!validateTransportAttributes(transport)) return res.status(400).json({error:'Completa peso en gramos, embalaje y dimensiones positivas; confirma los indicadores de transporte.'});
    const p=catalogRepository.getAllProducts(true).find(p=>p.id===productId);
    if(!p) return res.status(404).json({error:'Producto no encontrado.'});
    const variant=p.presentaciones?.find(v=>v.varianteId===variantId);
    if(p.presentaciones?.length && !variant) return res.status(400).json({error:'Selecciona la presentación exacta.'});
    if(JSON.stringify(previous || null)!==JSON.stringify((variant?variant.transport:p.transport) || null)) return res.status(409).json({error:'Los atributos cambiaron. Recarga antes de guardar.'});
    const update=variant ? {presentaciones:p.presentaciones!.map(v=>v===variant?{...v,transport}:v)} : {transport,weightKg:transport.weightGrams/1000};
    const result=catalogRepository.updateProduct(productId,update,(req as any).adminSession);
    if(!result.success) return res.status(400).json({error:result.error});
    res.json({product:result.product});
  });

  // Read-only administrative view. Configuration changes require a reviewed repository change.
  app.get('/api/v1/admin/coverage', requireAdminAuth, (_req,res)=>res.json({
    municipalities:COVERAGE_MUNICIPALITIES.map(m=>({...m,scheduledServiceReady:scheduledServiceReady(m.scheduledService)})),
    configurationSource:'src/data/coverageConfig.ts',
  }));

  app.get('/api/v1/admin/catalog', requireAdminAuth, (req: Request, res: Response) => {
    const { q, category, status } = req.query;
    let all = catalogOperations.getProducts();

    if (status && status !== 'TODOS') {
      all = all.filter(p => (p.status || 'ACTIVE') === status);
    }
    if (category && category !== 'Todo') {
      all = all.filter(p => p.category === category);
    }
    if (q) {
      const query = String(q).toLowerCase();
      all = all.filter(p =>
        p.name.toLowerCase().includes(query) ||
        p.brand.toLowerCase().includes(query) ||
        p.sku.toLowerCase().includes(query)
      );
    }

    res.json(all);
  });

  app.post('/api/v1/admin/catalog/products', requireAdminAuth, (req: Request, res: Response) => {
    const session = (req as any).adminSession;
    const result = catalogRepository.createProduct(req.body, {
      email: session.email,
      name: session.name,
    });
    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }
    products = catalogOperations.getSalesProducts();
    res.status(201).json({
      message: 'Producto creado exitosamente.',
      product: result.product,
    });
  });

  app.put('/api/v1/admin/catalog/products/:id', requireAdminAuth, (req: Request, res: Response) => {
    const session = (req as any).adminSession;
    const current=catalogOperations.getProducts().find(p=>p.id===req.params.id);
    const metadata={...req.body};
    for(const field of ['price','stockByStore','reservedStockByStore','presentaciones','commerceRevision']) {
      if(metadata[field]!==undefined && JSON.stringify(metadata[field])!==JSON.stringify((current as any)?.[field])) return res.status(409).json({error:'Edita precio, existencias y presentación desde Precio/Stock por variante; recarga si los datos cambiaron.'});
      delete metadata[field];
    }
    const result = catalogRepository.updateProduct(req.params.id, metadata, {
      email: session.email,
      name: session.name,
    });
    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }
    products = catalogOperations.getSalesProducts();
    res.json({
      message: 'Producto actualizado exitosamente.',
      product: result.product,
    });
  });

  app.patch('/api/v1/admin/catalog/products/:id/status', requireAdminAuth, (req: Request, res: Response) => {
    const session = (req as any).adminSession;
    const result = catalogRepository.toggleProductStatus(req.params.id, {
      email: session.email,
      name: session.name,
    });
    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }
    products = catalogOperations.getSalesProducts();
    res.json({
      message: `Estado del producto actualizado a ${result.newStatus}.`,
      product: result.product,
      newStatus: result.newStatus,
    });
  });

  app.patch('/api/v1/admin/catalog/products/:id/pricing-stock', requireAdminAuth, (req,res)=>{
    try {const product=catalogOperations.edit(req.params.id,req.body,(req as any).adminSession);res.json({product});}
    catch(error:any){res.status(409).json({error:error.message});}
  });
  app.get('/api/v1/admin/catalog/batches',requireAdminAuth,(_req,res)=>res.json(catalogOperations.listBatches()));
  app.get('/api/v1/admin/catalog/batches/:id',requireAdminAuth,(req,res)=>{
    try{res.json(catalogOperations.getBatch(req.params.id));}catch(e:any){res.status(404).json({error:e.message});}
  });
  app.post('/api/v1/admin/catalog/batches',requireAdminAuth,(req,res)=>{
    try{res.json(catalogOperations.prepare(req.body.id,req.body.source,(req as any).adminSession,req.body.inventoryDelta??6));}catch(e:any){res.status(400).json({error:e.message});}
  });
  app.post('/api/v1/admin/catalog/batches/:id/apply',requireAdminAuth,(req,res)=>{
    try{res.json(catalogOperations.apply(req.params.id,(req as any).adminSession,req.body.limit));}catch(e:any){res.status(409).json({error:e.message});}
  });
  app.post('/api/v1/admin/catalog/batches/:id/reverse',requireAdminAuth,(req,res)=>{
    try{res.json(catalogOperations.reverse(req.params.id,(req as any).adminSession));}catch(e:any){res.status(409).json({error:e.message});}
  });

  app.post('/api/v1/admin/catalog/images/apply', requireAdminAuth, (req,res)=>{
    try {
      const result=catalogRepository.applyImagePatches(req.body.patches,(req as any).adminSession);
      products=catalogOperations.getSalesProducts();res.json(result);
    }catch(error:any){res.status(409).json({error:error.message});}
  });

  app.post('/api/v1/admin/catalog/upload-image', requireAdminAuth, (req: Request, res: Response) => {
    const { dataUrl, filename } = req.body || {};
    if (!dataUrl) {
      return res.status(400).json({ error: 'Se requiere el parámetro dataUrl con la imagen en base64.' });
    }
    try {
      const uploadResult = saveBase64Image(dataUrl, filename);
      res.status(201).json({
        message: 'Imagen subida y validada exitosamente.',
        ...uploadResult,
      });
    } catch (err: any) {
      res.status(400).json({ error: err.message || 'Error al procesar la imagen.' });
    }
  });

  app.get('/api/v1/admin/catalog/audit', requireAdminAuth, (req: Request, res: Response) => {
    const { productId } = req.query;
    const logs = [...catalogRepository.getAuditLog(productId ? String(productId) : undefined),...catalogOperations.getAuditLog().filter(a=>!productId||a.productId===productId)].sort((a,b)=>String(b.timestamp||b.at).localeCompare(String(a.timestamp||a.at)));
    res.json(logs);
  });

  // ==========================================
  // FRONTEND MOUNTING (VITE IN DEV / STATIC IN PROD)
  // ==========================================

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: false,
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, 'dist')));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(__dirname, 'dist', 'index.html'));
    });
  }

  app.listen(PORT, isDispatchSimulation?'127.0.0.1':'0.0.0.0', () => {
    console.log(`Bolt Pets Authoritative Full-Stack Server running on port ${PORT}`);
  });
}

startServer().catch(err => {
  console.error('Failed to start server:', err);
});
