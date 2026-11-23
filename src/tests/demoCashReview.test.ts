import assert from 'node:assert/strict';
import { WAREHOUSES } from '../data/warehouseConfig';
import { CASH_REVIEW_SKU, cashReviewBasket, cashReviewContext, cashReviewProduct, cashReviewStores } from '../lib/demoCashReview';
import { enrichDestination } from '../lib/serverGeography';
import { evaluateDeliveryQuote } from '../lib/deliveryService';
import { saleVariant } from '../lib/variantCommerce';
import { DEFAULT_TRANSPORT_CONFIG } from '../types/transport';

const base = {config: structuredClone(DEFAULT_TRANSPORT_CONFIG), drivers: [], orders: []};
const fixture = saleVariant(cashReviewProduct(), CASH_REVIEW_SKU);
assert.equal(fixture.price, 59_000);
const items = [{productId: fixture.id, quantity: 1}];
assert.equal(cashReviewBasket(items), 'review');
assert.equal(cashReviewBasket([]), undefined);
assert.equal(cashReviewBasket([{productId: 'otro'}]), undefined);
assert.equal(cashReviewBasket([...items, {productId: 'otro'}]), 'mixed');
const sites = cashReviewStores(WAREHOUSES);
assert.deepEqual(sites.map(s => s.id), ['HUB_ALAMOS', 'HUB_KENNEDY', 'HUB_SUBA']);
const ctx = cashReviewContext(WAREHOUSES, base);
assert.equal(base.config.vehicles.length, 0);
assert.equal(base.drivers.length, 0);
assert.deepEqual(ctx.config.externalProviders, []);
for (const site of sites) {
  assert.equal(fixture.stockByStore[site.id], 8);
  assert.equal(fixture.reservedStockByStore[site.id], 0);
  for (const mode of ['TURBO', 'PROGRAMADO'] as const) {
    const req = {destination: enrichDestination(site.destination), items, requestedMode: mode};
    const evaluate = (value: Parameters<typeof evaluateDeliveryQuote>[0]) => evaluateDeliveryQuote(value, WAREHOUSES, [fixture], [], ctx);
    let quote = evaluate(req);
    if (mode === 'PROGRAMADO') {
      const slot = quote.scheduledSlots.find(s => !s.cutoffPassed && s.availableCapacity > 0);
      assert.ok(slot, site.id + ': ' + quote.reasonCode);
      quote = evaluate({...req, scheduledWindow: slot});
      assert.equal(quote.transportWindow?.slotId, slot.slotId);
    }
    assert.ok(quote.basketValidated && quote.transportPlan?.feasible, site.id + ': ' + quote.reasonCode);
    assert.equal(quote.assignedStoreId, site.id);
    assert.equal(quote.recommendedMode, mode);
    assert.equal(quote.charges?.subtotal, fixture.price);
    assert.equal(quote.charges?.total, mode === 'TURBO' ? 69_000 : 63_900);
    console.log('PASS', site.id, mode, quote.charges?.total);
  }
}
