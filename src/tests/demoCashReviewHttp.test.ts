import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Order, ScheduledDeliveryWindow } from '../types';
import type { DeliveryQuote } from '../lib/deliveryService';
import { createThreeStoreCashFixture, testStores, testSku, testPrice, testStock } from './threeStoreCashFixture';

const app = await createThreeStoreCashFixture({simulation: true});
const { request } = app;
const items = [{productId: testSku, price: testPrice, quantity: 1}];
try {
  await app.start(false);
  const admin = await app.login();
  const review = await request<{enabled: boolean; productId: string; stores: typeof testStores}>('/simulation/cash-review');
  assert.equal(review.enabled, true);
  assert.equal(review.productId, testSku);
  assert.deepEqual(review.stores.map(s => s.id), testStores.map(s => s.id));
  const lookup = await request<{id: string}[]>('/catalog?q=' + testSku);
  assert.deepEqual(lookup.map(p => p.id), [testSku]);
  const confirmed = new Map<string, number>();
  const inventory = async () => {
    for (const {id} of review.stores) {
      const {items: products} = await request<{items: {sku: string; stock: number; reserved: number}[]}>(
        '/bolt-admin/inventory?storeId=' + id + '&query=' + testSku, {token: admin});
      assert.deepEqual(products.filter(p => p.sku === testSku).map(p => [p.stock, p.reserved]), [[testStock, confirmed.get(id) || 0]], id);
    }
  };
  await inventory();
  for (const {id, destination} of review.stores) {
    for (const mode of ['TURBO', 'PROGRAMADO'] as const) {
      const input = {items, destination, requestedMode: mode};
      let quote = await request<DeliveryQuote>('/delivery/quote', {body: input});
      let slot: ScheduledDeliveryWindow | undefined;
      if (mode === 'PROGRAMADO') {
        slot = quote.scheduledSlots.find(s => s.availableCapacity > 0 && !s.cutoffPassed);
        assert.ok(slot);
        quote = await request<DeliveryQuote>('/delivery/quote', {body: {...input, scheduledWindow: slot}});
      }
      assert.ok(quote.confirmationToken && quote.charges);
      assert.equal(quote.assignedStoreId, id);
      await inventory();
      const key = randomUUID();
      const body = {deliveryAddress: destination, items, deliveryMode: mode, scheduledWindow: slot, paymentMethod: 'CASH_ON_DELIVERY',
        customer: {name: 'Prueba RDI', email: 'cliente@rdi.invalid', phone: '0000000000', isGuest: true}, confirmationToken: quote.confirmationToken};
      const order = await request<Order>('/orders', {key, body, status: 201});
      assert.equal(order.demoCustomerCheckout, true);
      assert.equal(order.payment.cashToCollect, 0);
      assert.equal(order.payment.cashSettled, false);
      assert.equal(order.totals.total, quote.charges.total);
      assert.equal(order.storeId, id);
      assert.equal(order.scheduledWindow?.slotId, slot?.slotId);
      assert.equal((await request<Order>('/orders', {key, body})).id, order.id);
      const list = await request<{orders: Order[]}>('/bolt-admin/orders?storeId=' + id, {token: admin});
      const row = list.orders.find(o => o.id === order.id);
      assert.ok(row?.demoCustomerCheckout);
      assert.equal(row.payment.cashToCollect, 0);
      const tracked = await request<{simulation: boolean; orderId: string}>('/orders/' + order.id + '/tracking', {guest: order.guestAccessToken});
      assert.equal(tracked.orderId, order.id);
      confirmed.set(id, (confirmed.get(id) || 0) + 1);
      await inventory();
      console.log('PASS demo local', id, mode, 'reserva por sede y sin cobro');
    }
  }
  const runs = await request<{orders: {dispatches: {cashDue: number; external?: unknown}[]}[]}>('/admin/dispatch', {token: admin});
  assert.equal(runs.orders.length, 6);
  for (const order of runs.orders) {
    assert.equal(order.dispatches.length, 1);
    assert.equal(order.dispatches[0].cashDue, 0);
    assert.equal(order.dispatches[0].external, undefined);
  }
  app.verifyNoEgress();
} finally { await app.dispose(); }
