import type { DriverProfile } from './index';
export interface ExternalProviderSimulation {
  id: string;
  name: string;
  integration: 'SIMULATION';
  enabled: boolean;
  storeIds: string[];
  modes: ('TURBO' | 'PROGRAMADO')[];
  response: 'ACCEPTED' | 'DELAYED' | 'REJECTED';
  respondsAt: string;
  offerExpiresAt: string;
  availableVehicles: number;
  shippingPerDispatchCOP: number;
  estimatedMinutes: number;
  maxLoadGrams: number;
  cargoDimensionsCm: [number,number,number];
  maxVolumeCm3: number;
  packagingGrams: number;
  scheduledSlots: string[];
}
export interface ExternalTransportOffer {
  providerId: string;
  providerName: string;
  offerId: string;
  expiresAt: string;
  shippingCOP: number;
  estimatedMinutes: number;
  simulation: true;
  driver: Pick<DriverProfile,'id'|'name'|'phone'|'vehiclePlate'|'vehicleType'|'rating'|'photo'>;
}
export interface ExternalProviderResponse {
  providerId: string;
  providerName: string;
  status: 'ACCEPTED' | 'PENDING' | 'REJECTED' | 'EXPIRED';
  simulation: true;
  message: string;
}
/** Measured per sellable unit. Dimensions include packaging; never inferred from category/name. */
export interface TransportAttributes {
  weightGrams: number;
  packagingGrams: number;
  dimensionsCm: [number, number, number];
  bulky: boolean;
  lightMarginEligible: boolean;
  kind?: 'JUGUETES' | 'MODA' | 'OTRO';
}
export interface TransportVehicle {
  driverId: string;
  storeIds: string[];
  enabled: boolean;
  modes: ('TURBO' | 'PROGRAMADO')[];
  maxLoadGrams: number;
  cargoDimensionsCm: [number, number, number];
  maxVolumeCm3: number;
  packagingGrams: number;
  /** Explicit future availability: YYYY-MM-DD|slotId. */
  scheduledSlots: string[];
  externalOffer?: ExternalTransportOffer;
}
export interface TransportConfig {
  version: 1;
  baseLimitGrams: number;
  lightMarginGrams: number;
  /** null: no business cap; 0: pause all confirmations. Fleet availability still applies. */
  maxDispatches: number | null;
  vehicles: TransportVehicle[];
  externalProviders?: ExternalProviderSimulation[];
  pricing: {
    /** Legacy/scheduled tariff. Existing installations retain it until an authorized edit. */
    shipping: number; freeShippingFrom: number; serviceFee: number;
    /** Customer Turbo price, once per purchase, including split/external deliveries. */
    turbo?: { shipping: number; freeShippingFrom: number };
  };
}
export const DEFAULT_TRANSPORT_CONFIG: TransportConfig = {
  version: 1, baseLimitGrams: 50000, lightMarginGrams: 3000,
  maxDispatches: null, vehicles: [], externalProviders: [],
  // Existing policy: once per purchase, also for split purchases.
  pricing: { shipping: 4900, freeShippingFrom: 70000, serviceFee: 0, turbo: {shipping: 10000, freeShippingFrom: 60000} },
};
export interface TransportLoad {
  driverId: string;
  storeId: string;
  productWeightGrams: number;
  nonEligibleWeightGrams: number;
  grossWeightGrams: number;
  volumeCm3: number;
  lightMarginUsedGrams: number;
  vehicle: TransportVehicle;
}
