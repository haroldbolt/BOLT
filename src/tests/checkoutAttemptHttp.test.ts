import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { DeliveryQuote } from '../lib/deliveryService';
import { createThreeStoreCashFixture, testPrice, testSku, testStores } from './threeStoreCashFixture';
import { checkoutBrowserFixture } from './checkoutBrowserFixture.mjs';

const app = await createThreeStoreCashFixture({ ownFleetOnly:true });
try {
  await app.start(true);
  const admin = await app.login();
  await app.registerFleet(admin);
  const { id: storeId, destination } = testStores[2];
  const items = [{ productId: testSku, quantity: 1 }];
  const quote = await app.request<DeliveryQuote>('/delivery/quote', {body:{destination, items, requestedMode:'TURBO'}});
  assert.ok(quote.confirmationToken);
  const endpoint = app.origin + '/api/v1/orders';
  const headers = { 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID() };
  const purchase = { method: 'POST', headers, body: JSON.stringify({
    storeId, items: [{...items[0], price:testPrice}], customer:{name:'Revisión',email:'checkout@example.invalid',phone:'0000000000'},
    deliveryAddress:destination, paymentMethod:'CASH_ON_DELIVERY', deliveryMode:'TURBO', confirmationToken:quote.confirmationToken,
  }) };
  const browser = checkoutBrowserFixture(), separateBrowser = checkoutBrowserFixture();
  assert.equal((await fetch(endpoint, purchase)).status, 428);
  const responses = await Promise.all([browser(endpoint, purchase),browser(endpoint, purchase)]);
  assert.deepEqual(responses.map(r=>r.status).sort(), [200,201]);
  const [first,second] = await Promise.all(responses.map(r=>r.json()));
  assert.ok(first.guestAccessToken && first.id);
  assert.equal(second.id,first.id);
  assert.equal(second.guestAccessToken,first.guestAccessToken);
  assert.equal(first.checkoutAttemptVerifier,undefined);
  const other = await separateBrowser(endpoint,purchase);
  assert.equal(other.status,409);
  const denied = await other.json();
  assert.equal(denied.code,'CHECKOUT_REVIEW_REQUIRED');
  assert.deepEqual(Object.keys(denied).sort(),['code','error']);
  const inventory = await app.request<{items:{productId:string;reserved:number}[]}>('/bolt-admin/inventory?storeId='+storeId+'&query='+testSku,{token:admin});
  assert.equal(inventory.items.find(i=>i.productId===testSku)?.reserved,1);
  assert.equal((await app.request<unknown[]>('/orders',{token:admin})).length,1);

  await app.stop(); await app.start(true);
  const recovered = await browser(endpoint,purchase);
  assert.equal(recovered.status,200);
  assert.equal((await recovered.json()).id,first.id);
  assert.equal((await separateBrowser(endpoint,purchase)).status,409);
  const after = await app.login();
  assert.equal((await app.request<unknown[]>('/orders',{token:after})).length,1);
  console.log('PASS: preparación de sesión, reintento concurrente, titular, aislamiento de dos navegadores y reinicio con una reserva.');
} finally { await app.dispose(); }
