import type { Order } from '../types';
import type { CustomerTracking } from '../types/customerTracking';

const durationMs = 4 * 60_000;
const pulseMs = 7_000;
const maxPreviewAgeMs = 24 * 60 * 60_000;

export function isApprovedDemoTracking(order: Order, simulation: boolean, approvedOrderId?: string) {
  return simulation && !!approvedOrderId && order.id === approvedOrderId &&
    order.fulfillmentStatus === 'PENDIENTE_CONFIRMACION' && order.deliveryReview?.status === 'PENDING' &&
    order.deliveryReview.requestedMode === 'TURBO' && !order.isSplitOrder && !order.childShipments?.length &&
    !order.driver && !order.timestamps?.pickedUpAt && !order.transportLoad &&
    order.payment.status === 'PENDIENTE' && order.payment.cashToCollect === 0 &&
    !order.payment.transactionId && !order.payment.cashSettled;
}

/** Read-only replay. Neither the order nor its inventory, custody, or payment is changed. */
export function projectApprovedDemoTracking(tracking: CustomerTracking, startedAt: number, now: number): CustomerTracking {
  const deadline = startedAt + durationMs;
  if (!tracking.simulation || tracking.status !== 'PENDIENTE_CONFIRMACION' ||
      !Number.isSafeInteger(startedAt) || startedAt > now || now - startedAt >= maxPreviewAgeMs) return tracking;

  const completed = now >= deadline;
  const began = new Date(startedAt).toISOString();
  const sampleAt = startedAt + Math.floor((now - startedAt) / pulseMs) * pulseMs;
  const origin = tracking.origin?.coordinates;
  const destination = tracking.destination.coordinates;
  const progress = (sampleAt - startedAt) / durationMs;
  const point = !completed && origin && destination ? {
    orderId: tracking.orderId,
    latitude: origin.lat + (destination.lat - origin.lat) * progress,
    longitude: origin.lng + (destination.lng - origin.lng) * progress,
    accuracy: 0,
    timestamp: sampleAt,
    secondsAgo: Math.floor((now - sampleAt) / 1000),
    sequenceNumber: Math.floor((sampleAt - startedAt) / pulseMs),
  } : null;

  return {
    ...tracking,
    status: completed ? 'ENTREGADO' : 'EN_CAMINO',
    deliveryMode: 'TURBO',
    scheduledWindow: undefined,
    timing: {
      serverTime: new Date(now).toISOString(),
      startedAt: began,
      dueAt: new Date(deadline).toISOString(),
      source: 'SIMULATION',
      stages: { ...tracking.timing.stages, confirmedAt: began, prepCompletedAt: began, pickedUpAt: began,
        deliveredAt: completed ? new Date(deadline).toISOString() : null },
    },
    locationStatus: completed ? 'NOT_IN_TRANSIT' : point ? 'LIVE' : 'UNAVAILABLE',
    locationStale: false,
    lastLocationAt: point ? new Date(point.timestamp).toISOString() : null,
    locationMaxAgeSeconds: 30,
    telemetry: point,
    trail: undefined,
    driver: completed ? null : { name: 'Repartidor de prueba BOLT', phone: '', vehiclePlate: '', vehicleType: 'MOTO', rating: 0, photo: '' },
    secretDeliveryCode: undefined,
    estimatedMinutes: durationMs / 60_000,
  };
}
