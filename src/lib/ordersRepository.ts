import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
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

export interface OrdersRepositoryOptions {
  dataDir?: string;
  initialOrders?: Order[];
  initialDrivers?: DriverProfile[];
}

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
  private readonly dataDir: string;
  private readonly stateFile: string;
  private readonly initialOrders: Order[];
  private readonly initialDrivers: DriverProfile[];
  private mutationDepth = 0;
  private persistencePending = false;
  private persistenceAdapter?: { read: () => any; write: (state: unknown) => void };
  private listeners = new Set<() => void>();

  /** Migra el estado privado existente una sola vez al mismo SQLite que el inventario. */
  public connectPersistence(adapter: { read: () => any; write: (state: unknown) => void }) {
    const stored = adapter.read();
    if (stored) {
      if (stored.version !== 1 || !Array.isArray(stored.orders) || !Array.isArray(stored.drivers) || !Array.isArray(stored.auditHistory) || !stored.telemetryHistory) throw new Error('La base de datos operativa no es válida.');
      this.orders = stored.orders;
      this.drivers = stored.drivers;
      this.auditHistory = stored.auditHistory;
      this.telemetryHistory = stored.telemetryHistory;
    }
    this.persistenceAdapter = adapter;
    this.saveState();
  }

  public subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }

  public updateOrder(id: string, update: (order: Order) => void): Order | undefined {
    return this.mutate(() => {
      const order = this.getOrderById(id);
      if (!order) return undefined;
      update(order);
      this.saveState();
      return order;
    });
  }

  public updateDriver(id: string, update: (driver: DriverProfile) => void): DriverProfile | undefined {
    return this.mutate(() => {
      const driver = this.getDriverById(id);
      if (!driver) return undefined;
      update(driver);
      this.saveState();
      return driver;
    });
  }

  constructor(options: OrdersRepositoryOptions = {}) {
    this.dataDir = path.resolve(options.dataDir || process.env.BOLT_DATA_DIR || path.join(process.cwd(), '.bolt-private/operations'));
    this.stateFile = path.join(this.dataDir, 'operations-state.json');
    this.initialOrders = options.initialOrders ?? [];
    this.initialDrivers = options.initialDrivers ?? [];
    this.init();
  }

  /**
   * Carga los datos desde el almacenamiento persistente en disco o desde los datos semilla
   */
  public init() {
    fs.mkdirSync(this.dataDir, { recursive: true, mode: 0o700 });
    if (fs.existsSync(this.stateFile)) {
      const state = JSON.parse(fs.readFileSync(this.stateFile, 'utf-8'));
      if (state.version !== 1 || !Array.isArray(state.orders) || !Array.isArray(state.drivers) || !Array.isArray(state.auditHistory) || !state.telemetryHistory || typeof state.telemetryHistory !== 'object') {
        throw new Error('Estado operativo inválido. Se conserva el archivo para recuperación; no se reemplaza por datos de demostración.');
      }
      this.orders = state.orders;
      this.drivers = state.drivers;
      this.auditHistory = state.auditHistory;
      this.telemetryHistory = state.telemetryHistory;
    } else {
      // Migración únicamente desde la carpeta privada configurada, nunca desde public o src/data.
      const readLegacy = <T,>(name: string, initial: T): T => {
        const file = path.join(this.dataDir, name);
        return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf-8')) : structuredClone(initial);
      };
      this.orders = readLegacy('persisted-orders.json', this.initialOrders);
      this.drivers = readLegacy('persisted-drivers.json', this.initialDrivers);
      this.auditHistory = readLegacy('persisted-audit.json', []);
      this.telemetryHistory = readLegacy('persisted-telemetry.json', {});
      if (!Array.isArray(this.orders) || !Array.isArray(this.drivers) || !Array.isArray(this.auditHistory) || !this.telemetryHistory || typeof this.telemetryHistory !== 'object') {
        throw new Error('Los archivos privados de migración tienen una estructura inválida.');
      }
    }
    // Una clave de padre de versiones anteriores podía contener puntos de distintos hijos.
    for (const order of this.orders) {
      if (order.isSplitOrder && order.childShipments?.length) delete this.telemetryHistory[order.id];
    }
    this.normalizeInitialState();
    this.saveState();
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

  private saveState() {
    if (this.mutationDepth > 0) {
      this.persistencePending = true;
      return;
    }
    this.writeState();
  }

  private writeState() {
    if (this.persistenceAdapter) {
      this.persistenceAdapter.write({ version: 1, orders: this.orders, drivers: this.drivers, auditHistory: this.auditHistory, telemetryHistory: this.telemetryHistory });
      for (const listener of this.listeners) { try { listener(); } catch { /* Un visor desconectado no revierte una operación confirmada. */ } }
      return;
    }
    // Un solo reemplazo atómico mantiene pedidos, auditoría y GPS en la misma versión.
    const temporary = path.join(this.dataDir, `.operations-${process.pid}-${randomUUID()}.tmp`);
    try {
      fs.writeFileSync(temporary, JSON.stringify({
        version: 1,
        orders: this.orders,
        drivers: this.drivers,
        auditHistory: this.auditHistory,
        telemetryHistory: this.telemetryHistory,
      }, null, 2), { encoding: 'utf-8', mode: 0o600 });
      fs.renameSync(temporary, this.stateFile);
    } finally {
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    }
  }

  private saveOrders() { this.saveState(); }

  private mutate<T>(operation: () => T, catalogProducts?: Product[]): T {
    const previous = structuredClone({ orders: this.orders, drivers: this.drivers, auditHistory: this.auditHistory, telemetryHistory: this.telemetryHistory });
    const inventory = catalogProducts?.map(product => ({ product, stock: structuredClone(product.stockByStore), reserved: structuredClone(product.reservedStockByStore) }));
    const previousPending = this.persistencePending;
    const restore = () => {
      this.orders = previous.orders;
      this.drivers = previous.drivers;
      this.auditHistory = previous.auditHistory;
      this.telemetryHistory = previous.telemetryHistory;
      this.persistencePending = previousPending;
      for (const entry of inventory || []) {
        for (const key of Object.keys(entry.product.stockByStore)) delete entry.product.stockByStore[key];
        Object.assign(entry.product.stockByStore, entry.stock);
        for (const key of Object.keys(entry.product.reservedStockByStore)) delete entry.product.reservedStockByStore[key];
        Object.assign(entry.product.reservedStockByStore, entry.reserved);
      }
    };
    this.mutationDepth++;
    try {
      const result = operation();
      if (result && typeof result === 'object' && 'success' in result && result.success === false) {
        restore();
        return result;
      }
      // Métodos anidados solo marcan dirty: un único rename confirma la operación exterior.
      if (this.mutationDepth === 1 && this.persistencePending) {
        this.writeState();
        this.persistencePending = false;
      }
      return result;
    } catch (error) {
      restore();
      throw error;
    } finally {
      this.mutationDepth--;
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
    return this.mutate(() => this.createOrderMutation(orderData, catalogProducts), catalogProducts);
  }

  private createOrderMutation(orderData: Order, catalogProducts?: Product[]): { success: boolean; order?: Order; error?: string } {
    // 1. Validar que no exista un pedido con el mismo ID
    if (this.orders.some(o => o.id === orderData.id)) {
      return { success: false, error: `Pedido duplicado: ya existe un pedido con ID ${orderData.id}` };
    }

    if (!Array.isArray(orderData.items) || orderData.items.length === 0) {
      return { success: false, error: 'El pedido debe contener al menos un producto.' };
    }
    const quantities = new Map<string, number>();
    for (const item of orderData.items) {
      if (!item.productId || !Number.isSafeInteger(item.quantity) || item.quantity <= 0) {
        return { success: false, error: 'Cada cantidad debe ser un entero positivo válido.' };
      }
      const total = (quantities.get(item.productId) || 0) + item.quantity;
      if (!Number.isSafeInteger(total)) return { success: false, error: 'Cantidad total fuera del rango permitido.' };
      quantities.set(item.productId, total);
    }

    // Comprobar todas las líneas agrupadas antes de aplicar una sola reserva por producto.
    if (catalogProducts) {
      for (const [productId, quantity] of quantities) {
        const prod = catalogProducts.find(p => p.id === productId);
        if (!prod) {
          return { success: false, error: `Producto no encontrado en catálogo: ${productId}` };
        }
        const currentStock = prod.stockByStore[orderData.storeId] ?? 0;
        const currentReserved = prod.reservedStockByStore?.[orderData.storeId] ?? 0;
        if (prod.status && prod.status !== 'ACTIVE') return { success: false, error: `El producto ${prod.name} está retirado de la venta.` };
        if (!Number.isSafeInteger(currentStock) || !Number.isSafeInteger(currentReserved) || currentStock < 0 || currentReserved < 0) {
          return { success: false, error: `Inventario inválido para ${prod.name}.` };
        }
        const availableToSell = currentStock - currentReserved;

        if (availableToSell < quantity) {
          return {
            success: false,
            error: `Inventario insuficiente para ${prod.name} en la bodega seleccionada. Disponibles: ${Math.max(0, availableToSell)}`,
          };
        }
      }

      // Aplicar reserva atómica en los productos
      for (const [productId, quantity] of quantities) {
        const prod = catalogProducts.find(p => p.id === productId)!;
        if (!prod.reservedStockByStore) prod.reservedStockByStore = {};
        prod.reservedStockByStore[orderData.storeId] = (prod.reservedStockByStore[orderData.storeId] || 0) + quantity;
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
    this.saveState();

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
    return this.mutate(() => this.transitionStatusMutation(orderId, newStatus, actor, options), options?.catalogProducts);
  }

  private transitionStatusMutation(
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
    if (order.isSplitOrder && order.childShipments?.length && !shipmentId && newStatus !== 'CANCELADO') {
      return { success: false, code: 400, error: 'Los estados de un pedido dividido se confirman por envío hijo.' };
    }

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

      this.saveState();

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
      // El PIN confirma la entrega. La conciliación del efectivo necesita una
      // confirmación de cobro independiente; entregar no acredita un pago.

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

      const requiresPhysicalReturn = (status: FulfillmentStatus) => ['LISTO_PARA_DESPACHO', 'REPARTIDOR_ASIGNADO', 'EN_CAMINO', 'CON_INCIDENCIA'].includes(status);
      const release = (items: Order['items']) => {
        for (const item of items) {
          const prod = catalogProducts?.find(product => product.id === item.productId);
          if (prod?.reservedStockByStore) prod.reservedStockByStore[order.storeId] = Math.max(0, (prod.reservedStockByStore[order.storeId] || 0) - item.quantity);
        }
      };
      if (order.isSplitOrder && order.childShipments?.length) {
        // Cada hijo conserva sus unidades y su situación física, incluso al cancelar el padre.
        for (const child of order.childShipments) {
          if (child.fulfillmentStatus === 'ENTREGADO' || child.fulfillmentStatus === 'CANCELADO') continue;
          const returnPending = requiresPhysicalReturn(child.fulfillmentStatus);
          if (!returnPending) release(child.items);
          child.fulfillmentStatus = 'CANCELADO';
          child.timestamps.cancelledAt = nowIso;
          child.cancelReason = order.cancelReason;
          child.physicalReturnPending = returnPending;
        }
        order.physicalReturnPending = order.childShipments.some(child => child.physicalReturnPending);
      } else {
        order.physicalReturnPending = requiresPhysicalReturn(currentStatus);
        if (!order.physicalReturnPending) release(order.items);
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

    this.saveState();

    return { success: true, order };
  }

  // ==========================================
  // CONFIRMACIÓN DE DEVOLUCIÓN FÍSICA A BODEGA
  // ==========================================

  public confirmPhysicalReturn(
    orderId: string,
    inspectorName: string,
    catalogProducts: Product[],
    notes?: string,
    shipmentId?: string
  ): { success: boolean; order?: Order; error?: string } {
    return this.mutate(() => this.confirmPhysicalReturnMutation(orderId, inspectorName, catalogProducts, notes, shipmentId), catalogProducts);
  }

  private confirmPhysicalReturnMutation(
    orderId: string,
    inspectorName: string,
    catalogProducts: Product[],
    notes?: string,
    shipmentId?: string
  ): { success: boolean; order?: Order; error?: string } {
    const order = this.orders.find(o => o.id === orderId || o.orderNumber === orderId);
    if (!order) return { success: false, error: 'Pedido no encontrado' };

    if (!order.physicalReturnPending && !order.childShipments?.some(c => c.physicalReturnPending)) {
      return { success: false, error: 'Este pedido no tiene devoluciones físicas pendientes de confirmación.' };
    }

    const nowIso = new Date().toISOString();
    let returnedItems = order.items;
    if (order.isSplitOrder && order.childShipments?.length) {
      const pending = order.childShipments.filter(child => child.physicalReturnPending && child.fulfillmentStatus === 'CANCELADO');
      const child = shipmentId ? pending.find(child => child.shipmentId === shipmentId) : pending.length === 1 ? pending[0] : undefined;
      if (!child) return { success: false, error: shipmentId ? 'El envío seleccionado no tiene una devolución cancelada pendiente.' : 'Seleccione el envío cuya devolución física fue inspeccionada.' };
      returnedItems = child.items;
      child.physicalReturnPending = false;
      child.physicalReturnConfirmedAt = nowIso;
      child.physicalReturnConfirmedBy = inspectorName;
      order.physicalReturnPending = order.childShipments.some(entry => entry.physicalReturnPending);
      if (order.fulfillmentStatus === 'CANCELADO' && !order.physicalReturnPending) {
        order.physicalReturnConfirmedAt = nowIso;
        order.physicalReturnConfirmedBy = inspectorName;
      }
      shipmentId = child.shipmentId;
    } else {
      if (order.fulfillmentStatus !== 'CANCELADO') return { success: false, error: 'Solo se puede confirmar el retorno de un pedido cancelado.' };
      order.physicalReturnPending = false;
      order.physicalReturnConfirmedAt = nowIso;
      order.physicalReturnConfirmedBy = inspectorName;
    }

    // Liberar reserva física en catálogo tras corroborar inspección de estado del producto
    if (catalogProducts) {
      for (const item of returnedItems) {
        const prod = catalogProducts.find(p => p.id === item.productId);
        if (prod && prod.reservedStockByStore) {
          prod.reservedStockByStore[order.storeId] = Math.max(0, (prod.reservedStockByStore[order.storeId] || 0) - item.quantity);
        }
      }
    }

    const auditEntry: OrderStatusHistoryEntry = {
      id: `HIST-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`,
      orderId: order.id,
      shipmentId,
      previousStatus: order.fulfillmentStatus,
      newStatus: order.fulfillmentStatus,
      timestamp: nowIso,
      actor: { role: 'BODEGA', name: inspectorName },
      reason: `Devolución física inspeccionada y reingresada a inventario disponible. Notas: ${notes || 'Mercancía en perfecto estado.'}`,
      metadata: { physicalReturnCleared: true },
    };

    order.statusHistory?.push(auditEntry);
    this.auditHistory.push(auditEntry);

    this.saveState();

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

    const driver = this.drivers.find(d => d.id === driverId);
    if (!driver) return { success: false, error: 'Conductor no encontrado.', code: 404 };
    if (!this.validateRolePermission(actor, 'REPARTIDOR_ASIGNADO')) return { success: false, error: 'Rol no autorizado para asignar conductores.', code: 403 };
    const target = order.isSplitOrder && order.childShipments?.length
      ? order.childShipments.find(child => child.shipmentId === shipmentId)
      : order;
    if (!target) return { success: false, error: 'Seleccione un envío hijo válido para asignar conductor.', code: 400 };
    if (target.fulfillmentStatus !== 'REPARTIDOR_ASIGNADO' && !ALLOWED_TRANSITIONS[target.fulfillmentStatus]?.includes('REPARTIDOR_ASIGNADO')) {
      return { success: false, error: 'El envío no está listo para asignar un conductor.', code: 400 };
    }
    const driverPayload = {
      id: driver.id,
      name: driver.name,
      phone: driver.phone,
      vehiclePlate: driver.vehiclePlate,
      vehicleType: driver.vehicleType,
      rating: driver.rating,
      photo: driver.photo,
    };

    return this.mutate(() => {
      const previousDriver = target.driver;
      target.driver = driverPayload;
      const alreadyAssigned = target.fulfillmentStatus === 'REPARTIDOR_ASIGNADO';
      const result = this.transitionStatus(orderId, 'REPARTIDOR_ASIGNADO', actor, {
        shipmentId,
        reason: `Conductor ${driver.name} asignado al pedido ${order.orderNumber}`,
      });
      if (!result.success) target.driver = previousDriver;
      if (result.success && alreadyAssigned) this.saveState();
      return result;
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
    return this.mutate(() => {
      const order = this.orders.find(o => o.id === orderId || o.orderNumber === orderId);
      if (!order) return { success: false, error: 'Pedido no encontrado' };
      if (typeof incidentType !== 'string' || !incidentType.trim() || incidentType.length > 100 || typeof description !== 'string' || !description.trim() || description.length > 2000) return { success: false, error: 'Describe la incidencia con textos válidos.' };
      const incident = { id: `INC-${randomUUID()}`, type: incidentType, description, createdAt: new Date().toISOString(), resolved: false };
      if (!order.incidents) order.incidents = [];
      order.incidents.push(incident);
      const result = this.transitionStatus(orderId, 'CON_INCIDENCIA', actor, {
        shipmentId,
        reason: `Novedad reportada: [${incidentType}] ${description}`,
      });
      // Una incidencia nueva también se guarda si el envío ya estaba en
      // CON_INCIDENCIA y la transición de estado fue idempotente.
      if (result.success) this.saveState();
      return result;
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
      // También en envíos divididos el efectivo permanece pendiente de
      // conciliación; los códigos de entrega no acreditan pagos.
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
  ): { success: boolean; code?: number; error?: string; point?: GPSTelemetry; nextSequenceNumber?: number; duplicate?: boolean } {
    return this.mutate(() => this.recordTelemetryMutation(point, actor));
  }

  private recordTelemetryMutation(
    point: GPSTelemetry,
    actor: OrderActor
  ): { success: boolean; code?: number; error?: string; point?: GPSTelemetry; nextSequenceNumber?: number; duplicate?: boolean } {
    const nonEmpty = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0 && value.length <= 160;
    if (!point || !nonEmpty(point.orderId) || !nonEmpty(point.pointId) || !nonEmpty(point.driverId) || !nonEmpty(point.assignmentId) || !nonEmpty(point.tripId)) {
      return { success: false, code: 400, error: 'Telemetría incompleta: se requieren pointId, orderId, driverId, assignmentId y tripId.' };
    }
    if (!Number.isSafeInteger(point.sequenceNumber) || point.sequenceNumber <= 0 || !Number.isFinite(point.timestamp) || point.timestamp <= 0) {
      return { success: false, code: 400, error: 'La secuencia debe ser un entero positivo y la fecha de captura debe ser válida.' };
    }
    const order = this.orders.find(entry => entry.id === point.orderId || entry.orderNumber === point.orderId);
    if (!order) return { success: false, code: 404, error: 'Pedido no encontrado.' };
    let target: Order | ChildShipment = order;
    if (order.isSplitOrder && order.childShipments?.length) {
      if (!nonEmpty(point.shipmentId)) return { success: false, code: 400, error: 'Seleccione el envío hijo que transmite su ubicación.' };
      const child = order.childShipments.find(entry => entry.shipmentId === point.shipmentId);
      if (!child) return { success: false, code: 404, error: 'Envío hijo no encontrado.' };
      target = child;
    } else if (point.shipmentId) {
      return { success: false, code: 400, error: 'Este pedido no tiene el envío hijo indicado.' };
    }
    if (!target.driver?.id || point.driverId !== target.driver.id) {
      return { success: false, code: 403, error: 'El conductor del punto no coincide con el conductor asignado.' };
    }
    if (!actor || !['CONDUCTOR', 'SISTEMA', 'ADMINISTRADOR', 'COORDINADOR'].includes(actor.role)) {
      return { success: false, code: 403, error: 'Rol no autorizado para emitir telemetría.' };
    }
    if (actor.role === 'CONDUCTOR' && (!nonEmpty(actor.id) || actor.id !== target.driver.id)) {
      return { success: false, code: 403, error: 'El actor no corresponde al conductor asignado.' };
    }
    // Estas comprobaciones no sustituyen la autenticación del actor en el servidor HTTP.
    if (!target.assignmentId || point.assignmentId !== target.assignmentId || !target.tripId || point.tripId !== target.tripId) {
      return { success: false, code: 400, error: 'La asignación o el recorrido no corresponden al envío seleccionado.' };
    }
    if (!Number.isFinite(point.latitude) || !Number.isFinite(point.longitude) || point.latitude < 4.40 || point.latitude > 4.90 || point.longitude < -74.30 || point.longitude > -73.90) {
      return { success: false, code: 400, error: 'Coordenadas GPS fuera del perímetro de cobertura de Bogotá.' };
    }
    if (!Number.isFinite(point.accuracy) || point.accuracy < 0 || point.accuracy > 200) {
      return { success: false, code: 400, error: 'Precisión GPS insuficiente o inválida (máximo 200 metros).' };
    }
    for (const key of ['speed', 'heading', 'altitude', 'batteryLevel'] as const) {
      if (point[key] !== undefined && !Number.isFinite(point[key])) return { success: false, code: 400, error: 'La medición opcional de GPS debe ser finita.' };
    }
    if ((point.speed !== undefined && point.speed < 0) || (point.heading !== undefined && (point.heading < 0 || point.heading > 360)) || (point.batteryLevel !== undefined && (point.batteryLevel < 0 || point.batteryLevel > 100))) {
      return { success: false, code: 400, error: 'Medición GPS opcional fuera de rango.' };
    }
    const canonical: GPSTelemetry = { ...point, orderId: order.id };
    const identity = (entry: GPSTelemetry) => JSON.stringify([
      entry.pointId, entry.orderId, entry.shipmentId ?? null, entry.driverId, entry.assignmentId, entry.tripId,
      entry.latitude, entry.longitude, entry.accuracy, entry.timestamp, entry.sequenceNumber,
      entry.heading ?? null, entry.speed ?? null, entry.altitude ?? null, entry.batteryLevel ?? null,
    ]);
    const duplicate = Object.values(this.telemetryHistory).flat().find(entry => entry.pointId === point.pointId);
    if (duplicate) {
      if (identity(duplicate) !== identity(canonical)) return { success: false, code: 409, error: 'El identificador de punto ya se utilizó con otros datos.', nextSequenceNumber: this.getNextTelemetrySequence(order.id, point.shipmentId) };
      // Una confirmación perdida puede reintentarse después del cierre; nunca añade otro punto.
      return { success: true, point: duplicate, duplicate: true, nextSequenceNumber: this.getNextTelemetrySequence(order.id, point.shipmentId) };
    }
    if (target.fulfillmentStatus !== 'EN_CAMINO') {
      return { success: false, code: 400, error: 'La transmisión GPS solo se permite durante una entrega EN_CAMINO.' };
    }
    const now = Date.now();
    if (point.timestamp < now - 5 * 60_000 || point.timestamp > now + 30_000) {
      return { success: false, code: 400, error: 'La lectura GPS tiene más de cinco minutos o una fecha futura inválida.' };
    }
    const streamKey = point.shipmentId ? `${order.id}:${point.shipmentId}` : order.id;
    const history = this.telemetryHistory[streamKey] || [];
    const lastPoint = history[history.length - 1];
    if (lastPoint && point.sequenceNumber <= lastPoint.sequenceNumber) {
      return { success: false, code: 409, error: 'Secuencia de GPS duplicada o retrasada.', nextSequenceNumber: this.getNextTelemetrySequence(order.id, point.shipmentId) };
    }
    if (lastPoint && point.timestamp < lastPoint.timestamp) {
      return { success: false, code: 400, error: 'La fecha de captura es anterior a la última lectura de este recorrido.' };
    }
    this.telemetryHistory[streamKey] = [...history, canonical];
    const driver = this.drivers.find(entry => entry.id === point.driverId);
    if (driver) driver.currentLocation = { lat: point.latitude, lng: point.longitude, heading: point.heading, speed: point.speed, updatedAt: new Date(point.timestamp).toISOString() };
    this.saveState();
    return { success: true, point: canonical, nextSequenceNumber: point.sequenceNumber + 1 };
  }

  public getLatestTelemetry(orderId: string, shipmentId?: string): GPSTelemetry | null {
    const history = this.getTelemetryHistory(orderId, shipmentId);
    const order = this.getOrderById(orderId);
    const target = shipmentId ? order?.childShipments?.find(child => child.shipmentId === shipmentId) : order;
    if (!target?.driver?.id || !target.assignmentId || !target.tripId) return null;
    for (let index = history.length - 1; index >= 0; index--) {
      const point = history[index];
      if (point.driverId === target.driver.id && point.assignmentId === target.assignmentId && point.tripId === target.tripId) return point;
    }
    return null;
  }

  public getNextTelemetrySequence(orderId: string, shipmentId?: string): number {
    const history = this.getTelemetryHistory(orderId, shipmentId);
    return history.reduce((max, point) => Number.isSafeInteger(point.sequenceNumber) && point.sequenceNumber > max ? point.sequenceNumber : max, 0) + 1;
  }

  public getTelemetryHistory(orderId: string, shipmentId?: string): GPSTelemetry[] {
    const order = this.getOrderById(orderId);
    if (!order) return [];
    if (order.isSplitOrder && order.childShipments?.length) {
      if (!shipmentId || !order.childShipments.some(child => child.shipmentId === shipmentId)) return [];
    } else if (shipmentId) return [];
    const streamKey = shipmentId ? `${order.id}:${shipmentId}` : order.id;
    return [...(this.telemetryHistory[streamKey] || [])];
  }
}
