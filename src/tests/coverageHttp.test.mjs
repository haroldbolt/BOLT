// Run only against a disposable copy of the app and its persisted data.
// Usage: BOLT_TEST_BASE_URL=http://localhost:3001 node src/tests/coverageHttp.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
const base=process.env.BOLT_TEST_BASE_URL;
if(!base || !/^http:\/\/localhost:3001$/.test(base)) throw Error('Use isolated test server on localhost:3001');
const fixtures=JSON.parse(fs.readFileSync(new URL('./coverage-address-fixtures.json',import.meta.url)));
const post=async(path,body)=>{const r=await fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});return {status:r.status,body:await r.json()}};
const result=[];
for(const f of fixtures){
 const q=await post('/api/v1/delivery/quote',{destination:{address:f.address,coordinates:f.coordinates},requestedMode:'PROGRAMADO'});
 assert.equal(q.status,200);assert.equal(q.body.scheduledEligible,!!f.expectedStoreId);
 if(f.expectedStoreId)assert.equal(q.body.assignedStoreId,f.expectedStoreId);else assert.equal(q.body.eligibilityStatus,'OUT_OF_COVERAGE');
 result.push({case:f.name,status:q.body.eligibilityStatus,store:q.body.assignedStoreId,locality:q.body.locality});
}
const f=fixtures[0],destination={address:f.address,coordinates:f.coordinates};
let q=(await post('/api/v1/delivery/quote',{destination,requestedMode:'PROGRAMADO'})).body;
const products=await (await fetch(base+'/api/v1/catalog')).json();
const product=products.find(p=>p.price>0 && !p.requiresPrescription && (p.stockByStore.HUB_SUBA||0)-(p.reservedStockByStore.HUB_SUBA||0)>20);
assert.ok(product);
const payload={storeId:'HUB_KENNEDY',deliveryMode:'PROGRAMADO',deliveryAddress:destination,items:[{productId:product.id,quantity:1,name:product.name,price:product.price,weightKg:product.weightKg,presentation:product.presentation}],customer:{name:'PRUEBA AISLADA COBERTURA CEDRITOS',phone:'+57 300 000 0000',email:'coverage-test@example.invalid'},paymentMethod:'EFECTIVO',scheduledWindow:q.scheduledSlots.filter(s=>s.availableCapacity===10).at(-1)};
const beforeOrders=await (await fetch(base+'/api/v1/orders')).json();
const ids=[];
// Real test bookings, no mocks: fill a previously unused future slot.
for(let i=0;i<10;i++){
 const r=await post('/api/v1/orders',payload);assert.equal(r.status,201,JSON.stringify(r.body));
 assert.equal(r.body.storeId,'HUB_SUBA');assert.equal(r.body.deliveryMode,'PROGRAMADO');ids.push(r.body.id);
}
const full=await post('/api/v1/orders',payload);assert.equal(full.status,400);assert.equal(full.body.code,'SLOT_CAPACITY_EXCEEDED');
q=(await post('/api/v1/delivery/quote',{destination,requestedMode:'PROGRAMADO',scheduledWindow:payload.scheduledWindow})).body;
assert.equal(q.reasonCode,'SLOT_CAPACITY_EXCEEDED');assert.equal(q.territoryInfo.isCovered,true);
const stock=(await post('/api/v1/delivery/quote',{destination,requestedMode:'PROGRAMADO',items:[{productId:product.id,quantity:999999}]})).body;
assert.equal(stock.reasonCode,'INSUFFICIENT_STOCK');assert.equal(stock.territoryInfo.isCovered,true);
const missing=await post('/api/v1/orders',{...payload,deliveryAddress:{address:f.address}});assert.equal(missing.status,400);assert.equal(missing.body.code,'ADDRESS_INCOMPLETE');
const afterOrders=await (await fetch(base+'/api/v1/orders')).json();
for(const old of beforeOrders)assert.deepEqual(afterOrders.find(o=>o.id===old.id),old,'Existing copied orders unchanged');
result.push({case:'10 isolated scheduled bookings',ids,assignedStore:'HUB_SUBA',fullSlot:full.body,stockReason:stock.reasonCode,existingOrdersUnchanged:true});
fs.writeFileSync(new URL('./coverage-http-result.json',import.meta.url),JSON.stringify(result,null,2));
console.log(JSON.stringify(result,null,2));
