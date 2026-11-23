import assert from 'node:assert/strict';
import test from 'node:test';
import { lookupWompiPayment, wompiLookupConfig } from '../lib/wompiLookup';

const env = { BOLT_WOMPI_LOOKUP_ENV: 'sandbox', BOLT_WOMPI_PRIVATE_KEY: 'prv_test_fixture', BOLT_WOMPI_MERCHANT_ID: '144' };
const config = wompiLookupConfig(env)!;
const order = { id: 'fixture-order', payment: { method: 'WOMPI_CARD' as const, status: 'PENDIENTE' as const, transactionId: 'fixture-tx' }, totals: { total: 20000 } };
const matching = { id: 'fixture-tx', reference: order.id, status: 'APPROVED', merchant: { id: 144 }, currency: 'COP',
  amount_in_cents: 2000000, payment_method_type: 'CARD', customer_email: 'fixture@example.invalid' };
const returns = (data: unknown) => async () => Response.json({ data });

test('Wompi lookup is opt-in and enforces environment-specific private keys', () => {
  assert.equal(wompiLookupConfig({}), null);
  assert.equal(wompiLookupConfig({ ...env, BOLT_WOMPI_LOOKUP_ENV: 'production' }), null);
  assert.equal(wompiLookupConfig({ ...env, BOLT_WOMPI_MERCHANT_ID: '' }), null);
  assert.equal(wompiLookupConfig({ ...env, BOLT_WOMPI_LOOKUP_ENV: 'production', BOLT_WOMPI_PRIVATE_KEY: 'prv_prod_fixture' })?.environment, 'production');
});

test('verified sandbox responses contain only read-only financial information', async () => {
  const before = structuredClone(order);
  for (const status of ['PENDING', 'DECLINED', 'APPROVED', 'VOIDED', 'ERROR', 'APPROVED']) {
    const statusView = await lookupWompiPayment(order, config, async (url, options) => {
      assert.equal(String(url), 'https://sandbox.wompi.co/v1/transactions/fixture-tx');
      assert.equal(options?.method, 'GET');
      assert.equal(options?.redirect, 'error');
      assert.equal(new Headers(options?.headers).get('Authorization'), 'Bearer ' + config.privateKey);
      return returns({ ...matching, status })();
    });
    assert.deepEqual(statusView, { environment: 'sandbox', provider: 'WOMPI', amountInCents: 2000000, currency: 'COP', providerStatus: status });
  }
  assert.deepEqual(order, before);
});

test('incomplete or untrusted provider evidence stays unresolved', async () => {
  for (const mismatch of [{ id: 'different' }, { reference: 'other-order' }, { merchant: undefined }, { merchant: { id: 'other' } },
    { amount_in_cents: 20000 }, { currency: 'USD' }, { payment_method_type: 'PSE' }, { status: 'OTHER' }]) {
    await assert.rejects(lookupWompiPayment(order, config, returns({ ...matching, ...mismatch })), { code: 'WOMPI_NOT_VERIFIED' });
  }
  await assert.rejects(lookupWompiPayment(order, config, async () => new Response(null, { status: 404 })), { code: 'WOMPI_NOT_VERIFIED' });
  await assert.rejects(lookupWompiPayment(order, config, async () => { throw new Error('network unavailable'); }), { code: 'WOMPI_UNAVAILABLE' });
});

test('cash orders and missing or invalid links never contact the provider', async () => {
  let calls = 0;
  const lookup = async () => { calls++; return returns(matching)(); };
  for (const payment of [{ ...order.payment, method: 'CASH_ON_DELIVERY' as const }, { ...order.payment, transactionId: undefined },
    { ...order.payment, transactionId: 'https://outside.invalid/' }]) {
    await assert.rejects(lookupWompiPayment({ ...order, payment }, config, lookup), { code: 'WOMPI_LINK_REQUIRED' });
  }
  assert.equal(calls, 0);
});
