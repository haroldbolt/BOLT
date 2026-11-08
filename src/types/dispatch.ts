import type { TransportVehicle, TransportLoad } from "./transport";
export type Availability = "OFF_DUTY" | "AVAILABLE" | "OFFER_PENDING" | "BUSY";
export interface DispatchConfig {
  offerSeconds: number;
  searchSeconds: number;
  providerTimeoutSeconds: number;
  locationMaxAgeSeconds: number;
  heartbeatMaxAgeSeconds: number;
  locationAccuracyMeters: number;
  routeMaxAgeSeconds: number;
  routeTieSeconds: number;
  driverSessionHours: number;
  pinAttempts: number;
}
export const DEFAULT_DISPATCH_CONFIG: DispatchConfig = {
  offerSeconds: 30,
  searchSeconds: 180,
  providerTimeoutSeconds: 8,
  locationMaxAgeSeconds: 90,
  heartbeatMaxAgeSeconds: 90,
  locationAccuracyMeters: 100,
  routeMaxAgeSeconds: 60,
  routeTieSeconds: 10,
  driverSessionHours: 12,
  pinAttempts: 5,
};
export interface DriverAccount {
  userId: string;
  driverId: string;
  email: string;
  salt: string;
  passwordHash: string;
  enabled: boolean;
  storeIds: string[];
  status: Availability;
  heartbeatAt?: number;
  accuracy?: number;
  activeDispatchId?: string;
}
export interface PickupEstimate {
  kind: "ROUTE" | "GEOGRAPHIC";
  meters: number;
  seconds?: number;
  source: string;
  observedAt: number;
}
export interface DispatchOffer {
  id: string;
  dispatchId: string;
  driverId: string;
  createdAt: number;
  expiresAt: number;
  status: "PENDING" | "ACCEPTED" | "REJECTED" | "EXPIRED" | "RELEASED";
  estimate: PickupEstimate;
  vehicle: TransportVehicle;
}
export interface ExternalRequest {
  key: string;
  providerId: string;
  reference?: string;
  status:
    | "REQUESTING"
    | "UNKNOWN"
    | "ACCEPTED"
    | "ASSIGNED"
    | "REJECTED"
    | "CANCELLED";
  quoteId: string;
  providerName?: string;
  confirmedLoad?: TransportLoad;
  costCOP: number;
  startedAt: number;
  updatedAt: number;
  driver?: { id: string; name: string };
  estimate?: PickupEstimate;
  simulation: boolean;
  collected?: number;
  cancellationPending?: boolean;
}
export interface DispatchRun {
  id: string;
  orderId: string;
  shipmentId?: string;
  code: string;
  status:
    | "PENDING"
    | "SEARCHING"
    | "OFFER_PENDING"
    | "ASSIGNED"
    | "PICKED_UP"
    | "DELIVERED"
    | "INCIDENT"
    | "CANCELLED"
    | "SEARCH_EXHAUSTED";
  createdAt: number;
  searchStartedAt?: number;
  assignedAt?: number;
  arrivedAt?: number;
  pickedUpAt?: number;
  deliveredAt?: number;
  offerId?: string;
  driverId?: string;
  providerId?: string;
  attempted: string[];
  reason?: string;
  estimate?: PickupEstimate;
  external?: ExternalRequest;
  cashDue: number;
  cashCollected: number;
  pinFailures: number;
  pinLockedUntil?: number;
  releaseRequested?: boolean;
  legacyReconciliation?: { fingerprint:string; at:number; actorId:string; pickupEvidence?: {pickedUpAt:string; sourceReference:string} };
  transfer?: {
    from: string;
    to: string;
    requestedBy: string;
    releasedAt?: number;
    acceptedAt?: number;
  };
}
export interface DispatchEvent {
  id: string;
  at: number;
  type: string;
  actorId: string;
  dispatchId?: string;
  detail?: string;
}
export interface DispatchState {
  recoveries?: Record<string, import("../lib/trackingRecovery").RecoveryCase>;
  version: 1;
  counter: number;
  config: DispatchConfig;
  accounts: Record<string, DriverAccount>;
  sessions: Record<string, { driverId: string; expiresAt: number }>;
  runs: Record<string, DispatchRun>;
  offers: Record<string, DispatchOffer>;
  events: DispatchEvent[];
  guestHashes: Record<string, string>;
  guestSecret: string;
  settlements: Record<
    string,
    { driverId: string; amountCOP: number; adminId: string; at: number }
  >;
  loginFailures: Record<string, { count: number; until: number }>;
}
export function newDispatchState(): DispatchState {
  return {
    version: 1,
    counter: 0,
    config: { ...DEFAULT_DISPATCH_CONFIG },
    accounts: {},
    sessions: {},
    runs: {},
    offers: {},
    events: [],
    guestHashes: {},
    guestSecret: "",
    settlements: {},
    loginFailures: {},
  };
}
