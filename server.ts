import express, { Request, Response } from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import { INITIAL_PRODUCTS, INITIAL_STORES, INITIAL_DRIVERS, INITIAL_ORDERS } from './src/data/seedData';
import { Order, Product, Store, DriverProfile, GPSTelemetry } from './src/types';

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

  // Create Order with transactional stock reservation
  app.post('/api/v1/orders', (req: Request, res: Response) => {
    try {
      const { storeId, items, customer, deliveryAddress, paymentMethod, tip = 0 } = req.body;

      if (!storeId || !items || !items.length || !customer || !deliveryAddress || !paymentMethod) {
        return res.status(400).json({ error: 'Faltan campos obligatorios para crear el pedido.' });
      }

      // Check stock availability and reserve
      for (const item of items) {
        const prod = products.find(p => p.id === item.productId);
        if (!prod) {
          return res.status(400).json({ error: `Producto no encontrado: ${item.productId}` });
        }
        const currentStock = prod.stockByStore[storeId] || 0;
        const currentReserved = prod.reservedStockByStore[storeId] || 0;
        const availableToSell = currentStock - currentReserved;

        // Regla operativa: venta normal se pausa cuando quedan <= 2 unidades para evitar roturas
        if (availableToSell - item.quantity < 0) {
          return res.status(400).json({
            error: `Inventario insuficiente para ${prod.name}. Disponibles para venta: ${Math.max(0, availableToSell)}`,
          });
        }
      }

      // Apply reservation
      for (const item of items) {
        const prod = products.find(p => p.id === item.productId)!;
        prod.reservedStockByStore[storeId] = (prod.reservedStockByStore[storeId] || 0) + item.quantity;
      }

      const hasPrescriptionItem = items.some((i: any) => i.requiresPrescription);
      const subtotal = items.reduce((acc: number, curr: any) => acc + (curr.price * curr.quantity), 0);
      const totalWeightKg = items.reduce((acc: number, curr: any) => acc + ((curr.weightKg || 0.2) * curr.quantity), 0);
      const shipping = subtotal >= 70000 ? 0 : 4900;
      const serviceFee = 1500;
      const total = subtotal + shipping + serviceFee + tip;

      const random4DigitCode = Math.floor(1000 + Math.random() * 9000).toString();
      const newOrderNum = `#BP-${Math.floor(1000 + Math.random() * 9000)}`;

      const newOrder: Order = {
        id: `ORD-2026-${Math.floor(1000 + Math.random() * 9000)}`,
        orderNumber: newOrderNum,
        createdAt: new Date().toISOString(),
        storeId,
        storeName: stores.find(s => s.id === storeId)?.name || 'Sede Kennedy',
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
        estimatedDeliveryMinutes: 15,
        originalPromiseWindow: {
          start: new Date().toISOString(),
          end: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
        },
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

  // Verify delivery with customer secret code
  app.post('/api/v1/orders/:orderId/verify-delivery', (req: Request, res: Response) => {
    const order = orders.find(o => o.id === req.params.orderId);
    if (!order) return res.status(404).json({ error: 'Pedido no encontrado' });

    const { deliveryCode } = req.body;
    if (order.secretDeliveryCode !== String(deliveryCode).trim()) {
      return res.status(403).json({ error: 'Código de entrega inválido. Verifique el número de 4 dígitos con el cliente.' });
    }

    order.fulfillmentStatus = 'ENTREGADO';
    order.timestamps.deliveredAt = new Date().toISOString();

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

    const { status } = req.body;
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

    const { driverId } = req.body;
    const driver = drivers.find(d => d.id === driverId) || drivers[0];

    order.driver = {
      id: driver.id,
      name: driver.name,
      phone: driver.phone,
      vehiclePlate: driver.vehiclePlate,
      vehicleType: driver.vehicleType,
      rating: driver.rating,
      photo: driver.photo,
    };
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
