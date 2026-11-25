import assert from 'node:assert/strict';
import { test } from 'node:test';
import { INITIAL_ORDERS, INITIAL_STORES } from '../data/seedData';
import { buildCustomerTracking } from '../lib/customerTracking';
import { formatDeliveryClock, readDeliveryClock } from '../lib/customerTrackingTiming';
import type { ChildShipment, GPSTelemetry, Order, Store } from '../types';
import type { DispatchRun } from '../types/dispatch';

const started = Date.parse('2026-11-16T15:00:00.000Z');
// Preparation can outlast the original checkout estimate.
const confirmed = started - 30 * 60_000;
const now = started + 5 * 60_000;
const iso = (time: number) => new Date(time).toISOString();
const store: Store = {
  ...INITIAL_STORES.find((entry) => entry.id === 'HUB_SUBA')!,
  showAddressToCustomer: true,
  verificationStatus: 'VERIFIED',
  verifiedEntrance: { lat: 4.73, lng: -74.08 },
};
const fixtureOrder: Order = {
  ...structuredClone(INITIAL_ORDERS[0]),
  id: 'TRACKING-FIXTURE',
  orderNumber: 'TRACKING-FIXTURE',
  storeId: store.id,
  deliveryMode: 'TURBO',
  fulfillmentStatus: 'EN_CAMINO',
  assignmentId: 'tracking-assignment',
  tripId: 'tracking-trip',
  deliveryAddress: {
    address: 'Destino ficticio', details: '', porteriaPolicy: 'DEJAR_EN_PORTERIA',
    coordinates: { lat: 4.72, lng: -74.07 },
  },
  timestamps: { confirmedAt: iso(confirmed), prepCompletedAt: iso(started), pickedUpAt: iso(started + 60_000) },
  originalPromiseWindow: { start: iso(confirmed), end: iso(confirmed + 20 * 60_000) },
  estimatedDeliveryMinutes: 99,
  transportConfirmation: 'checkout-verified-quote',
  deliveryQuoteSnapshot: {
    quoteId: 'saved-test-quote', geographicDistanceMeters: 900, roadDistanceMeters: 1500,
    totalSeconds: 1200, estimatedMinutes: 20, configVersion: 'test', assignedStoreId: store.id,
  },
  driver: {
    id: 'tracking-driver', name: 'Repartidor de prueba', phone: '0000000000',
    vehiclePlate: 'PRUEBA', vehicleType: 'MOTO', photo: '', rating: 0,
  },
};
const run: DispatchRun = {
  id: fixtureOrder.assignmentId!, orderId: fixtureOrder.id, code: 'tracking-dispatch',
  status: 'PICKED_UP', driverId: fixtureOrder.driver!.id, pickedUpAt: started + 60_000,
  createdAt: started, attempted: [], cashDue: 0, cashCollected: 0, pinFailures: 0,
};
const point: GPSTelemetry = {
  pointId: 'point-1', orderId: fixtureOrder.id, driverId: fixtureOrder.driver!.id,
  assignmentId: fixtureOrder.assignmentId!, tripId: fixtureOrder.tripId!,
  latitude: 4.725, longitude: -74.075, accuracy: 10, batteryLevel: 55,
  timestamp: now - 5000, sequenceNumber: 1,
};
const fixture = { order: fixtureOrder, store, run, telemetry: point, now, simulation: false, maxAgeSeconds: 30 };

test('Turbo starts at the persisted ready time even after a long preparation and survives refresh, overdue and delivery', () => {
  const first = buildCustomerTracking(fixture);
  const refreshed = buildCustomerTracking({ ...fixture, now: now + 30_000 });
  assert.equal(first.timing.startedAt, iso(started));
  assert.equal(first.timing.source, 'VERIFIED_QUOTE');
  assert.equal(first.timing.dueAt, iso(started + 20 * 60_000));
  assert.equal(first.estimatedMinutes, 20, 'ignore the historical UI fallback of 99 minutes');
  assert.equal(refreshed.timing.serverTime, iso(now + 30_000));
  assert.equal(refreshed.timing.startedAt, first.timing.startedAt);
  assert.equal(refreshed.timing.dueAt, first.timing.dueAt);
  assert.deepEqual(readDeliveryClock(first.timing, now), {
    elapsedSeconds: 300, remainingSeconds: 900, overdue: false,
  });
  assert.deepEqual(readDeliveryClock(refreshed.timing, now + 30_000), {
    elapsedSeconds: 330, remainingSeconds: 870, overdue: false,
  });
  assert.deepEqual(readDeliveryClock(refreshed.timing, started + 21 * 60_000), {
    elapsedSeconds: 1260, remainingSeconds: 0, overdue: true,
  });
  assert.deepEqual(readDeliveryClock(refreshed.timing, started + 21 * 60_000, iso(now + 90_000)), {
    elapsedSeconds: 390, remainingSeconds: null, overdue: false,
  });
  assert.deepEqual(readDeliveryClock(refreshed.timing, now, null), {
    elapsedSeconds: null, remainingSeconds: null, overdue: false,
  });
  assert.equal(formatDeliveryClock(390), '06:30');
  assert.equal(formatDeliveryClock(3661), '1:01:01');
});

test('Turbo confirmation and preparation never start the clock', () => {
  for (const fulfillmentStatus of ['CONFIRMADO', 'EN_ALISTAMIENTO'] as const) {
    const tracking = buildCustomerTracking({ ...fixture, order: {
      ...fixtureOrder, fulfillmentStatus,
      timestamps: { confirmedAt: iso(confirmed), prepStartedAt: iso(confirmed + 5000) },
    } });
    assert.equal(tracking.timing.startedAt, null);
    assert.equal(tracking.timing.dueAt, null);
    assert.equal(tracking.timing.source, null);
    assert.equal(readDeliveryClock(tracking.timing, now).remainingSeconds, null);
  }
  const missingReady = buildCustomerTracking({ ...fixture, order: {
    ...fixtureOrder, timestamps: { confirmedAt: iso(confirmed), pickedUpAt: iso(started + 60_000) },
  } });
  assert.equal(missingReady.timing.startedAt, null, 'a later operational state cannot invent a ready timestamp');
  assert.equal(missingReady.timing.dueAt, null);
  assert.equal(readDeliveryClock({ startedAt: null, dueAt: iso(now + 60_000), source: 'VERIFIED_QUOTE' }, now).remainingSeconds, null);
});

test('a legacy or pending order cannot borrow unverified start and countdown values', () => {
  const legacy = buildCustomerTracking({ ...fixture, telemetry: null, run: undefined, order: {
    ...fixtureOrder,
    transportConfirmation: undefined,
    timestamps: { confirmedAt: iso(now + 60_000) },
  } });
  assert.equal(legacy.timing.startedAt, null);
  assert.equal(legacy.timing.source, null);
  assert.equal(legacy.timing.dueAt, null);
  assert.equal(legacy.estimatedMinutes, undefined);
  assert.deepEqual(readDeliveryClock({ ...legacy.timing, dueAt: fixtureOrder.originalPromiseWindow.end }, now), {
    elapsedSeconds: null, remainingSeconds: null, overdue: false,
  });

  const unverifiableQuote = buildCustomerTracking({ ...fixture, order: {
    ...fixtureOrder, originalPromiseWindow: { ...fixtureOrder.originalPromiseWindow, end: iso(now + 999_000) },
  } });
  assert.equal(unverifiableQuote.timing.startedAt, iso(started));
  assert.equal(unverifiableQuote.timing.dueAt, null);

  const pending = buildCustomerTracking({ ...fixture, order: { ...fixtureOrder, fulfillmentStatus: 'PENDIENTE_CONFIRMACION' } });
  assert.equal(pending.timing.startedAt, null);
  assert.equal(pending.timing.dueAt, null);
  assert.equal(pending.locationStatus, 'NOT_IN_TRANSIT');
  assert.equal(pending.telemetry, null);
  assert.equal(pending.secretDeliveryCode, undefined);
});

test('a booked window uses its real closing time in Bogotá', () => {
  const slot = {
    slotId: '2026-11-17-HORARIO_2', date: '2026-11-17', dateLabel: '17 de noviembre',
    startTime: '14:00', endTime: '18:00', displayWindow: '14:00–18:00',
  };
  const order: Order = { ...fixtureOrder, deliveryMode: 'PROGRAMADO', scheduledWindow: slot };
  const scheduled = buildCustomerTracking({ ...fixture, order });
  assert.equal(scheduled.timing.source, 'BOOKED_WINDOW');
  assert.equal(scheduled.timing.dueAt, '2026-11-17T23:00:00.000Z');
  assert.equal(scheduled.scheduledWindow?.slotId, slot.slotId);
  const noBookingEvidence = buildCustomerTracking({ ...fixture, order: { ...order, transportConfirmation: undefined } });
  assert.equal(noBookingEvidence.timing.dueAt, null);
  assert.equal(noBookingEvidence.scheduledWindow, undefined);
});

test('GPS is restricted to fresh, accurate telemetry from the driver in custody', () => {
  const current = buildCustomerTracking(fixture);
  assert.equal(current.locationStatus, 'LIVE');
  assert.equal(current.telemetry?.latitude, point.latitude);
  assert.equal(current.telemetry?.secondsAgo, 5);
  for (const privateField of ['driverId', 'assignmentId', 'tripId', 'batteryLevel']) {
    assert.equal(Object.hasOwn(current.telemetry!, privateField), false);
  }
  const stale = buildCustomerTracking({ ...fixture, now: now + 26_000 });
  assert.equal(stale.locationStatus, 'STALE');
  assert.equal(stale.telemetry, null);
  assert.equal(stale.lastLocationAt, iso(point.timestamp));

  for (const telemetry of [
    { ...point, orderId: 'unrelated-order' }, { ...point, shipmentId: 'sibling' },
    { ...point, driverId: 'old-driver' }, { ...point, tripId: 'old-trip' },
    { ...point, assignmentId: 'old-assignment' }, { ...point, accuracy: 300 },
    { ...point, timestamp: now + 1000 }, { ...point, timestamp: run.pickedUpAt! - 1000 },
    { ...point, latitude: 0, longitude: 0 },
  ]) {
    const blocked = buildCustomerTracking({ ...fixture, telemetry });
    assert.equal(blocked.locationStatus, 'UNAVAILABLE');
    assert.equal(blocked.telemetry, null);
    assert.equal(blocked.lastLocationAt, null);
  }
  const assigned = buildCustomerTracking({ ...fixture, order: { ...fixtureOrder, fulfillmentStatus: 'REPARTIDOR_ASIGNADO' },
    run: { ...run, status: 'ASSIGNED' } });
  assert.equal(assigned.locationStatus, 'NOT_IN_TRANSIT');
  assert.equal(assigned.telemetry, null);
  assert.equal(assigned.secretDeliveryCode, undefined);
  const noCustody = buildCustomerTracking({ ...fixture, run: { ...run, status: 'ASSIGNED', pickedUpAt: undefined } });
  assert.equal(noCustody.locationStatus, 'UNAVAILABLE');
  assert.equal(noCustody.telemetry, null);

  const transfer = { from: 'prior-driver', to: run.driverId!, requestedBy: 'admin', releasedAt: now - 2000 };
  const released = buildCustomerTracking({ ...fixture, run: { ...run, transfer } });
  assert.equal(released.telemetry, null, 'released custody does not publish a driver until accepted');
  const acceptedRun = { ...run, transfer: { ...transfer, acceptedAt: now - 1000 } };
  const priorPoint = buildCustomerTracking({ ...fixture, run: acceptedRun });
  assert.equal(priorPoint.telemetry, null, 'the next custodian must send a point after accepting');
  const nextPoint = buildCustomerTracking({ ...fixture, run: acceptedRun, telemetry: { ...point, timestamp: now } });
  assert.equal(nextPoint.locationStatus, 'LIVE');
});

test('split-order selection does not expose a sibling GPS or PIN; hidden warehouses do not publish coordinates', () => {
  const child: ChildShipment = {
    ...fixtureOrder,
    parentOrderId: fixtureOrder.id, shipmentId: 'shipment-a', shipmentIndex: 1, shipmentCount: 2,
    weightKg: 1, weightGrams: 1000, subtotal: 10000, cashToCollect: 0, secretDeliveryCode: 'PIN-A',
  };
  const sibling: ChildShipment = {
    ...child, shipmentId: 'shipment-b', shipmentIndex: 2, assignmentId: 'sibling-assignment',
    tripId: 'sibling-trip', secretDeliveryCode: 'PIN-B',
  };
  const order: Order = { ...fixtureOrder, deliveryMode: 'TURBO_DIVIDIDO', isSplitOrder: true, childShipments: [child, sibling] };
  const selectedRun = { ...run, shipmentId: child.shipmentId };
  const selectedPoint = { ...point, shipmentId: child.shipmentId };
  const both = buildCustomerTracking({ ...fixture, order, run: selectedRun, telemetry: selectedPoint });
  assert.equal(both.timing.startedAt, null, 'the undifferentiated purchase cannot inherit the first shipment clock');
  assert.equal(both.timing.dueAt, null);
  const waitingSibling = buildCustomerTracking({ ...fixture, order, child: {
    ...sibling, fulfillmentStatus: 'EN_ALISTAMIENTO', timestamps: { confirmedAt: iso(confirmed) },
  } });
  assert.equal(waitingSibling.timing.startedAt, null);
  assert.equal(waitingSibling.timing.dueAt, null);
  const siblingReady = buildCustomerTracking({ ...fixture, order, child: {
    ...sibling, fulfillmentStatus: 'LISTO_PARA_DESPACHO', timestamps: { confirmedAt: iso(confirmed), prepCompletedAt: iso(now) },
  } });
  assert.equal(siblingReady.timing.dueAt, iso(now + 20 * 60_000));
  assert.equal(both.shipmentCount, 2);
  assert.equal(both.telemetry, null);
  assert.equal(both.secretDeliveryCode, undefined);
  assert.deepEqual(both.childShipments?.map((entry) => Object.keys(entry).sort()), [
    ['fulfillmentStatus', 'shipmentId', 'shipmentIndex'], ['fulfillmentStatus', 'shipmentId', 'shipmentIndex'],
  ]);

  const validChild = buildCustomerTracking({ ...fixture, order, child, run: selectedRun, telemetry: selectedPoint });
  assert.equal(validChild.locationStatus, 'LIVE');
  assert.equal(validChild.secretDeliveryCode, child.secretDeliveryCode);
  const wrongChild = buildCustomerTracking({ ...fixture, order, child: sibling, run: selectedRun, telemetry: selectedPoint,
    store: { ...store, showAddressToCustomer: false } });
  assert.equal(wrongChild.locationStatus, 'UNAVAILABLE');
  assert.equal(wrongChild.telemetry, null);
  assert.equal(wrongChild.origin?.coordinates, null);
  assert.equal(wrongChild.origin?.address, undefined);
  assert.equal(wrongChild.secretDeliveryCode, sibling.secretDeliveryCode);
});
