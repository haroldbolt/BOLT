import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { INITIAL_PRODUCTS } from '../data/seedData';
import { CatalogOperations } from '../lib/catalogOperations';
import { validOffer } from '../lib/catalogPurchase';
import { saleVariant } from '../lib/variantCommerce';
import type { Product } from '../types';

const storeId = 'HUB_SUBA';
const product: Product = {
  ...INITIAL_PRODUCTS[0], id: 'price-test-product', price: 20_000, originalPrice: 25_000,
  stockByStore: { [storeId]: 10 }, reservedStockByStore: { [storeId]: 2 },
  presentaciones: [
    { varianteId: 'small', nombre: '1 kg', sku: 'PRICE-S', foto: '', bodegaIds: [storeId] },
    { varianteId: 'large', nombre: '2 kg', sku: 'PRICE-L', foto: '', bodegaIds: [storeId], price: 40_000 },
  ],
};
const actor = { name: 'Coordinación', email: 'fixture@example.test' };
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bolt-admin-prices-'));

try {
  const options = { file: path.join(directory, 'operations.json'), products: () => [product], stores: () => [], orders: () => [] };
  let catalog = new CatalogOperations(options);
  catalog.initializeOrderTracking();
  const variant = (id: string) => saleVariant(catalog.getProducts()[0], id);
  const save = (id: string, priceCOP: number, originalPriceCOP?: number | null) => catalog.edit(product.id, {
    variantId: id, priceCOP, originalPriceCOP, expectedRevision: variant(id).commerceRevision, reason: 'Prueba de precios',
  }, actor);

  assert.deepEqual(validOffer(variant('small')), { originalPrice: 25_000, percent: 20 });
  const before = variant('large');
  assert.equal(before.originalPrice, undefined);
  save('large', 30_000, 40_000);
  assert.deepEqual(validOffer(variant('large')), { originalPrice: 40_000, percent: 25 });
  assert.deepEqual(validOffer(variant('small')), { originalPrice: 25_000, percent: 20 });
  assert.equal(catalog.getProducts()[0].discountPercent, 20);
  assert.equal(catalog.getProducts()[0].presentaciones?.[1].discountPercent, 25);
  assert.deepEqual(variant('large').stockByStore, before.stockByStore);
  assert.deepEqual(variant('large').reservedStockByStore, before.reservedStockByStore);
  assert.deepEqual(catalog.getAuditLog().at(-1).priceChange, { before: 40_000, after: 30_000, originalBefore: null, originalAfter: 40_000 });
  assert.throws(() => catalog.edit(product.id, {
    variantId: 'large', priceCOP: 32_000, originalPriceCOP: 40_000, expectedRevision: before.commerceRevision,
  }, actor), /cambió/);
  assert.throws(() => save('large', 40_000, 40_000), /mayor/);

  catalog = new CatalogOperations(options);
  assert.equal(catalog.getSalesProducts().find(item => item.variantId === 'large')?.price, 30_000);
  assert.deepEqual(validOffer(variant('large')), { originalPrice: 40_000, percent: 25 });
  save('large', 40_000, null);
  save('small', 25_000, null);
  catalog = new CatalogOperations(options);
  assert.equal(catalog.getProducts()[0].originalPrice, undefined);
  assert.equal(validOffer(variant('large')), null);
  assert.equal(variant('small').price, 25_000);
  save('small', 19_000);
  assert.equal(validOffer(variant('small')), null);

  save('large', 32_000, 40_000);
  catalog.prepare('prices-from-shopify', {
    shop: 'fixture.invalid', currency: 'COP', complete: true, completedAt: new Date().toISOString(),
    variants: [{ id: 'large', sku: 'PRICE-L', title: '2 kg', price: '35000', product: { id: product.id, title: product.name, handle: 'fixture' } }],
  }, actor, 0);
  catalog.apply('prices-from-shopify', actor);
  assert.equal(variant('large').price, 35_000);
  assert.equal(validOffer(variant('large')), null);
  catalog = new CatalogOperations(options);
  catalog.reverse('prices-from-shopify', actor);
  assert.equal(variant('large').price, 32_000);
  assert.deepEqual(validOffer(variant('large')), { originalPrice: 40_000, percent: 20 });
  console.log('PASS: precios y promociones por presentación, auditoría, recarga, edición obsoleta y reversión de importación.');
} finally {
  fs.rmSync(directory, { recursive: true, force: true });
}
