import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { 
  Order, 
  ChildShipment, 
  DriverProfile, 
  FulfillmentStatus, 
  OrderStatusHistoryEntry, 
  OrderActor, 
  Product,
  OperationRole,
  GPSTelemetry
} from '../types';
import { INITIAL_ORDERS, INITIAL_DRIVERS } from '../data/seedData';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.resolve(__dirname, '../data');

const ORDERS_FILE = path.join(DATA_DIR, 'persisted-orders.json');
const DRIVERS_FILE = path.join(DATA_DIR, 'persisted-drivers.json');
const AUDIT_FILE = path.join(DATA_DIR, 'persisted-audit.json');
const TELEMETRY_FILE = path.join(DATA_DIR, 'persisted-telemetry.json');

// Matriz autorizada de transiciones permitidas por estado
const ALLOWED_TRANSITIONS: Record<FulfillmentStatus, FulfillmentStatus[]> = {
  PENDIENTE_CONFIRMACION: ['CONFIRMADO', 'CANCELADO'],
  CONFIRMADO: ['EN_ALISTAMIENTO', 'CANCELADO'],
  EN_ALISTAMIENTO: ['LISTO_PARA_DESPACHO', 'CON_INCIDENCIA', 'CANCELADO'],
  LISTO_PARA_DESPACHO: ['REPARTIDOR_ASIGNADO', 'CON_INCIDENCIA', 'CANCELADO'],
  REPARTIDOR_ASIGNADO: ['EN_CAMINO', 'LISTO_PARA_DESPACHO', 'CON_INCIDENCIA', 'CANCELADO'],
  EN_CAMINO: ['ENTREGADO', 'CON_INCIDENCIA', 'CANCELADO'],
  CON_INCIDENCIA: ['EN_CAMINO', 'LISTO_PARA_DESPACHO', 'ENTREGADO', 'CANCELADO'],
  ENTREGADO: [], // Terminal
  CANCELADO: [], // Terminal
};

// Roles autorizados por transición
const ROLE_PERMISSIONS: Partial<Record<FulfillmentStatus, string[]>> = {
  CONFIRMADO: ['CLIENTE', 'BODEGA', 'ADMINISTRADOR', 'COORDINADOR', 'SISTEMA'],
  EN_ALISTAMIENTO: ['BODEGA', 'ALISTADOR', 'COORDINADOR', 'ADMINISTRADOR'],
  LISTO_PARA_DESPACHO: ['BODEGA', 'ALISTADOR', 'DESPACHADOR', 'COORDINADOR', 'ADMINISTRADOR'],
  REPARTIDOR_ASIGNADO: ['BODEGA', 'COORDINADOR', 'ADMINISTRADOR', 'SISTEMA'],
  EN_CAMINO: ['CONDUCTOR', 'BODEGA', 'COORDINADOR', 'ADMINISTRADOR'],
  ENTREGADO: ['CONDUCTOR', 'BODEGA', 'COORDINADOR', 'ADMINISTRADOR'], // REQUIERE PIN
  CON_INCIDENCIA: ['CONDUCTOR', 'BODEGA', 'COORDINADOR', 'ADMINISTRADOR', 'SISTEMA'],
  CANCELADO: ['CLIENTE', 'BODEGA', 'COORDINADOR', 'ADMINISTRADOR', 'SISTEMA', 'SOPORTE'],
};

export class OrdersRepository {
  private orders: Order[] = [];
  private drivers: DriverProfile[] = [];
  private auditHistory: OrderStatusHistoryEntry[] = [];
  private telemetryHistory: Record<string, GPSTelemetry[]> = {};
  private initialized = false;

  constructor() {
    this.init();
  }

  /**
   * Carga los datos desde el almacenamiento persistente en disco o desde los datos semilla
   */
  public init() {
    if (!fs.existsSync(DATA_DIR)) {
      try {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      } catch (e) {
        console.error('[OrdersRepository] No se pudo crear directorio de datos:', e);
      }
    }

    // 1. Cargar o Inicializar Pedidos
    if (fs.existsSync(ORDERS_FILE)) {
      try {
        const raw = fs.readFileSync(ORDERS_FILE, 'utf-8');
        this.orders = JSON.parse(raw);
      } catch (err) {
        console.error('[OrdersRepository] Error leyendo persisted-orders.json, usando semillas:', err);
        this.orders = JSON.parse(JSON.stringify(INITIAL_ORDERS));
        this.saveOrders();
      }
    } else {
      this.orders = JSON.parse(JSON.stringify(INITIAL_ORDERS));
      this.saveOrders();
    }

    // 2. Cargar o Inicializar Conductores
    if (fs.existsSync(DRIVERS_FILE)) {
      try {
        const raw = fs.readFileSync(DRIVERS_FILE, 'utf-8');
        this.drivers = JSON.parse(raw);
      } catch (err) {
        console.error('[OrdersRepository] Error leyendo persisted-drivers.json, usando semillas:', err);
        this.drivers = JSON.parse(JSON.stringify(INITIAL_DRIVERS));
        this.saveDrivers();
      }
    } else {
      this.drivers = JSON.parse(JSON.stringify(INITIAL_DRIVERS));
      this.saveDrivers();
    }

    // 3. Cargar o Inicializar Auditoría
    if (fs.existsSync(AUDIT_FILE)) {
      try {
        const raw = fs.readFileSync(AUDIT_FILE, 'utf-8');
        this.auditHistory = JSON.parse(raw);
      } catch (err) {
        this.auditHistory = [];
        this.saveAudit();
      }
    } else {
      this.auditHistory = [];
      this.saveAudit();
    }

    // 4. Cargar o Inicializar Telemetría GPS Persistente
    if (fs.existsSync(TELEMETRY_FILE)) {
      try {
        const raw = fs.readFileSync(TELEMETRY_FILE, 'utf-8');
        this.telemetryHistory = JSON.parse(raw);
      } catch (err) {
        this.telemetryHistory = {};
        this.saveTelemetry();
      }
    } else {
      this.telemetryHistory = {};
      this.saveTelemetry();
    }

    // Normalizar IDs estables y estructuras iniciales si faltan
    this.normalizeInitialState();
    this.initialized = true;
  }

  private normalizeInitialState() {
    let modified = false;
    for (const order of this.orders) {
      if (!order.assignmentId) {
        order.assignmentId = `ASG-${order.id.replace('ORD-2026-', '')}`;
        modified = true;
      }
      if (!order.tripId) {
        order.tripId = `TRP-${order.id.replace('ORD-2026-', '')}`;
        modified = true;
      }
      if (!order.statusHistory) {
        order.statusHistory = [];
        modified = true;
      }
      if (order.childShipments && order.childShipments.length > 0) {
        for (let i = 0; i < order.childShipments.length; i++) {
          const child = order.childShipments[i];
          if (!child.assignmentId) {
            child.assignmentId = `ASG-${order.id.replace('ORD-2026-', '')}-${i + 1}`;
            modified = true;
          }
          if (!child.tripId) {
            child.tripId = `TRP-${order.id.replace('ORD-2026-', '')}-${i + 1}`;
            modified = true;
          }
          if (!child.statusHistory) {
            child.statusHistory = [];
            modified = true;
          }
        }
      }
    }
    if (modified) {
      this.saveOrders();
    }
  }

  private saveOrders() {
    try {
      fs.writeFileSync(ORDERS_FILE, JSON.stringify(this.orders, null, 2), 'utf-8');
    } catch (e) {
      console.error('[OrdersRepository] Error guardando pedidos en disco:', e);
    }
  }

  private saveDrivers() {
    try {
      fs.writeFileSync(DRIVERS_FILE, JSON.stringify(this.drivers, null, 2), 'utf-8');
    } catch (e) {
      console.error('[OrdersRepository] Error guardando conductores en disco:', e);
    }
  }

  private saveAudit() {
    try {
      fs.writeFileSync(AUDIT_FILE, JSON.stringify(this.auditHistory, null, 2), 'utf-8');
    } catch (e) {
      console.error('[OrdersRepository] Error guardando historial de auditoría en disco:', e);
    }
  }

  private saveTelemetry() {
    try {
      fs.writeFileSync(TELEMETRY_FILE, JSON.stringify(this.telemetryHistory, null, 2), 'utf-8');
    } catch (e) {
      console.error('[OrdersRepository] Error guardando telemetría en disco:', e);
    }
  }

  // ==========================================
  // CONSULTAS
  // ==========================================

  public getAllOrders(): Order[] {
    return [...this.orders];
  }

  public getOrderById(id: string): Order | undefined {
    return this.orders.find(o => o.id === id || o.orderNumber === id);
  }

  public getOrdersByStore(storeId: string): Order[] {
    return this.orders.filter(o => o.storeId === storeId);
  }

  public getOrdersByStatus(status: FulfillmentStatus): Order[] {
    return this.orders.filter(o => o.fulfillmentStatus === status);
  }

  public getAuditHistory(orderId?: string): OrderStatusHistoryEntry[] {
    if (orderId) {
      return this.auditHistory.filter(h => h.orderId === orderId);
    }
    return [...this.auditHistory];
  }

  public getAllDrivers(): DriverProfile[] {
    return [...this.drivers];
  }

  public getDriverById(id: string): DriverProfile | undefined {
    return this.drivers.find(d => d.id === id);
  }

  // ==========================================
  // CREACIÓN DE PEDIDO CON RESERVA ATÓMICA
  // ==========================================

  public createOrder(orderData: Order, catalogProducts?: Product[]): { success: boolean; order?: Order; error?: string } {
    // 1. Validar que no exista un pedido con el mismo ID
    if (this.orders.some(o => o.id === orderData.id)) {
      return { success: false, error: `Pedido duplicado: ya existe un pedido con ID ${orderData.id}` };
    }

    // 2. Comprobar y reservar inventario si se proporciona catálogo
    if (catalogProducts && orderData.items) {
      for (const item of orderData.items) {
        const prod = catalogProducts.find(p => p.id === item.productId);
        if (!prod) {
          return { success: false, error: `Producto no encontrado en catálogo: ${item.productId}` };
        }
        const currentStock = prod.stockByStore[orderData.storeId] || 0;
        const currentReserved = prod.reservedStockByStore[orderData.storeId] || 0;
        const availableToSell = currentStock - currentReserved;

        if (availableToSell - item.quantity < 0) {
          return {
            success: false,
            error: `Inventario insuficiente para ${prod.name} en la bodega seleccionada. Disponibles: ${Math.max(0, availableToSell)}`,
          };
        }
      }

      // Aplicar reserva atómica en los productos
      for (const item of orderData.items) {
        const prod = catalogProducts.find(p => p.id === item.productId)!;
        if (!prod.reservedStockByStore) prod.reservedStockByStore = {};
        prod.reservedStockByStore[orderData.storeId] = (prod.reservedStockByStore[orderData.storeId] || 0) + item.quantity;
      }
    }

    // 3. Asignar IDs estables para GPS y telemetría
    const cleanId = orderData.id.replace('ORD-2026-', '');
    if (!orderData.assignmentId) {
      orderData.assignmentId = `ASG-${cleanId}`;
    }
    if (!orderData.tripId) {
      orderData.tripId = `TRP-${cleanId}`;
    }

    // Asignar IDs estables a los envíos divididos
    if (orderData.isSplitOrder && orderData.childShipments) {
      orderData.childShipments.forEach((child, idx) => {
        if (!child.assignmentId) child.assignmentId = `ASG-${cleanId}-${idx + 1}`;
        if (!child.tripId) child.tripId = `TRP-${cleanId}-${idx + 1}`;
        if (!child.childOrderId) child.childOrderId = `${orderData.id}-${String.fromCharCode(65 + idx)}`;
        if (!child.statusHistory) child.statusHistory = [];
      });
    }

    // 4. Registrar evento de auditoría inicial
    const initialActor: OrderActor = { role: 'CLIENTE', id: orderData.customer.email, name: orderData.customer.name };
    const historyEntry: OrderStatusHistoryEntry = {
      id: `HIST-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`,
      orderId: orderData.id,
      previousStatus: 'PENDIENTE_CONFIRMACION',
      newStatus: orderData.fulfillmentStatus,
      timestamp: new Date().toISOString(),
      actor: initialActor,
      reason: 'Creación y registro de pedido en el servidor autoritativo',
      metadata: {
        deliveryMode: orderData.deliveryMode,
        isSplitOrder: !!orderData.isSplitOrder,
        itemsCount: orderData.items.length,
        totalCOP: orderData.totals.total,
      },
    };

    orderData.statusHistory = [historyEntry];
    this.auditHistory.push(historyEntry);

    // 5. Guardar pedido en colección y persistir a disco
    this.orders.unshift(orderData);
    this.saveOrders();
    this.saveAudit();

    return { success: true, order: orderData };
  }

  // ==========================================
  // MÁQUINA DE ESTADOS AUTORIZADA Y VALIDADA
  // ==========================================

  public transitionStatus(
    orderId: string,
    newStatus: FulfillmentStatus,
    actor: OrderActor,
    options?: {
      shipmentId?: string;
      reason?: string;
      deliveryCode?: string;
      catalogProducts?: Product[];
      notes?: string;
    }
  ): { success: boolean; order?: Order; childShipment?: ChildShipment; error?: string; code?: number } {
    const order = this.orders.find(o => o.id === orderId || o.orderNumber === orderId);
    if (!order) {
      return { success: false, error: `Pedido no encontrado: ${orderId}`, code: 404 };
    }

    const { shipmentId, reason, deliveryCode, catalogProducts, notes } = options || {};
    const nowIso = new Date().toISOString();

    // -------------------------------------------------------------
    // CASO A: TRANSICIÓN DE ENVÍO HIJO EN PEDIDO DIVIDIDO (>60 KG)
    // -------------------------------------------------------------
    if (order.isSplitOrder && order.childShipments && shipmentId) {
      const child = order.childShipments.find(s => s.shipmentId === shipmentId);
      if (!child) {
        return { success: false, error: `Envío hijo no encontrado: ${shipmentId}`, code: 404 };
      }

      const currentStatus = child.fulfillmentStatus;

      // Idempotencia: si ya está en el estado solicitado, retornar exitoso sin reprocesar
      if (currentStatus === newStatus) {
        return { success: true, order, childShipment: child };
      }

      // Validar permisos del rol para el nuevo estado
      const rolePermitted = this.validateRolePermission(actor, newStatus);
      if (!rolePermitted) {
        return {
          success: false,
          error: `Acción no autorizada: El rol '${actor.role}' no tiene permiso para cambiar el estado a '${newStatus}'`,
          code: 403,
        };
      }

      // Regla cliente: el cliente no puede avanzar estados operativos ni marcar entrega
      if (actor.role === 'CLIENTE') {
        if (newStatus !== 'CANCELADO') {
          return {
            success: false,
            error: 'Los clientes solo pueden consultar o solicitar cancelación antes de despacho.',
            code: 403,
          };
        }
        if (currentStatus !== 'PENDIENTE_CONFIRMACION' && currentStatus !== 'CONFIRMADO') {
          return {
            success: false,
            error: 'No se puede cancelar el envío una vez iniciado el alistamiento o despacho.',
            code: 400,
          };
        }
      }

      // Validar matriz de transiciones permitidas
      const allowed = ALLOWED_TRANSITIONS[currentStatus] || [];
      if (!allowed.includes(newStatus)) {
        return {
          success: false,
          error: `Transición inválida: No se permite cambiar de '${currentStatus}' a '${newStatus}'. Permitidos: ${allowed.join(', ') || 'Ninguno (terminal)'}`,
          code: 400,
        };
      }

      // Si es ENTREGADO, es OBLIGATORIO validar el PIN secreto de 4 dígitos
      if (newStatus === 'ENTREGADO') {
        if (!deliveryCode || String(deliveryCode).trim() !== child.secretDeliveryCode) {
          return {
            success: false,
            error: 'Código secreto de entrega inválido. Verifique el código de 4 dígitos proporcionado por el cliente.',
            code: 403,
          };
        }
        child.timestamps.deliveredAt = nowIso;

        // Descontar inventario físico definitivo para los ítems de este envío
        if (catalogProducts) {
          for (const item of child.items) {
            const prod = catalogProducts.find(p => p.id === item.productId);
            if (prod) {
              if (prod.stockByStore) {
                prod.stockByStore[order.storeId] = Math.max(0, (prod.stockByStore[order.storeId] || 0) - item.quantity);
              }
              if (prod.reservedStockByStore) {
                prod.reservedStockByStore[order.storeId] = Math.max(0, (prod.reservedStockByStore[order.storeId] || 0) - item.quantity);
              }
            }
          }
        }
      }

      // Manejo de Cancelación y Gestión de Stock
      if (newStatus === 'CANCELADO') {
        child.timestamps.cancelledAt = nowIso;
        child.cancelReason = reason || 'Cancelación de envío hijo';

        // Comprobar si fue antes o después de despacho
        const wasDispatchedOrPacked = ['LISTO_PARA_DESPACHO', 'REPARTIDOR_ASIGNADO', 'EN_CAMINO', 'CON_INCIDENCIA'].includes(currentStatus);
        if (wasDispatchedOrPacked) {
          child.physicalReturnPending = true;
          // NO reponer stock automáticamente: requiere confirmación de inspección física
        } else {
          // Pre-despacho: liberar reserva de forma atómica inmediatamente
          if (catalogProducts) {
            for (const item of child.items) {
              const prod = catalogProducts.find(p => p.id === item.productId);
              if (prod && prod.reservedStockByStore) {
                prod.reservedStockByStore[order.storeId] = Math.max(0, (prod.reservedStockByStore[order.storeId] || 0) - item.quantity);
              }
            }
          }
        }
      }

      // Actualizar marcas de tiempo correspondientes
      if (newStatus === 'EN_ALISTAMIENTO' && !child.timestamps.prepStartedAt) child.timestamps.prepStartedAt = nowIso;
      if (newStatus === 'LISTO_PARA_DESPACHO' && !child.timestamps.prepCompletedAt) child.timestamps.prepCompletedAt = nowIso;
      if (newStatus === 'REPARTIDOR_ASIGNADO' && !child.timestamps.assignedAt) child.timestamps.assignedAt = nowIso;
      if (newStatus === 'EN_CAMINO' && !child.timestamps.pickedUpAt) child.timestamps.pickedUpAt = nowIso;

      // Aplicar nuevo estado al envío hijo
      child.fulfillmentStatus = newStatus;

      // Registrar auditoría
      const auditEntry: OrderStatusHistoryEntry = {
        id: `HIST-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`,
        orderId: order.id,
        shipmentId: child.shipmentId,
        previousStatus: currentStatus,
        newStatus,
        timestamp: nowIso,
        actor,
        reason: reason || `Transición a ${newStatus} en envío hijo ${child.shipmentIndex}`,
        metadata: {
          shipmentIndex: child.shipmentIndex,
          shipmentCount: child.shipmentCount,
          weightKg: child.weightKg,
          notes,
        },
      };

      if (!child.statusHistory) child.statusHistory = [];
      child.statusHistory.push(auditEntry);
      if (!order.statusHistory) order.statusHistory = [];
      order.statusHistory.push(auditEntry);
      this.auditHistory.push(auditEntry);

      // Sincronizar estado del pedido padre con base en el conjunto de hijos
      this.recalculateParentOrderStatus(order, nowIso);

      this.saveOrders();
      this.saveAudit();

      return { success: true, order, childShipment: child };
    }

    // -------------------------------------------------------------
    // CASO B: TRANSICIÓN DEL PEDIDO COMPLETO (TURBO O PROGRAMADO)
    // -------------------------------------------------------------
    const currentStatus = order.fulfillmentStatus;

    // Idempotencia: si ya está en el estado solicitado, retornar exitoso
    if (currentStatus === newStatus) {
      return { success: true, order };
    }

    // Validar permisos del rol para el nuevo estado
    const rolePermitted = this.validateRolePermission(actor, newStatus);
    if (!rolePermitted) {
      return {
        success: false,
        error: `Acción no autorizada: El rol '${actor.role}' no tiene permiso para cambiar el estado a '${newStatus}'`,
        code: 403,
      };
    }

    // Regla de seguridad del cliente
    if (actor.role === 'CLIENTE') {
      if (newStatus !== 'CANCELADO') {
        return {
          success: false,
          error: 'Un botón de cliente no puede acreditar un pago ni marcar una entrega.',
          code: 403,
        };
      }
      if (currentStatus !== 'PENDIENTE_CONFIRMACION' && currentStatus !== 'CONFIRMADO') {
        return {
          success: false,
          error: 'No se puede cancelar el pedido: la orden ya se encuentra en preparación o ruta.',
          code: 400,
        };
      }
    }

    // En pedidos divididos, no se puede forzar ENTREGADO directamente sobre el padre
    // mientras existan envíos hijos pendientes
    if (order.isSplitOrder && order.childShipments && order.childShipments.length > 0) {
      if (newStatus === 'ENTREGADO') {
        const pendingChildren = order.childShipments.filter(c => c.fulfillmentStatus !== 'ENTREGADO');
        if (pendingChildren.length > 0) {
          return {
            success: false,
            error: `No se puede marcar el pedido completo como entregado: faltan ${pendingChildren.length} envíos por entregar con sus respectivos códigos de seguridad.`,
            code: 400,
          };
        }
      }
    }

    // Validar matriz de transiciones permitidas
    const allowed = ALLOWED_TRANSITIONS[currentStatus] || [];
    if (!allowed.includes(newStatus)) {
      return {
        success: false,
        error: `Transición inválida: No se permite cambiar de '${currentStatus}' a '${newStatus}'. Permitidos: ${allowed.join(', ') || 'Ninguno (terminal)'}`,
        code: 400,
      };
    }

    // Si es ENTREGADO, validar código secreto de 4 dígitos
    if (newStatus === 'ENTREGADO') {
      if (!deliveryCode || String(deliveryCode).trim() !== order.secretDeliveryCode) {
        return {
          success: false,
          error: 'Código secreto de entrega inválido. Verifique los 4 dígitos suministrados por el cliente.',
          code: 403,
        };
      }
      order.timestamps.deliveredAt = nowIso;
      if (order.payment.method === 'CASH_ON_DELIVERY') {
        order.payment.cashSettled = true;
        order.payment.status = 'APROBADO';
      }

      // Descontar inventario físico definitivo
      if (catalogProducts) {
        for (const item of order.items) {
          const prod = catalogProducts.find(p => p.id === item.productId);
          if (prod) {
            if (prod.stockByStore) {
              prod.stockByStore[order.storeId] = Math.max(0, (prod.stockByStore[order.storeId] || 0) - item.quantity);
            }
            if (prod.reservedStockByStore) {
              prod.reservedStockByStore[order.storeId] = Math.max(0, (prod.reservedStockByStore[order.storeId] || 0) - item.quantity);
            }
          }
        }
      }
    }

    // Manejo de Cancelación y Gestión de Stock
    if (newStatus === 'CANCELADO') {
      order.timestamps.cancelledAt = nowIso;
      order.cancelReason = reason || 'Cancelación de pedido';

      const wasDispatchedOrPacked = ['LISTO_PARA_DESPACHO', 'REPARTIDOR_ASIGNADO', 'EN_CAMINO', 'CON_INCIDENCIA'].includes(currentStatus);
      if (wasDispatchedOrPacked) {
        order.physicalReturnPending = true;
        // Mercancía ya empacada o en tránsito: NO retornar a disponible sin confirmación física
      } else {
        // Pre-despacho: liberar stock reservado inmediatamente
        if (catalogProducts) {
          for (const item of order.items) {
            const prod = catalogProducts.find(p => p.id === item.productId);
            if (prod && prod.reservedStockByStore) {
              prod.reservedStockByStore[order.storeId] = Math.max(0, (prod.reservedStockByStore[order.storeId] || 0) - item.quantity);
            }
          }
        }
      }

      // Si tiene hijos, cancelar hijos no entregados
      if (order.childShipments) {
        order.childShipments.forEach(c => {
          if (c.fulfillmentStatus !== 'ENTREGADO') {
            c.fulfillmentStatus = 'CANCELADO';
            c.timestamps.cancelledAt = nowIso;
            c.cancelReason = order.cancelReason;
            if (wasDispatchedOrPacked) {
              c.physicalReturnPending = true;
            }
          }
        });
      }
    }

    // Actualizar timestamps
    if (newStatus === 'EN_ALISTAMIENTO' && !order.timestamps.prepStartedAt) order.timestamps.prepStartedAt = nowIso;
    if (newStatus === 'LISTO_PARA_DESPACHO' && !order.timestamps.prepCompletedAt) order.timestamps.prepCompletedAt = nowIso;
    if (newStatus === 'REPARTIDOR_ASIGNADO' && !order.timestamps.assignedAt) order.timestamps.assignedAt = nowIso;
    if (newStatus === 'EN_CAMINO' && !order.timestamps.pickedUpAt) order.timestamps.pickedUpAt = nowIso;

    // Aplicar nuevo estado al pedido
    order.fulfillmentStatus = newStatus;

    // Registrar auditoría
    const auditEntry: OrderStatusHistoryEntry = {
      id: `HIST-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`,
      orderId: order.id,
      previousStatus: currentStatus,
      newStatus,
      timestamp: nowIso,
      actor,
      reason: reason || `Transición autorizada a ${newStatus}`,
      metadata: {
        paymentStatus: order.payment.status,
        deliveryMode: order.deliveryMode,
        driverId: order.driver?.id,
        notes,
      },
    };

    if (!order.statusHistory) order.statusHistory = [];
    order.statusHistory.push(auditEntry);
    this.auditHistory.push(auditEntry);

    this.saveOrders();
    this.saveAudit();

    return { success: true, order };
  }

  // ==========================================
  // CONFIRMACIÓN DE DEVOLUCIÓN FÍSICA A BODEGA
  // ==========================================

  public confirmPhysicalReturn(
    orderId: string,
    inspectorName: string,
    catalogProducts: Product[],
    notes?: string
  ): { success: boolean; order?: Order; error?: string } {
    const order = this.orders.find(o => o.id === orderId || o.orderNumber === orderId);
    if (!order) return { success: false, error: 'Pedido no encontrado' };

    if (!order.physicalReturnPending && !order.childShipments?.some(c => c.physicalReturnPending)) {
      return { success: false, error: 'Este pedido no tiene devoluciones físicas pendientes de confirmación.' };
    }

    const nowIso = new Date().toISOString();
    order.physicalReturnPending = false;
    order.physicalReturnConfirmedAt = nowIso;
    order.physicalReturnConfirmedBy = inspectorName;

    // Liberar reserva física en catálogo tras corroborar inspección de estado del producto
    if (catalogProducts) {
      for (const item of order.items) {
        const prod = catalogProducts.find(p => p.id === item.productId);
        if (prod && prod.reservedStockByStore) {
          prod.reservedStockByStore[order.storeId] = Math.max(0, (prod.reservedStockByStore[order.storeId] || 0) - item.quantity);
        }
      }
    }

    if (order.childShipments) {
      order.childShipments.forEach(c => {
        c.physicalReturnPending = false;
        c.physicalReturnConfirmedAt = nowIso;
        c.physicalReturnConfirmedBy = inspectorName;
      });
    }

    const auditEntry: OrderStatusHistoryEntry = {
      id: `HIST-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`,
      orderId: order.id,
      previousStatus: order.fulfillmentStatus,
      newStatus: order.fulfillmentStatus,
      timestamp: nowIso,
      actor: { role: 'BODEGA', name: inspectorName },
      reason: `Devolución física inspeccionada y reingresada a inventario disponible. Notas: ${notes || 'Mercancía en perfecto estado.'}`,
      metadata: { physicalReturnCleared: true },
    };

    order.statusHistory?.push(auditEntry);
    this.auditHistory.push(auditEntry);

    this.saveOrders();
    this.saveAudit();

    return { success: true, order };
  }

  // ==========================================
  // ASIGNACIÓN DE CONDUCTOR
  // ==========================================

  public assignDriver(
    orderId: string,
    driverId: string,
    actor: OrderActor,
    shipmentId?: string
  ): { success: boolean; order?: Order; childShipment?: ChildShipment; error?: string; code?: number } {
    const order = this.orders.find(o => o.id === orderId || o.orderNumber === orderId);
    if (!order) return { success: false, error: 'Pedido no encontrado', code: 404 };

    const driver = this.drivers.find(d => d.id === driverId) || this.drivers[0];
    const driverPayload = {
      id: driver.id,
      name: driver.name,
      phone: driver.phone,
      vehiclePlate: driver.vehiclePlate,
      vehicleType: driver.vehicleType,
      rating: driver.rating,
      photo: driver.photo,
    };

    const nowIso = new Date().toISOString();

    if (order.isSplitOrder && order.childShipments && shipmentId) {
      const child = order.childShipments.find(s => s.shipmentId === shipmentId);
      if (!child) return { success: false, error: `Envío hijo no encontrado: ${shipmentId}`, code: 404 };

      child.driver = driverPayload;
      return this.transitionStatus(orderId, 'REPARTIDOR_ASIGNADO', actor, {
        shipmentId,
        reason: `Conductor ${driver.name} asignado al envío hijo ${child.shipmentIndex}`,
      });
    }

    order.driver = driverPayload;
    return this.transitionStatus(orderId, 'REPARTIDOR_ASIGNADO', actor, {
      reason: `Conductor ${driver.name} asignado al pedido ${order.orderNumber}`,
    });
  }

  // ==========================================
  // CONFIRMACIÓN DE RECOGIDA (PICKUP) EN HUB
  // ==========================================

  public confirmPickup(
    orderId: string,
    actor: OrderActor,
    shipmentId?: string
  ): { success: boolean; order?: Order; childShipment?: ChildShipment; error?: string; code?: number } {
    return this.transitionStatus(orderId, 'EN_CAMINO', actor, {
      shipmentId,
      reason: 'Recogida física verificada en bodega con precintos intactos. Inicio de recorrido.',
    });
  }

  // ==========================================
  // VERIFICACIÓN DE ENTREGA CON PIN SECRETO
  // ==========================================

  public verifyDelivery(
    orderId: string,
    deliveryCode: string,
    actor: OrderActor,
    shipmentId?: string,
    catalogProducts?: Product[]
  ): { success: boolean; order?: Order; childShipment?: ChildShipment; error?: string; code?: number } {
    return this.transitionStatus(orderId, 'ENTREGADO', actor, {
      shipmentId,
      deliveryCode,
      catalogProducts,
      reason: 'Entrega física completada y verificada mediante PIN secreto de 4 dígitos suministrado por el cliente.',
    });
  }

  // ==========================================
  // REPORTE DE INCIDENCIA
  // ==========================================

  public reportIncident(
    orderId: string,
    actor: OrderActor,
    incidentType: string,
    description: string,
    shipmentId?: string
  ): { success: boolean; order?: Order; error?: string } {
    const order = this.orders.find(o => o.id === orderId || o.orderNumber === orderId);
    if (!order) return { success: false, error: 'Pedido no encontrado' };

    const incident = {
      id: `INC-${Date.now()}`,
      type: incidentType,
      description,
      createdAt: new Date().toISOString(),
      resolved: false,
    };

    if (!order.incidents) order.incidents = [];
    order.incidents.push(incident);

    return this.transitionStatus(orderId, 'CON_INCIDENCIA', actor, {
      shipmentId,
      reason: `Novedad reportada: [${incidentType}] ${description}`,
    });
  }

  // ==========================================
  // MÉTODOS AUXILIARES
  // ==========================================

  private recalculateParentOrderStatus(order: Order, nowIso: string) {
    if (!order.childShipments || order.childShipments.length === 0) return;

    const children = order.childShipments;
    const allDelivered = children.every(c => c.fulfillmentStatus === 'ENTREGADO');
    const allCancelled = children.every(c => c.fulfillmentStatus === 'CANCELADO');

    if (allDelivered) {
      order.fulfillmentStatus = 'ENTREGADO';
      order.timestamps.deliveredAt = nowIso;
      if (order.payment.method === 'CASH_ON_DELIVERY') {
        order.payment.cashSettled = true;
        order.payment.status = 'APROBADO';
      }
    } else if (allCancelled) {
      order.fulfillmentStatus = 'CANCELADO';
      order.timestamps.cancelledAt = nowIso;
    } else if (children.some(c => c.fulfillmentStatus === 'EN_CAMINO')) {
      order.fulfillmentStatus = 'EN_CAMINO';
    } else if (children.some(c => c.fulfillmentStatus === 'REPARTIDOR_ASIGNADO')) {
      order.fulfillmentStatus = 'REPARTIDOR_ASIGNADO';
    } else if (children.some(c => c.fulfillmentStatus === 'LISTO_PARA_DESPACHO')) {
      order.fulfillmentStatus = 'LISTO_PARA_DESPACHO';
    } else if (children.some(c => c.fulfillmentStatus === 'EN_ALISTAMIENTO')) {
      order.fulfillmentStatus = 'EN_ALISTAMIENTO';
    }
  }

  private validateRolePermission(actor: OrderActor, newStatus: FulfillmentStatus): boolean {
    // SISTEMA y ADMINISTRADOR tienen permiso universal sobre el ciclo operativo
    if (actor.role === 'SISTEMA' || actor.role === 'ADMINISTRADOR') return true;

    const allowedRoles = ROLE_PERMISSIONS[newStatus] || [];
    return allowedRoles.includes(actor.role);
  }

  // ==========================================
  // GESTIÓN Y PERSISTENCIA DE TELEMETRÍA GPS REAL
  // ==========================================

  public recordTelemetry(
    point: GPSTelemetry,
    actor: OrderActor
  ): { success: boolean; code?: number; error?: string; point?: GPSTelemetry } {
    if (!point || !point.orderId) {
      return { success: false, code: 400, error: 'Identificador de pedido obligatorio en telemetría' };
    }

    const order = this.orders.find(o => o.id === point.orderId || o.orderNumber === point.orderId);
    if (!order) {
      return { success: false, code: 404, error: `Pedido no encontrado: ${point.orderId}` };
    }

    // Identificar la entidad objetivo (pedido completo o envío hijo de orden dividida)
    let targetStatus: FulfillmentStatus = order.fulfillmentStatus;
    let expectedDriverId = order.driver?.id;
    let expectedAssignmentId = order.assignmentId;
    let expectedTripId = order.tripId;

    if (point.shipmentId && order.childShipments && order.childShipments.length > 0) {
      const child = order.childShipments.find(c => c.shipmentId === point.shipmentId);
      if (!child) {
        return { success: false, code: 404, error: `Envío hijo no encontrado: ${point.shipmentId}` };
      }
      targetStatus = child.fulfillmentStatus;
      expectedDriverId = child.driver?.id || expectedDriverId;
      expectedAssignmentId = child.assignmentId || expectedAssignmentId;
      expectedTripId = child.tripId || expectedTripId;
    }

    // 1. Validación de ciclo de vida: Solo se permite telemetría activa en estado EN_CAMINO
    if (targetStatus === 'ENTREGADO') {
      return {
        success: false,
        code: 400,
        error: 'No se puede registrar telemetría de un pedido ya entregado. El recorrido ha finalizado.',
      };
    }
    if (targetStatus === 'CANCELADO') {
      return {
        success: false,
        code: 400,
        error: 'El pedido fue cancelado. El recorrido ha finalizado.',
      };
    }
    if (targetStatus !== 'EN_CAMINO') {
      return {
        success: false,
        code: 400,
        error: `El pedido está en estado ${targetStatus}. La transmisión GPS solo se permite en estado EN_CAMINO.`,
      };
    }

    // 2. Validación de autorización del conductor
    if (actor.role === 'CONDUCTOR') {
      const currentActorId = actor.id || point.driverId;
      if (currentActorId && expectedDriverId && currentActorId !== expectedDriverId) {
        return {
          success: false,
          code: 403,
          error: `Conductor no autorizado (${currentActorId}). El envío está asignado a ${expectedDriverId}.`,
        };
      }
    } else if (actor.role !== 'SISTEMA' && actor.role !== 'ADMINISTRADOR' && actor.role !== 'COORDINADOR') {
      return {
        success: false,
        code: 403,
        error: `Rol no autorizado (${actor.role}) para emitir coordenadas de telemetría.`,
      };
    }

    // Validar asignación y viaje si están definidos
    if (expectedAssignmentId && point.assignmentId && point.assignmentId !== expectedAssignmentId) {
      return {
        success: false,
        code: 400,
        error: `Asignación no coincide: recibido ${point.assignmentId}, esperado ${expectedAssignmentId}.`,
      };
    }
    if (expectedTripId && point.tripId && point.tripId !== expectedTripId) {
      return {
        success: false,
        code: 400,
        error: `Identificador de viaje no coincide: recibido ${point.tripId}, esperado ${expectedTripId}.`,
      };
    }

    // 3. Validación de coordenadas dentro de la cobertura metropolitana de Bogotá
    // Límites estrictos: Latitud 4.4000 a 4.9000, Longitud -74.3000 a -73.9000
    if (
      typeof point.latitude !== 'number' ||
      typeof point.longitude !== 'number' ||
      isNaN(point.latitude) ||
      isNaN(point.longitude) ||
      point.latitude < 4.40 ||
      point.latitude > 4.90 ||
      point.longitude < -74.30 ||
      point.longitude > -73.90
    ) {
      return {
        success: false,
        code: 400,
        error: `Coordenadas GPS (${point.latitude}, ${point.longitude}) fuera del perímetro de cobertura de Bogotá (4.40 a 4.90 lat, -74.30 a -73.90 lng).`,
      };
    }

    // 4. Validación de precisión del sensor GPS
    if (typeof point.accuracy !== 'number' || isNaN(point.accuracy) || point.accuracy < 0 || point.accuracy > 200) {
      return {
        success: false,
        code: 400,
        error: `Precisión GPS insuficiente (${point.accuracy}m). Se rechazan lecturas con error superior a 200m.`,
      };
    }

    // 5. Validación de orden cronológico y secuencia ascendente
    const streamKey = point.shipmentId ? `${order.id}:${point.shipmentId}` : order.id;
    const history = this.telemetryHistory[streamKey] || [];

    if (history.length > 0) {
      const lastPoint = history[history.length - 1];

      // Rechazar secuencias fuera de orden o duplicadas
      if (point.sequenceNumber <= lastPoint.sequenceNumber) {
        return {
          success: false,
          code: 409,
          error: `Número de secuencia duplicado o retrasado: recibido #${point.sequenceNumber}, último registrado #${lastPoint.sequenceNumber}.`,
        };
      }

      // Rechazar marcas temporales regresivas
      if (point.timestamp < lastPoint.timestamp) {
        return {
          success: false,
          code: 400,
          error: `Marca temporal regresiva: timestamp recibido (${point.timestamp}) es anterior al último registrado (${lastPoint.timestamp}).`,
        };
      }
    }

    const pointWithId: GPSTelemetry = {
      ...point,
      pointId: point.pointId || `GPS-${Date.now()}-${point.sequenceNumber}`,
      driverId: point.driverId || expectedDriverId || 'DRV-CARLOS-01',
      assignmentId: point.assignmentId || expectedAssignmentId || `ASG-${order.id}`,
      tripId: point.tripId || expectedTripId || `TRP-${order.id}`,
    };

    if (!this.telemetryHistory[streamKey]) {
      this.telemetryHistory[streamKey] = [];
    }
    this.telemetryHistory[streamKey].push(pointWithId);

    // Si es un envío hijo, guardar también bajo la orden general para compatibilidad
    if (point.shipmentId && !this.telemetryHistory[order.id]) {
      this.telemetryHistory[order.id] = [pointWithId];
    } else if (point.shipmentId) {
      this.telemetryHistory[order.id].push(pointWithId);
    }

    // Actualizar ubicación física del conductor en su perfil
    const driverIdToUpdate = pointWithId.driverId;
    const driver = this.drivers.find(d => d.id === driverIdToUpdate);
    if (driver) {
      driver.currentLocation = {
        lat: pointWithId.latitude,
        lng: pointWithId.longitude,
        heading: pointWithId.heading,
        speed: pointWithId.speed,
        updatedAt: new Date(pointWithId.timestamp || Date.now()).toISOString(),
      };
      this.saveDrivers();
    }

    this.saveTelemetry();
    return { success: true, point: pointWithId };
  }

  public getLatestTelemetry(orderId: string, shipmentId?: string): GPSTelemetry | null {
    const streamKey = shipmentId ? `${orderId}:${shipmentId}` : orderId;
    const history = this.telemetryHistory[streamKey];
    if (history && history.length > 0) {
      return history[history.length - 1];
    }
    return null;
  }

  public getTelemetryHistory(orderId: string, shipmentId?: string): GPSTelemetry[] {
    const streamKey = shipmentId ? `${orderId}:${shipmentId}` : orderId;
    const history = this.telemetryHistory[streamKey];
    if (history && history.length > 0) {
      return [...history];
    }
    return [];
  }
}

export const ordersRepository = new OrdersRepository();
