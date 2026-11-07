/** Run ONLY against isolated simulation server; no automatic launch or production URL. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
const origin=process.env.BOLT_TRANSPORT_TEST_URL;
if(origin!=='http://localhost:3010') throw Error('Only the dedicated port 3010 simulation is permitted.');
const request=async(path:string,body?:any,headers:any={})=>{const res=await fetch(origin+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...headers},body:body===undefined?undefined:JSON.stringify(body)});return {status:res.status,data:await res.json()};};
const initial=await request('/api/v1/orders');
const runId=crypto.randomUUID();
const catalog=(await request('/api/v1/catalog?q=SIMULACIÓN')).data;
const startingProduct=catalog.find((p:any)=>p.id==='sim-comida-20kg');assert.ok(startingProduct?.name.startsWith('SIMULACIÓN'));
const startingStock=startingProduct.stockByStore.HUB_KENNEDY,startingReserved=startingProduct.reservedStockByStore.HUB_KENNEDY;
const destination={address:'Calle 3 #78-20, Kennedy Central, Bogotá',coordinates:{lat:4.6365,lng:-74.1448},municipality:'Bogotá',locality:'Kennedy'};
const quote=async(items:any[],requestedMode='TURBO',scheduledWindow?:any)=>(await request('/api/v1/delivery/quote',{destination,items,requestedMode,scheduledWindow})).data;
const cases:any[]=[];
for(const [name,items,expected] of [
 ['36 kg',[['sim-comida-36kg',1]],1],['50 kg',[['sim-comida-50kg',1]],1],['50 + 2 ligeros',[['sim-comida-50kg',1],['sim-snack-1kg',2]],1],['50 + 3 ligeros',[['sim-comida-50kg',1],['sim-snack-1kg',3]],1],['50 + 4 ligeros',[['sim-comida-50kg',1],['sim-snack-1kg',4]],2],['3 bolsas 20 kg',[['sim-comida-20kg',3]],2],['Voluminoso',[['sim-cama',1]],0],['Datos ausentes',[['sim-sin-datos',1]],0]
] as any[]) {
 const q=await quote(items.map(([productId,quantity]:any)=>({productId,quantity})));
 assert.equal(q.transportPlan?.feasible?q.transportPlan.shipments.length:0,expected,name);cases.push({name,code:q.reasonCode,shipments:q.transportPlan?.shipments.map((s:any)=>({weight:s.productWeightGrams,gross:s.grossWeightGrams,driverId:s.driverId,items:s.items}))});
}
assert.equal((await request('/api/v1/orders')).data.length,initial.data.length,'Quotes create no orders');
const items=[{productId:'sim-comida-20kg',quantity:3}];const q=await quote(items);
const payload={confirmationToken:q.confirmationToken,items:items.map(i=>({...i,price:10000})),deliveryMode:'TURBO_DIVIDIDO',deliveryAddress:destination,customer:{name:'SIMULACIÓN HTTP',phone:'0000000000',email:'fixture@example.invalid',isGuest:true},paymentMethod:'CASH_ON_DELIVERY',tip:0};
const headers={'Idempotency-Key':`simulation-group-once-${runId}`};
const created=await request('/api/v1/orders',payload,headers);assert.equal(created.status,201,JSON.stringify(created.data));
const order=created.data;assert.equal(order.childShipments.length,2);assert.equal(order.totals.serviceFee,1500);assert.equal(order.totals.shipping,4900);assert.equal(order.totals.total,36400);assert.equal(order.childShipments.reduce((a:number,c:any)=>a+c.cashToCollect,0),36400);assert.equal(new Set(order.childShipments.map((c:any)=>c.driver.id)).size,2);
const repeat=await request('/api/v1/orders',payload,headers);assert.equal(repeat.status,200);assert.equal(repeat.data.id,order.id);assert.deepEqual(repeat.data.childShipments,order.childShipments);
const stale=await request('/api/v1/orders',payload,{'Idempotency-Key':`simulation-stale-other-${runId}`});assert.notEqual(stale.status,201);assert.equal((await request('/api/v1/orders')).data.length,initial.data.length+1,'Stale capacity cannot double book');
let current=(await request('/api/v1/catalog?q=sim-comida-20kg')).data.find((p:any)=>p.id==='sim-comida-20kg');assert.equal(current.reservedStockByStore.HUB_KENNEDY,startingReserved+3);
const badPrice=await request('/api/v1/orders',{...payload,items:[{productId:'sim-comida-20kg',quantity:3,price:1}]},{'Idempotency-Key':`simulation-bad-price-${runId}`});assert.equal(badPrice.status,409);
for(const c of order.childShipments) for(const status of ['EN_ALISTAMIENTO','LISTO_PARA_DESPACHO','REPARTIDOR_ASIGNADO','EN_CAMINO']) {
 const r=await request(`/api/v1/operations/orders/${order.id}/status`,{status,shipmentId:c.shipmentId,role:'ADMINISTRADOR'});assert.equal(r.status,200,JSON.stringify(r));
}
const first=order.childShipments[0],second=order.childShipments[1];
const badPin=await request(`/api/v1/orders/${order.id}/verify-delivery`,{shipmentId:first.shipmentId,deliveryCode:'0000',role:'CONDUCTOR'});assert.equal(badPin.status,403,JSON.stringify(badPin));
const delivered=await request(`/api/v1/orders/${order.id}/verify-delivery`,{shipmentId:first.shipmentId,deliveryCode:first.secretDeliveryCode,role:'CONDUCTOR'});assert.equal(delivered.status,200,JSON.stringify(delivered));
assert.notEqual((await request(`/api/v1/orders/${order.id}`)).data.fulfillmentStatus,'ENTREGADO');
const tracking=(await request(`/api/v1/orders/${order.id}/tracking?shipmentId=${first.shipmentId}`)).data;assert.equal(tracking.driver.id,first.driver.id);assert.equal(tracking.status,'ENTREGADO');assert.equal(tracking.secretDeliveryCode,first.secretDeliveryCode);assert.equal((await request(`/api/v1/orders/${order.id}/tracking?shipmentId=not-in-this-purchase`)).status,404);
const cancelled=await request(`/api/v1/operations/orders/${order.id}/status`,{status:'CANCELADO',shipmentId:second.shipmentId,reason:'SIMULACIÓN devolución parcial',role:'ADMINISTRADOR'});assert.equal(cancelled.status,200);
const returned=await request(`/api/v1/operations/orders/${order.id}/confirm-physical-return`,{shipmentId:second.shipmentId,inspectorName:'SIMULACIÓN'});assert.equal(returned.status,200);
current=(await request('/api/v1/catalog?q=sim-comida-20kg')).data.find((p:any)=>p.id==='sim-comida-20kg');assert.equal(current.stockByStore.HUB_KENNEDY,startingStock-2);assert.equal(current.reservedStockByStore.HUB_KENNEDY,startingReserved);
assert.equal((await request('/api/v1/admin/transport')).status,401);
fs.writeFileSync('../turbo-http-results.json',JSON.stringify({cases,orderId:order.id,idempotency:true,noSideEffectsFromQuotes:true,oneCharge:true,partialDelivery:true,partialReturn:true,authoritativePrice:true,stock:{before:startingStock,onHand:current.stockByStore.HUB_KENNEDY,reserved:current.reservedStockByStore.HUB_KENNEDY}},null,2));
console.log('HTTP: 8 distribution scenarios + grouped checkout, idempotency, capacity race, price, PIN, partial return and admin protection passed');
