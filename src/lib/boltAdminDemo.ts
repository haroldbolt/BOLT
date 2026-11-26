import type { Order, OrderItem, Product, Store } from '../types';
import type { TransportAttributes, TransportVehicle } from '../types/transport';
import { generateScheduledSlots } from './deliveryService';
import { DispatchError, type DispatchService } from './dispatchService';
import { pendingDeliveryOrder } from './pendingDeliveryOrder';
import type { TransportContext } from './transportPlanner';

export const BOLT_ADMIN_DEMO_PRODUCT_ID = 'SIM-BOLT-ADMIN-SUBA';
export const BOLT_ADMIN_DEMO_STORE_ID = 'HUB_SUBA';
const fingerprints = {
  PROGRAMADO: 'BOLT_ADMIN_SUBA_SIMULATION_V1',
  TURBO: 'BOLT_ADMIN_SUBA_SIMULATION_V1_TURBO',
} as const;
export type BoltAdminDemoMode = keyof typeof fingerprints;
const keyPrefix = 'bolt-admin-suba-';
const customerKeyPrefix = 'bolt-customer-suba-';
const customerFingerprint = 'BOLT_CUSTOMER_SUBA_SIMULATION_V1';
const customerDemoAddress: Order['deliveryAddress'] = {
  address: 'Calle 144 #104-32, Suba, Bogotá',
  coordinates: { lat: 4.7488, lng: -74.0872 },
  municipality: 'Bogotá',
  locality: 'Suba',
  details: 'Dirección ficticia de la simulación BOLT Cliente.',
  porteriaPolicy: 'SUBIR_A_PUERTA',
};

export function isBoltCustomerDemoOrder(order: Order | undefined): order is Order & { creationRequestFingerprint: typeof customerFingerprint } {
  return !!order && order.creationRequestFingerprint === customerFingerprint &&
    !!order.creationRequestId?.startsWith(customerKeyPrefix) && isSubaFixture(order);
}

function isSubaFixture(order: Order) {
  return order.storeId === BOLT_ADMIN_DEMO_STORE_ID && order.items.length === 1 &&
    order.items[0].productId === BOLT_ADMIN_DEMO_PRODUCT_ID;
}

export function boltAdminDemoProduct(): Product {
  const transport: TransportAttributes = {
    weightGrams: 1000,
    packagingGrams: 100,
    dimensionsCm: [25, 18, 10],
    bulky: false,
    lightMarginEligible: false,
  };
  return {
    id: BOLT_ADMIN_DEMO_PRODUCT_ID,
    sku: BOLT_ADMIN_DEMO_PRODUCT_ID,
    name: 'Alimento de prueba BOLT Admin',
    brand: 'BOLT · Simulación',
    species: 'Perro',
    category: 'Alimentos',
    requiresPrescription: false,
    storageCondition: 'TEMPERATURA_AMBIENTE',
    temperatureColdChain: false,
    price: 25000,
    presentation: 'Bolsa de 1 kg',
    weightKg: 1,
    image: '',
    description: 'Producto ficticio para verificar reservas y confirmación en Suba.',
    stockByStore: { [BOLT_ADMIN_DEMO_STORE_ID]: 100 },
    reservedStockByStore: { [BOLT_ADMIN_DEMO_STORE_ID]: 0 },
    rating: 0,
    reviewsCount: 0,
    tags: ['SIMULACIÓN'],
    // The storefront and public order endpoints must not sell this item.
    status: 'INACTIVE',
    bodegaIds: [BOLT_ADMIN_DEMO_STORE_ID],
    transport,
    presentaciones: [{
      varianteId: BOLT_ADMIN_DEMO_PRODUCT_ID + '-1KG',
      nombre: '1 kg',
      sku: BOLT_ADMIN_DEMO_PRODUCT_ID,
      foto: '',
      bodegaIds: [BOLT_ADMIN_DEMO_STORE_ID],
      transport,
    }],
  };
}

export function isBoltAdminDemoOrder(order: Order | undefined): order is Order {
  return isBoltCustomerDemoOrder(order) || (!!order &&
    (order.creationRequestFingerprint === fingerprints.PROGRAMADO || order.creationRequestFingerprint === fingerprints.TURBO) &&
    !!order.creationRequestId?.startsWith(keyPrefix) && isSubaFixture(order));
}

export function activateBoltAdminDemoProduct(order: Order, product: Product): Product {
  return isBoltAdminDemoOrder(order) && product.id === BOLT_ADMIN_DEMO_PRODUCT_ID
    ? { ...product, status: 'ACTIVE' }
    : product;
}

function demoScenario(catalog: Product[], store: Store | undefined, quantity: number) {
  const product = catalog.find(item => item.id === BOLT_ADMIN_DEMO_PRODUCT_ID);
  if (!product || store?.id !== BOLT_ADMIN_DEMO_STORE_ID || !store.isActive) {
    throw new DispatchError(409, 'SIMULATION_UNAVAILABLE', 'El escenario de prueba de Suba no está disponible.');
  }
  const item: OrderItem = {
    productId: product.id,
    sku: product.sku,
    name: product.name,
    brand: product.brand,
    presentation: product.presentation,
    price: product.price,
    quantity,
    image: product.image,
    weightKg: product.weightKg,
    requiresPrescription: false,
  };
  return { store, item };
}

export function boltCustomerDemoCheckout(catalog: Product[], selectedStore: Store | undefined) {
  const { item, store } = demoScenario(catalog, selectedStore, 1);
  return {
    enabled: true,
    storeId: store.id,
    storeName: store.name,
    deliveryMode: 'TURBO' as const,
    items: [item],
    address: customerDemoAddress.address,
    subtotalCOP: item.price,
    cashToCollect: 0,
  };
}

export function createBoltAdminDemoOrder(input: {
  requestId: string | undefined;
  requestedMode?: BoltAdminDemoMode;
  origin?: 'customer';
  checkoutAttemptVerifier?: string;
  catalog: Product[];
  store: Store | undefined;
  dispatch: Pick<DispatchService, 'createOrder'>;
}): Order {
  const { requestId, requestedMode = 'PROGRAMADO', catalog, dispatch } = input;
  const customerCheckout = input.origin === 'customer';
  // Replaying this request returns a private tracking capability. Require a random UUID for the public checkout.
  const validKey = customerCheckout
    ? /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    : /^[A-Za-z0-9_-]{10,100}$/;
  if (!requestId || !validKey.test(requestId)) {
    throw new DispatchError(400, 'IDEMPOTENCY_REQUIRED', 'Vuelve a intentar crear el pedido con un identificador válido.');
  }
  const { store, item } = demoScenario(catalog, input.store, customerCheckout ? 1 : 2);
  const order = pendingDeliveryOrder({
    items: [item],
    customer: {
      name: 'Cliente de prueba Suba',
      email: 'bolt-admin-suba@example.invalid',
      phone: '0000000000',
      isGuest: true,
    },
    // Use fixed destinations with verified coverage for each demo entry point.
    address: customerCheckout ? customerDemoAddress : {
      address: 'Calle 150 #16-56, Cedritos, Bogotá',
      coordinates: { lat: 4.731531, lng: -74.041785 },
      municipality: 'Bogotá',
      locality: 'Usaquén',
      details: 'Pedido ficticio del panel BOLT Admin.',
      porteriaPolicy: 'SUBIR_A_PUERTA',
    },
    store,
    requestedMode: customerCheckout ? 'TURBO' : requestedMode,
    creationRequestId: (customerCheckout ? customerKeyPrefix : keyPrefix) + requestId,
    checkoutAttemptVerifier: input.checkoutAttemptVerifier,
    creationRequestFingerprint: customerCheckout ? customerFingerprint : fingerprints[requestedMode],
  });
  if (customerCheckout && order.deliveryReview) order.deliveryReview.reasonCode = 'DEMO_CONFIRMATION_REQUIRED';
  const result = dispatch.createOrder(order, catalog.map(p => activateBoltAdminDemoProduct(order, p)), store);
  if (!result.success || !result.order || !isBoltAdminDemoOrder(result.order)) {
    throw new DispatchError(409, result.code || 'SIMULATION_ORDER_FAILED', result.error || 'No se pudo registrar el pedido de prueba.');
  }
  return result.order;
}

const customerDriverPrefix = 'SIM-BOLT-CLIENT-';

export function isBoltCustomerDemoDriver(driverId: string) {
  return driverId.startsWith(customerDriverPrefix);
}

export function boltCustomerDemoVehicle(order: Order): TransportVehicle | undefined {
  return isBoltCustomerDemoOrder(order) ? demoVehicle(customerDriverPrefix + order.id, ['TURBO']) : undefined;
}

function demoVehicle(driverId: string, modes: TransportVehicle['modes']): TransportVehicle {
  return {
    driverId,
    storeIds: [BOLT_ADMIN_DEMO_STORE_ID],
    enabled: true,
    modes,
    maxLoadGrams: 5000,
    packagingGrams: 200,
    cargoDimensionsCm: [60, 40, 35],
    maxVolumeCm3: 84000,
    scheduledSlots: modes.includes('PROGRAMADO') ? generateScheduledSlots().map(slot => `${slot.date}|${slot.slotId}`) : [],
  };
}

export function boltAdminDemoReviewContext(order: Order | undefined, context: TransportContext): TransportContext {
  if (!isBoltAdminDemoOrder(order)) return context;
  // The quote uses capacity for this fixture alone.
  const vehicle = boltCustomerDemoVehicle(order) ?? demoVehicle('SIM-BOLT-ADMIN-' + order.id, ['PROGRAMADO']);
  const driverId = vehicle.driverId;
  return {
    ...context,
    config: { ...context.config, maxDispatches: 1, vehicles: [vehicle], externalProviders: [] },
    drivers: [{
      id: driverId,
      name: 'Vehículo de prueba BOLT Admin',
      phone: '0000000000',
      vehiclePlate: 'SIMULADO',
      vehicleType: 'CARRO',
      maxWeightKg: 5,
      rating: 0,
      photo: '',
      operationalEligible: true,
      isOnline: true,
      currentStatus: 'DISPONIBLE',
      currentLocation: { ...order.deliveryAddress.coordinates, updatedAt: order.createdAt },
      cashBalance: 0,
    }],
  };
}
