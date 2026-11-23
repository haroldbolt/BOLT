/** Real HTTP checkout contract, exclusively against an empty, disposable three-store installation. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { DeliveryQuote } from '../lib/deliveryService';
import type { Order, ScheduledDeliveryWindow } from '../types';
import type { CustomerTracking } from '../types/customerTracking';
import type { DispatchRun } from '../types/dispatch';
import { createThreeStoreCashFixture, testPrice, testSku, testStock, testStores } from './threeStoreCashFixture';

const fixture = await createThreeStoreCashFixture();
const { request } = fixture;
const modes = ['TURBO', 'PROGRAMADO'] as const;
const units = [{ productId: testSku, quantity: 1 }];
const customer = { name: 'Cliente de prueba RDI', email: 'cliente@rdi.invalid', phone: '0000000000', isGuest: true };
const results: { storeId: string; mode: typeof modes[number]; order: Order; key: string; body: object }[] = [];
let admin: string;

async function assertInventory() {
  for (const { id } of testStores) {
    const { items } = await request<{items: { productId: string; stock: number; reserved: number; available: number }[]}>(
      '/bolt-admin/inventory?storeId=' + id + '&query=' + testSku, { token: admin });
    const row = items.find(item => item.productId === testSku);
    assert.ok(row, id + ' sin producto de prueba');
    const expected = results.filter(row => row.storeId === id).length;
    assert.deepEqual([row.stock, row.reserved, row.available], [testStock, expected, testStock - expected], id);
  }
}

async function assertPanels() {
  const view = await request<{orders: { id: string; storeId: string; code: string; dispatches: DispatchRun[] }[]}>(
    '/admin/dispatch', { token: admin });
  assert.equal(view.orders.length, results.length);
  for (const { id } of testStores) {
    const { orders } = await request<{orders: Order[]}>('/bolt-admin/orders?storeId=' + id, { token: admin });
    const expected = results.filter(r => r.storeId === id);
    assert.deepEqual(orders.map(order => order.id).sort(), expected.map(r => r.order.id).sort());
    for (const { mode, order: recorded } of expected) {
      const order = orders.find(o => o.id === recorded.id)!;
      assert.equal(order.storeId, id);
      assert.equal(order.deliveryMode, mode);
      assert.equal(order.scheduledWindow?.slotId, recorded.scheduledWindow?.slotId);
      assert.equal(order.payment.status, 'PENDIENTE');
      const group = view.orders.find(row => row.id === order.id);
      assert.ok(group);
      assert.equal(group.storeId, id);
      assert.equal(group.code, recorded.purchaseCode);
      assert.equal(group.dispatches.length, 1);
      const [run] = group.dispatches;
      assert.equal(run.orderId, order.id);
      assert.equal(run.cashCollected, 0);
      assert.equal(run.cashDue, order.totals.total);
      assert.equal(run.external, undefined);
      const tracking = await request<CustomerTracking>('/orders/' + order.id + '/tracking', { guest: recorded.guestAccessToken });
      assert.equal(tracking.orderId, order.id);
      assert.equal(tracking.deliveryMode, mode);
      assert.equal(tracking.timing.source, mode === 'PROGRAMADO' ? 'BOOKED_WINDOW' : 'VERIFIED_QUOTE');
      assert.equal(tracking.status, 'CONFIRMADO');
    }
    const sales = await request<{summary: {collectedCOP: number}}>('/bolt-admin/sales?storeId=' + id, { token: admin });
    assert.equal(sales.summary.collectedCOP, 0);
  }
}

try {
  await fixture.start(false);
  admin = await fixture.login();
  const listed = await request<{id: string}[]>('/stores');
  assert.deepEqual(listed.map(s => s.id).sort(), testStores.map(s => s.id).sort());
  const initial = await request<Order[]>('/orders', { token: admin });
  assert.equal(initial.length, 0);
  for (const { destination, id } of testStores) {
    for (const mode of modes) {
      const q = await request<DeliveryQuote>('/delivery/quote', { body: { destination, items: units, requestedMode: mode } });
      assert.equal(q.reasonCode, 'RAPPI_CASH_UNCONFIRMED', id + ' ' + mode);
      assert.equal(q.confirmationToken, undefined);
      assert.equal(q.reviewRequestToken, undefined);
      const denied = await request<{code: string}>('/orders', { key: randomUUID(), status: 503, body: {
        deliveryAddress: destination, deliveryMode: mode, customer, items: units, paymentMethod: 'CASH_ON_DELIVERY',
      } });
      assert.equal(denied.code, 'RAPPI_CASH_UNCONFIRMED');
    }
  }
  await assertInventory();
  await assertPanels();

  await fixture.stop();
  await fixture.start(true);
  admin = await fixture.login();
  await fixture.registerFleet(admin);
  for (const { destination, id } of testStores) {
    for (const mode of modes) {
      const quoteInput = { destination, items: units, requestedMode: mode };
      let quote = await request<DeliveryQuote>('/delivery/quote', { body: quoteInput });
      let selected: ScheduledDeliveryWindow | undefined;
      if (mode === 'PROGRAMADO') {
        selected = quote.scheduledSlots.find(slot => slot.availableCapacity > 0 && !slot.cutoffPassed);
        assert.ok(selected, id + ' sin franja verificada');
        quote = await request<DeliveryQuote>('/delivery/quote', { body: { ...quoteInput, scheduledWindow: selected } });
        assert.equal(quote.transportWindow?.slotId, selected.slotId);
      }
      assert.equal(quote.assignedStoreId, id);
      assert.equal(quote.recommendedMode, mode, id + ' ' + quote.reasonCode);
      assert.ok(quote.confirmationToken && quote.charges);
      assert.equal(quote.charges.subtotal, testPrice);
      const body = {
        customer, items: [{ ...units[0], price: testPrice }], deliveryAddress: destination, deliveryMode: mode,
        scheduledWindow: selected, confirmationToken: quote.confirmationToken, paymentMethod: 'CASH_ON_DELIVERY', tip: 0,
      };
      const invalidPayment = await request<{code: string}>('/orders', { status: 400, key: randomUUID(), body: { ...body, paymentMethod: 'WOMPI_CARD' } });
      assert.equal(invalidPayment.code, 'PAYMENT_UNAVAILABLE');
      if (selected) {
        const missing = await request<{code: string}>('/orders', { status: 400, key: randomUUID(), body: { ...body, scheduledWindow: undefined } });
        assert.equal(missing.code, 'MODE_UNAVAILABLE');
      }
      const key = randomUUID();
      const order = await request<Order>('/orders', { status: 201, key, body });
      assert.ok(order.guestAccessToken && order.purchaseCode);
      assert.equal(order.deliveryMode, mode);
      assert.equal(order.storeId, id);
      assert.equal(order.fulfillmentStatus, 'CONFIRMADO');
      assert.equal(order.scheduledWindow?.slotId, selected?.slotId);
      assert.equal(order.totals.total, quote.charges.total);
      assert.equal(order.payment.method, 'CASH_ON_DELIVERY');
      assert.equal(order.payment.cashToCollect, quote.charges.total);
      assert.equal(order.payment.status, 'PENDIENTE');
      assert.equal(order.payment.cashSettled, false);
      assert.equal(order.payment.transactionId, undefined);
      const replay = await request<Order>('/orders', { key, body });
      assert.equal(replay.id, order.id);
      assert.equal(replay.purchaseCode, order.purchaseCode);
      results.push({ storeId: id, mode, order, key, body });
      await assertInventory();
      console.log('PASS checkout temporal', id, mode, 'total COP', order.totals.total, 'reservas en sede', results.filter(r => r.storeId === id).length);
    }
  }
  await assertPanels();
  assert.equal(new Set(results.map(r => r.order.purchaseCode)).size, 6);
  await fixture.stop();
  await fixture.start(true);
  admin = await fixture.login();
  for (const { order, key, body } of results) {
    const replay = await request<Order>('/orders', { key, body });
    assert.equal(replay.id, order.id);
    assert.equal(replay.purchaseCode, order.purchaseCode);
  }
  await assertPanels();
  await assertInventory();
  fixture.verifyNoEgress();
  console.log('PASS 6 confirmaciones aisladas, 6 bloqueos de efectivo sin aprobación, sin dobles reservas al reintentar o reiniciar, COP 0 recaudados y cero conexiones salientes.');
} finally {
  await fixture.dispose();
}
