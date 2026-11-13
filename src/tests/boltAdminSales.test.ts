import assert from 'node:assert/strict';
import { INITIAL_ORDERS } from '../data/seedData';
import { buildBoltAdminSalesReport } from '../lib/boltAdminSales';
import type { Order } from '../types';

const now = new Date('2026-11-13T06:45:00Z');
const suba = { id: 'HUB_SUBA', name: 'Suba' };
const kennedy = { id: 'HUB_KENNEDY', name: 'Kennedy' };
const [seed] = INITIAL_ORDERS;
const item = { ...seed.items[0], productId: 'variant', name: 'Producto de prueba', price: 2_000, quantity: 2 };
const payment: Order['payment'] = { method: 'CASH_ON_DELIVERY', status: 'APROBADO', cashSettled: true };
const testOrder = (id: string, confirmedAt: string, overrides: Partial<Order> = {}): Order => ({
  ...seed,
  id,
  storeId: suba.id,
  createdAt: confirmedAt,
  timestamps: { confirmedAt },
  fulfillmentStatus: 'CONFIRMADO',
  payment,
  items: [item],
  totals: { ...seed.totals, total: 9_000 },
  ...overrides,
});

const split = testOrder('split', '2026-11-13T05:00:00Z', {
  createdAt: '2026-11-12T20:00:00Z',
  fulfillmentStatus: 'ENTREGADO',
  isSplitOrder: true,
});
const legacy = testOrder('legacy', '2026-11-13T06:10:00Z', { timestamps: {} });
const online = testOrder('online', '2026-11-13T06:20:00Z', {
  items: [{ ...item, productId: 'parent', quantity: 1 }],
  payment: { method: 'WOMPI_CARD', status: 'APROBADO', transactionId: 'FAKE' },
});
const orders = [
  split,
  split,
  testOrder('child', split.createdAt, { parentOrderId: split.id, timestamps: split.timestamps }),
  legacy,
  online,
  testOrder('previous', '2026-11-12T06:30:00Z', { items: [{ ...item, quantity: 3 }] }),
  testOrder('later-yesterday', '2026-11-12T06:46:00Z'),
  testOrder('future', '2026-11-13T06:46:00Z'),
  testOrder('pending', '2026-11-13T06:00:00Z', { fulfillmentStatus: 'PENDIENTE_CONFIRMACION' }),
  testOrder('cancelled', '2026-11-13T06:00:00Z', { fulfillmentStatus: 'CANCELADO' }),
  testOrder('refunded', '2026-11-13T06:00:00Z', { payment: { ...payment, status: 'REEMBOLSADO' } }),
  testOrder('payment-failed', '2026-11-13T06:00:00Z', { payment: { ...payment, status: 'RECHAZADO' } }),
  testOrder('other-store', '2026-11-13T06:00:00Z', { storeId: kennedy.id }),
];

const collectedAt = Date.parse('2026-11-13T06:40:00Z');
const inputs = {
  now,
  orders,
  stores: [suba],
  demo: false,
  catalog: [
    { id: 'variant', parentProductId: 'parent', name: 'Producto agrupado' },
    { id: 'parent', name: 'Producto agrupado' },
  ],
  runs: [
    { orderId: split.id, cashCollected: 3_000, deliveredAt: collectedAt, status: 'DELIVERED' as const },
    { orderId: split.id, cashCollected: 4_000, deliveredAt: collectedAt, status: 'DELIVERED' as const },
    { orderId: split.id, cashCollected: 2_000, deliveredAt: collectedAt, status: 'CANCELLED' as const },
    { orderId: online.id, cashCollected: 9_000, deliveredAt: collectedAt, status: 'DELIVERED' as const },
  ],
};

const today = buildBoltAdminSalesReport({ ...inputs, period: 'today' });
assert.equal(today.from, '2026-11-13');
assert.equal(today.to, '2026-11-13');
assert.deepEqual(today.summary, { orderCount: 3, confirmedCOP: 27_000, collectedCOP: 7_000, units: 5, averageOrderCOP: 9_000 });
assert.deepEqual(today.series.map(bucket => [bucket.label, bucket.orderCount]), [['00:00', 1], ['01:00', 2]]);
assert.deepEqual(today.stores, [{ ...suba, orderCount: 3, confirmedCOP: 27_000, collectedCOP: 7_000 }]);
assert.deepEqual(today.products, [{ id: 'parent', name: 'Producto agrupado', units: 5, previousUnits: 3, revenueCOP: 10_000, changePercent: 67 }]);

const week = buildBoltAdminSalesReport({ ...inputs, stores: [suba, kennedy], period: '7d' });
assert.equal(week.from, '2026-11-07');
assert.equal(week.series.length, 7);
assert.deepEqual(week.stores.map(store => [store.id, store.orderCount]), [[suba.id, 5], [kennedy.id, 1]]);
assert.equal(week.products[0].changePercent, null);

const demo = buildBoltAdminSalesReport({ ...inputs, period: '30d', demo: true });
assert.equal(demo.from, '2026-10-15');
assert.equal(demo.series.length, 30);
assert.equal(demo.demo, true);
assert.equal(demo.summary.collectedCOP, 0);

const simulatedDeliveryAt = '2026-11-13T05:25:00Z';
const simulatedOrder = testOrder('simulated-delivery', '2026-11-12T06:35:00Z', {
  purchaseCode: 'BP-000011',
  fulfillmentStatus: 'ENTREGADO',
  timestamps: { confirmedAt: '2026-11-12T06:35:00Z', deliveredAt: simulatedDeliveryAt },
  deliveryReview: { status: 'SIMULATED', requestedAt: '2026-11-12T05:00:00Z', reasonCode: 'MISSING_TRANSPORT_DATA' },
  payment: { method: 'CASH_ON_DELIVERY', status: 'PENDIENTE', cashToCollect: 0 },
  items: [{ ...item, name: 'Agility Gold Adulto Raza Grande', presentation: '15 kg', quantity: 1, price: 245_000 }],
  totals: { ...seed.totals, total: 245_000 },
});
const otherStoreDelivery = { ...simulatedOrder, id: 'simulated-kennedy', purchaseCode: undefined, orderNumber: 'LEGACY-TEST', storeId: kennedy.id };
const olderDelivery = { ...simulatedOrder, id: 'simulated-yesterday', timestamps: { deliveredAt: '2026-11-13T04:59:59Z' } };
const futureDelivery = { ...simulatedOrder, id: 'simulated-future', timestamps: { deliveredAt: '2026-11-13T06:46:00Z' } };
const pendingDelivery: Order = {
  ...simulatedOrder,
  id: 'simulated-not-delivered',
  fulfillmentStatus: 'EN_CAMINO',
  timestamps: { confirmedAt: '2026-11-13T05:15:00Z', deliveredAt: simulatedDeliveryAt },
};
const missingDeliveryDate = { ...simulatedOrder, id: 'simulated-no-date', timestamps: {} };
const testOrders: Order[] = [
  simulatedOrder,
  otherStoreDelivery,
  olderDelivery,
  futureDelivery,
  pendingDelivery,
  missingDeliveryDate,
  split,
  { ...simulatedOrder, id: 'simulated-approved-payment', payment: { ...simulatedOrder.payment, status: 'APROBADO' } },
  { ...simulatedOrder, id: 'simulated-balance-due', payment: { ...simulatedOrder.payment, cashToCollect: 245_000 } },
  { ...simulatedOrder, id: 'simulated-no-balance', payment: { ...simulatedOrder.payment, cashToCollect: undefined } },
  { ...simulatedOrder, id: 'simulated-with-transaction', payment: { ...simulatedOrder.payment, transactionId: 'FAKE-TEST' } },
  { ...simulatedOrder, id: 'simulated-settled', payment: { ...simulatedOrder.payment, cashSettled: true } },
];
const mixedInputs = {
  ...inputs,
  orders: [...inputs.orders, ...testOrders],
  runs: [...inputs.runs, { orderId: pendingDelivery.id, cashCollected: 245_000, deliveredAt: collectedAt, status: 'DELIVERED' as const }],
  testOrders,
};
assert.deepEqual(today.testDeliveries, []);
assert.deepEqual(buildBoltAdminSalesReport({ ...mixedInputs, period: 'today' }), today);

const demoToday = buildBoltAdminSalesReport({ ...mixedInputs, period: 'today', demo: true });
assert.deepEqual(demoToday.testDeliveries, [{
  id: simulatedOrder.id,
  code: 'BP-000011',
  storeId: suba.id,
  storeName: suba.name,
  deliveredAt: new Date(simulatedDeliveryAt).toISOString(),
  collectedCOP: 0,
  items: [{ name: 'Agility Gold Adulto Raza Grande', presentation: '15 kg', quantity: 1 }],
}]);
assert.deepEqual(
  { ...demoToday, testDeliveries: [] },
  buildBoltAdminSalesReport({ ...inputs, period: 'today', demo: true }),
);
const demoWeek = buildBoltAdminSalesReport({ ...mixedInputs, period: '7d', demo: true, stores: [suba, kennedy] });
assert.deepEqual(demoWeek.testDeliveries.map(({ id }) => id).sort(), [olderDelivery.id, otherStoreDelivery.id, simulatedOrder.id].sort());
assert.equal(demoWeek.testDeliveries.find(({ id }) => id === otherStoreDelivery.id)?.code, 'LEGACY-TEST');

console.log('PASS: periodos de Bogotá, órdenes únicas y confirmadas, alcance por sede, productos agrupados, recaudo respaldado y entregas simuladas separadas.');
