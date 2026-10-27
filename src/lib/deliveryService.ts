/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * BOLT PETS — SERVICIO AUTORITATIVO DE ENTREGAS Y COBERTURA (BOGOTÁ, D.C.)
 * 
 * Requerimientos y Reglas Operativas:
 * 1. Constantes autoritativas:
 *    - coverageRadiusMeters: 6.000 metros (6 km) de radio geográfico por bodega habilitada.
 *    - maxDeliverySeconds: 1.500 segundos (25 minutos) como límite máximo de tiempo total de entrega.
 *    - heavyOrderThresholdGrams: 60.000 gramos (60 kg) límite estricto para pedidos pesados.
 *    - maxVehicleWeightGrams: 25.000 gramos (25 kg) capacidad máxima estándar por motocicleta.
 *    - scheduledCoverageRadiusMeters: 25.000 metros (25 km) radio metropolitano de entrega programada.
 * 2. Fórmula de Haversine para cálculo de distancia geodésica.
 * 3. Filtrado y evaluación de bodegas habilitadas en Bogotá (Kennedy, Álamos, Suba).
 * 4. Turbo vs Turbo Dividido vs Envío Programado:
 *    - Case A: Cobertura Turbo estándar (<= 6 km, <= 25 min, peso <= 60 kg).
 *    - Case B: Turbo Dividido (peso > 60 kg, <= 6 km, <= 25 min, unidades enteras sin fraccionar empaques,
 *              plazo común estricto de 25 min para todos los envíos hijos).
 *    - Case C: Envío Programado exclusivo (dirección fuera de radio Turbo de 6 km o tiempo > 25 min, pero dentro de cobertura programada).
 *    - Case D: Fuera de toda cobertura (excede 25 km metropolitanos).
 * 5. Endpoint '/api/v1/delivery/quote' y manejador para Express y cliente.
 */

import { Store, Product, DeliveryMode, ScheduledDeliveryWindow, SCHEDULED_DELIVERY_CONFIG } from '../types';
import {
  getCurrentBogotaTime,
  getAvailableScheduledWindows,
  validateScheduledBookingWindow,
} from '../utils/timeUtils';

// ============================================================================
// 1. CONSTANTES DE CONFIGURACIÓN AUTORITATIVAS
// ============================================================================

export const COVERAGE_RADIUS_METERS = 6000;          // 6 km radio geodésico Turbo
export const MAX_DELIVERY_SECONDS = 1500;             // 25 minutos (1.500 segundos) límite Turbo
export const HEAVY_ORDER_THRESHOLD_GRAMS = 60000;     // 60 kg (estrictamente > 60.000 g activa división)
export const MAX_VEHICLE_WEIGHT_GRAMS = 25000;        // 25 kg capacidad de carga de moto estándar
export const SCHEDULED_COVERAGE_RADIUS_METERS = 25000; // 25 km cobertura metropolitana Bogotá
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
  heavyOrderThresholdGrams: HEAVY_ORDER_THRESHOLD_GRAMS,
  maxVehicleWeightGrams: MAX_VEHICLE_WEIGHT_GRAMS,
  scheduledCoverageRadiusMeters: SCHEDULED_COVERAGE_RADIUS_METERS,
  maxScheduledWeightGrams: MAX_SCHEDULED_WEIGHT_GRAMS,
  scheduledDelivery: SCHEDULED_DELIVERY_CONFIG,
  configVersion: '2026.2-SPLIT-SCHEDULED',
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

export const BOGOTA_TURBO_WAREHOUSES: Store[] = [
  {
    id: 'HUB_KENNEDY',
    name: 'Bolt Pets Kennedy',
    address: 'Carrera 79A #2-05, Bogotá, Colombia',
    postalAddress: 'Carrera 79A #2-05, Bogotá, Colombia',
    coordinates: { lat: 4.6320297, lng: -74.1516306 },
    shopifyCoordinates: { lat: 4.6320297, lng: -74.1516306 },
    verifiedEntrance: { lat: 4.6320297, lng: -74.1516306 },
    verificationStatus: 'VERIFIED',
    verifiedAt: '2026-10-25 14:30 COT',
    verifiedBy: 'Coordinador Operativo Bogotá',
    placeId: 'ChIJz27b_KENNEDY_BOG',
    shopifyLocationGid: 'gid://shopify/Location/115617857816',
    turboEnabled: true,
    isActive: true,
    schedule: '07:00 - 23:00',
    maxDeliveryRadiusKm: 6.0,
    vehicleMaxWeightKg: 25,
    safetyStockDefault: 2,
  },
  {
    id: 'HUB_ALAMOS',
    name: 'Bolt Pets Álamos',
    address: 'Calle 72 #97A-18, Bogotá, Colombia',
    postalAddress: 'Calle 72 #97A-18, Bogotá, Colombia',
    coordinates: { lat: 4.7026365, lng: -74.1149105 },
    shopifyCoordinates: { lat: 4.7026365, lng: -74.1149105 },
    verifiedEntrance: { lat: 4.7026365, lng: -74.1149105 },
    verificationStatus: 'VERIFIED',
    verifiedAt: '2026-10-25 15:10 COT',
    verifiedBy: 'Coordinador Operativo Bogotá',
    placeId: 'ChIJ_ALAMOS_ENGATIVA_BOG',
    shopifyLocationGid: 'gid://shopify/Location/115617890584',
    turboEnabled: true,
    isActive: true,
    schedule: '07:00 - 23:00',
    maxDeliveryRadiusKm: 6.0,
    vehicleMaxWeightKg: 25,
    safetyStockDefault: 2,
  },
  {
    id: 'HUB_SUBA',
    name: 'Bolt Pets Suba',
    address: 'Carrera 107 #143-31, Bogotá, Colombia',
    postalAddress: 'Carrera 107 #143-31, Bogotá, Colombia',
    coordinates: { lat: 4.747154, lng: -74.098137 },
    shopifyCoordinates: { lat: 4.747154, lng: -74.098137 },
    verifiedEntrance: { lat: 4.747154, lng: -74.098137 },
    verificationStatus: 'VERIFIED',
    verifiedAt: '2026-10-25 15:45 COT',
    verifiedBy: 'Coordinador Operativo Bogotá',
    placeId: 'ChIJ_SUBA_PINAR_BOG',
    shopifyLocationGid: 'gid://shopify/Location/115617923352',
    turboEnabled: true,
    isActive: true,
    schedule: '07:00 - 23:00',
    maxDeliveryRadiusKm: 6.0,
    vehicleMaxWeightKg: 25,
    safetyStockDefault: 2,
  },
  {
    id: 'HUB_CENTRO',
    name: 'Sede Centro Histórico',
    address: 'Calle 11 #15-53, La Candelaria / Centro, Bogotá',
    postalAddress: 'Calle 11 #15-53, La Candelaria / Centro, Bogotá',
    coordinates: { lat: 4.6028, lng: -74.0754 },
    shopifyCoordinates: { lat: 4.6028, lng: -74.0754 },
    verifiedEntrance: { lat: 4.6028, lng: -74.0754 },
    verificationStatus: 'VERIFIED',
    verifiedAt: '2026-10-20 10:00 COT',
    verifiedBy: 'Administración General',
    shopifyLocationGid: 'gid://shopify/Location/115617999999',
    turboEnabled: false, // Deshabilitado para Turbo
    isActive: true,
    schedule: '08:00 - 20:00',
    maxDeliveryRadiusKm: 5.0,
    vehicleMaxWeightKg: 15,
    safetyStockDefault: 5,
  },
];

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
  thresholdGrams: number; // 60000
  shipmentCount: number;
  maxWeightPerVehicleKg: number; // 25
  shipments: SplitShipmentPlan[];
  commonDeadlineSeconds: number; // 1500
  allShipmentsMeetDeadline: boolean;
  feasible: boolean;
  explanation: string;
}

export interface DeliveryQuote {
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

  // Detalles Turbo Dividido (para pedidos > 60 kg)
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

  destination: {
    address: string;
    details?: string;
    coordinates: LatLng;
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
  };
  items?: QuoteRequestItem[];
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

// ============================================================================
// 8. ALGORITMO DE PARTICIÓN TURBO DIVIDIDO (> 60 KG)
// ============================================================================

/**
 * Divide pedidos pesados (> 60 kg) en unidades enteras respetando la capacidad
 * de carga del vehículo (máx. 25 kg por moto) y asegurando que TODOS los envíos
 * cumplan con el plazo común único de 25 minutos (1.500 segundos).
 */
export function generateSplitDeliveryPlan(
  rawItems: QuoteRequestItem[],
  catalogProducts: Product[],
  estimatedTravelSeconds: number,
  maxVehicleCapacityGrams: number = MAX_VEHICLE_WEIGHT_GRAMS
): TurboDivididoDetails {
  // 1. Expandir unidades discretas enteras (sin fraccionar ningún paquete)
  interface DiscreteUnit {
    productId: string;
    name: string;
    weightKg: number;
    weightGrams: number;
    price: number;
  }

  const discreteUnits: DiscreteUnit[] = [];
  let totalOrderWeightGrams = 0;

  for (const item of rawItems) {
    const prod = catalogProducts.find(p => p.id === item.productId);
    const unitWeightKg = prod?.weightKg || 0.2;
    const unitWeightGrams = Math.round(unitWeightKg * 1000);
    const unitPrice = prod?.price || 0;
    const name = prod?.name || `Producto ${item.productId}`;

    for (let q = 0; q < item.quantity; q++) {
      discreteUnits.push({
        productId: item.productId,
        name,
        weightKg: unitWeightKg,
        weightGrams: unitWeightGrams,
        price: unitPrice,
      });
      totalOrderWeightGrams += unitWeightGrams;
    }
  }

  // 2. Ordenamiento descendente por peso (First-Fit Decreasing)
  discreteUnits.sort((a, b) => b.weightGrams - a.weightGrams);

  // 3. Empaque en contenedores de motocicleta (bins)
  interface Bin {
    units: DiscreteUnit[];
    currentWeightGrams: number;
  }

  const bins: Bin[] = [];
  let hasOversizedUnit = false;

  for (const unit of discreteUnits) {
    if (unit.weightGrams > maxVehicleCapacityGrams) {
      hasOversizedUnit = true; // Unidad indivisible superior a la capacidad del vehículo
    }

    let placed = false;
    for (const bin of bins) {
      if (bin.currentWeightGrams + unit.weightGrams <= maxVehicleCapacityGrams) {
        bin.units.push(unit);
        bin.currentWeightGrams += unit.weightGrams;
        placed = true;
        break;
      }
    }

    if (!placed) {
      bins.push({
        units: [unit],
        currentWeightGrams: unit.weightGrams,
      });
    }
  }

  // 4. Verificación de plazo común de 25 minutos (1.500 segundos)
  // Cada envío hijo se prepara en paralelo en la bodega y se despacha hacia el mismo destino
  const shipments: SplitShipmentPlan[] = bins.map((bin, index) => {
    // Agrupar unidades por producto
    const groupedMap = new Map<string, SplitShipmentItem>();
    for (const u of bin.units) {
      const existing = groupedMap.get(u.productId);
      if (existing) {
        existing.quantity += 1;
        existing.totalWeightGrams += u.weightGrams;
        existing.totalWeightKg = Number((existing.totalWeightGrams / 1000).toFixed(2));
      } else {
        groupedMap.set(u.productId, {
          productId: u.productId,
          name: u.name,
          quantity: 1,
          unitWeightKg: u.weightKg,
          totalWeightKg: u.weightKg,
          totalWeightGrams: u.weightGrams,
          price: u.price,
        });
      }
    }

    const items = Array.from(groupedMap.values());
    const subtotal = items.reduce((acc, it) => acc + (it.price * it.quantity), 0);
    const weightGrams = bin.currentWeightGrams;
    const weightKg = Number((weightGrams / 1000).toFixed(2));

    // Tiempo total de este envío hijo: preparación de sus ítems + viaje + margen
    const { totalSeconds } = computeTotalETASeconds(estimatedTravelSeconds, bin.units.length);

    return {
      shipmentIndex: index + 1,
      shipmentId: `SHP-${Date.now().toString().slice(-4)}-${index + 1}`,
      items,
      weightKg,
      weightGrams,
      subtotal,
      cashToCollect: subtotal, // Inicializado al subtotal del envío
      estimatedArrivalSeconds: totalSeconds,
      secretDeliveryCode: Math.floor(1000 + Math.random() * 9000).toString(),
    };
  });

  const allShipmentsMeetDeadline = shipments.every(
    s => s.estimatedArrivalSeconds <= DELIVERY_CONFIG.maxDeliverySeconds
  );

  // Es factible si:
  // - No hay unidades que excedan por sí solas los 25 kg
  // - Se requieren <= 4 motos (capacidad simultánea de flota de bodega)
  // - Todos los envíos llegan en <= 1.500 s (25 min)
  const feasible = !hasOversizedUnit && bins.length <= 4 && allShipmentsMeetDeadline;

  const totalWeightKg = Number((totalOrderWeightGrams / 1000).toFixed(2));

  return {
    totalWeightKg,
    totalWeightGrams: totalOrderWeightGrams,
    thresholdGrams: HEAVY_ORDER_THRESHOLD_GRAMS,
    shipmentCount: shipments.length,
    maxWeightPerVehicleKg: Number((maxVehicleCapacityGrams / 1000).toFixed(0)),
    shipments,
    commonDeadlineSeconds: DELIVERY_CONFIG.maxDeliverySeconds,
    allShipmentsMeetDeadline,
    feasible,
    explanation: feasible
      ? `Tu pedido pesa ${totalWeightKg} kg (> 60 kg). Se dividirá en ${shipments.length} envíos Turbo en moto simultáneos con llegada en menos de 25 min.`
      : `Tu pedido pesa ${totalWeightKg} kg y requiere despacho mediante Envío Programado en vehículo de carga.`,
  };
}

// ============================================================================
// 9. LÓGICA DE EVALUACIÓN DE COTIZACIÓN Y ASIGNACIÓN AUTOMÁTICA
// ============================================================================

/**
 * Evalúa las bodegas habilitadas en Bogotá para una dirección de destino:
 * 1. Condición Turbo estándar: Haversine <= 6.000 m, totalETA <= 1.500 s, peso <= 60 kg.
 * 2. Condición Turbo Dividido: peso > 60 kg (estrictamente > 60.000 g), Haversine <= 6.000 m,
 *    totalETA <= 1.500 s para todos los envíos hijos, unidades enteras sin fraccionar empaques.
 * 3. Condición Envío Programado: hasta 25 km de cobertura metropolitana de Bogotá.
 * 4. Selección automática de la bodega óptima sin intervención del cliente.
 */
export function evaluateDeliveryQuote(
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
      const unitWeight = prod?.weightKg || 0.2;
      totalWeightGrams += Math.round(unitWeight * 1000) * it.quantity;
    }
  }
  const totalWeightKg = Number((totalWeightGrams / 1000).toFixed(2));

  // Validación de coordenadas
  if (
    !destination ||
    !destination.coordinates ||
    typeof destination.coordinates.lat !== 'number' ||
    typeof destination.coordinates.lng !== 'number' ||
    isNaN(destination.coordinates.lat) ||
    isNaN(destination.coordinates.lng)
  ) {
    return {
      quoteId,
      eligibilityStatus: DeliveryStatus.ADDRESS_NEEDS_CONFIRMATION,
      reasonCode: 'MISSING_COORDINATES',
      message: 'Por favor confirma el punto exacto de entrega en el mapa.',
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
  const detectedLocality = detectBogotaLocality(destination.coordinates, destination.address);
  const detectedLocalityName = getBogotaLocalityName(detectedLocality);
  const isTurboLocality = TURBO_ALLOWED_LOCALITIES.includes(detectedLocality as any);

  // Bodegas activas con Turbo habilitado (Kennedy, Álamos, Suba)
  const activeTurboStores = stores.filter(s => s.isActive && s.turboEnabled);

  // Distancia mínima global a cualquier bodega activa de Bogotá
  let minGlobalGeoDistance = Infinity;
  for (const s of stores.filter(st => st.isActive)) {
    const d = haversine(getStoreDispatchCoordinates(s), destination.coordinates);
    if (d < minGlobalGeoDistance) minGlobalGeoDistance = d;
  }
  const isWithinScheduledCoverage = minGlobalGeoDistance <= DELIVERY_CONFIG.scheduledCoverageRadiusMeters;

  // Si está fuera de todo el perímetro metropolitano de Bogotá (> 25 km)
  if (!isWithinScheduledCoverage) {
    let minTurboGeoDistance = Infinity;
    for (const store of activeTurboStores) {
      const d = haversine(getStoreDispatchCoordinates(store), destination.coordinates);
      if (d < minTurboGeoDistance) minTurboGeoDistance = d;
    }
    const geoKm = Number((minTurboGeoDistance / 1000).toFixed(1));
    const roadKm = Number(((minTurboGeoDistance * DELIVERY_CONFIG.urbanRoadFactor) / 1000).toFixed(1));

    return {
      quoteId,
      eligibilityStatus: DeliveryStatus.OUT_OF_COVERAGE,
      reasonCode: 'OUT_OF_ALL_COVERAGE',
      message: 'Dirección fuera del perímetro metropolitano de Bogotá.',
      availableModes: { turbo: false, turboDividido: false, scheduled: false },
      recommendedMode: null,
      autoSwitchedToScheduled: false,
      detectedLocality,
      detectedLocalityName,
      isTurboLocality: false,
      destination,
      geographicDistanceMeters: minTurboGeoDistance,
      geographicDistanceKm: geoKm,
      roadDistanceMeters: Math.round(minTurboGeoDistance * DELIVERY_CONFIG.urbanRoadFactor),
      roadDistanceKm: roadKm,
      scheduledEligible: false,
      scheduledSlots: [],
      calculatedAt: now.toISOString(),
      expiresAt,
      configVersion: DELIVERY_CONFIG.configVersion,
      candidateWarehousesEvaluated: activeTurboStores.length,
      basketValidated: !!items?.length,
      totalWeightKg,
      totalWeightGrams,
    };
  }

  // REGLA 1: Turbo y Turbo Dividido únicamente en Kennedy, Suba y Engativá.
  // En cualquier otra localidad de Bogotá, selecciona automáticamente Envío Programado.
  if (!isTurboLocality) {
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
      reasonCode: 'NON_TURBO_LOCALITY_AUTO_SCHEDULED',
      message: 'Para esta dirección, continuamos con envío programado. Elige cuándo recibir tu pedido',
      availableModes: {
        turbo: false,
        turboDividido: false,
        scheduled: true,
      },
      recommendedMode: 'PROGRAMADO',
      autoSwitchedToScheduled: true,
      switchReason: 'LOCALITY_NOT_TURBO',
      detectedLocality,
      detectedLocalityName,
      isTurboLocality: false,
      destination,
      geographicDistanceMeters: minTurboGeoDistance,
      geographicDistanceKm: geoKm,
      roadDistanceMeters: Math.round(minTurboGeoDistance * DELIVERY_CONFIG.urbanRoadFactor),
      roadDistanceKm: roadKm,
      scheduledEligible: true,
      scheduledSlots,
      scheduledExplanation: `Turbo y Turbo Dividido aplican exclusivamente en Kennedy, Suba y Engativá. Para ${detectedLocalityName}, continuamos con Envío Programado.`,
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
    return {
      quoteId,
      eligibilityStatus: DeliveryStatus.SCHEDULED_ONLY,
      reasonCode: 'NO_ACTIVE_TURBO_STORES',
      message: 'Para esta dirección, continuamos con envío programado. Elige cuándo recibir tu pedido',
      availableModes: { turbo: false, turboDividido: false, scheduled: true },
      recommendedMode: 'PROGRAMADO',
      autoSwitchedToScheduled: true,
      switchReason: 'TURBO_CONDITIONS_NOT_MET',
      detectedLocality,
      detectedLocalityName,
      isTurboLocality: true,
      destination,
      geographicDistanceMeters: 0,
      geographicDistanceKm: 0,
      roadDistanceMeters: 0,
      roadDistanceKm: 0,
      scheduledEligible: true,
      scheduledSlots,
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

  // ==========================================================================
  // EVALUACIÓN DE PESO Y CONDICIÓN TURBO DIVIDIDO (> 60 KG)
  // Regla estricta: activada ÚNICAMENTE cuando totalWeightGrams > 60000.
  // ==========================================================================
  const isHeavyOrder = totalWeightGrams > DELIVERY_CONFIG.heavyOrderThresholdGrams;

  if (isHeavyOrder && items && items.length > 0 && catalogProducts.length > 0) {
    const splitPlan = generateSplitDeliveryPlan(
      items,
      catalogProducts,
      winner.roadTravelSeconds,
      DELIVERY_CONFIG.maxVehicleWeightGrams
    );

    if (splitPlan.feasible) {
      // CASO B: Turbo Dividido factible y Envío Programado
      return {
        quoteId,
        eligibilityStatus: DeliveryStatus.ELIGIBLE,
        reasonCode: 'TURBO_DIVIDIDO_ELIGIBLE',
        message: `Tu pedido pesa ${totalWeightKg} kg (> 60 kg). Se entregará en ${splitPlan.shipmentCount} motos Turbo simultáneas en aprox. ${winner.estimatedMinutes} min.`,
        availableModes: {
          turbo: false, // Monomoto deshabilitada por exceder 60 kg
          turboDividido: true,
          scheduled: true,
        },
        recommendedMode: 'TURBO_DIVIDIDO',
        autoSwitchedToScheduled: false,
        detectedLocality,
        detectedLocalityName,
        isTurboLocality: true,
        assignedStoreId: winner.store.id,
        assignedStoreName: winner.store.name,
        assignedStoreAddress: winner.store.address,
        assignedStoreCoordinates: getStoreDispatchCoordinates(winner.store),
        destination,
        geographicDistanceMeters: winner.geoDistanceMeters,
        geographicDistanceKm: Number((winner.geoDistanceMeters / 1000).toFixed(1)),
        roadDistanceMeters: winner.roadDistanceMeters,
        roadDistanceKm: Number((winner.roadDistanceMeters / 1000).toFixed(1)),
        etaComponents: winner.etaComponents,
        estimatedMinutes: winner.estimatedMinutes,
        turboDividido: splitPlan,
        scheduledEligible: true,
        scheduledSlots,
        calculatedAt: now.toISOString(),
        expiresAt,
        configVersion: DELIVERY_CONFIG.configVersion,
        candidateWarehousesEvaluated: pool.length,
        basketValidated: true,
        totalWeightKg,
        totalWeightGrams,
      };
    } else {
      // Peso > 60 kg pero división Turbo no es factible -> Envío Programado
      return {
        quoteId,
        eligibilityStatus: DeliveryStatus.SCHEDULED_ONLY,
        reasonCode: 'HEAVY_ORDER_SCHEDULED_ONLY',
        message: 'Para esta dirección, continuamos con envío programado. Elige cuándo recibir tu pedido',
        availableModes: {
          turbo: false,
          turboDividido: false,
          scheduled: true,
        },
        recommendedMode: 'PROGRAMADO',
        autoSwitchedToScheduled: true,
        switchReason: 'WEIGHT_OVERSIZED',
        detectedLocality,
        detectedLocalityName,
        isTurboLocality: true,
        assignedStoreId: winner.store.id,
        assignedStoreName: winner.store.name,
        assignedStoreAddress: winner.store.address,
        assignedStoreCoordinates: getStoreDispatchCoordinates(winner.store),
        destination,
        geographicDistanceMeters: winner.geoDistanceMeters,
        geographicDistanceKm: Number((winner.geoDistanceMeters / 1000).toFixed(1)),
        roadDistanceMeters: winner.roadDistanceMeters,
        roadDistanceKm: Number((winner.roadDistanceMeters / 1000).toFixed(1)),
        scheduledEligible: true,
        scheduledSlots,
        scheduledExplanation: 'Para esta dirección, continuamos con envío programado. Elige cuándo recibir tu pedido',
        calculatedAt: now.toISOString(),
        expiresAt,
        configVersion: DELIVERY_CONFIG.configVersion,
        candidateWarehousesEvaluated: pool.length,
        basketValidated: true,
        totalWeightKg,
        totalWeightGrams,
      };
    }
  }

  // CASO A: Pedido estándar elegible para Turbo (peso <= 60 kg, <= 6 km, <= 25 min en Kennedy/Suba/Engativá)
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
    detectedLocalityName,
    isTurboLocality: true,
    assignedStoreId: winner.store.id,
    assignedStoreName: winner.store.name,
    assignedStoreAddress: winner.store.address,
    assignedStoreCoordinates: getStoreDispatchCoordinates(winner.store),
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
