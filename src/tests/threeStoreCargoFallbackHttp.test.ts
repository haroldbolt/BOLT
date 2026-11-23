import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import type { DeliveryQuote } from '../lib/deliveryService';
import type { Order } from '../types';
import type { DispatchRun } from '../types/dispatch';
import { createThreeStoreCashFixture, testPrice, testSku, testStores } from './threeStoreCashFixture';

// The isolated adapter receives synthetic responses in-process; the fixture forbids all outgoing sockets.
const app = await createThreeStoreCashFixture({ respondAsCargo: true });
try {
  await app.start(true);
  const token = await app.login();
  const item = { productId: testSku, quantity: 1 };
  const quote = (destination: typeof testStores[number]['destination'], requestedMode: 'TURBO' | 'PROGRAMADO') =>
    app.request<DeliveryQuote>('/delivery/quote', { body: { destination, requestedMode, items: [item] } });
  const coordinator = () => app.request<{
    providers: { id: string; enabled: boolean }[];
    orders: { id: string; dispatches: DispatchRun[] }[];
  }>('/admin/dispatch', { token });
  assert.ok((await coordinator()).providers.some(p => p.id === 'rappi' && p.enabled));
  for (const { destination } of testStores) {
    for (const mode of ['TURBO', 'PROGRAMADO'] as const) {
      const result = await quote(destination, mode);
      assert.equal(result.territoryInfo?.isCovered, true);
      assert.equal(result.reasonCode, 'NO_AVAILABLE_VEHICLES', result.message);
      assert.equal(result.recommendedMode, null);
      assert.ok(!result.confirmationToken);
      assert.deepEqual(result.transportPlan?.shipments, []);
    }
  }
  assert.deepEqual((await coordinator()).orders, []);
  assert.deepEqual(app.cargoCalls(), []);

  const fleet = await app.registerFleet(token);
  const suba = testStores.find(s => s.id === 'HUB_SUBA')!;
  const local = await quote(suba.destination, 'TURBO');
  assert.equal(local.recommendedMode, 'TURBO', local.message);
  assert.ok(local.confirmationToken);
  const created = await app.request<Order>('/orders', { key: randomUUID(), status: 201, body: {
    items: [{ ...item, price: testPrice }], deliveryAddress: suba.destination,
    deliveryMode: 'TURBO', confirmationToken: local.confirmationToken,
    customer: { name:'Cliente Ficticio', phone:'3000000000', email:'cliente@rdi.invalid', isGuest:true },
    paymentMethod:'CASH_ON_DELIVERY',
  } });
  assert.equal(created.storeId, suba.id);
  assert.equal(created.fulfillmentStatus, 'CONFIRMADO');
  assert.deepEqual(app.cargoCalls(), []);

  // The vehicle used by checkout leaves its shift before the goods are prepared.
  await app.request('/driver/shift', { token: fleet.get(suba.id), body: { action:'END' } });
  const operations = '/bolt-admin/orders/' + created.id;
  await app.request(operations + '/start-preparation', { token, body: {} });
  assert.deepEqual(app.cargoCalls(), []);
  await app.request(operations + '/ready-for-dispatch', { token, body: {} });
  const readRun = async () => (await coordinator()).orders.find(o => o.id === created.id)?.dispatches[0];
  let run = await readRun();
  for (let attempt = 0; attempt < 60 && run?.external?.status !== 'ACCEPTED'; attempt++) {
    await delay(100);
    run = await readRun();
  }
  assert.equal(run?.external?.status, 'ACCEPTED', run?.reason);
  const id = run!.id;
  assert.equal(run?.external?.key, id);
  assert.equal(run?.cashCollected, 0);
  assert.ok(!run?.driverId && !run?.deliveredAt);
  assert.ok(!run?.external?.bankReceipt);
  await app.request('/admin/dispatch/' + id + '/search', { token, body: {} });
  assert.deepEqual(app.cargoCalls().filter(call => call.operation !== 'order-status'), [
    { operation: 'order-validate' },
    { operation: 'order-create', reference: id },
  ]);
  const persisted = await app.request<Order>('/orders/' + created.id, { token });
  assert.equal(persisted.storeId, suba.id);
  assert.equal(persisted.fulfillmentStatus, 'LISTO_PARA_DESPACHO');
  assert.equal(persisted.payment.cashToCollect, created.totals.total);
  assert.equal(persisted.payment.status, 'PENDIENTE');
  app.verifyNoEgress();
  console.log('PASS: las seis cotizaciones sin flota no prometen vehículos. Cargo simulado solo interviene después de preparar una compra Turbo autorizada; una solicitud, sin recaudo.');
} finally {
  await app.dispose();
}
