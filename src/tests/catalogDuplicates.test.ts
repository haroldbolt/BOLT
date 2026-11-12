import assert from 'node:assert/strict';
import test from 'node:test';
import {INITIAL_PRODUCTS} from '../data/seedData';
import {customerCatalog} from '../lib/brandDirectory';
import {resolveGuestCart} from '../lib/guestCart';
import type {Product, Store} from '../types';

const kennedy = {id:'HUB_KENNEDY'} as Store;
const suba = {id:'HUB_SUBA'} as Store;
const legacy = {...INITIAL_PRODUCTS.find(p=>p.id==='prod-nexgard-spectra-m')!,
  status:'ACTIVE',stockByStore:{[kennedy.id]:6,[suba.id]:4},reservedStockByStore:{[kennedy.id]:2}};
const common = {bodegaIds:[kennedy.id,suba.id],stockByStore:{[kennedy.id]:2,[suba.id]:1},reservedStockByStore:{[suba.id]:1}};
const option = {...common, nombre:'7.5–15 kg',varianteId:'gid://shopify/ProductVariant/49141673722136', sku:'',foto:'',price:54000};
const alternative = {...option,varianteId:'different-size',stockByStore:{[kennedy.id]:5,[suba.id]:6}};
const preferred:Product = {...legacy,...common,id:'gid://shopify/Product/9496657363224',sku:'shopify-sku',presentaciones:[option,alternative]};

test('the redundant card is suppressed without merging stock, variants or saved-cart references',()=>{
  const originals=[legacy,preferred];
  const before=structuredClone(originals);
  assert.deepEqual(customerCatalog(originals,kennedy),[preferred]);
  assert.equal(customerCatalog(originals,kennedy)[0].presentaciones?.length,2);
  const references=[{productId:legacy.id,variantId:legacy.presentaciones?.[0]?.varianteId,quantity:2}];
  const restored=resolveGuestCart(references,originals);
  assert.equal(restored.items[0].product.sku,legacy.sku);
  assert.equal(restored.items[0].quantity,2);
  assert.equal(restored.items[0].product.price,legacy.price);
  assert.deepEqual(restored.unavailable,[]);
  assert.deepEqual(originals,before);
});

test('the other size, an inactive preferred product or a sold-out equivalent cannot suppress the card',()=>{
  assert.deepEqual(customerCatalog([legacy,preferred],suba),[legacy,preferred]);
  assert.deepEqual(customerCatalog([legacy,preferred]),[legacy,preferred]);
  assert.deepEqual(customerCatalog([legacy,{...preferred,status:'INACTIVE'}],kennedy),[legacy]);
  const changed={...preferred,presentaciones:[alternative]};
  assert.deepEqual(customerCatalog([legacy,changed],kennedy),[legacy,changed]);
});
