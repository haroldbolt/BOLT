import { applyTransportQuote } from './transportQuote';
import { DEFAULT_TRANSPORT_CONFIG, type TransportContext, type TransportPlan } from './transportPlanner';
import { WAREHOUSES } from '../data/warehouseConfig';
import { validDestinationCoordinates } from './addressGeography';
// Geographic and time eligibility; capacity uses the shared unit planner below.
import { Store, Product, DeliveryMode, ScheduledDeliveryWindow, SCHEDULED_DELIVERY_CONFIG } from '../types';
import {
  getCurrentBogotaTime,
  getAvailableScheduledWindows,
  validateScheduledBookingWindow,
} from '../utils/timeUtils';
import {
  resolveTerritorialAssignment,
  canonicalizeBogotaLocality,
  isSoachaMunicipality,
  TerritorialAssignmentResult,
  TERRITORIAL_WAREHOUSES,
  KENNEDY_LOCALITIES,
  ALAMOS_LOCALITIES,
  SUBA_LOCALITIES,
} from './territoryConfig';

// ============================================================================
// 1. CONSTANTES DE CONFIGURACIÓN AUTORITATIVAS
// ============================================================================

export const COVERAGE_RADIUS_METERS = 6000;          // 6 km radio geodésico Turbo
export const MAX_DELIVERY_SECONDS = 1500;             // 25 minutos (1.500 segundos) límite Turbo
export const SCHEDULED_COVERAGE_RADIUS_METERS = 25000; // Legacy display value; never used to reject scheduled territory
export const MAX_SCHEDULED_WEIGHT_GRAMS = 300000;     // 300 kg capacidad de camioneta programada

// Localidades autorizadas para Turbo y Turbo Dividido exclusivamente
export const TURBO_ALLOWED_LOCALITIES = ['KENNEDY', 'SUBA', 'ENGATIVA'] as const;
export type TurboLocality = typeof TURBO_ALLOWED_LOCALITIES[number];

/**
 * Detecta la localidad de Bogotá mediante análisis de texto de dirección y coordenadas geográficas.
 */
export function detectBogotaLocality(coords?: { lat: number; lng: number } | null, addressText?: string): string {
  const clean = (addressText || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  // 1. Detección por texto y barrios conocidos con precedencia
  if (
    clean.includes('kennedy') || clean.includes('castilla') || clean.includes('timiza') || 
    clean.includes('tintal') || clean.includes('patio bonito') || clean.includes('carvajal') || 
    clean.includes('mandalay') || clean.includes('bavaria') || clean.includes('villa alsacia')
  ) {
    return 'KENNEDY';
  }
  if (
    clean.includes('suba') || clean.includes('rincon') || clean.includes('tibabuyes') || 
    clean.includes('pinar') || clean.includes('lombardia') || clean.includes('niza') || 
    clean.includes('colina campestre') || clean.includes('colina') || clean.includes('mazuren') || 
    clean.includes('prado veraniego') || clean.includes('san jose de baviera')
  ) {
    return 'SUBA';
  }
  if (
    clean.includes('engativa') || clean.includes('alamos') || clean.includes('villas') || 
    clean.includes('minuto de dios') || clean.includes('quirigua') || clean.includes('normandia') || 
    clean.includes('boyaca real') || clean.includes('santa cecilia') || clean.includes('garces navas') ||
    clean.includes('calle 72')
  ) {
    return 'ENGATIVA';
  }
  if (
    clean.includes('usaquen') || clean.includes('cedritos') || clean.includes('santa barbara') || 
    clean.includes('san patricio') || clean.includes('calle 140') || clean.includes('calle 116') || 
    clean.includes('calle 127') || clean.includes('unicentro') || clean.includes('torca') ||
    clean.includes('santa ana') || clean.includes('la carolina')
  ) {
    return 'USAQUEN';
  }
  if (
    clean.includes('chapinero') || clean.includes('lourdes') || clean.includes('rosales') || 
    clean.includes('chico') || clean.includes('antiguo country') || clean.includes('marly') || 
    clean.includes('javeriana') || clean.includes('el retiro')
  ) {
    return 'CHAPINERO';
  }
  if (
    clean.includes('teusaquillo') || clean.includes('salitre') || clean.includes('palermo') || 
    clean.includes('la soledad') || clean.includes('quinta paredes') || clean.includes('ciudad salitre')
  ) {
    return 'TEUSAQUILLO';
  }
  if (
    clean.includes('fontibon') || clean.includes('modelia') || clean.includes('hayuelos') || 
    clean.includes('capellania') || clean.includes('aeropuerto') || clean.includes('zona franca')
  ) {
    return 'FONTIBON';
  }
  if (
    clean.includes('candelaria') || clean.includes('centro') || clean.includes('santa fe') || 
    clean.includes('martires') || clean.includes('las cruces') || clean.includes('plaza de bolivar')
  ) {
    return 'CENTRO_HISTORICO';
  }
  if (clean.includes('bosa') || clean.includes('el recreo') || clean.includes('san pablo')) {
    return 'BOSA';
  }
  if (clean.includes('barrios unidos') || clean.includes('castellana') || clean.includes('alcazares') || clean.includes('polo')) {
    return 'BARRIOS_UNIDOS';
  }
  if (clean.includes('puente aranda') || clean.includes('ciudad montes')) {
    return 'PUENTE_ARANDA';
  }

  // 2. Detección por polígonos/cuadrícula de coordenadas geográficas
  if (coords && typeof coords.lat === 'number' && typeof coords.lng === 'number' && !isNaN(coords.lat) && !isNaN(coords.lng)) {
    const { lat, lng } = coords;

    // Kennedy: lat ~4.590 - 4.665, lng ~ -74.195 - -74.135
    if (lat >= 4.590 && lat <= 4.665 && lng >= -74.195 && lng <= -74.135) {
      return 'KENNEDY';
    }
    // Suba: lat ~4.710 - 4.825, lng ~ -74.135 - -74.045
    if (lat >= 4.710 && lat <= 4.825 && lng >= -74.135 && lng <= -74.045) {
      return 'SUBA';
    }
    // Engativá: lat ~4.670 - 4.730, lng ~ -74.148 - -74.085
    if (lat >= 4.670 && lat <= 4.730 && lng >= -74.148 && lng <= -74.085) {
      return 'ENGATIVA';
    }
    // Fontibón: lat ~4.640 - 4.685, lng ~ -74.165 - -74.110
    if (lat >= 4.640 && lat <= 4.685 && lng >= -74.165 && lng <= -74.110) {
      return 'FONTIBON';
    }
    // Usaquén: lat ~4.680 - 4.800, lng >= -74.055 && lng <= -74.010
    if (lat >= 4.680 && lat <= 4.800 && lng >= -74.055 && lng <= -74.010) {
      return 'USAQUEN';
    }
    // Chapinero: lat ~4.625 - 4.685, lng >= -74.070 && lng <= -74.030
    if (lat >= 4.625 && lat <= 4.685 && lng >= -74.070 && lng <= -74.030) {
      return 'CHAPINERO';
    }
    // Teusaquillo: lat ~4.620 - 4.665, lng >= -74.095 && lng <= -74.065
    if (lat >= 4.620 && lat <= 4.665 && lng >= -74.095 && lng <= -74.065) {
      return 'TEUSAQUILLO';
    }
    // Centro / La Candelaria / Santa Fe: lat ~4.585 - 4.620, lng >= -74.085 && lng <= -74.050
    if (lat >= 4.585 && lat <= 4.620 && lng >= -74.085 && lng <= -74.050) {
      return 'CENTRO_HISTORICO';
    }
    // Bosa: lat ~4.580 - 4.630, lng >= -74.210 && lng <= -74.165
    if (lat >= 4.580 && lat <= 4.630 && lng >= -74.210 && lng <= -74.165) {
      return 'BOSA';
    }
    // Barrios Unidos: lat ~4.650 - 4.690, lng >= -74.090 && lng <= -74.055
    if (lat >= 4.650 && lat <= 4.690 && lng >= -74.090 && lng <= -74.055) {
      return 'BARRIOS_UNIDOS';
    }
  }

  return 'OTRA_LOCALIDAD_BOGOTA';
}

/**
 * Obtiene el nombre amigable de la localidad de Bogotá.
 */
export function getBogotaLocalityName(localityCode: string): string {
  switch (localityCode) {
    case 'KENNEDY': return 'Kennedy';
    case 'SUBA': return 'Suba';
    case 'ENGATIVA': return 'Engativá';
    case 'USAQUEN': return 'Usaquén';
    case 'CHAPINERO': return 'Chapinero';
    case 'TEUSAQUILLO': return 'Teusaquillo';
    case 'FONTIBON': return 'Fontibón';
    case 'CENTRO_HISTORICO': return 'La Candelaria / Centro';
    case 'BOSA': return 'Bosa';
    case 'BARRIOS_UNIDOS': return 'Barrios Unidos';
    case 'PUENTE_ARANDA': return 'Puente Aranda';
    default: return 'Bogotá D.C.';
  }
}

export const DELIVERY_CONFIG = {
  coverageRadiusMeters: COVERAGE_RADIUS_METERS,
  maxDeliverySeconds: MAX_DELIVERY_SECONDS,
  scheduledCoverageRadiusMeters: SCHEDULED_COVERAGE_RADIUS_METERS,
  maxScheduledWeightGrams: MAX_SCHEDULED_WEIGHT_GRAMS,
  scheduledDelivery: SCHEDULED_DELIVERY_CONFIG,
  configVersion: '2026.3-UNIT-CAPACITY',
  defaultPrepReadySeconds: 180, // 3 min alistamiento base de farmacia / alimentos
  itemPickSeconds: 15,          // 15 seg por ítem adicional en picking
  courierReadySeconds: 120,     // 2 min disponibilidad de repartidor en bodega
  pickupHandoffSeconds: 60,     // 1 min verificación de precintos y entrega a repartidor
  customerHandoffSeconds: 120,  // 2 min entrega física en portería / puerta
  operationalBufferSeconds: 120, // 2 min margen de contingencia Bogotá
  averageMotoSpeedKmH: 23,      // Velocidad media motocicleta en Bogotá con semáforos y tráfico (~6.39 m/s)
  urbanRoadFactor: 1.32,        // Factor de desvío vial real vs geodésico en cuadrícula bogotana
};

// ============================================================================
// 2. ESTADOS DE RESPUESTA Y ELEGIBILIDAD
// ============================================================================

export const DeliveryStatus = {
  ELIGIBLE: 'ELIGIBLE',
  OUT_OF_COVERAGE: 'OUT_OF_COVERAGE',
  OVER_TIME_LIMIT: 'OVER_TIME_LIMIT',
  OUT_OF_STOCK: 'OUT_OF_STOCK',
  INSUFFICIENT_STOCK: 'INSUFFICIENT_STOCK',
  STORE_CLOSED: 'STORE_CLOSED',
  NO_AVAILABLE_WAREHOUSE: 'NO_AVAILABLE_WAREHOUSE',
  NO_ELIGIBLE_COURIER: 'NO_ELIGIBLE_COURIER',
  ADDRESS_NEEDS_CONFIRMATION: 'ADDRESS_NEEDS_CONFIRMATION',
  SCHEDULED_ONLY: 'SCHEDULED_ONLY',
  ESTIMATE_UNAVAILABLE: 'ESTIMATE_UNAVAILABLE',
} as const;

export type DeliveryEligibilityStatus =
  | 'ELIGIBLE'
  | 'OUT_OF_COVERAGE'
  | 'OVER_TIME_LIMIT'
  | 'OUT_OF_STOCK'
  | 'INSUFFICIENT_STOCK'
  | 'STORE_CLOSED'
  | 'NO_AVAILABLE_WAREHOUSE'
  | 'NO_ELIGIBLE_COURIER'
  | 'ADDRESS_NEEDS_CONFIRMATION'
  | 'SCHEDULED_ONLY'
  | 'ESTIMATE_UNAVAILABLE';

// ============================================================================
// 3. BODEGAS HABILITADAS DE BOGOTÁ (KENNEDY, ÁLAMOS, SUBA, CENTRO)
// ============================================================================

export const BOGOTA_TURBO_WAREHOUSES: Store[] = WAREHOUSES;

export function getStoreDispatchCoordinates(store: Store): LatLng {
  return store.verifiedEntrance || store.shopifyCoordinates || store.coordinates;
}

// ============================================================================
// 4. TIPOS E INTERFACES DE COTIZACIÓN
// ============================================================================

export interface LatLng {
  lat: number;
  lng: number;
}

export interface ETAComponents {
  preparationReadySeconds: number;
  courierReadyAtWarehouseSeconds: number;
  pickupHandoffSeconds: number;
  roadTravelSeconds: number;
  customerHandoffSeconds: number;
  operationalBufferSeconds: number;
  totalSeconds: number;
}

export type ScheduledWindowId = 'HORARIO_1' | 'HORARIO_2' | 'HORARIO_3';

export interface ScheduledSlot {
  slotId: string;
  windowId: ScheduledWindowId;
  windowName: string;
  date: string; // YYYY-MM-DD
  dateLabel: string; // "Hoy, 26 de Octubre"
  startTime: string; // "09:00"
  endTime: string; // "14:00"
  displayWindow: string; // "09:00–14:00"
  displayWindowShort: string; // "9:00–2:00 p. m."
  displayWindowFull: string; // "9:00 a. m. a 2:00 p. m."
  bookingCutoffTime: string; // "10:00"
  bookingCutoffLabel: string; // "10:00 a. m."
  commercialHook: string; // "Pide antes de las 10:00 a. m. y recibe hoy de 9:00 a. m. a 2:00 p. m."
  countdownNotice?: string; // "⏰ Últimos 35 minutos para elegir esta franja"
  minutesUntilCutoff?: number; // 35
  availableCapacity: number;
  maxCapacity: number;
  cutoffPassed: boolean;
  price: number;
}

export interface SplitShipmentItem {
  productId: string;
  name: string;
  quantity: number;
  unitWeightKg: number;
  totalWeightKg: number;
  totalWeightGrams: number;
  price: number;
}

export interface SplitShipmentPlan {
  shipmentIndex: number; // 1, 2, ...
  shipmentId: string;
  items: SplitShipmentItem[];
  weightKg: number;
  weightGrams: number;
  subtotal: number;
  cashToCollect: number;
  estimatedArrivalSeconds: number;
  secretDeliveryCode: string;
}

export interface TurboDivididoDetails {
  totalWeightKg: number;
  totalWeightGrams: number;
  thresholdGrams: number; // Commercial base, not a physical vehicle capacity
  shipmentCount: number;
  maxWeightPerVehicleKg: number; // Configured physical maximum
  shipments: SplitShipmentPlan[];
  commonDeadlineSeconds: number; // 1500
  allShipmentsMeetDeadline: boolean;
  feasible: boolean;
  explanation: string;
}

export interface DeliveryQuote {
  transportPlan?: TransportPlan;
  inventoryValidated?: boolean;
  confirmationToken?: string;
  charges?: {subtotal:number;freeShippingFrom:number;shipping:number;ownShipping?:number;externalShipping?:number;serviceFee:number;total:number};
  providerResponses?: import('../types/transport').ExternalProviderResponse[];
  transportWindow?: ScheduledSlot;
  warehouse?: {id:string;name:string;customerName:string;address?:string};
  quoteId: string;
  eligibilityStatus: DeliveryEligibilityStatus;
  reasonCode: string;
  message: string;

  // Modos de entrega disponibles y recomendado
  availableModes: {
    turbo: boolean;
    turboDividido: boolean;
    scheduled: boolean;
  };
  recommendedMode: DeliveryMode | null;

  // Detalles Turbo
  assignedStoreId?: string;
  assignedStoreName?: string;
  assignedStoreAddress?: string;
  assignedStoreCoordinates?: LatLng;
  geographicDistanceMeters: number;
  geographicDistanceKm: number;
  roadDistanceMeters: number;
  roadDistanceKm: number;
  etaComponents?: ETAComponents;
  estimatedMinutes?: number;

  // Detalles de distribución por unidades y capacidad
  turboDividido?: TurboDivididoDetails;

  // Detalles Entrega Programada
  scheduledEligible: boolean;
  scheduledSlots: ScheduledSlot[];
  scheduledExplanation?: string;

  // Localidad y conmutación automática Turbo vs Programado
  detectedLocality?: string;
  detectedLocalityName?: string;
  isTurboLocality?: boolean;
  autoSwitchedToScheduled?: boolean;
  switchReason?: 'LOCALITY_NOT_TURBO' | 'TURBO_CONDITIONS_NOT_MET' | 'WEIGHT_OVERSIZED';

  // Información y Asignación Territorial (Pedidos Programados)
  territoryInfo?: TerritorialAssignmentResult;
  municipality?: string;
  locality?: string;

  destination: {
    address: string;
    details?: string;
    coordinates: LatLng;
    municipality?: string;
    locality?: string;
    neighborhood?: string;
    geographicExclusion?: string;
  };
  calculatedAt: string;
  expiresAt: string;
  configVersion: string;
  candidateWarehousesEvaluated: number;
  basketValidated: boolean;
  totalWeightKg: number;
  totalWeightGrams: number;
}

export interface QuoteRequestItem {
  productId: string;
  quantity: number;
}

export interface QuoteRequest {
  destination: {
    address: string;
    details?: string;
    coordinates: LatLng;
    municipality?: string;
    locality?: string;
    neighborhood?: string;
    geographicExclusion?: string;
  };
  items?: QuoteRequestItem[];
  requestedMode?: DeliveryMode;
  scheduledWindow?: {date:string; slotId?:string; startTime?:string; windowId?:ScheduledWindowId};
}

// ============================================================================
// 5. FUNCIÓN HAVERSINE PARA DISTANCIA GEOGRÁFICA
// ============================================================================

/**
 * Cálculo de distancia geodésica mediante la fórmula de Haversine en metros.
 * Soporta llamadas con dos objetos LatLng o cuatro coordenadas numéricas.
 */
export function haversine(
  coord1OrLat1: LatLng | number,
  coord2OrLon1: LatLng | number,
  lat2?: number,
  lon2?: number
): number {
  let phi1: number;
  let phi2: number;
  let deltaPhi: number;
  let deltaLambda: number;

  if (typeof coord1OrLat1 === 'object' && typeof coord2OrLon1 === 'object') {
    phi1 = (coord1OrLat1.lat * Math.PI) / 180;
    phi2 = (coord2OrLon1.lat * Math.PI) / 180;
    deltaPhi = ((coord2OrLon1.lat - coord1OrLat1.lat) * Math.PI) / 180;
    deltaLambda = ((coord2OrLon1.lng - coord1OrLat1.lng) * Math.PI) / 180;
  } else if (
    typeof coord1OrLat1 === 'number' &&
    typeof coord2OrLon1 === 'number' &&
    typeof lat2 === 'number' &&
    typeof lon2 === 'number'
  ) {
    phi1 = (coord1OrLat1 * Math.PI) / 180;
    phi2 = (lat2 * Math.PI) / 180;
    deltaPhi = ((lat2 - coord1OrLat1) * Math.PI) / 180;
    deltaLambda = ((lon2 - coord2OrLon1) * Math.PI) / 180;
  } else {
    return 0;
  }

  const R = 6371e3; // Radio de la Tierra en metros
  const a =
    Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return Math.round(R * c);
}

// Alias para compatibilidad con código existente
export const calculateHaversineDistanceMeters = haversine;

// ============================================================================
// 6. MODELADO DE TIEMPO VIAL Y CÁLCULO DE ETA TOTAL (PREPARACIÓN + LOGÍSTICA)
// ============================================================================

/**
 * Estimación de distancia vial y tiempo de viaje en motocicleta en Bogotá.
 */
export function estimateRoadTravel(
  origin: LatLng,
  destination: LatLng,
  customRoadFactor?: number
): { roadDistanceMeters: number; travelSeconds: number } {
  const geodesicMeters = haversine(origin, destination);
  const roadFactor = customRoadFactor || DELIVERY_CONFIG.urbanRoadFactor;
  const roadDistanceMeters = Math.round(geodesicMeters * roadFactor);

  // Velocidad de 23 km/h = ~6.3889 m/s
  const speedMps = (DELIVERY_CONFIG.averageMotoSpeedKmH * 1000) / 3600;
  const travelSeconds = Math.round(roadDistanceMeters / speedMps);

  return { roadDistanceMeters, travelSeconds };
}

/**
 * Cálculo del tiempo total de entrega (fórmula autorizada):
 * etaTotalSeconds = max(prepReadySeconds, courierReadySeconds)
 *   + pickupHandoffSeconds
 *   + roadTravelSeconds
 *   + customerHandoffSeconds
 *   + operationalBufferSeconds
 */
export function computeTotalETASeconds(
  roadTravelSeconds: number,
  itemCount: number = 1
): { etaComponents: ETAComponents; totalSeconds: number; estimatedMinutes: number } {
  const preparationReadySeconds =
    DELIVERY_CONFIG.defaultPrepReadySeconds + Math.max(0, itemCount - 1) * DELIVERY_CONFIG.itemPickSeconds;
  const courierReadyAtWarehouseSeconds = DELIVERY_CONFIG.courierReadySeconds;
  const pickupHandoffSeconds = DELIVERY_CONFIG.pickupHandoffSeconds;
  const customerHandoffSeconds = DELIVERY_CONFIG.customerHandoffSeconds;
  const operationalBufferSeconds = DELIVERY_CONFIG.operationalBufferSeconds;

  // Preparación en bodega y llegada de repartidor operan en paralelo
  const dispatchPrepOverlap = Math.max(preparationReadySeconds, courierReadyAtWarehouseSeconds);

  // Tiempo total integrado
  const totalSeconds =
    dispatchPrepOverlap +
    pickupHandoffSeconds +
    roadTravelSeconds +
    customerHandoffSeconds +
    operationalBufferSeconds;

  // Redondeo conservador a minutos hacia arriba
  const estimatedMinutes = Math.ceil(totalSeconds / 60);

  const etaComponents: ETAComponents = {
    preparationReadySeconds,
    courierReadyAtWarehouseSeconds,
    pickupHandoffSeconds,
    roadTravelSeconds,
    customerHandoffSeconds,
    operationalBufferSeconds,
    totalSeconds,
  };

  return { etaComponents, totalSeconds, estimatedMinutes };
}

// ============================================================================
// 7. GENERACIÓN DE FRANJAS DE ENTREGA PROGRAMADA (ENVÍO PROGRAMADO)
// ============================================================================

const SPANISH_DAYS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
const SPANISH_MONTHS = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

export interface OfficialScheduledWindowDef {
  windowId: ScheduledWindowId;
  windowName: string;
  startTime: string;
  endTime: string;
  displayWindow: string;
  displayWindowShort: string;
  displayWindowFull: string;
  cutoffHour: number;
  cutoffMinute: number;
  cutoffLabel: string;
  commercialHook: string;
}

export { SCHEDULED_DELIVERY_CONFIG };

/**
 * Las tres franjas oficiales autoritativas de entrega programada:
 * - Horario 1: 09:00–14:00 (Corte el mismo día: 10:00 a. m.)
 * - Horario 2: 14:00–18:00 (Corte el mismo día: 12:00 m.)
 * - Horario 3: 18:00–22:00 (Corte el mismo día: 4:00 p. m. / 16:00)
 */
export const OFFICIAL_SCHEDULED_WINDOWS: OfficialScheduledWindowDef[] = [
  {
    windowId: 'HORARIO_1',
    windowName: 'Horario 1',
    startTime: '09:00',
    endTime: '14:00',
    displayWindow: '09:00–14:00',
    displayWindowShort: '9:00–2:00 p. m.',
    displayWindowFull: '9:00 a. m. a 2:00 p. m.',
    cutoffHour: 10,
    cutoffMinute: 0,
    cutoffLabel: '10:00 a. m.',
    commercialHook: 'Pide antes de las 10:00 a. m. y recibe hoy de 9:00 a. m. a 2:00 p. m.',
  },
  {
    windowId: 'HORARIO_2',
    windowName: 'Horario 2',
    startTime: '14:00',
    endTime: '18:00',
    displayWindow: '14:00–18:00',
    displayWindowShort: '2:00–6:00 p. m.',
    displayWindowFull: '2:00 p. m. a 6:00 p. m.',
    cutoffHour: 12,
    cutoffMinute: 0,
    cutoffLabel: '12:00 m.',
    commercialHook: 'Pide antes de las 12:00 m. y recibe hoy de 2:00 p. m. a 6:00 p. m.',
  },
  {
    windowId: 'HORARIO_3',
    windowName: 'Horario 3',
    startTime: '18:00',
    endTime: '22:00',
    displayWindow: '18:00–22:00',
    displayWindowShort: '6:00–10:00 p. m.',
    displayWindowFull: '6:00 p. m. a 10:00 p. m.',
    cutoffHour: 16,
    cutoffMinute: 0,
    cutoffLabel: '4:00 p. m.',
    commercialHook: 'Pide antes de las 4:00 p. m. y recibe hoy de 6:00 p. m. a 10:00 p. m.',
  },
];

/**
 * Obtiene la hora y fecha locales exactas en la zona horaria America/Bogota.
 */
export function getBogotaTime(referenceDate: Date = new Date()): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  dateString: string;
} {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Bogota',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = formatter.formatToParts(referenceDate);
  const map: Record<string, string> = {};
  for (const p of parts) map[p.type] = p.value;
  const year = parseInt(map.year, 10);
  const month = parseInt(map.month, 10) - 1;
  const day = parseInt(map.day, 10);
  const rawHour = parseInt(map.hour, 10);
  const hour = rawHour === 24 ? 0 : rawHour;
  const minute = parseInt(map.minute, 10);
  const dateString = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return { year, month, day, hour, minute, dateString };
}

export interface GenerateScheduledSlotsOptions {
  includeExpired?: boolean;
  maxDays?: number;
}

/**
 * Genera las franjas horarias disponibles para Envío Programado.
 * Reglas de visibilidad para entrega el MISMO DÍA (Bogotá local):
 * - Antes de las 10:00 a. m.: muestra Horarios 1, 2 y 3.
 * - Después de las 10:00 a. m. (primer corte): oculta Horario 1 de hoy.
 * - Después de las 12:00 m.: oculta Horarios 1 y 2 de hoy.
 * - Después de las 4:00 p. m. (16:00): oculta todos los horarios de hoy (muestra días futuros).
 *
 * Hook comercial y cuenta regresiva:
 * - Mensaje claro para cada franja disponible hoy (ej. “Pide antes de las 10:00 a. m. y recibe hoy...”).
 * - Si restan menos de 60 minutos para el corte: “⏰ Últimos X minutos para elegir esta franja”.
 * - Para días futuros: siempre muestra los 3 horarios completos (el corte de hoy no afecta a mañana).
 */
export function generateScheduledSlots(
  referenceDate: Date = new Date(),
  options: GenerateScheduledSlotsOptions = {}
): ScheduledSlot[] {
  const { includeExpired = false, maxDays = 3 } = options;
  const slots: ScheduledSlot[] = [];
  const bogota = getBogotaTime(referenceDate);
  const currentTotalMinutes = bogota.hour * 60 + bogota.minute;

  for (let dayOffset = 0; dayOffset < maxDays; dayOffset++) {
    const baseDate = new Date(Date.UTC(bogota.year, bogota.month, bogota.day + dayOffset, 12, 0, 0));
    const yyyy = baseDate.getUTCFullYear();
    const mm = String(baseDate.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(baseDate.getUTCDate()).padStart(2, '0');
    const dateStr = `${yyyy}-${mm}-${dd}`;
    const dayOfWeek = baseDate.getUTCDay();

    let dayPrefix = '';
    if (dayOffset === 0) dayPrefix = 'Hoy, ';
    else if (dayOffset === 1) dayPrefix = 'Mañana, ';
    else dayPrefix = `${SPANISH_DAYS[dayOfWeek]}, `;

    const dateLabel = `${dayPrefix}${baseDate.getUTCDate()} de ${SPANISH_MONTHS[baseDate.getUTCMonth()]}`;

    for (const win of OFFICIAL_SCHEDULED_WINDOWS) {
      const isToday = dayOffset === 0;
      let cutoffPassed = false;
      let countdownNotice: string | undefined = undefined;
      let minutesUntilCutoff: number | undefined = undefined;
      let commercialHook = '';

      if (isToday) {
        const cutoffTotalMinutes = win.cutoffHour * 60 + win.cutoffMinute;
        const minutesRemaining = cutoffTotalMinutes - currentTotalMinutes;

        if (minutesRemaining <= 0) {
          cutoffPassed = true;
        } else {
          minutesUntilCutoff = minutesRemaining;
          if (minutesRemaining <= 60) {
            countdownNotice = `⏰ Últimos ${minutesRemaining} minutos para elegir esta franja`;
          }
        }
        commercialHook = win.commercialHook;
      } else {
        cutoffPassed = false;
        commercialHook = `Recibe el ${dateLabel} de ${win.displayWindowFull}`;
      }

      // Ocultar franjas cerradas al cliente (salvo auditoría operativa explícita)
      if (cutoffPassed && !includeExpired) {
        continue;
      }

      slots.push({
        slotId: `SLOT-${dateStr}-${win.windowId}`,
        windowId: win.windowId,
        windowName: win.windowName,
        date: dateStr,
        dateLabel,
        startTime: win.startTime,
        endTime: win.endTime,
        displayWindow: win.displayWindow,
        displayWindowShort: win.displayWindowShort,
        displayWindowFull: win.displayWindowFull,
        bookingCutoffTime: `${String(win.cutoffHour).padStart(2, '0')}:${String(win.cutoffMinute).padStart(2, '0')}`,
        bookingCutoffLabel: win.cutoffLabel,
        commercialHook,
        countdownNotice,
        minutesUntilCutoff,
        availableCapacity: cutoffPassed ? 0 : (isToday ? 8 : 10),
        maxCapacity: 10,
        cutoffPassed,
        price: 0,
      });
    }
  }

  return slots;
}

/**
 * Valida de forma estricta si una franja de entrega programada puede ser reservada
 * en el momento actual (servidor o checkout), previniendo compras en franjas cerradas.
 */
export function validateScheduledBooking(
  slot: { date: string; startTime?: string; windowId?: ScheduledWindowId; slotId?: string },
  referenceDate: Date = new Date()
): { valid: boolean; reason?: string } {
  const bogota = getBogotaTime(referenceDate);
  const isToday = slot.date === bogota.dateString;

  if (!isToday) {
    // Para fechas futuras, la reserva es válida siempre que la fecha no sea pasada
    if (slot.date < bogota.dateString) {
      return { valid: false, reason: 'No es posible programar entregas en fechas pasadas.' };
    }
    return { valid: true };
  }

  // Identificar el horario por windowId o por slotId / startTime
  const winDef = OFFICIAL_SCHEDULED_WINDOWS.find(
    w => w.windowId === slot.windowId || slot.slotId?.includes(w.windowId) || slot.startTime === w.startTime
  );

  if (!winDef) {
    return { valid: false, reason: 'Franja horaria programada no reconocida.' };
  }

  const currentTotalMinutes = bogota.hour * 60 + bogota.minute;
  const cutoffTotalMinutes = winDef.cutoffHour * 60 + winDef.cutoffMinute;

  if (currentTotalMinutes >= cutoffTotalMinutes) {
    return {
      valid: false,
      reason: `La franja ${winDef.windowName} para entrega hoy cerró a las ${winDef.cutoffLabel}. Por favor selecciona otra franja disponible o para mañana.`,
    };
  }

  // Si reserva Horario 1 entre 9:00 a. m. y 10:00 a. m., verificar que la entrega ocurra antes de las 2:00 p. m.
  if (winDef.windowId === 'HORARIO_1' && currentTotalMinutes >= 9 * 60) {
    // El fin de ventana es 14:00 (840 min). Hay margen suficiente siempre que sea antes de las 10:00 a. m.
    if (currentTotalMinutes >= 10 * 60) {
      return {
        valid: false,
        reason: 'El Horario 1 cerró a las 10:00 a. m. para entregas hoy.',
      };
    }
  }

  return { valid: true };
}

function evaluateDeliveryQuoteInternal(
  req: QuoteRequest,
  stores: Store[] = BOGOTA_TURBO_WAREHOUSES,
  catalogProducts: Product[] = []
): DeliveryQuote {
  const { destination, items } = req;
  const now = new Date();
  const quoteId = `QUO-${Date.now()}-${Math.floor(Math.random() * 9000 + 1000)}`;
  const expiresAt = new Date(now.getTime() + 10 * 60 * 1000).toISOString(); // 10 min validez
  const scheduledSlots = generateScheduledSlots(now);

  // Calcular peso total de la cesta en gramos
  let totalWeightGrams = 0;
  if (items && items.length > 0 && catalogProducts.length > 0) {
    for (const it of items) {
      const prod = catalogProducts.find(p => p.id === it.productId);
      const unitWeight = prod?.transport ? prod.transport.weightGrams / 1000 : Number.isFinite(prod?.weightKg) && prod!.weightKg>0 ? prod!.weightKg : 0;
      totalWeightGrams += Math.round(unitWeight * 1000) * it.quantity;
    }
  }
  const totalWeightKg = Number((totalWeightGrams / 1000).toFixed(2));

  // Validación de coordenadas
  if (
    !destination ||
    !destination.address?.trim() ||
    (destination.address.match(/\d+/g) || []).length < 2 ||
    !validDestinationCoordinates(destination.coordinates) ||
    typeof destination.coordinates.lat !== 'number' ||
    typeof destination.coordinates.lng !== 'number' ||
    isNaN(destination.coordinates.lat) ||
    isNaN(destination.coordinates.lng)
  ) {
    return {
      quoteId,
      eligibilityStatus: DeliveryStatus.ADDRESS_NEEDS_CONFIRMATION,
      reasonCode: !destination?.address?.trim() || (destination.address.match(/\d+/g) || []).length < 2 ? 'ADDRESS_INCOMPLETE' : 'MISSING_COORDINATES',
      message: !destination?.address?.trim() || (destination.address.match(/\d+/g) || []).length < 2 ? 'Completa la dirección de entrega con vía y número antes de cotizar.' : 'Por favor confirma el punto exacto de entrega en el mapa.',
      availableModes: { turbo: false, turboDividido: false, scheduled: false },
      recommendedMode: null,
      destination: destination || { address: '', coordinates: { lat: 0, lng: 0 } },
      geographicDistanceMeters: 0,
      geographicDistanceKm: 0,
      roadDistanceMeters: 0,
      roadDistanceKm: 0,
      scheduledEligible: false,
      scheduledSlots: [],
      calculatedAt: now.toISOString(),
      expiresAt,
      configVersion: DELIVERY_CONFIG.configVersion,
      candidateWarehousesEvaluated: 0,
      basketValidated: false,
      totalWeightKg: 0,
      totalWeightGrams: 0,
    };
  }

  // Validación de localidad en Bogotá
  const detectedLocality = (canonicalizeBogotaLocality(destination.locality) || '').toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '') || detectBogotaLocality(destination.coordinates, destination.address);
  const detectedLocalityName = getBogotaLocalityName(detectedLocality);
  const isTurboLocality = TURBO_ALLOWED_LOCALITIES.includes(detectedLocality as any);

  // Bodegas activas con Turbo habilitado (Kennedy, Álamos, Suba)
  const activeTurboStores = stores.filter(s => s.isActive && s.turboEnabled && (!s.enabledModes || !!s.scheduledLocalities?.length || !!s.scheduledMunicipalities?.length) && (!s.enabledModes || s.enabledModes.includes('TURBO') || s.enabledModes.includes('TURBO_DIVIDIDO')));

  // Resolución autoritativa de territorio (localidad en Bogotá o Soacha)
  const territoryAssignment = resolveTerritorialAssignment({
    municipality: destination.municipality,
    locality: destination.locality,
    address: destination.address,
    coordinates: destination.coordinates,
  });

  // 1. Si está fuera del área de cobertura estándar (ej: Sumapaz o municipio no cubierto como Chía)
  if (destination.geographicExclusion || territoryAssignment.status === 'OUT_OF_COVERAGE') {
    return {
      quoteId,
      eligibilityStatus: DeliveryStatus.OUT_OF_COVERAGE,
      reasonCode: 'TERRITORY_OUT_OF_COVERAGE',
      message: destination.geographicExclusion || territoryAssignment.reason || 'Zona fuera del área de cobertura habilitada.',
      availableModes: { turbo: false, turboDividido: false, scheduled: false },
      recommendedMode: null,
      autoSwitchedToScheduled: false,
      detectedLocality: territoryAssignment.locality || 'FUERA_DE_COBERTURA',
      detectedLocalityName: territoryAssignment.locality || territoryAssignment.municipality,
      isTurboLocality: false,
      destination,
      geographicDistanceMeters: 0,
      geographicDistanceKm: 0,
      roadDistanceMeters: 0,
      roadDistanceKm: 0,
      scheduledEligible: false,
      scheduledSlots: [],
      territoryInfo: territoryAssignment,
      municipality: territoryAssignment.municipality,
      locality: territoryAssignment.locality,
      calculatedAt: now.toISOString(),
      expiresAt,
      configVersion: DELIVERY_CONFIG.configVersion,
      candidateWarehousesEvaluated: 0,
      basketValidated: !!items?.length,
      totalWeightKg,
      totalWeightGrams,
    };
  }

  // 2. Si la localidad o municipio no se reconoció con certeza y requiere confirmación del cliente
  if (territoryAssignment.status === 'NEEDS_CONFIRMATION') {
    return {
      quoteId,
      eligibilityStatus: DeliveryStatus.ADDRESS_NEEDS_CONFIRMATION,
      reasonCode: 'LOCALITY_NEEDS_CONFIRMATION',
      message: territoryAssignment.reason || 'Por favor confirma tu localidad o municipio para validar la cobertura y bodega.',
      availableModes: { turbo: false, turboDividido: false, scheduled: false },
      recommendedMode: null,
      autoSwitchedToScheduled: false,
      destination,
      geographicDistanceMeters: 0,
      geographicDistanceKm: 0,
      roadDistanceMeters: 0,
      roadDistanceKm: 0,
      scheduledEligible: false,
      scheduledSlots: [],
      territoryInfo: territoryAssignment,
      municipality: territoryAssignment.municipality,
      calculatedAt: now.toISOString(),
      expiresAt,
      configVersion: DELIVERY_CONFIG.configVersion,
      candidateWarehousesEvaluated: 0,
      basketValidated: false,
      totalWeightKg: 0,
      totalWeightGrams: 0,
    };
  }

  // Identificar la bodega territorial asignada
  const assignedTerritorialStoreId = territoryAssignment.assignedStoreId!;
  const territorialStore = stores.find(s => s.id === assignedTerritorialStoreId);
  const isTerritorialStoreActive = !!territorialStore?.isActive && (!territorialStore.enabledModes || territorialStore.enabledModes.includes('PROGRAMADO'));

  // Validar existencias en la bodega territorial asignada (descontando reservado)
  let territorialStockSufficient = true;
  let territorialInsufficientItemName = '';
  let territorialAvailableStock = 0;

  if (items && items.length > 0 && catalogProducts.length > 0 && territorialStore) {
    for (const basketItem of items) {
      const prod = catalogProducts.find(
        p => p.id === basketItem.productId || p.sku === basketItem.productId || p.productoId === basketItem.productId
      );
      if (!prod || !Number.isInteger(basketItem.quantity) || basketItem.quantity <= 0) {
        territorialStockSufficient = false; territorialInsufficientItemName = prod?.name || basketItem.productId; break;
      }
      if (prod) {
        const currentStock = prod.stockByStore[territorialStore.id] || 0;
        const currentReserved = prod.reservedStockByStore[territorialStore.id] || 0;
        const availableToSell = currentStock - currentReserved;
        if (availableToSell - basketItem.quantity < 0) {
          territorialStockSufficient = false;
          territorialInsufficientItemName = prod.name;
          territorialAvailableStock = Math.max(0, availableToSell);
          break;
        }
      }
    }
  }

  // REGLA 1: Turbo y Turbo Dividido únicamente en Kennedy, Suba y Engativá.
  // En cualquier otra localidad de Bogotá o Soacha, selecciona automáticamente Envío Programado con su bodega asignada.
  if (!isTurboLocality) {
    let minTurboGeoDistance = Infinity;
    for (const store of activeTurboStores) {
      const d = haversine(getStoreDispatchCoordinates(store), destination.coordinates);
      if (d < minTurboGeoDistance) minTurboGeoDistance = d;
    }
    const geoKm = Number((minTurboGeoDistance / 1000).toFixed(1));
    const roadKm = Number(((minTurboGeoDistance * DELIVERY_CONFIG.urbanRoadFactor) / 1000).toFixed(1));

    // Validar estado de la bodega e inventario
    let scheduledEligible = isTerritorialStoreActive && territorialStockSufficient;
    let scheduledMessage = 'Para esta dirección, continuamos con envío programado. Elige cuándo recibir tu pedido';
    let reasonCode = 'NON_TURBO_LOCALITY_AUTO_SCHEDULED';

    if (!isTerritorialStoreActive) {
      scheduledMessage = `La bodega ${territoryAssignment.assignedStoreName} se encuentra temporalmente inactiva. No es posible trasladar el pedido a otra bodega sin autorización.`;
      reasonCode = 'STORE_INACTIVE';
    } else if (!territorialStockSufficient) {
      scheduledMessage = `Inventario insuficiente para "${territorialInsufficientItemName}" en ${territoryAssignment.assignedStoreName}. Disponibles para venta: ${territorialAvailableStock}. Por favor ajusta tu carrito.`;
      reasonCode = 'INSUFFICIENT_STOCK';
    }

    return {
      quoteId,
      eligibilityStatus: scheduledEligible ? DeliveryStatus.SCHEDULED_ONLY : !isTerritorialStoreActive ? DeliveryStatus.STORE_CLOSED : DeliveryStatus.INSUFFICIENT_STOCK,
      reasonCode,
      message: scheduledMessage,
      availableModes: {
        turbo: false,
        turboDividido: false,
        scheduled: scheduledEligible,
      },
      recommendedMode: scheduledEligible ? 'PROGRAMADO' : null,
      autoSwitchedToScheduled: true,
      switchReason: 'LOCALITY_NOT_TURBO',
      detectedLocality,
      detectedLocalityName: territoryAssignment.locality || territoryAssignment.municipality,
      isTurboLocality: false,
      assignedStoreId: territoryAssignment.assignedStoreId || undefined,
      assignedStoreName: territoryAssignment.assignedStoreName || undefined,
      assignedStoreAddress: territorialStore?.address,
      assignedStoreCoordinates: territorialStore ? getStoreDispatchCoordinates(territorialStore) : undefined,
      territoryInfo: territoryAssignment,
      municipality: territoryAssignment.municipality,
      locality: territoryAssignment.locality,
      destination,
      geographicDistanceMeters: minTurboGeoDistance,
      geographicDistanceKm: geoKm,
      roadDistanceMeters: Math.round(minTurboGeoDistance * DELIVERY_CONFIG.urbanRoadFactor),
      roadDistanceKm: roadKm,
      scheduledEligible,
      scheduledSlots: scheduledEligible ? scheduledSlots : [],
      scheduledExplanation: scheduledMessage,
      calculatedAt: now.toISOString(),
      expiresAt,
      configVersion: DELIVERY_CONFIG.configVersion,
      candidateWarehousesEvaluated: activeTurboStores.length,
      basketValidated: !!items?.length,
      totalWeightKg,
      totalWeightGrams,
    };
  }

  if (activeTurboStores.length === 0) {
    let scheduledEligible = isTerritorialStoreActive && territorialStockSufficient;
    let scheduledMessage = 'Para esta dirección, continuamos con envío programado. Elige cuándo recibir tu pedido';
    if (!isTerritorialStoreActive) {
      scheduledMessage = `La bodega ${territoryAssignment.assignedStoreName} se encuentra temporalmente inactiva.`;
    } else if (!territorialStockSufficient) {
      scheduledMessage = `Inventario insuficiente para "${territorialInsufficientItemName}" en ${territoryAssignment.assignedStoreName}. Disponibles: ${territorialAvailableStock}.`;
    }

    return {
      quoteId,
      eligibilityStatus: scheduledEligible ? DeliveryStatus.SCHEDULED_ONLY : DeliveryStatus.OUT_OF_STOCK,
      reasonCode: 'NO_ACTIVE_TURBO_STORES',
      message: scheduledMessage,
      availableModes: { turbo: false, turboDividido: false, scheduled: scheduledEligible },
      recommendedMode: scheduledEligible ? 'PROGRAMADO' : null,
      autoSwitchedToScheduled: true,
      switchReason: 'TURBO_CONDITIONS_NOT_MET',
      detectedLocality,
      detectedLocalityName: territoryAssignment.locality || detectedLocalityName,
      isTurboLocality: true,
      assignedStoreId: territoryAssignment.assignedStoreId || undefined,
      assignedStoreName: territoryAssignment.assignedStoreName || undefined,
      assignedStoreAddress: territorialStore?.address,
      assignedStoreCoordinates: territorialStore ? getStoreDispatchCoordinates(territorialStore) : undefined,
      territoryInfo: territoryAssignment,
      municipality: territoryAssignment.municipality,
      locality: territoryAssignment.locality,
      destination,
      geographicDistanceMeters: 0,
      geographicDistanceKm: 0,
      roadDistanceMeters: 0,
      roadDistanceKm: 0,
      scheduledEligible,
      scheduledSlots: scheduledEligible ? scheduledSlots : [],
      calculatedAt: now.toISOString(),
      expiresAt,
      configVersion: DELIVERY_CONFIG.configVersion,
      candidateWarehousesEvaluated: 0,
      basketValidated: false,
      totalWeightKg,
      totalWeightGrams,
    };
  }

  interface CandidateEvaluation {
    store: Store;
    geoDistanceMeters: number;
    roadDistanceMeters: number;
    roadTravelSeconds: number;
    totalSeconds: number;
    estimatedMinutes: number;
    etaComponents: ETAComponents;
    stockSufficient: boolean;
  }

  const candidates: CandidateEvaluation[] = [];
  const itemCount = items ? items.reduce((acc, i) => acc + i.quantity, 0) : 1;

  for (const store of activeTurboStores) {
    const storeOrigin = getStoreDispatchCoordinates(store);
    const geoDistanceMeters = haversine(storeOrigin, destination.coordinates);

    // Condición 1: Radio de cobertura máximo de 6.000 metros
    if (geoDistanceMeters <= DELIVERY_CONFIG.coverageRadiusMeters) {
      let stockSufficient = true;
      if (items && items.length > 0 && catalogProducts.length > 0) {
        for (const basketItem of items) {
          const prod = catalogProducts.find(p => p.id === basketItem.productId);
          if (prod) {
            const currentStock = prod.stockByStore[store.id] || 0;
            const currentReserved = prod.reservedStockByStore[store.id] || 0;
            const availableToSell = currentStock - currentReserved;
            if (availableToSell - basketItem.quantity < 0) {
              stockSufficient = false;
              break;
            }
          }
        }
      }

      const { roadDistanceMeters, travelSeconds } = estimateRoadTravel(storeOrigin, destination.coordinates);
      const { etaComponents, totalSeconds, estimatedMinutes } = computeTotalETASeconds(travelSeconds, itemCount);

      candidates.push({
        store,
        geoDistanceMeters,
        roadDistanceMeters,
        roadTravelSeconds: travelSeconds,
        totalSeconds,
        estimatedMinutes,
        etaComponents,
        stockSufficient,
      });
    }
  }

  // CASO FUERA DEL RADIO TURBO DE 6 KM DENTRO DE LOCALIDADES TURBO
  if (candidates.length === 0) {
    let minTurboGeoDistance = Infinity;
    for (const store of activeTurboStores) {
      const d = haversine(getStoreDispatchCoordinates(store), destination.coordinates);
      if (d < minTurboGeoDistance) minTurboGeoDistance = d;
    }

    const geoKm = Number((minTurboGeoDistance / 1000).toFixed(1));
    const roadKm = Number(((minTurboGeoDistance * DELIVERY_CONFIG.urbanRoadFactor) / 1000).toFixed(1));

    return {
      quoteId,
      eligibilityStatus: DeliveryStatus.SCHEDULED_ONLY,
      reasonCode: 'DISTANCE_EXCEEDS_6KM_AUTO_SCHEDULED',
      message: 'Para esta dirección, continuamos con envío programado. Elige cuándo recibir tu pedido',
      availableModes: {
        turbo: false,
        turboDividido: false,
        scheduled: true,
      },
      recommendedMode: 'PROGRAMADO',
      autoSwitchedToScheduled: true,
      switchReason: 'TURBO_CONDITIONS_NOT_MET',
      detectedLocality,
      detectedLocalityName,
      isTurboLocality: true,
      destination,
      geographicDistanceMeters: minTurboGeoDistance,
      geographicDistanceKm: geoKm,
      roadDistanceMeters: Math.round(minTurboGeoDistance * DELIVERY_CONFIG.urbanRoadFactor),
      roadDistanceKm: roadKm,
      scheduledEligible: true,
      scheduledSlots,
      scheduledExplanation: 'Para esta dirección, continuamos con envío programado. Elige cuándo recibir tu pedido',
      calculatedAt: now.toISOString(),
      expiresAt,
      configVersion: DELIVERY_CONFIG.configVersion,
      candidateWarehousesEvaluated: activeTurboStores.length,
      basketValidated: !!items?.length,
      totalWeightKg,
      totalWeightGrams,
    };
  }

  // Filtrar candidatos por inventario suficiente
  const stockEligibleCandidates = candidates.filter(c => c.stockSufficient);
  if (items && items.length > 0 && stockEligibleCandidates.length === 0) {
    return {
      quoteId,
      eligibilityStatus: DeliveryStatus.SCHEDULED_ONLY,
      reasonCode: 'OUT_OF_STOCK_AUTO_SCHEDULED',
      message: 'Para esta dirección, continuamos con envío programado. Elige cuándo recibir tu pedido',
      availableModes: {
        turbo: false,
        turboDividido: false,
        scheduled: true,
      },
      recommendedMode: 'PROGRAMADO',
      autoSwitchedToScheduled: true,
      switchReason: 'TURBO_CONDITIONS_NOT_MET',
      detectedLocality,
      detectedLocalityName,
      isTurboLocality: true,
      destination,
      geographicDistanceMeters: candidates[0].geoDistanceMeters,
      geographicDistanceKm: Number((candidates[0].geoDistanceMeters / 1000).toFixed(1)),
      roadDistanceMeters: candidates[0].roadDistanceMeters,
      roadDistanceKm: Number((candidates[0].roadDistanceMeters / 1000).toFixed(1)),
      scheduledEligible: true,
      scheduledSlots,
      scheduledExplanation: 'Para esta dirección, continuamos con envío programado. Elige cuándo recibir tu pedido',
      calculatedAt: now.toISOString(),
      expiresAt,
      configVersion: DELIVERY_CONFIG.configVersion,
      candidateWarehousesEvaluated: candidates.length,
      basketValidated: true,
      totalWeightKg,
      totalWeightGrams,
    };
  }

  const pool = stockEligibleCandidates.length > 0 ? stockEligibleCandidates : candidates;

  // Condición 2: Límite máximo total de 1.500 segundos (25 minutos)
  const timeEligibleCandidates = pool.filter(c => c.totalSeconds <= DELIVERY_CONFIG.maxDeliverySeconds);

  if (timeEligibleCandidates.length === 0) {
    const bestCandidate = pool.sort((a, b) => a.totalSeconds - b.totalSeconds)[0];
    return {
      quoteId,
      eligibilityStatus: DeliveryStatus.SCHEDULED_ONLY,
      reasonCode: 'ETA_EXCEEDS_25MIN_AUTO_SCHEDULED',
      message: 'Para esta dirección, continuamos con envío programado. Elige cuándo recibir tu pedido',
      availableModes: {
        turbo: false,
        turboDividido: false,
        scheduled: true,
      },
      recommendedMode: 'PROGRAMADO',
      autoSwitchedToScheduled: true,
      switchReason: 'TURBO_CONDITIONS_NOT_MET',
      detectedLocality,
      detectedLocalityName,
      isTurboLocality: true,
      destination,
      geographicDistanceMeters: bestCandidate.geoDistanceMeters,
      geographicDistanceKm: Number((bestCandidate.geoDistanceMeters / 1000).toFixed(1)),
      roadDistanceMeters: bestCandidate.roadDistanceMeters,
      roadDistanceKm: Number((bestCandidate.roadDistanceMeters / 1000).toFixed(1)),
      etaComponents: bestCandidate.etaComponents,
      estimatedMinutes: bestCandidate.estimatedMinutes,
      scheduledEligible: true,
      scheduledSlots,
      scheduledExplanation: 'Para esta dirección, continuamos con envío programado. Elige cuándo recibir tu pedido',
      calculatedAt: now.toISOString(),
      expiresAt,
      configVersion: DELIVERY_CONFIG.configVersion,
      candidateWarehousesEvaluated: pool.length,
      basketValidated: !!items?.length,
      totalWeightKg,
      totalWeightGrams,
    };
  }

  // Ordenar candidatos por menor tiempo total y menor distancia en ruta
  timeEligibleCandidates.sort((a, b) => {
    if (a.totalSeconds !== b.totalSeconds) {
      return a.totalSeconds - b.totalSeconds;
    }
    return a.roadDistanceMeters - b.roadDistanceMeters;
  });

  const winner = timeEligibleCandidates[0];

  return {
    quoteId,
    eligibilityStatus: DeliveryStatus.ELIGIBLE,
    reasonCode: 'SUCCESS',
    message: `Entregamos en esta dirección en aprox. ${winner.estimatedMinutes} min desde ${winner.store.name}.`,
    availableModes: {
      turbo: true,
      turboDividido: false,
      scheduled: true,
    },
    recommendedMode: 'TURBO',
    autoSwitchedToScheduled: false,
    detectedLocality,
    detectedLocalityName: territoryAssignment.locality || detectedLocalityName,
    isTurboLocality: true,
    assignedStoreId: winner.store.id,
    assignedStoreName: winner.store.name,
    assignedStoreAddress: winner.store.address,
    assignedStoreCoordinates: getStoreDispatchCoordinates(winner.store),
    territoryInfo: territoryAssignment,
    municipality: territoryAssignment.municipality,
    locality: territoryAssignment.locality,
    destination,
    geographicDistanceMeters: winner.geoDistanceMeters,
    geographicDistanceKm: Number((winner.geoDistanceMeters / 1000).toFixed(1)),
    roadDistanceMeters: winner.roadDistanceMeters,
    roadDistanceKm: Number((winner.roadDistanceMeters / 1000).toFixed(1)),
    etaComponents: winner.etaComponents,
    estimatedMinutes: winner.estimatedMinutes,
    scheduledEligible: true,
    scheduledSlots,
    calculatedAt: now.toISOString(),
    expiresAt,
    configVersion: DELIVERY_CONFIG.configVersion,
    candidateWarehousesEvaluated: pool.length,
    basketValidated: !!items?.length,
    totalWeightKg,
    totalWeightGrams,
  };
}

// One result for store, checkout and order creation. Slots are populated from
// the server's order repository; a full slot is an operational rejection.
export function evaluateDeliveryQuote(req: QuoteRequest, stores: Store[] = BOGOTA_TURBO_WAREHOUSES, products: Product[] = [], slotOrders: any[] = [], transport: TransportContext = {config:DEFAULT_TRANSPORT_CONFIG,drivers:[],orders:slotOrders}): DeliveryQuote {
  const quantities=new Map<string,number>();
  for(const i of req.items || []) quantities.set(i.productId,(quantities.get(i.productId)||0)+i.quantity);
  req={...req,items:[...quantities].map(([productId,quantity])=>({productId,quantity}))};
  const quote = evaluateDeliveryQuoteInternal(req, stores, products);
  const territory = resolveTerritorialAssignment(req.destination || {});
  if (!territory.isCovered || quote.eligibilityStatus === 'OUT_OF_COVERAGE' || quote.eligibilityStatus === 'ADDRESS_NEEDS_CONFIRMATION') return quote;
  quote.territoryInfo=territory; quote.municipality=territory.municipality; quote.locality=territory.locality;
  const turboStore=stores.find(s=>s.id===quote.assignedStoreId);
  if(turboStore?.enabledModes) {
    quote.availableModes.turbo &&= turboStore.enabledModes.includes('TURBO');
    quote.availableModes.turboDividido &&= turboStore.enabledModes.includes('TURBO_DIVIDIDO');
    if((quote.recommendedMode==='TURBO' && !quote.availableModes.turbo) || (quote.recommendedMode==='TURBO_DIVIDIDO' && !quote.availableModes.turboDividido)) quote.recommendedMode='PROGRAMADO';
  }
  const store = stores.find(s => s.id === territory.assignedStoreId);
  const stockOK = !(req.items || []).some(item => {
    const p = products.find(p=>p.id===item.productId || p.sku===item.productId || p.productoId===item.productId);
    return !p || !Number.isInteger(item.quantity) || item.quantity<=0 || (p.stockByStore[store?.id || ''] || 0)-(p.reservedStockByStore[store?.id || ''] || 0)<item.quantity;
  });
  quote.scheduledSlots = quote.scheduledSlots.map(slot=>({...slot, availableCapacity: Math.max(0,10-slotOrders.filter(o=>o.deliveryMode==='PROGRAMADO' && o.storeId===store?.id && o.status!=='CANCELADO' && o.fulfillmentStatus!=='CANCELADO' && o.scheduledWindow?.date===slot.date && (o.scheduledWindow.slotId===slot.slotId || o.scheduledWindow.startTime===slot.startTime)).length)}));
  quote.scheduledEligible = !!store?.isActive && (!store.enabledModes || store.enabledModes.includes('PROGRAMADO')) && stockOK;
  quote.availableModes.scheduled = quote.scheduledEligible;
  if (req.requestedMode === 'PROGRAMADO' || quote.recommendedMode === 'PROGRAMADO') {
    quote.assignedStoreId = store?.id; quote.assignedStoreName = store?.name;
    quote.assignedStoreAddress = store?.address;
    if(store) {
      quote.assignedStoreCoordinates=getStoreDispatchCoordinates(store);
      quote.geographicDistanceMeters=haversine(quote.assignedStoreCoordinates,req.destination.coordinates);
      quote.geographicDistanceKm=Number((quote.geographicDistanceMeters/1000).toFixed(1));
      quote.roadDistanceMeters=Math.round(quote.geographicDistanceMeters*DELIVERY_CONFIG.urbanRoadFactor);
      quote.roadDistanceKm=Number((quote.roadDistanceMeters/1000).toFixed(1));
    }
    quote.recommendedMode='PROGRAMADO'; quote.autoSwitchedToScheduled=true;
    quote.message='Para esta dirección, continuamos con envío programado. Elige cuándo recibir tu pedido';
    const selected = req.scheduledWindow;
    const slot = selected && quote.scheduledSlots.find(s=>s.date===selected.date
      && !!(selected.slotId || selected.windowId || selected.startTime)
      && (!selected.slotId || s.slotId===selected.slotId)
      && (!selected.windowId || s.windowId===selected.windowId)
      && (!selected.startTime || s.startTime===selected.startTime));
    const reason = !store?.isActive ? ['STORE_INACTIVE','La bodega territorial asignada está inactiva.']
      : store.enabledModes && !store.enabledModes.includes('PROGRAMADO') ? ['MODE_UNAVAILABLE','La sede territorial no tiene habilitado el envío programado.']
      : !stockOK ? ['INSUFFICIENT_STOCK','Inventario insuficiente en la bodega territorial asignada. Ajusta tu carrito.']
      : selected && !slot ? ['MODE_UNAVAILABLE','La franja seleccionada ya no está disponible. Elige otra franja.']
      : (slot ? slot.availableCapacity<=0 : !quote.scheduledSlots.some(s=>s.availableCapacity>0)) ? ['SLOT_CAPACITY_EXCEEDED','La franja no tiene cupo. Selecciona otro horario.'] : null;
    if (reason) {
      quote.reasonCode=reason[0]; quote.message=reason[1];
      quote.eligibilityStatus = reason[0]==='STORE_INACTIVE' ? 'STORE_CLOSED' : reason[0]==='INSUFFICIENT_STOCK' ? 'INSUFFICIENT_STOCK' : 'ESTIMATE_UNAVAILABLE';
      quote.scheduledEligible=false; quote.availableModes.scheduled=false; quote.recommendedMode=null;
    }
  }
  return applyTransportQuote(quote,req,stores,products,transport);
}

// Alias funcional
export const quoteDelivery = evaluateDeliveryQuote;

// ============================================================================
// 10. MANEJADOR AUTÓNOMO DEL ENDPOINT '/api/v1/delivery/quote'
// ============================================================================

export function deliveryQuoteEndpoint(
  req: { body: QuoteRequest },
  res: { status: (code: number) => { json: (data: any) => any }; json: (data: any) => any },
  customStores?: Store[],
  customProducts?: Product[]
) {
  try {
    const quote = evaluateDeliveryQuote(
      req.body,
      customStores || BOGOTA_TURBO_WAREHOUSES,
      customProducts || []
    );
    return res.json(quote);
  } catch (error: any) {
    console.error('Error en /api/v1/delivery/quote:', error);
    return res.status(500).json({
      error: error.message || 'Error interno al calcular cotización de entrega',
      eligibilityStatus: DeliveryStatus.ESTIMATE_UNAVAILABLE,
    });
  }
}
