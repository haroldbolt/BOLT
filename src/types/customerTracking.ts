import type { DeliveryMode, FulfillmentStatus, Order, ScheduledDeliveryWindow } from './index';
import type { DispatchService } from '../lib/dispatchService';

export type CustomerTrackingCoordinates = { lat: number; lng: number };

export type TrackingStage = 'confirmedAt' | 'prepStartedAt' | 'prepCompletedAt' |
  'assignedAt' | 'pickedUpAt' | 'deliveredAt' | 'cancelledAt';

export interface CustomerTrackingTiming {
  serverTime: string;
  startedAt: string | null;
  dueAt: string | null;
  source: 'BOOKED_WINDOW' | 'VERIFIED_QUOTE' | null;
  stages: Record<TrackingStage, string | null>;
}

export interface CustomerTrackingTelemetry {
  pointId?: string;
  orderId: string;
  shipmentId?: string;
  latitude: number;
  longitude: number;
  accuracy: number;
  heading?: number;
  speed?: number;
  timestamp: number;
  sequenceNumber: number;
  secondsAgo: number;
}

export interface CustomerTracking {
  orderId: string;
  orderNumber: string;
  shipmentId?: string;
  status: FulfillmentStatus;
  deliveryMode?: DeliveryMode;
  scheduledWindow?: ScheduledDeliveryWindow;
  timing: CustomerTrackingTiming;
  locationStatus: 'LIVE' | 'STALE' | 'UNAVAILABLE' | 'NOT_IN_TRANSIT';
  locationStale: boolean;
  lastLocationAt: string | null;
  locationMaxAgeSeconds: number;
  simulation: boolean;
  telemetry: CustomerTrackingTelemetry | null;
  trail?: { coordinates: CustomerTrackingCoordinates[]; source: 'RECORDED_GPS' };
  origin: { name: string; address?: string; coordinates: CustomerTrackingCoordinates | null } | null;
  destination: { address: string; coordinates: CustomerTrackingCoordinates | null };
  cargo: { units: number; productWeightGrams: number; grossWeightGrams: number } | null;
  warehouse?: Order['warehouse'];
  warehouseAssignment?: Order['warehouseAssignment'];
  hubCoordinates: CustomerTrackingCoordinates | null;
  customerCoordinates: CustomerTrackingCoordinates | null;
  driver: Omit<NonNullable<Order['driver']>, 'id'> | null;
  secretDeliveryCode?: string;
  isSplitOrder: boolean;
  shipmentCount: number;
  childShipments?: { shipmentId: string; shipmentIndex: number; fulfillmentStatus: FulfillmentStatus }[];
  dispatchStatusMessage?: string;
  dispatches?: ReturnType<DispatchService['customerDispatches']>;
  estimatedMinutes?: number;
}
