import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { AdminOrder } from '../components/admin-next/adminClient';
import type { DeliveryQuote } from '../lib/deliveryService';
import type { Order } from '../types';
import type { CustomerTracking } from '../types/customerTracking';
import { createThreeStoreCashFixture, testPrice, testSku, testStores } from './threeStoreCashFixture';

const fixture = await createThreeStoreCashFixture({ ownFleetOnly: true, splitSuba: true });
const { request } = fixture;
try {
  await fixture.start(true);
  const admin = await fixture.login();
  await fixture.registerFleet(admin);
  async function operator(storeId: string) {
    const account = { name: 'Operador de prueba', email: storeId.toLowerCase() + '@example.invalid', storeId, password: randomUUID() };
    await request('/admin/store-operators', { token: admin, body: account, status: 201 });
    return (await request<{token: string}>('/auth/login', { body: account })).token;
  }
  const suba = await operator('HUB_SUBA');
  const kennedy = await operator('HUB_KENNEDY');
  const destination = testStores.find(s => s.id === 'HUB_SUBA')!.destination;
  const items = [{ productId: testSku, quantity: 2 }];
  const quote = await request<DeliveryQuote>('/delivery/quote', { body: { destination, items, requestedMode: 'TURBO' } });
  assert.equal(quote.recommendedMode, 'TURBO_DIVIDIDO', quote.message);
  const order = await request<Order>('/orders', { status: 201, key: randomUUID(), body: {
    customer: { name: 'Cliente ficticio', email: 'cliente@example.invalid', phone: '0000000000', isGuest: true },
    items: [{ ...items[0], price: testPrice }], deliveryAddress: destination, deliveryMode: quote.recommendedMode,
    paymentMethod: 'CASH_ON_DELIVERY', confirmationToken: quote.confirmationToken, tip: 0,
  } });
  const orderPath = '/bolt-admin/orders/' + order.id;
  const read = async () => (await request<{order: AdminOrder}>(orderPath, { token: suba })).order;
  const parts = (await read()).childShipments!;
  assert.equal(parts.length, 2);
  assert.ok(parts.every(part => part.items[0].quantity === 1 && !('secretDeliveryCode' in part)));
  const [{ shipmentId }, second] = parts;
  const start = orderPath + '/start-preparation';
  const ready = orderPath + '/ready-for-dispatch';
  const getClock = (id: string) => request<CustomerTracking>('/orders/' + order.id + '/tracking?shipmentId=' + encodeURIComponent(id), { guest: order.guestAccessToken });
  await request(start, { token: suba, body: {}, status: 409 });
  await request(start, { token: suba, body: { shipmentId: 'UNKNOWN' }, status: 404 });
  await request(start, { token: kennedy, body: { shipmentId }, status: 403 });
  await request(ready, { token: suba, body: { shipmentId }, status: 409 });
  await request(start, { token: suba, body: { shipmentId } });
  assert.equal((await getClock(shipmentId)).timing.startedAt, null);
  await request(ready, { token: kennedy, body: { shipmentId }, status: 403 });
  await request(ready, { token: suba, body: { shipmentId } });
  const firstClock = (await getClock(shipmentId)).timing;
  assert.ok(firstClock.startedAt && firstClock.dueAt);
  await request(ready, { token: suba, body: { shipmentId } });
  assert.equal((await getClock(shipmentId)).timing.startedAt, firstClock.startedAt);
  assert.equal((await getClock(second.shipmentId)).timing.startedAt, null);
  assert.equal((await read()).childShipments?.[1].fulfillmentStatus, 'CONFIRMADO');
  assert.deepEqual(fixture.cargoCalls(), []);
  console.log('PASS: Operador de Suba prepara y marca lista una sola entrega. El otro cronómetro espera y Kennedy conserva sus permisos.');
} finally {
  await fixture.dispose();
}
