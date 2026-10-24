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

export interface Store {
  id: string;
  name: string;
  address: string;
  coordinates: { lat: number; lng: number };
  turboEnabled: boolean;
  isActive: boolean;
  schedule: string;
  maxDeliveryRadiusKm: number;
  vehicleMaxWeightKg: number;
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

export interface Order {
  id: string;
  orderNumber: string;
  createdAt: string;
  storeId: string;
  storeName: string;
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
