/** Explicitly isolated local copy; this script never targets production. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import fixtures from './municipal-coverage-fixtures.json';
import existing from './coverage-address-fixtures.json';
const origin=process.env.BOLT_COVERAGE_TEST_URL;
if(origin!=='http://localhost:3020' || !process.cwd().endsWith('/BOLT-coverage')) throw Error('Use the isolated BOLT-coverage copy on port 3020.');
const request=async(path:string,body?:any,key?:string)=>{const r=await fetch(origin+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(key?{'Idempotency-Key':key}:{})},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,data:await r.json()}};
const catalog=(await request('/api/v1/catalog?q=SIMULACI%C3%93N')).data;
const product=catalog.find((p:any)=>p.id==='sim-snack-1kg');assert.ok(product?.name.startsWith('SIMULACIÓN'));
const items=[{productId:product.id,quantity:1}],purchaseItems=[{...items[0],price:product.price}];
const before=(await request('/api/v1/orders')).data;
const reports:any[]=[];
const quote=async(f:any,extra:any={})=>(await request('/api/v1/delivery/quote',{destination:{address:f.address,coordinates:f.coordinates,...extra},items,requestedMode:'PROGRAMADO'})).data;
const valid=existing[0],validQuote=await quote(valid);assert.equal(validQuote.assignedStoreId,'HUB_SUBA');assert.ok(validQuote.confirmationToken);
const payload={storeId:'HUB_KENNEDY',deliveryAddress:{address:valid.address,coordinates:valid.coordinates},items:purchaseItems,deliveryMode:'PROGRAMADO',confirmationToken:validQuote.confirmationToken,scheduledWindow:validQuote.transportWindow,customer:{name:'SIMULACIÓN COBERTURA',phone:'0000000000',email:'coverage@example.invalid'},paymentMethod:'CASH_ON_DELIVERY',tip:0};
for(const f of [...fixtures,existing.find(f=>f.name==='Chia')!]) {
 const q=await quote(f,{municipality:'Bogotá',locality:'Usaquén',countryCode:'CO',municipalityCode:'11001',geographicExclusion:''});
 const pending=['Cajicá','Chia'].includes(f.name);
 assert.equal(q.reasonCode,pending?'SCHEDULED_SERVICE_PENDING':'TERRITORY_OUT_OF_COVERAGE');
 assert.equal(q.availableModes.turbo,false);assert.equal(q.availableModes.scheduled,false);
 for(const deliveryMode of ['PROGRAMADO','TURBO']) {
  const bad=await request('/api/v1/orders',{...payload,deliveryMode,deliveryAddress:{address:'Carrera 5 #12-14, vía Chía, Bogotá',coordinates:f.coordinates,municipality:'Bogotá',locality:'Usaquén',geographicExclusion:''}},crypto.randomUUID());
  assert.equal(bad.status,400,JSON.stringify(bad));assert.equal(bad.data.code,q.reasonCode);
 }
 reports.push({case:f.name,reason:q.reasonCode,municipality:q.municipality,store:q.assignedStoreId,directOrderBlocked:true});
}
const missing=await request('/api/v1/orders',{...payload,deliveryAddress:{address:'Calle 150 #16-56'}},crypto.randomUUID());assert.equal(missing.status,400);assert.equal(missing.data.code,'ADDRESS_INCOMPLETE');
const price=await request('/api/v1/orders',{...payload,items:[{...purchaseItems[0],price:1}]},crypto.randomUUID());assert.equal(price.data.code,'PRICE_CHANGED');
assert.deepEqual((await request('/api/v1/orders')).data,before,'Quotes and rejected orders preserve existing history');
// Valid purchase once, with the latest quote and canonical slot, after previous rejections.
const stale=await request('/api/v1/orders',payload,crypto.randomUUID());assert.equal(stale.data.code,'QUOTE_CHANGED');
const fresh=(await request('/api/v1/delivery/quote',{destination:payload.deliveryAddress,items,requestedMode:'PROGRAMADO',scheduledWindow:payload.scheduledWindow})).data;payload.confirmationToken=fresh.confirmationToken;
const key=crypto.randomUUID();const created=await request('/api/v1/orders',payload,key);assert.equal(created.status,201,JSON.stringify(created));assert.equal(created.data.storeId,'HUB_SUBA');assert.equal(created.data.deliveryMode,'PROGRAMADO');
const repeated=await request('/api/v1/orders',payload,key);assert.equal(repeated.status,200);assert.equal(repeated.data.id,created.data.id);
const after=(await request('/api/v1/orders')).data;assert.equal(after.length,before.length+1);
for(const old of before)assert.deepEqual(after.find((o:any)=>o.id===old.id),old);
const afterProduct=(await request('/api/v1/catalog?q=SIMULACI%C3%93N')).data.find((p:any)=>p.id===product.id);assert.equal(afterProduct.reservedStockByStore.HUB_SUBA,(product.reservedStockByStore.HUB_SUBA||0)+1);
const q=await quote(valid,{municipality:'Cota',locality:'Bogotá'});assert.equal(q.assignedStoreId,'HUB_SUBA');assert.equal(q.availableModes.scheduled,true);
fs.writeFileSync('../coverage-http-results.json',JSON.stringify({reports,createdTestOrder:created.data.id,order:created.data,existingOrdersUnchanged:true,priceRevalidated:true,reservedExactlyOnce:true,idempotency:true},null,2));
console.log('PASS HTTP: 8 destinations, 16 forged orders blocked, missing destination, price, preserved history, Cedritos purchase + retry + reservation once');
