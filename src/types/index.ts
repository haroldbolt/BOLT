export type Species = 'Perro' | 'Gato' | 'Ambos' | 'Otros';

export type MainCategory =
  | 'Todo'
  | 'Perros'
  | 'Gatos'
  | 'Alimentos'
  | 'Arenas'
  | 'Snacks'
  | 'Farmacia'
  | 'Antipulgas'
  | 'Higiene'
  | 'Accesorios';

export type PharmacySubcategory =
  | 'Antipulgas y garrapatas'
  | 'Desparasitación'
  | 'Dermatología'
  | 'Oídos y ojos'
  | 'Cuidado digestivo'
  | 'Vitaminas y suplementos'
  | 'Curación y primeros auxilios'
  | 'Medicamentos veterinarios';

export type StorageCondition = 'TEMPERATURA_AMBIENTE' | 'CADENA_FRIO_2_8' | 'LUGAR_FRESCO_Y_SECO';

export interface ProductLot {
  lotNumber: string;
  expiryDate: string; // ISO date YYYY-MM-DD
  quantity: number;
  isRecalled?: boolean;
}

export interface Product {
  id: string;
  sku: string;
  barcode?: string;
  name: string;
  brand: string;
  species: Species;
  category: MainCategory;
  pharmacySubcategory?: PharmacySubcategory;
  requiresPrescription: boolean;
  icaRegistration?: string;
  activeIngredient?: string;
  concentration?: string;
  pharmaceuticalForm?: string;
  storageCondition: StorageCondition;
  temperatureColdChain: boolean;
  price: number;
  originalPrice?: number;
  discountPercent?: number;
  presentation: string;
  weightKg: number;
  unitPriceText?: string;
  image: string;
  gallery?: string[];
  description: string;
  authorizedInfo?: string;
  stockByStore: Record<string, number>;
  reservedStockByStore: Record<string, number>;
  lots?: ProductLot[];
  rating: number;
  reviewsCount: number;
  isNew?: boolean;
  isLightningDeal?: boolean;
  tags: string[];
}

export interface ProductFilterState {
  minPrice: number | null;
  maxPrice: number | null;
  brands: string[];
  minWeightKg: number | null;
  maxWeightKg: number | null;
}

export type WarehouseVerificationStatus = 'VERIFIED' | 'UNVERIFIED' | 'DISCREPANCY_WARNING';

export interface Store {
  id: string;
  name: string;
  address: string;
  postalAddress?: string;
  coordinates: { lat: number; lng: number };
  shopifyCoordinates?: { lat: number; lng: number };
  verifiedEntrance?: { lat: number; lng: number };
  verificationStatus?: WarehouseVerificationStatus;
  verifiedAt?: string;
  verifiedBy?: string;
  placeId?: string;
  shopifyLocationGid?: string;
  turboEnabled: boolean;
  isActive: boolean;
  isPaused?: boolean;
  schedule: string;
  maxDeliveryRadiusKm: number;
  vehicleMaxWeightKg: number;
  safetyStockDefault?: number;
}

export type ShopifyConnectionStatus =
  | 'SIN_CONFIGURAR'
  | 'PENDIENTE_AUTORIZACION'
  | 'CONECTADO'
  | 'SINCRONIZANDO'
  | 'ERROR_SINCRONIZACION';

export interface ShopifyLocationMapping {
  storeId: string;
  storeName: string;
  shopifyLocationGid: string;
  shopifyLocationName: string;
  isActiveInBolt: boolean;
  lastSyncAt?: string;
  syncedProductsCount: number;
  discrepanciesCount: number;
}

export interface ShopifyInventoryItemMapping {
  sku: string;
  productName: string;
  shopifyProductGid: string;
  shopifyVariantGid: string;
  shopifyInventoryItemGid: string;
  quantitiesByLocation: Record<string, {
    onHand: number;
    committed: number;
    reservedBolt: number;
    safetyStock: number;
    sellable: number;
  }>;
  lastUpdated: string;
}

export interface ShopifySyncState {
  status: ShopifyConnectionStatus;
  storeDomain: string;
  publicDomain: string;
  apiVersion: string;
  readOnlyScopes: string[];
  lastSuccessfulSync?: string;
  lastAttemptedSync?: string;
  reconciliationIntervalMinutes: number;
  activeWarehousesCount: number;
  totalMappedSkus: number;
  unmappedSkusCount: number;
  discrepanciesCount: number;
  errorMessage?: string;
  locations: ShopifyLocationMapping[];
  inventoryItems: ShopifyInventoryItemMapping[];
}

export type PorteriaPolicy = 'DEJAR_EN_PORTERIA' | 'SUBIR_A_PUERTA' | 'LLAMAR_AL_LLEGAR';

export type PaymentMethod = 'WOMPI_CARD' | 'WOMPI_PSE' | 'WOMPI_BANCOLOMBIA' | 'CASH_ON_DELIVERY';

export type PaymentStatus = 'PENDIENTE' | 'APROBADO' | 'RECHAZADO' | 'REEMBOLSADO';

export type PrescriptionStatus = 'NO_REQUIERE' | 'PENDIENTE_REVISION' | 'APROBADA' | 'RECHAZADA';

export type FulfillmentStatus =
  | 'PENDIENTE_CONFIRMACION'
  | 'CONFIRMADO'
  | 'EN_ALISTAMIENTO'
  | 'LISTO_PARA_DESPACHO'
  | 'REPARTIDOR_ASIGNADO'
  | 'EN_CAMINO'
  | 'ENTREGADO'
  | 'CON_INCIDENCIA'
  | 'CANCELADO';

export interface CartItem {
  product: Product;
  quantity: number;
}

export interface OrderItem {
  productId: string;
  sku: string;
  name: string;
  brand: string;
  presentation: string;
  price: number;
  quantity: number;
  image: string;
  weightKg: number;
  requiresPrescription: boolean;
  picked?: boolean;
  verifiedLot?: string;
}

export interface PrescriptionReviewData {
  status: PrescriptionStatus;
  documentUrl?: string;
  documentName?: string;
  uploadedAt?: string;
  reviewedBy?: string;
  reviewedAt?: string;
  reviewNotes?: string;
  vetName?: string;
  vetLicense?: string;
}

export type DeliveryMode = 'TURBO' | 'TURBO_DIVIDIDO' | 'PROGRAMADO';

export type ScheduledWindowId = 'HORARIO_1' | 'HORARIO_2' | 'HORARIO_3';

export interface ScheduledDeliveryWindow {
  slotId: string;
  windowId?: ScheduledWindowId;
  windowName?: string;
  date: string;
  dateLabel: string;
  startTime: string;
  endTime: string;
  displayWindow: string;
  displayWindowShort?: string;
  bookingCutoffTime?: string;
  bookingCutoffLabel?: string;
  commercialHook?: string;
  countdownNotice?: string;
  minutesUntilCutoff?: number;
  availableCapacity?: number;
  maxCapacity?: number;
  cutoffPassed?: boolean;
  price?: number;
}

export interface ChildShipment {
  shipmentId: string;
  shipmentIndex: number;
  shipmentCount: number;
  parentOrderId: string;
  childOrderId?: string;
  items: OrderItem[];
  weightKg: number;
  weightGrams: number;
  subtotal: number;
  cashToCollect: number;
  fulfillmentStatus: FulfillmentStatus;
  secretDeliveryCode: string;
  estimatedDeliveryMinutes: number;
  driver?: {
    id: string;
    name: string;
    phone: string;
    vehiclePlate: string;
    vehicleType: string;
    rating: number;
    photo: string;
  };
  timestamps: {
    confirmedAt?: string;
    prepStartedAt?: string;
    prepCompletedAt?: string;
    assignedAt?: string;
    pickedUpAt?: string;
    deliveredAt?: string;
  };
}

export interface Order {
  id: string;
  orderNumber: string;
  createdAt: string;
  storeId: string;
  storeName: string;
  deliveryMode?: DeliveryMode;
  scheduledWindow?: ScheduledDeliveryWindow;
  isSplitOrder?: boolean;
  parentOrderId?: string;
  shipmentId?: string;
  shipmentIndex?: number;
  shipmentCount?: number;
  childShipments?: ChildShipment[];
  customer: {
    name: string;
    phone: string;
    email: string;
    isGuest: boolean;
  };
  deliveryAddress: {
    address: string;
    details: string;
    porteriaPolicy: PorteriaPolicy;
    coordinates: { lat: number; lng: number };
  };
  items: OrderItem[];
  totals: {
    subtotal: number;
    discount: number;
    shipping: number;
    serviceFee: number;
    tip: number;
    total: number;
    totalWeightKg: number;
  };
  payment: {
    method: PaymentMethod;
    status: PaymentStatus;
    transactionId?: string;
    cashToCollect?: number;
    cashSettled?: boolean;
  };
  prescriptionReview: PrescriptionReviewData;
  fulfillmentStatus: FulfillmentStatus;
  secretDeliveryCode: string; // 4-digit code given to the customer
  estimatedDeliveryMinutes: number;
  originalPromiseWindow: {
    start: string;
    end: string;
  };
  timestamps: {
    confirmedAt?: string;
    prepStartedAt?: string;
    prepCompletedAt?: string;
    assignedAt?: string;
    pickedUpAt?: string;
    deliveredAt?: string;
    cancelledAt?: string;
  };
  driver?: {
    id: string;
    name: string;
    phone: string;
    vehiclePlate: string;
    vehicleType: string;
    rating: number;
    photo: string;
  };
  incidents?: Array<{
    id: string;
    type: string;
    description: string;
    createdAt: string;
    resolved: boolean;
    notes?: string;
  }>;
  deliveryQuoteSnapshot?: {
    quoteId: string;
    geographicDistanceMeters: number;
    roadDistanceMeters: number;
    totalSeconds: number;
    estimatedMinutes: number;
    configVersion: string;
    assignedStoreId: string;
  };
}

export interface DriverProfile {
  id: string;
  name: string;
  phone: string;
  vehiclePlate: string;
  vehicleType: 'MOTO' | 'BICICLETA' | 'CARRO';
  maxWeightKg: number;
  rating: number;
  photo: string;
  isOnline: boolean;
  currentStatus: 'DISPONIBLE' | 'EN_RUTA_A_HUB' | 'EN_CAMINO_CLIENTE' | 'FUERA_DE_TURNO';
  currentLocation: {
    lat: number;
    lng: number;
    heading?: number;
    speed?: number;
    updatedAt: string;
  };
  activeOrderId?: string;
  activeAssignmentId?: string;
  cashBalance: number;
}

export interface GPSTelemetry {
  orderId: string;
  assignmentId: string;
  tripId: string;
  latitude: number;
  longitude: number;
  accuracy: number;
  heading?: number;
  speed?: number;
  batteryLevel?: number;
  timestamp: number;
  sequenceNumber: number;
}

export type OperationRole =
  | 'ADMINISTRADOR'
  | 'COORDINADOR'
  | 'ALISTADOR'
  | 'DESPACHADOR'
  | 'REVISOR_FARMACEUTICO'
  | 'SOPORTE'
  | 'FINANZAS';

// ============================================================================
// CONFIGURACIÓN AUTORITATIVA DE ENTREGA PROGRAMADA
// ============================================================================

export interface ScheduledWindowDefinition {
  id: ScheduledWindowId;
  name: string;
  interval: {
    start: string;
    end: string;
  };
  cutoff: {
    hour: number;
    minute: number;
    label: string;
  };
  displayInterval: string;
  displayIntervalText: string;
  commercialHook: string;
}

export interface ScheduledDeliveryConfig {
  timezone: string;
  maxDaysAhead: number;
  maxCapacityPerSlot: number;
  coverageRadiusMeters: number;
  windows: ScheduledWindowDefinition[];
}

export const SCHEDULED_DELIVERY_CONFIG: ScheduledDeliveryConfig = {
  timezone: 'America/Bogota',
  maxDaysAhead: 3,
  maxCapacityPerSlot: 10,
  coverageRadiusMeters: 25000,
  windows: [
    {
      id: 'HORARIO_1',
      name: 'Horario 1',
      interval: {
        start: '09:00',
        end: '14:00',
      },
      cutoff: {
        hour: 10,
        minute: 0,
        label: '10:00 a. m.',
      },
      displayInterval: '09:00–14:00',
      displayIntervalText: '9:00 a. m. a 2:00 p. m.',
      commercialHook: 'Pide antes de las 10:00 a. m. y recibe hoy de 9:00 a. m. a 2:00 p. m.',
    },
    {
      id: 'HORARIO_2',
      name: 'Horario 2',
      interval: {
        start: '14:00',
        end: '18:00',
      },
      cutoff: {
        hour: 12,
        minute: 0,
        label: '12:00 m.',
      },
      displayInterval: '14:00–18:00',
      displayIntervalText: '2:00 p. m. a 6:00 p. m.',
      commercialHook: 'Pide antes de las 12:00 m. y recibe hoy de 2:00 p. m. a 6:00 p. m.',
    },
    {
      id: 'HORARIO_3',
      name: 'Horario 3',
      interval: {
        start: '18:00',
        end: '22:00',
      },
      cutoff: {
        hour: 16,
        minute: 0,
        label: '4:00 p. m.',
      },
      displayInterval: '18:00–22:00',
      displayIntervalText: '6:00 p. m. a 10:00 p. m.',
      commercialHook: 'Pide antes de las 4:00 p. m. y recibe hoy de 6:00 p. m. a 10:00 p. m.',
    },
  ],
};
