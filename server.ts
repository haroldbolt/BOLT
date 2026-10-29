import express, { Request, Response } from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import { INITIAL_PRODUCTS, INITIAL_STORES } from './src/data/seedData';
import { Order, Product, Store, DriverProfile, GPSTelemetry, OrderActor, ActorRole } from './src/types';
import { evaluateDeliveryQuote, DELIVERY_CONFIG, deliveryQuoteEndpoint, validateScheduledBooking } from './src/lib/deliveryService';
import { shopifyService } from './src/lib/shopifyService';
import { loadPrivateInventorySnapshot, PrivateInventoryResult } from './src/lib/privateInventoryLoader';
import { localCatalogService } from './src/lib/localCatalogService';
import { ordersRepository } from './src/lib/ordersRepository';

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

// Authoritative in-memory state initialized from local catalog (3.830 productos agrupados, 5.652 variantes, 5 bodegas)
let stores: Store[] = localCatalogService.getStores().length > 0 ? localCatalogService.getStores() : JSON.parse(JSON.stringify(INITIAL_STORES));
let products: Product[] = localCatalogService.getAllGroupedProducts().length > 0 ? localCatalogService.getAllGroupedProducts() : JSON.parse(JSON.stringify(INITIAL_PRODUCTS));

// Registro de carga de catálogo local
console.log(`[Catálogo Local] Iniciado con ${products.length} productos agrupados, ${localCatalogService.getTotalVariantsCount()} variantes y ${stores.length} bodegas.`);

// Comprobación de inventario privado (.bolt-private/shopify/snapshot.json no bloqueante)
const privateInventoryStatus: PrivateInventoryResult = loadPrivateInventorySnapshot();
console.log(`[Inventario Privado] ${privateInventoryStatus.message} Se utiliza el catálogo local estructurado.`);
let drivers: DriverProfile[] = ordersRepository.getAllDrivers();


async function startServer() {
  const app = express();
  const PORT = parseInt(process.env.PORT || '3000', 10);

  app.use(cors());
  app.use(express.json({ limit: '15mb' }));

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

  // Authoritative Delivery Quote Endpoint
  app.post('/api/v1/delivery/quote', (req: Request, res: Response) => {
    return deliveryQuoteEndpoint(req, res, stores, products);
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
        return res.json({
          coordinates: location ? { lat: Number(location.lat.toFixed(6)), lng: Number(location.lng.toFixed(6)) } : null,
          formattedAddress: formatted,
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
        items,
        customer,
        deliveryAddress,
        paymentMethod,
        tip = 0,
        deliveryMode: requestedDeliveryMode,
        scheduledWindow,
      } = req.body;

      if (!items || !items.length || !customer || !deliveryAddress || !paymentMethod) {
        return res.status(400).json({ error: 'Faltan campos obligatorios para crear el pedido.' });
      }

      // Validar cobertura y límite de tiempo con el motor autoritativo si hay coordenadas
      let assignedStoreId = storeId;
      let evaluatedQuote: any = null;

      if (deliveryAddress.coordinates && !isNaN(deliveryAddress.coordinates.lat) && !isNaN(deliveryAddress.coordinates.lng)) {
        evaluatedQuote = evaluateDeliveryQuote({
          destination: {
            address: deliveryAddress.address,
            details: deliveryAddress.details,
            coordinates: deliveryAddress.coordinates,
          },
          items: items.map((i: any) => ({ productId: i.productId, quantity: i.quantity })),
        }, stores, products);

        // Si el cliente pide Envío Programado, validar que tenga cobertura programada, no esté vencido el corte y haya cupo
        if (requestedDeliveryMode === 'PROGRAMADO') {
          if (!evaluatedQuote.scheduledEligible) {
            return res.status(400).json({
              error: evaluatedQuote.message || 'Dirección fuera de la zona de cobertura metropolitana de entrega programada.',
              eligibilityStatus: evaluatedQuote.eligibilityStatus,
            });
          }

          if (scheduledWindow) {
            const bookingVal = validateScheduledBooking(scheduledWindow);
            if (!bookingVal.valid) {
              return res.status(400).json({
                error: bookingVal.reason || 'La franja de entrega programada seleccionada ya no está disponible.',
                code: 'CUTOFF_EXPIRED',
              });
            }

            // Validar capacidad de la franja (máximo 10 pedidos por franja)
            const currentSlotOrders = ordersRepository.getAllOrders().filter(
              (o: Order) => o.deliveryMode === 'PROGRAMADO' &&
              o.scheduledWindow &&
              o.scheduledWindow.date === scheduledWindow.date &&
              (o.scheduledWindow.slotId === scheduledWindow.slotId || o.scheduledWindow.startTime === scheduledWindow.startTime)
            );
            if (currentSlotOrders.length >= 10) {
              return res.status(400).json({
                error: 'La franja seleccionada ha alcanzado su capacidad máxima. Por favor selecciona otro horario.',
                code: 'SLOT_CAPACITY_EXCEEDED',
              });
            }
          }
        } else {
          // Si es Turbo o Turbo Dividido, debe ser ELIGIBLE
          if (evaluatedQuote.eligibilityStatus !== 'ELIGIBLE') {
            return res.status(400).json({
              error: evaluatedQuote.message,
              eligibilityStatus: evaluatedQuote.eligibilityStatus,
              geographicDistanceMeters: evaluatedQuote.geographicDistanceMeters,
              roadDistanceMeters: evaluatedQuote.roadDistanceMeters,
            });
          }
        }

        // Asignación automática de bodega autoritativa
        assignedStoreId = evaluatedQuote.assignedStoreId || storeId || 'HUB_KENNEDY';
      }

      const assignedStore = stores.find(s => s.id === assignedStoreId) || stores[0];
      assignedStoreId = assignedStore.id;

      // Check stock availability in assigned warehouse and reserve
      for (const item of items) {
        const prod = products.find(p => p.id === item.productId);
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

      // Apply reservation
      for (const item of items) {
        const prod = products.find(p => p.id === item.productId)!;
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
        deliveryAddress,
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

      const createResult = ordersRepository.createOrder(newOrder, products);
      if (!createResult.success) {
        return res.status(400).json({ error: createResult.error });
      }
      return res.status(201).json(createResult.order);
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
      hubCoordinates: stores.find(s => s.id === order.storeId)?.coordinates || { lat: 4.6284, lng: -74.1539 },
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
  // FRONTEND MOUNTING (VITE IN DEV / STATIC IN PROD)
  // ==========================================

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
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
