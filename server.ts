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
import { evaluateDeliveryQuote, DELIVERY_CONFIG, deliveryQuoteEndpoint, validateScheduledBooking } from './src/lib/deliveryService';
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

// Helper para extraer el actor autenticado u operacional desde cabeceras/payload
function extractActor(req: Request, defaultRole: ActorRole = 'BODEGA'): OrderActor {
  const role = ((req.headers['x-actor-role'] as string) || req.body?.role || defaultRole) as any;
  const id = (req.headers['x-actor-id'] as string) || req.body?.actorId;
  const name = (req.headers['x-actor-name'] as string) || req.body?.actorName || (
    role === 'CLIENTE' ? 'Cliente Web' :
    role === 'CONDUCTOR' ? 'Carlos Rodríguez (Conductor)' :
    'Operador Bodega'
  );
  return { role, id, name };
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


async function startServer() {
  const app = express();
  const PORT = parseInt(process.env.PORT || '3000', 10);

  app.use(cors());
  app.use(express.json({ limit: '15mb' }));
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
    products = catalogRepository.getAllProducts(true);
    let filtered = [...products];

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
    return {...order, warehouseAssignment:order.warehouseAssignment,
      storeName:order.warehouseAssignment?.store.name || warehouse?.name || '',
      warehouse:order.warehouseAssignment?.store || describeWarehouse(warehouse)};
  };

  // Authoritative Delivery Quote Endpoint
  app.post('/api/v1/delivery/quote', (req: Request, res: Response) => {
    res.set('Cache-Control', 'no-store');
    const quote=evaluateDeliveryQuote({...req.body, destination: enrichDestination(req.body.destination)}, stores, products, ordersRepository.getAllOrders());
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
        const resolved = enrichDestination({...territory, coordinates: first.geometry?.location});

        return res.json({
          address,
          formattedAddress: address,
          rawAddress: raw,
          municipality: resolved.municipality,
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
    try {
      const searchTarget = String(address).toLowerCase().includes('bogot') ? String(address) : `${address}, Bogotá, Colombia`;
      const response = await fetch(
        `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(searchTarget)}&key=${apiKey}&components=country:CO&language=es&region=co`
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

        const territory = parseAddressComponents(first.address_components);
        const resolved = enrichDestination({...territory, coordinates: first.geometry?.location});

        return res.json({
          coordinates: location ? { lat: Number(location.lat.toFixed(6)), lng: Number(location.lng.toFixed(6)) } : null,
          formattedAddress: formatted,
          municipality: resolved.municipality,
          locality: resolved.locality,
          neighborhood: territory.neighborhood,
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
      const creationRequestId=req.get('Idempotency-Key');
      const creationRequestFingerprint=crypto.createHash('sha256').update(JSON.stringify(req.body)).digest('hex');
      if(creationRequestId) {
        if(creationRequestId.length>150) return res.status(400).json({error:'Identificador de solicitud inválido'});
        const previous=ordersRepository.getOrderByCreationRequest(creationRequestId);
        if(previous) return previous.creationRequestFingerprint===creationRequestFingerprint
          ? res.status(200).json(presentOrder(previous)) : res.status(409).json({error:'La solicitud ya fue utilizada con otros datos.'});
      }
      const {
        storeId,
        items,
        customer,
        deliveryAddress: rawDeliveryAddress,
        paymentMethod,
        tip = 0,
        deliveryMode: requestedDeliveryMode,
        scheduledWindow,
      } = req.body;

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
        evaluatedQuote = evaluateDeliveryQuote({
          destination: deliveryAddress,
          items: items.map((i: any) => ({ productId: i.productId, quantity: i.quantity })),
          requestedMode: requestedDeliveryMode,
          scheduledWindow,
        }, stores, products, ordersRepository.getAllOrders());

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

      // Apply reservation
      for (const item of items) {
        const prod = products.find(p => p.id === item.productId || p.productoId === item.productId || p.sku === item.productId)!;
        prod.reservedStockByStore[assignedStoreId] = (prod.reservedStockByStore[assignedStoreId] || 0) + item.quantity;
      }

      const hasPrescriptionItem = items.some((i: any) => i.requiresPrescription);
      const subtotal = items.reduce((acc: number, curr: any) => acc + (curr.price * curr.quantity), 0);
      const totalWeightKg = items.reduce((acc: number, curr: any) => acc + ((curr.weightKg || 0.2) * curr.quantity), 0);
      const totalWeightGrams = Math.round(totalWeightKg * 1000);
      const shipping = subtotal >= 70000 ? 0 : 4900;
      const serviceFee = 1500;
      const total = subtotal + shipping + serviceFee + tip;

      const random4DigitCode = Math.floor(1000 + Math.random() * 9000).toString();
      const newOrderNum = `#BP-${Math.floor(1000 + Math.random() * 9000)}`;

      // Determinar modo de entrega efectivo
      let effectiveDeliveryMode = requestedDeliveryMode;
      if (!effectiveDeliveryMode) {
        if (totalWeightGrams > 60000 && evaluatedQuote?.turboDividido?.feasible) {
          effectiveDeliveryMode = 'TURBO_DIVIDIDO';
        } else if (evaluatedQuote?.availableModes?.turbo) {
          effectiveDeliveryMode = 'TURBO';
        } else {
          effectiveDeliveryMode = 'PROGRAMADO';
        }
      }

      const isSplitOrder = effectiveDeliveryMode === 'TURBO_DIVIDIDO';

      // ETA calculado dinámicamente según la cotización
      const estimatedMinutes = evaluatedQuote?.estimatedMinutes || (effectiveDeliveryMode === 'PROGRAMADO' ? 180 : 25);
      const promiseEnd = effectiveDeliveryMode === 'PROGRAMADO' && scheduledWindow
        ? `${scheduledWindow.date}T${scheduledWindow.endTime}:00.000Z`
        : new Date(Date.now() + estimatedMinutes * 60 * 1000).toISOString();

      const newOrderId = `ORD-2026-${Math.floor(1000 + Math.random() * 9000)}`;

      // Generar envíos hijos si es Turbo Dividido
      let childShipments: any[] | undefined = undefined;
      if (isSplitOrder && evaluatedQuote?.turboDividido?.shipments) {
        let accumulatedCash = 0;
        childShipments = evaluatedQuote.turboDividido.shipments.map((plan: any, idx: number) => {
          // Asignar conductor inicial de la flota disponible en bodega
          const assignedDriver = drivers[idx % drivers.length];
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
            shipmentId: `SHP-${newOrderId.slice(-4)}-${idx + 1}`,
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
            driver: assignedDriver ? {
              id: assignedDriver.id,
              name: assignedDriver.name,
              phone: assignedDriver.phone,
              vehiclePlate: assignedDriver.vehiclePlate,
              vehicleType: assignedDriver.vehicleType,
              rating: assignedDriver.rating,
              photo: assignedDriver.photo,
            } : undefined,
            timestamps: {
              confirmedAt: new Date().toISOString(),
            },
          };
        });
      }

      const newOrder: Order = {
        creationRequestId, creationRequestFingerprint,
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

      const createResult = ordersRepository.createOrder(newOrder, products, assignedStore);
      if (!createResult.success) {
        return res.status(400).json({ error: createResult.error });
      }
      return res.status(201).json(presentOrder(createResult.order!));
    } catch (e: any) {
      console.error('Error creating order:', e);
      return res.status(500).json({ error: e.message || 'Error interno del servidor' });
    }
  });

  // Get orders
  app.get('/api/v1/orders', (req: Request, res: Response) => {
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
    const actor = extractActor(req, role || 'CLIENTE');
    if (actorName) actor.name = actorName;

    const result = ordersRepository.transitionStatus(req.params.orderId, 'CANCELADO', actor, {
      reason: reason || 'Cancelación de pedido solicitada',
      catalogProducts: products,
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
    const latestTelemetry = ordersRepository.getLatestTelemetry(order.id, shipmentId);

    res.json({
      orderId: order.id,
      orderNumber: order.orderNumber,
      status: order.fulfillmentStatus,
      deliveryMode: order.deliveryMode || 'TURBO',
      warehouse:presentOrder(order).warehouse,
      warehouseAssignment:order.warehouseAssignment,
      scheduledWindow: order.scheduledWindow,
      isSplitOrder: !!order.isSplitOrder,
      shipmentCount: order.shipmentCount || (order.childShipments ? order.childShipments.length : 1),
      childShipments: order.childShipments,
      estimatedMinutes: order.estimatedDeliveryMinutes,
      secretDeliveryCode: order.secretDeliveryCode,
      driver: order.driver ? {
        id: order.driver.id,
        name: order.driver.name,
        phone: order.driver.phone,
        vehiclePlate: order.driver.vehiclePlate,
        vehicleType: order.driver.vehicleType,
        photo: order.driver.photo,
        rating: order.driver.rating,
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
  app.get('/api/v1/orders/:orderId/telemetry/history', (req: Request, res: Response) => {
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
  app.post('/api/v1/orders/:orderId/verify-delivery', (req: Request, res: Response) => {
    const { deliveryCode, shipmentId } = req.body;
    if (!deliveryCode) {
      return res.status(400).json({ error: 'Se requiere el código secreto de entrega de 4 dígitos.' });
    }

    const actor = extractActor(req, 'CONDUCTOR');
    const result = ordersRepository.verifyDelivery(req.params.orderId, deliveryCode, actor, shipmentId, products);

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
    const { action } = req.body;
    const currentDrivers = ordersRepository.getAllDrivers();
    const driver = currentDrivers[0];
    driver.isOnline = action === 'START';
    driver.currentStatus = driver.isOnline ? 'DISPONIBLE' : 'FUERA_DE_TURNO';
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
      return res.status(result.code || 400).json({ error: result.error });
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
    const result = ordersRepository.verifyDelivery(targetOrder.id, deliveryCode, actor, targetShipmentId, products);
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
    if (req.headers['x-driver-id']) {
      actor.id = String(req.headers['x-driver-id']);
    }

    const result = ordersRepository.recordTelemetry(telemetry, actor);
    if (!result.success) {
      return res.status(result.code || 400).json({ error: result.error });
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

  app.post('/api/v1/operations/orders/:orderId/assign-driver', (req: Request, res: Response) => {
    const { driverId, shipmentId } = req.body;
    const actor = extractActor(req, 'COORDINADOR');
    const result = ordersRepository.assignDriver(req.params.orderId, driverId || 'DRV-CARLOS-01', actor, shipmentId);

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
    const { inspectorName, notes } = req.body;
    const result = ordersRepository.confirmPhysicalReturn(
      req.params.orderId,
      inspectorName || 'Supervisor de Bodega Kennedy',
      products,
      notes
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
    const { storeId, sku, newOnHand, committed = 0 } = req.body;
    if (!storeId || !sku || typeof newOnHand !== 'number') {
      return res.status(400).json({ error: 'Faltan parámetros requeridos (storeId, sku, newOnHand)' });
    }

    const result = shopifyService.updateLocationStock(storeId, sku, newOnHand, committed);
    if (!result.success) {
      return res.status(404).json({ error: result.error || 'No se pudo actualizar el inventario' });
    }

    // Actualizar también el catálogo en memoria de la sede para consistencia
    const prod = products.find(p => p.sku === sku);
    if (prod) {
      prod.stockByStore[storeId] = Math.max(0, newOnHand - committed);
    }

    res.json({
      message: `Webhook simulado exitosamente: Stock actualizado en ${storeId} para SKU ${sku}`,
      item: result.item,
      state: shopifyService.getState(),
    });
  });

  // ==========================================
  // RUTAS DE AUTENTICACIÓN Y SEGURIDAD ADMINISTRATIVA
  // ==========================================

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

  app.get('/api/v1/admin/catalog', requireAdminAuth, (req: Request, res: Response) => {
    const { q, category, status } = req.query;
    let all = catalogRepository.getAllProducts(true);

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
    products = catalogRepository.getAllProducts(true);
    res.status(201).json({
      message: 'Producto creado exitosamente.',
      product: result.product,
    });
  });

  app.put('/api/v1/admin/catalog/products/:id', requireAdminAuth, (req: Request, res: Response) => {
    const session = (req as any).adminSession;
    const result = catalogRepository.updateProduct(req.params.id, req.body, {
      email: session.email,
      name: session.name,
    });
    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }
    products = catalogRepository.getAllProducts(true);
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
    products = catalogRepository.getAllProducts(true);
    res.json({
      message: `Estado del producto actualizado a ${result.newStatus}.`,
      product: result.product,
      newStatus: result.newStatus,
    });
  });

  app.patch('/api/v1/admin/catalog/products/:id/pricing-stock', requireAdminAuth, (req: Request, res: Response) => {
    const session = (req as any).adminSession;
    const { variantId, priceCOP, stockByStore, presentationName } = req.body;
    const result = catalogRepository.updateVariantPriceAndStock(
      req.params.id,
      { variantId, priceCOP, stockByStore, presentationName },
      { email: session.email, name: session.name }
    );
    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }
    products = catalogRepository.getAllProducts(true);
    res.json({
      message: 'Precio e inventario actualizados exitosamente.',
      product: result.product,
    });
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
    const logs = catalogRepository.getAuditLog(productId ? String(productId) : undefined);
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

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Bolt Pets Authoritative Full-Stack Server running on port ${PORT}`);
  });
}

startServer().catch(err => {
  console.error('Failed to start server:', err);
});
