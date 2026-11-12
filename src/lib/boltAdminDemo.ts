import type { Order, OrderItem, Product, Store } from '../types';
import type { TransportAttributes, TransportVehicle } from '../types/transport';
import { generateScheduledSlots } from './deliveryService';
import { DispatchError, type DispatchService } from './dispatchService';
import { pendingDeliveryOrder } from './pendingDeliveryOrder';
import { catalogPhotoGallery, MAX_PRODUCT_GALLERY_PHOTOS, usableProductImage } from './productImages';
import type { TransportContext } from './transportPlanner';

export const BOLT_ADMIN_DEMO_PRODUCT_ID = 'SIM-BOLT-ADMIN-SUBA';
export const BOLT_ADMIN_DEMO_STORE_ID = 'HUB_SUBA';
export const BOLT_GALLERY_DEMO_PRODUCT_ID = 'SIM-BOLT-GALERIA-PAWISE';
const fingerprints = {
  PROGRAMADO: 'BOLT_ADMIN_SUBA_SIMULATION_V1',
  TURBO: 'BOLT_ADMIN_SUBA_SIMULATION_V1_TURBO',
} as const;
export type BoltAdminDemoMode = keyof typeof fingerprints;
const keyPrefix = 'bolt-admin-suba-';

export function boltGalleryDemoProduct(source: Product): Product {
  const bodegaIds = [BOLT_ADMIN_DEMO_STORE_ID, 'HUB_KENNEDY', 'HUB_ALAMOS'];
  const emptyStock = { HUB_SUBA: 0, HUB_KENNEDY: 0, HUB_ALAMOS: 0 };
  const previewPrice = 1000;
  const sourceVariants = (source.presentaciones ?? []).slice(0, MAX_PRODUCT_GALLERY_PHOTOS);
  const gallery = catalogPhotoGallery({
    image: source.image,
    gallery: [...(source.gallery ?? []), ...sourceVariants.map(variant => variant.foto)],
  }).slice(0, MAX_PRODUCT_GALLERY_PHOTOS);
  const presentaciones = sourceVariants.map((variant, index) => {
    const sku = `${BOLT_GALLERY_DEMO_PRODUCT_ID}-${String(index + 1).padStart(2, '0')}`;
    return {
      varianteId: sku,
      nombre: variant.nombre,
      sku,
      foto: usableProductImage(variant.foto) ? variant.foto : '',
      price: previewPrice,
      stockByStore: { ...emptyStock },
      reservedStockByStore: { ...emptyStock },
      bodegaIds: [...bodegaIds],
    };
  });
  return {
    id: BOLT_GALLERY_DEMO_PRODUCT_ID,
    sku: BOLT_GALLERY_DEMO_PRODUCT_ID,
    name: 'Prueba de galería BOLT · Collar Pawise',
    brand: 'BOLT · Simulación',
    species: source.species,
    category: source.category,
    requiresPrescription: false,
    storageCondition: source.storageCondition,
    temperatureColdChain: false,
    price: previewPrice,
    presentation: presentaciones[0]?.nombre ?? 'Referencia de prueba',
    weightKg: 0,
    image: gallery[0] ?? '',
    gallery,
    description: 'Referencia de prueba para revisar fotos y tallas en la demo. No está disponible para comprar.',
    stockByStore: { ...emptyStock },
    reservedStockByStore: { ...emptyStock },
    rating: 0,
    reviewsCount: 0,
    tags: [],
    status: 'ACTIVE',
    bodegaIds,
    presentaciones,
  };
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

export function isBoltAdminDemoOrder(order: Order | undefined): order is Order & { creationRequestFingerprint: typeof fingerprints[BoltAdminDemoMode] } {
  return !!order &&
    (order.creationRequestFingerprint === fingerprints.PROGRAMADO || order.creationRequestFingerprint === fingerprints.TURBO) &&
    !!order.creationRequestId?.startsWith(keyPrefix) &&
    order.storeId === BOLT_ADMIN_DEMO_STORE_ID &&
    order.items.length === 1 &&
    order.items[0].productId === BOLT_ADMIN_DEMO_PRODUCT_ID;
}

export function activateBoltAdminDemoProduct(order: Order, product: Product): Product {
  return isBoltAdminDemoOrder(order) && product.id === BOLT_ADMIN_DEMO_PRODUCT_ID
    ? { ...product, status: 'ACTIVE' }
    : product;
}

export function createBoltAdminDemoOrder(input: {
  requestId: string | undefined;
  requestedMode?: BoltAdminDemoMode;
  catalog: Product[];
  store: Store | undefined;
  dispatch: Pick<DispatchService, 'createOrder'>;
}): Order {
  const { requestId, requestedMode = 'PROGRAMADO', catalog, store, dispatch } = input;
  if (!requestId || !/^[A-Za-z0-9_-]{10,100}$/.test(requestId)) {
    throw new DispatchError(400, 'IDEMPOTENCY_REQUIRED', 'Vuelve a intentar crear el pedido con un identificador válido.');
  }
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
    quantity: 2,
    image: product.image,
    weightKg: product.weightKg,
    requiresPrescription: false,
  };
  const order = pendingDeliveryOrder({
    items: [item],
    customer: {
      name: 'Cliente de prueba Suba',
      email: 'bolt-admin-suba@example.invalid',
      phone: '0000000000',
      isGuest: true,
    },
    // Use the established Cedritos coverage fixture, not a customer address.
    address: {
      address: 'Calle 150 #16-56, Cedritos, Bogotá',
      coordinates: { lat: 4.731531, lng: -74.041785 },
      municipality: 'Bogotá',
      locality: 'Usaquén',
      details: 'Pedido ficticio del panel BOLT Admin.',
      porteriaPolicy: 'SUBIR_A_PUERTA',
    },
    store,
    requestedMode,
    creationRequestId: keyPrefix + requestId,
    creationRequestFingerprint: fingerprints[requestedMode],
  });
  const result = dispatch.createOrder(order, catalog.map(p => activateBoltAdminDemoProduct(order, p)), store);
  if (!result.success || !result.order || !isBoltAdminDemoOrder(result.order)) {
    throw new DispatchError(409, 'SIMULATION_ORDER_FAILED', result.error || 'No se pudo registrar el pedido de prueba.');
  }
  return result.order;
}

export function boltAdminDemoReviewContext(order: Order | undefined, context: TransportContext): TransportContext {
  if (!isBoltAdminDemoOrder(order)) return context;
  // This vehicle exists only for the quote and validation of this fixture. It
  // never changes driver accounts, capacity, or availability for other orders.
  const driverId = 'SIM-BOLT-ADMIN-' + order.id;
  const vehicle: TransportVehicle = {
    driverId,
    storeIds: [BOLT_ADMIN_DEMO_STORE_ID],
    enabled: true,
    modes: ['PROGRAMADO'],
    maxLoadGrams: 5000,
    packagingGrams: 200,
    cargoDimensionsCm: [60, 40, 35],
    maxVolumeCm3: 84000,
    scheduledSlots: generateScheduledSlots().map(slot => `${slot.date}|${slot.slotId}`),
  };
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
