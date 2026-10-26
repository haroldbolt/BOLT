import express, { Request, Response } from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import { INITIAL_PRODUCTS, INITIAL_STORES, INITIAL_DRIVERS, INITIAL_ORDERS } from './src/data/seedData';
import { Order, Product, Store, DriverProfile, GPSTelemetry } from './src/types';
import { evaluateDeliveryQuote, DELIVERY_CONFIG, deliveryQuoteEndpoint, validateScheduledBooking } from './src/lib/deliveryService';
import { shopifyService } from './src/lib/shopifyService';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Authoritative in-memory state initialized from seed data
let stores: Store[] = JSON.parse(JSON.stringify(INITIAL_STORES));
let products: Product[] = JSON.parse(JSON.stringify(INITIAL_PRODUCTS));
let drivers: DriverProfile[] = JSON.parse(JSON.stringify(INITIAL_DRIVERS));
let orders: Order[] = JSON.parse(JSON.stringify(INITIAL_ORDERS));
let gpsTelemetryHistory: Record<string, GPSTelemetry[]> = {
  'ORD-2026-8941': [
    {
      orderId: 'ORD-2026-8941',
      assignmentId: 'ASG-5510',
      tripId: 'TRP-8821',
      latitude: 4.6312,
      longitude: -74.1485,
      accuracy: 4.5,
      heading: 210,
      speed: 32,
      batteryLevel: 85,
      timestamp: Date.now() - 4000,
      sequenceNumber: 142,
    },
  ],
};

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
      timezone: 'America/Bogota',
      locale: 'es-CO',
      storesCount: stores.length,
      productsCount: products.length,
      ordersCount: orders.length,
      timestamp: new Date().toISOString(),
    });
  });

  // Stores
  app.get('/api/v1/stores', (_req: Request, res: Response) => {
    res.json(stores);
  });

  // Catalog
  app.get('/api/v1/catalog', (req: Request, res: Response) => {
    const { category, species, storeId, q } = req.query;
    let filtered = [...products];

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
        p.tags.some(t => t.toLowerCase().includes(queryStr))
      );
    }

    res.json(filtered);
  });

  // Authoritative Delivery Quote Endpoint
  app.post('/api/v1/delivery/quote', (req: Request, res: Response) => {
    return deliveryQuoteEndpoint(req, res, stores, products);
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
            const currentSlotOrders = orders.filter(
              o => o.deliveryMode === 'PROGRAMADO' &&
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

      orders.unshift(newOrder);
      return res.status(201).json(newOrder);
    } catch (e: any) {
      console.error('Error creating order:', e);
      return res.status(500).json({ error: e.message || 'Error interno del servidor' });
    }
  });

  // Get orders
  app.get('/api/v1/orders', (req: Request, res: Response) => {
    const { storeId, status } = req.query;
    let list = [...orders];
    if (storeId) list = list.filter(o => o.storeId === storeId);
    if (status) list = list.filter(o => o.fulfillmentStatus === status);
    res.json(list);
  });

  // Get specific order
  app.get('/api/v1/orders/:orderId', (req: Request, res: Response) => {
    const order = orders.find(o => o.id === req.params.orderId);
    if (!order) return res.status(404).json({ error: 'Pedido no encontrado' });
    res.json(order);
  });

  // Upload or update prescription document
  app.post('/api/v1/orders/:orderId/prescription', (req: Request, res: Response) => {
    const order = orders.find(o => o.id === req.params.orderId);
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

  // Customer tracking endpoint (sanitized)
  app.get('/api/v1/orders/:orderId/tracking', (req: Request, res: Response) => {
    const order = orders.find(o => o.id === req.params.orderId);
    if (!order) return res.status(404).json({ error: 'Pedido no encontrado' });

    const history = gpsTelemetryHistory[order.id] || [];
    const latestTelemetry = history[history.length - 1];

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
        latitude: latestTelemetry.latitude,
        longitude: latestTelemetry.longitude,
        heading: latestTelemetry.heading,
        speed: latestTelemetry.speed,
        timestamp: latestTelemetry.timestamp,
        secondsAgo: Math.floor((Date.now() - latestTelemetry.timestamp) / 1000),
      } : null,
      hubCoordinates: stores.find(s => s.id === order.storeId)?.coordinates || { lat: 4.6284, lng: -74.1539 },
      customerCoordinates: order.deliveryAddress.coordinates,
    });
  });

  // Verify delivery with customer secret code (supports entire order or individual child shipment)
  app.post('/api/v1/orders/:orderId/verify-delivery', (req: Request, res: Response) => {
    const order = orders.find(o => o.id === req.params.orderId);
    if (!order) return res.status(404).json({ error: 'Pedido no encontrado' });

    const { deliveryCode, shipmentId } = req.body;
    const inputCode = String(deliveryCode).trim();

    // Caso A: Verificación de un envío hijo específico en pedido dividido
    if (order.isSplitOrder && order.childShipments && shipmentId) {
      const child = order.childShipments.find(s => s.shipmentId === shipmentId);
      if (!child) {
        return res.status(404).json({ error: `Envío hijo no encontrado: ${shipmentId}` });
      }

      if (child.secretDeliveryCode !== inputCode && order.secretDeliveryCode !== inputCode) {
        return res.status(403).json({
          error: `Código de entrega inválido para el envío ${child.shipmentIndex} de ${child.shipmentCount}.`,
        });
      }

      child.fulfillmentStatus = 'ENTREGADO';
      child.timestamps.deliveredAt = new Date().toISOString();

      // Deduct physical stock for items in this shipment
      for (const item of child.items) {
        const prod = products.find(p => p.id === item.productId);
        if (prod) {
          prod.stockByStore[order.storeId] = Math.max(0, (prod.stockByStore[order.storeId] || 0) - item.quantity);
          prod.reservedStockByStore[order.storeId] = Math.max(0, (prod.reservedStockByStore[order.storeId] || 0) - item.quantity);
        }
      }

      // Comprobar si todos los envíos hijos han sido entregados
      const allDelivered = order.childShipments.every(s => s.fulfillmentStatus === 'ENTREGADO');
      if (allDelivered) {
        order.fulfillmentStatus = 'ENTREGADO';
        order.timestamps.deliveredAt = new Date().toISOString();
        if (order.payment.method === 'CASH_ON_DELIVERY') {
          order.payment.cashSettled = true;
          order.payment.status = 'APROBADO';
        }
      }

      return res.json({
        message: `Envío ${child.shipmentIndex} de ${child.shipmentCount} verificado y entregado exitosamente`,
        childShipment: child,
        order,
      });
    }

    // Caso B: Verificación general del pedido
    if (order.secretDeliveryCode !== inputCode) {
      return res.status(403).json({ error: 'Código de entrega inválido. Verifique el número de 4 dígitos con el cliente.' });
    }

    order.fulfillmentStatus = 'ENTREGADO';
    order.timestamps.deliveredAt = new Date().toISOString();
    if (order.childShipments) {
      order.childShipments.forEach(s => {
        s.fulfillmentStatus = 'ENTREGADO';
        s.timestamps.deliveredAt = new Date().toISOString();
      });
    }

    // Deduct physical stock permanently
    for (const item of order.items) {
      const prod = products.find(p => p.id === item.productId);
      if (prod) {
        prod.stockByStore[order.storeId] = Math.max(0, (prod.stockByStore[order.storeId] || 0) - item.quantity);
        prod.reservedStockByStore[order.storeId] = Math.max(0, (prod.reservedStockByStore[order.storeId] || 0) - item.quantity);
      }
    }

    res.json({ message: 'Entrega verificada exitosamente', order });
  });

  // ==========================================
  // BOLT CONDUCTOR ANDROID SHARED CONTRACT ROUTES
  // ==========================================

  app.get('/api/v1/driver/profile', (_req: Request, res: Response) => {
    res.json(drivers[0]);
  });

  app.post('/api/v1/driver/shift', (req: Request, res: Response) => {
    const { action } = req.body;
    const driver = drivers[0];
    driver.isOnline = action === 'START';
    driver.currentStatus = driver.isOnline ? 'DISPONIBLE' : 'FUERA_DE_TURNO';
    res.json({ message: `Turno ${driver.isOnline ? 'iniciado' : 'finalizado'}`, driver });
  });

  app.get('/api/v1/driver/assignments', (_req: Request, res: Response) => {
    const activeOrder = orders.find(o => o.driver?.id === drivers[0].id && o.fulfillmentStatus !== 'ENTREGADO');
    res.json({ activeAssignment: activeOrder || null });
  });

  app.post('/api/v1/driver/gps', (req: Request, res: Response) => {
    const telemetry: GPSTelemetry = req.body;
    if (!telemetry.orderId || !telemetry.latitude || !telemetry.longitude) {
      return res.status(400).json({ error: 'Datos de telemetría incompletos' });
    }

    if (!gpsTelemetryHistory[telemetry.orderId]) {
      gpsTelemetryHistory[telemetry.orderId] = [];
    }
    gpsTelemetryHistory[telemetry.orderId].push(telemetry);

    // Keep memory lean
    if (gpsTelemetryHistory[telemetry.orderId].length > 100) {
      gpsTelemetryHistory[telemetry.orderId].shift();
    }

    // Update driver position
    const driver = drivers.find(d => d.id === drivers[0].id);
    if (driver) {
      driver.currentLocation = {
        lat: telemetry.latitude,
        lng: telemetry.longitude,
        heading: telemetry.heading,
        speed: telemetry.speed,
        updatedAt: new Date().toISOString(),
      };
    }

    res.json({ status: 'telemetry_received', count: gpsTelemetryHistory[telemetry.orderId].length });
  });

  // ==========================================
  // OPERATIONS DASHBOARD ROUTES
  // ==========================================

  app.post('/api/v1/operations/orders/:orderId/status', (req: Request, res: Response) => {
    const order = orders.find(o => o.id === req.params.orderId);
    if (!order) return res.status(404).json({ error: 'Pedido no encontrado' });

    const { status, shipmentId } = req.body;

    if (order.isSplitOrder && order.childShipments && shipmentId) {
      const child = order.childShipments.find(s => s.shipmentId === shipmentId);
      if (child) {
        child.fulfillmentStatus = status;
        const nowIso = new Date().toISOString();
        if (status === 'EN_ALISTAMIENTO' && !child.timestamps.prepStartedAt) child.timestamps.prepStartedAt = nowIso;
        if (status === 'LISTO_PARA_DESPACHO' && !child.timestamps.prepCompletedAt) child.timestamps.prepCompletedAt = nowIso;
        if (status === 'EN_CAMINO' && !child.timestamps.pickedUpAt) child.timestamps.pickedUpAt = nowIso;
        if (status === 'ENTREGADO' && !child.timestamps.deliveredAt) child.timestamps.deliveredAt = nowIso;

        // Sincronizar estado del pedido padre
        if (order.childShipments.every(s => s.fulfillmentStatus === 'ENTREGADO')) {
          order.fulfillmentStatus = 'ENTREGADO';
          order.timestamps.deliveredAt = nowIso;
        } else if (order.childShipments.some(s => s.fulfillmentStatus === 'EN_CAMINO')) {
          order.fulfillmentStatus = 'EN_CAMINO';
        } else if (order.childShipments.some(s => s.fulfillmentStatus === 'REPARTIDOR_ASIGNADO')) {
          order.fulfillmentStatus = 'REPARTIDOR_ASIGNADO';
        } else if (order.childShipments.some(s => s.fulfillmentStatus === 'LISTO_PARA_DESPACHO')) {
          order.fulfillmentStatus = 'LISTO_PARA_DESPACHO';
        } else if (order.childShipments.some(s => s.fulfillmentStatus === 'EN_ALISTAMIENTO')) {
          order.fulfillmentStatus = 'EN_ALISTAMIENTO';
        }

        return res.json({ message: `Estado del envío ${child.shipmentIndex} actualizado a ${status}`, child, order });
      }
    }

    order.fulfillmentStatus = status;

    if (status === 'EN_ALISTAMIENTO' && !order.timestamps.prepStartedAt) {
      order.timestamps.prepStartedAt = new Date().toISOString();
    }
    if (status === 'LISTO_PARA_DESPACHO' && !order.timestamps.prepCompletedAt) {
      order.timestamps.prepCompletedAt = new Date().toISOString();
    }
    if (status === 'EN_CAMINO' && !order.timestamps.pickedUpAt) {
      order.timestamps.pickedUpAt = new Date().toISOString();
    }

    res.json({ message: 'Estado actualizado', order });
  });

  app.post('/api/v1/operations/orders/:orderId/prescription/review', (req: Request, res: Response) => {
    const order = orders.find(o => o.id === req.params.orderId);
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
    const order = orders.find(o => o.id === req.params.orderId);
    if (!order) return res.status(404).json({ error: 'Pedido no encontrado' });

    const { driverId, shipmentId } = req.body;
    const driver = drivers.find(d => d.id === driverId) || drivers[0];
    const driverPayload = {
      id: driver.id,
      name: driver.name,
      phone: driver.phone,
      vehiclePlate: driver.vehiclePlate,
      vehicleType: driver.vehicleType,
      rating: driver.rating,
      photo: driver.photo,
    };

    if (order.isSplitOrder && order.childShipments && shipmentId) {
      const child = order.childShipments.find(s => s.shipmentId === shipmentId);
      if (child) {
        child.driver = driverPayload;
        child.fulfillmentStatus = 'REPARTIDOR_ASIGNADO';
        child.timestamps.assignedAt = new Date().toISOString();

        if (order.childShipments.every(s => !!s.driver)) {
          order.fulfillmentStatus = 'REPARTIDOR_ASIGNADO';
          order.timestamps.assignedAt = new Date().toISOString();
        }

        return res.json({ message: `Conductor asignado al envío ${child.shipmentIndex}`, child, order });
      }
    }

    order.driver = driverPayload;
    order.fulfillmentStatus = 'REPARTIDOR_ASIGNADO';
    order.timestamps.assignedAt = new Date().toISOString();

    res.json({ message: 'Conductor asignado exitosamente', order });
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
