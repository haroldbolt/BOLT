/** Read/deny-only checks against the isolated local simulation; never creates an order. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import original from './coverage-address-fixtures.json';
import municipal from './municipal-coverage-fixtures.json';
const origin=process.env.BOLT_COVERAGE_TEST_URL;
if(origin!=='http://localhost:3020' || !process.cwd().endsWith('/BOLT-coverage')) throw Error('Use the isolated BOLT-coverage copy on port 3020.');
async function request(path:string,body?:any){
 const response=await fetch(origin+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json','Idempotency-Key':crypto.randomUUID()},body:body===undefined?undefined:JSON.stringify(body)});
 return {status:response.status,data:await response.json()};
}
const before=(await request('/api/v1/orders')).data;
const product=(await request('/api/v1/catalog?q=SIMULACI%C3%93N')).data.find((p:any)=>p.id==='sim-snack-1kg');
assert.ok(product?.name.startsWith('SIMULACIÓN'));
const items=[{productId:product.id,quantity:1}];
const chia=original.find(f=>f.name==='Chia')!,cajica=municipal.find(f=>f.name==='Cajicá')!,cota=municipal.find(f=>f.name==='Cota')!;
const reports=[];
for(const f of [chia,cajica,cota,original[0],original.find(f=>f.name==='Soacha')!,cajica,cota,chia]) {
 const destination={address:f.address,coordinates:f.coordinates,municipality:'Bogotá',locality:'Kennedy'};
 const {status,data:q}=await request('/api/v1/delivery/quote',{destination,items,requestedMode:'TURBO'});assert.equal(status,200);
 if(f===cota){assert.equal(q.reasonCode,'TERRITORY_OUT_OF_COVERAGE');assert.equal(q.assignedStoreId,undefined);}
 else {assert.equal(q.recommendedMode,'PROGRAMADO');assert.equal(q.assignedStoreId,f.name==='Soacha'?'HUB_KENNEDY':'HUB_SUBA');assert.ok(q.scheduledSlots.some((s:any)=>s.availableCapacity>0));}
 reports.push({destination:f.name,municipality:q.municipality,mode:q.recommendedMode,store:q.assignedStoreId,slots:q.scheduledSlots.length,reason:q.reasonCode});
 if(f===chia || f===cajica) {
  const slot=q.scheduledSlots.findLast((s:any)=>s.availableCapacity>0);
  const {data:fresh}=await request('/api/v1/delivery/quote',{destination,items,requestedMode:'PROGRAMADO',scheduledWindow:slot});
  assert.ok(fresh.confirmationToken);assert.equal(fresh.transportWindow.slotId,slot.slotId);
  const payload={storeId:'HUB_KENNEDY',deliveryAddress:destination,items:[{...items[0],price:product.price}],deliveryMode:'PROGRAMADO',confirmationToken:fresh.confirmationToken,scheduledWindow:{...slot,date:'2099-01-01'},customer:{name:'SIMULACIÓN HORARIOS',phone:'0000000000',email:'schedule@example.invalid'},paymentMethod:'CASH_ON_DELIVERY',tip:0};
  const badSlot=await request('/api/v1/orders',payload);assert.equal(badSlot.status,400);assert.ok(['MODE_UNAVAILABLE','SLOT_CAPACITY_EXCEEDED'].includes(badSlot.data.code));
  const blocked=await request('/api/v1/orders',{...payload,scheduledWindow:slot,deliveryAddress:{address:'Carrera 5 #12-14, vía Chía, Bogotá',coordinates:cota.coordinates,municipality:'Chía'}});
  assert.equal(blocked.status,400);assert.equal(blocked.data.code,'TERRITORY_OUT_OF_COVERAGE');
 }
}
assert.deepEqual((await request('/api/v1/orders')).data,before,'No orders from schedule queries or rejected submissions');
const afterProduct=(await request('/api/v1/catalog?q=SIMULACI%C3%93N')).data.find((p:any)=>p.id===product.id);
assert.deepEqual(afterProduct.stockByStore,product.stockByStore);assert.deepEqual(afterProduct.reservedStockByStore,product.reservedStockByStore);
fs.writeFileSync('../schedule-http-results.json',JSON.stringify({reports,invalidSlotsRejected:true,oldTokensCannotAuthorizeCota:true,ordersBefore:before.length,ordersAfter:before.length,historyUnchanged:true,stockAndReservationsUnchanged:true},null,2));
console.log('PASS HTTP: 8 destination transitions; invalid slots and forged Cota orders rejected; orders, stock and reservations unchanged');
