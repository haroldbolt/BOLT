import type { ChildShipment, GPSTelemetry, Order, Store } from '../types';
import type { DispatchRun } from '../types/dispatch';
import type { CustomerTracking, CustomerTrackingCoordinates, CustomerTrackingTiming } from '../types/customerTracking';
import { resolveOrderWarehouse } from './warehouseAssignment';

export const CUSTOMER_TRACKING_TRAIL_POINTS = 24;
const TRAIL_MAX_AGE_MS = 5 * 60_000;

interface TrackingEvidence {
  order: Order;
  child?: ChildShipment;
  store?: Store;
  run?: DispatchRun;
  telemetry?: GPSTelemetry | null;
  telemetryHistory?: GPSTelemetry[];
  maxAgeSeconds: number;
  simulation: boolean;
  now?: number;
}

function dateMillis(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const result = Date.parse(value);
  return Number.isFinite(result) && result > 0 ? result : null;
}

function isoDate(value: unknown, now = Infinity): string | null {
  const millis = dateMillis(value);
  return millis !== null && millis <= now ? new Date(millis).toISOString() : null;
}

function coordinates(point?: CustomerTrackingCoordinates | null): CustomerTrackingCoordinates | null {
  if (!point || !Number.isFinite(point.lat) || Math.abs(point.lat) > 90 ||
    !Number.isFinite(point.lng) || Math.abs(point.lng) > 180 || (point.lat === 0 && point.lng === 0)) return null;
  return { lat: point.lat, lng: point.lng };
}

function bookedWindow(order: Order, startedAt: string) {
  const slot = order.scheduledWindow;
  if (!slot?.slotId || !/^\d{4}-\d{2}-\d{2}$/.test(slot.date) ||
    !/^\d{2}:\d{2}$/.test(slot.startTime) || !/^\d{2}:\d{2}$/.test(slot.endTime)) return null;
  const opening = dateMillis(`${slot.date}T${slot.startTime}:00-05:00`);
  const closing = dateMillis(`${slot.date}T${slot.endTime}:00-05:00`);
  if (!opening || !closing || closing <= opening || closing <= Date.parse(startedAt)) return null;
  // Date.parse rolls certain impossible calendar dates into the following month.
  const bogotaDate = new Date(opening - 5 * 60 * 60_000).toISOString().slice(0, 10);
  if (bogotaDate !== slot.date) return null;
  if (!order.transportConfirmation && dateMillis(order.originalPromiseWindow?.end) !== closing) return null;
  return new Date(closing).toISOString();
}

export function turboDeadline(order: Order, readyAt: string) {
  const quote = order.deliveryQuoteSnapshot;
  const eta = quote?.estimatedMinutes;
  const deadline = dateMillis(order.originalPromiseWindow?.end);
  const windowStart = dateMillis(order.originalPromiseWindow?.start);
  if (!order.transportConfirmation || !quote?.quoteId || quote.assignedStoreId !== order.storeId ||
    !Number.isFinite(quote.totalSeconds) || quote.totalSeconds <= 0 || typeof eta !== 'number' ||
    !Number.isFinite(eta) || eta <= 0 || !deadline || !windowStart || deadline <= windowStart) return null;
  // The checkout derives the saved promise from this estimate. Allow rounding and writes across a clock tick.
  if (Math.abs(deadline - windowStart - eta * 60_000) > 10_000) return null;
  // The quote fixes the duration. The warehouse readiness transition fixes the clock origin.
  const due = new Date(Date.parse(readyAt) + eta * 60_000);
  return Number.isFinite(due.getTime()) ? { dueAt: due.toISOString(), estimatedMinutes: eta } : null;
}

export function buildCustomerTracking({
  order, child, store, run, telemetry, telemetryHistory = [], maxAgeSeconds, simulation, now = Date.now(),
}: TrackingEvidence): CustomerTracking {
  const isSplitOrder = !!order.isSplitOrder || !!order.childShipments?.length;
  const tracked = child || order;
  const savedWarehouse = resolveOrderWarehouse(order, store ? [store] : []);
  const hideWarehouseAddress = store?.showAddressToCustomer === false;
  const warehouse = savedWarehouse && hideWarehouseAddress ? { ...savedWarehouse, address: undefined } : savedWarehouse;
  const warehouseAssignment = order.warehouseAssignment && hideWarehouseAddress
    ? { ...order.warehouseAssignment, store: { ...order.warehouseAssignment.store, address: undefined } }
    : order.warehouseAssignment;
  const origin = warehouse ? {
    name: warehouse.customerName,
    address: warehouse.address,
    coordinates: store?.id === warehouse.id && !hideWarehouseAddress && store.verificationStatus === 'VERIFIED'
      ? coordinates(store.verifiedEntrance) : null,
  } : null;
  const destination = { address: order.deliveryAddress.address, coordinates: coordinates(order.deliveryAddress.coordinates) };

  const stages: CustomerTrackingTiming['stages'] = {
    confirmedAt: isoDate(tracked.timestamps?.confirmedAt ?? order.timestamps?.confirmedAt, now),
    prepStartedAt: isoDate(tracked.timestamps?.prepStartedAt, now),
    prepCompletedAt: isoDate(tracked.timestamps?.prepCompletedAt, now),
    assignedAt: isoDate(tracked.timestamps?.assignedAt, now),
    pickedUpAt: isoDate(tracked.timestamps?.pickedUpAt, now),
    deliveredAt: isoDate(tracked.timestamps?.deliveredAt, now),
    cancelledAt: isoDate(tracked.timestamps?.cancelledAt, now),
  };
  const pending = order.deliveryReview?.status === 'PENDING' || tracked.fulfillmentStatus === 'PENDIENTE_CONFIRMACION';
  const isSelectedShipment = !isSplitOrder || !!child;
  const isTurbo = order.deliveryMode === 'TURBO' || order.deliveryMode === 'TURBO_DIVIDIDO';
  const preparing = tracked.fulfillmentStatus === 'CONFIRMADO' || tracked.fulfillmentStatus === 'EN_ALISTAMIENTO';
  const clockOrigin = isTurbo
    ? (isSelectedShipment && !preparing ? stages.prepCompletedAt : null)
    : isoDate(order.timestamps?.confirmedAt, now) ?? stages.confirmedAt;
  const startedAt = pending ? null : clockOrigin;
  let dueAt: string | null = null;
  let source: CustomerTrackingTiming['source'] = null;
  let estimatedMinutes: number | undefined;
  if (startedAt && order.deliveryMode === 'PROGRAMADO') {
    dueAt = bookedWindow(order, startedAt);
    if (dueAt) source = 'BOOKED_WINDOW';
  } else if (startedAt && isTurbo) {
    const estimate = turboDeadline(order, startedAt);
    if (estimate) {
      source = 'VERIFIED_QUOTE';
      dueAt = estimate.dueAt;
      estimatedMinutes = estimate.estimatedMinutes;
    }
  }

  const shipmentId = child?.shipmentId;
  const isInTransit = isSelectedShipment && !pending && tracked.fulfillmentStatus === 'EN_CAMINO';
  const isMatchingRun = !!run && isSelectedShipment && run.id === tracked.assignmentId && run.orderId === order.id &&
    run.shipmentId === shipmentId && !!run.driverId && run.driverId === tracked.driver?.id;
  const custodyStartedAt = Math.max(run?.pickedUpAt ?? 0, run?.transfer?.acceptedAt ?? 0);
  const custodyReleased = !!run?.transfer?.releasedAt && !run.transfer.acceptedAt;
  const currentCustody = isInTransit && isMatchingRun && run?.status === 'PICKED_UP' && !custodyReleased && custodyStartedAt > 0;
  const driverIsVisible = !pending && isMatchingRun && !custodyReleased &&
    (currentCustody || (tracked.fulfillmentStatus === 'REPARTIDOR_ASIGNADO' && run?.status === 'ASSIGNED'));
  const isCustodyPoint = (point?: GPSTelemetry | null): point is GPSTelemetry => !!point && !!run && currentCustody &&
    point.orderId === order.id && point.shipmentId === shipmentId && point.driverId === run.driverId &&
    point.assignmentId === run.id && !!tracked.tripId && point.tripId === tracked.tripId &&
    Number.isFinite(point.timestamp) && point.timestamp >= custodyStartedAt && point.timestamp <= now &&
    Number.isSafeInteger(point.sequenceNumber) && point.sequenceNumber >= 0 &&
    Number.isFinite(point.accuracy) && point.accuracy >= 0 && point.accuracy <= 200 &&
    !!coordinates({ lat: point.latitude, lng: point.longitude });
  const lastPoint = isCustodyPoint(telemetry) ? telemetry : null;
  const freshnessLimit = Number.isFinite(maxAgeSeconds) && maxAgeSeconds > 0 ? maxAgeSeconds : 0;
  const freshPoint = lastPoint && freshnessLimit && now - lastPoint.timestamp <= freshnessLimit * 1000 ? lastPoint : null;
  const recordedPoints = freshPoint ? telemetryHistory.slice(-CUSTOMER_TRACKING_TRAIL_POINTS)
    .filter(point => isCustodyPoint(point) && now - point.timestamp <= TRAIL_MAX_AGE_MS)
    .map(point => ({ lat: point.latitude, lng: point.longitude })) : [];

  const load = !pending && isSelectedShipment ? tracked.transportLoad : undefined;
  const units = tracked.items.reduce((total, item) => total + item.quantity, 0);
  const cargo = load && load.storeId === order.storeId && Number.isSafeInteger(units) && units > 0 &&
    Number.isSafeInteger(load.productWeightGrams) && load.productWeightGrams > 0 &&
    Number.isSafeInteger(load.grossWeightGrams) && load.grossWeightGrams >= load.productWeightGrams ? {
      units, productWeightGrams: load.productWeightGrams, grossWeightGrams: load.grossWeightGrams,
    } : null;

  return {
    orderId: order.id, orderNumber: order.orderNumber, shipmentId, status: tracked.fulfillmentStatus,
    deliveryMode: order.deliveryMode, scheduledWindow: dueAt && source === 'BOOKED_WINDOW' ? order.scheduledWindow : undefined,
    timing: { serverTime: new Date(now).toISOString(), startedAt, dueAt, source, stages },
    locationStatus: !isInTransit ? 'NOT_IN_TRANSIT' : freshPoint ? 'LIVE' : lastPoint ? 'STALE' : 'UNAVAILABLE',
    locationStale: !!lastPoint && !freshPoint,
    lastLocationAt: lastPoint ? new Date(lastPoint.timestamp).toISOString() : null,
    locationMaxAgeSeconds: freshnessLimit,
    simulation,
    telemetry: freshPoint ? {
      pointId: freshPoint.pointId, orderId: freshPoint.orderId, shipmentId: freshPoint.shipmentId,
      latitude: freshPoint.latitude, longitude: freshPoint.longitude, accuracy: freshPoint.accuracy,
      heading: Number.isFinite(freshPoint.heading) ? freshPoint.heading : undefined,
      speed: Number.isFinite(freshPoint.speed) && freshPoint.speed! >= 0 ? freshPoint.speed : undefined,
      timestamp: freshPoint.timestamp, sequenceNumber: freshPoint.sequenceNumber,
      secondsAgo: Math.floor((now - freshPoint.timestamp) / 1000),
    } : null,
    trail: recordedPoints.length >= 2 ? { coordinates: recordedPoints, source: 'RECORDED_GPS' } : undefined,
    origin, destination, cargo, warehouse, warehouseAssignment,
    hubCoordinates: origin?.coordinates ?? null, customerCoordinates: destination.coordinates,
    driver: driverIsVisible && tracked.driver ? {
      name: tracked.driver.name, phone: tracked.driver.phone, vehiclePlate: tracked.driver.vehiclePlate,
      vehicleType: tracked.driver.vehicleType, photo: tracked.driver.photo, rating: tracked.driver.rating,
    } : null,
    secretDeliveryCode: isInTransit ? tracked.secretDeliveryCode : undefined,
    isSplitOrder, shipmentCount: order.childShipments?.length || order.shipmentCount || 1,
    childShipments: order.childShipments?.map(({ shipmentId, shipmentIndex, fulfillmentStatus }) =>
      ({ shipmentId, shipmentIndex, fulfillmentStatus })),
    estimatedMinutes,
  };
}
