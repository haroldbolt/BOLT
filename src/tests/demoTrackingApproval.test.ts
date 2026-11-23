import assert from 'node:assert/strict';
import test from 'node:test';
import { INITIAL_ORDERS } from '../data/seedData';
import { buildCustomerTracking } from '../lib/customerTracking';
import { readDeliveryClock } from '../lib/customerTrackingTiming';
import { isApprovedDemoTracking, projectApprovedDemoTracking } from '../lib/demoTrackingApproval';
import type { Order } from '../types';

const start = Date.parse('2026-11-16T17:00:00-05:00');
const order: Order = {
  ...INITIAL_ORDERS[0],
  id: 'ORD-DEMO-APPROVAL',
  fulfillmentStatus: 'PENDIENTE_CONFIRMACION',
  deliveryReview: { status: 'PENDING', requestedMode: 'TURBO', reasonCode: 'TRANSPORT_DATA_PENDING', requestedAt: new Date(start).toISOString() },
  payment: { method: 'CASH_ON_DELIVERY', status: 'PENDIENTE', cashToCollect: 0 },
  driver: undefined,
  assignmentId: undefined,
  transportLoad: undefined,
  isSplitOrder: false,
  childShipments: undefined,
  timestamps: {},
};
function pendingTracking() {
  const tracking = buildCustomerTracking({ order, simulation: true, maxAgeSeconds: 45, now: start });
  tracking.origin = { name: 'Kennedy', coordinates: { lat: 4.638, lng: -74.141 } };
  tracking.destination.coordinates = { lat: 4.65, lng: -74.11 };
  return tracking;
}

test('approval applies to the designated unpaid pending order in the demo alone', () => {
  assert(isApprovedDemoTracking(order, true, order.id));
  assert(!isApprovedDemoTracking(order, false, order.id));
  assert(!isApprovedDemoTracking(order, true, 'ORD-OTHER'));
  assert(!isApprovedDemoTracking(order, true));
  assert(!isApprovedDemoTracking({ ...order, fulfillmentStatus: 'CANCELADO' }, true, order.id));
  assert(!isApprovedDemoTracking({ ...order, payment: { ...order.payment, cashToCollect: 490000 } }, true, order.id));
  assert(isApprovedDemoTracking({ ...order, assignmentId: 'RESERVED-ID' }, true, order.id));
  assert(!isApprovedDemoTracking({ ...order, timestamps: { pickedUpAt: new Date(start).toISOString() } }, true, order.id));
});

test('the simulated clock and GPS advance in a read-only view of the same purchase', () => {
  const base = pendingTracking();
  const before = structuredClone({ order, base });
  const first = projectApprovedDemoTracking(base, start, start);
  const next = projectApprovedDemoTracking(base, start, start + 14000);
  const done = projectApprovedDemoTracking(base, start, start + 240000);
  assert.equal(first.orderId, order.id);
  assert.equal(first.status, 'EN_CAMINO');
  assert.equal(first.telemetry?.latitude, base.origin?.coordinates?.lat);
  assert.equal(first.timing.source, 'SIMULATION');
  assert.equal(readDeliveryClock(first.timing, start).remainingSeconds, 240);
  assert.equal(readDeliveryClock(next.timing, start + 14000).remainingSeconds, 226);
  assert.notDeepEqual(next.telemetry, first.telemetry);
  assert.equal(next.locationStatus, 'LIVE');
  assert.equal(next.secretDeliveryCode, undefined);
  assert.equal(next.trail, undefined);
  assert.equal(done.status, 'ENTREGADO');
  assert.equal(done.telemetry, null);
  assert.deepEqual({ order, base }, before);
});

test('future and expired starts and live operation do not expose simulated GPS', () => {
  const base = pendingTracking();
  assert.equal(projectApprovedDemoTracking(base, start + 1, start), base);
  assert.equal(projectApprovedDemoTracking(base, start, start + 86400000), base);
  const live = { ...base, simulation: false };
  assert.equal(projectApprovedDemoTracking(live, start, start), live);
});
