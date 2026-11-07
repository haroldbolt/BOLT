/** Explicit isolated simulation only. A test admin file is supplied outside source control. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import {fixtureExternalProvider} from './transportFixtures';
const origin=process.env.BOLT_TRANSPORT_TEST_URL,credentialFile=process.env.BOLT_TRANSPORT_TEST_ADMIN;
if(origin!=='http://localhost:3010' || !credentialFile) throw Error('Use only the isolated port 3010 and an explicit test-admin credentials file.');
const credentials=JSON.parse(fs.readFileSync(credentialFile,'utf8'));
if(!credentials.email.endsWith('@example.invalid')) throw Error('A fictitious admin is required.');
const request=async(path:string,body?:any,headers:any={},method=body===undefined?'GET':'POST')=>{const r=await fetch(origin+path,{method,headers:{'Content-Type':'application/json',...headers},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,data:await r.json()};};
const login=await request('/api/v1/auth/login',{email:credentials.email,password:credentials.password});assert.equal(login.status,200);const auth={Authorization:`Bearer ${login.data.token}`};
const initial=(await request('/api/v1/admin/transport',undefined,auth)).data;
let current=initial;
const set=async(config:any)=>{const r=await request('/api/v1/admin/transport',{config,revision:current.revision},auth,'PUT');assert.equal(r.status,200,JSON.stringify(r.data));current=r.data;};
const p=fixtureExternalProvider(),base={...initial.config,maxDispatches:null,externalProviders:[p]};
const destination={address:'Calle 3 #78-20, Kennedy Central, Bogotá',coordinates:{lat:4.6365,lng:-74.1448},municipality:'Bogotá',locality:'Kennedy'};
const items=[{productId:'sim-comida-50kg',quantity:5}];
const quote=async()=>(await request('/api/v1/delivery/quote',{destination,items,requestedMode:'TURBO'})).data;
const orderCount=(await request('/api/v1/orders')).data.length;
const payload=(q:any)=>({confirmationToken:q.confirmationToken,items:items.map(i=>({...i,price:10000})),deliveryMode:'TURBO_DIVIDIDO',deliveryAddress:destination,customer:{name:'SIMULACIÓN red externa HTTP',phone:'0000000000',email:'external@example.invalid',isGuest:true},paymentMethod:'CASH_ON_DELIVERY',tip:0});
try {
 await set({...base,vehicles:[],externalProviders:[{...p,response:'DELAYED'}]});let q=await quote();assert.equal(q.basketValidated,false);assert.equal(q.reasonCode,'PROVIDER_RESPONSE_PENDING');assert.equal(q.confirmationToken,undefined);
 await set({...base,vehicles:[],externalProviders:[{...p,response:'REJECTED'}]});q=await quote();assert.equal(q.basketValidated,false);
 await set({...base,vehicles:[]});q=await quote();assert.equal(q.transportPlan.shipments.length,5);assert.equal(q.charges.shipping,40000);assert.equal(q.charges.serviceFee,1500);assert.equal(q.estimatedMinutes,20);
 const oldPayload=payload(q);
 await set({...base,vehicles:[],externalProviders:[{...p,offerExpiresAt:new Date(Date.now()-1000).toISOString()}]});assert.notEqual((await request('/api/v1/orders',oldPayload,{'Idempotency-Key':crypto.randomUUID()})).status,201);
 await set({...base,vehicles:[],externalProviders:[{...p,shippingPerDispatchCOP:9000}]});assert.equal((await request('/api/v1/orders',oldPayload,{'Idempotency-Key':crypto.randomUUID()})).status,409,'Changed provider costs require confirmation');
 assert.equal((await request('/api/v1/orders')).data.length,orderCount,'No orders from pending, rejection, expiry or quotes');
 await set(base);q=await quote();assert.equal(q.transportPlan.shipments.length,5);const extCount=q.transportPlan.shipments.filter((s:any)=>s.vehicle.externalOffer).length;assert.ok(extCount>0);assert.equal(q.charges.externalShipping,extCount*8000);
 const headers={'Idempotency-Key':crypto.randomUUID()},body=payload(q);const created=await request('/api/v1/orders',body,headers);assert.equal(created.status,201,JSON.stringify(created.data));const o=created.data;assert.equal(o.childShipments.length,5);assert.equal(o.totals.total,q.charges.total);
 assert.equal((await request('/api/v1/orders',body,headers)).data.id,o.id);assert.equal((await request('/api/v1/orders')).data.length,orderCount+1);
 const external=o.childShipments.find((s:any)=>s.transportLoad.vehicle.externalOffer);assert.ok(external.driver.name.startsWith('SIMULACIÓN'));assert.equal((await request(`/api/v1/orders/${o.id}/tracking?shipmentId=${external.shipmentId}`)).data.driver.id,external.driver.id);
 for(const status of ['EN_ALISTAMIENTO','LISTO_PARA_DESPACHO']) assert.equal((await request(`/api/v1/operations/orders/${o.id}/status`,{status,shipmentId:external.shipmentId,role:'ADMINISTRADOR'})).status,200);
 const assigned=await request(`/api/v1/operations/orders/${o.id}/assign-driver`,{driverId:external.driver.id,shipmentId:external.shipmentId,role:'ADMINISTRADOR'});assert.equal(assigned.status,200,JSON.stringify(assigned.data));
 // Cancel only this disposable HTTP fixture before dispatch; preserve all previous orders.
 for(const c of o.childShipments) assert.equal((await request(`/api/v1/operations/orders/${o.id}/status`,{status:'CANCELADO',shipmentId:c.shipmentId,reason:'SIMULACIÓN HTTP finalizada antes de salida',role:'ADMINISTRADOR'})).status,200);
 const cancelledOrder=(await request(`/api/v1/orders/${o.id}`)).data;
 for(const c of cancelledOrder.childShipments.filter((s:any)=>s.physicalReturnPending)) assert.equal((await request(`/api/v1/operations/orders/${o.id}/confirm-physical-return`,{shipmentId:c.shipmentId,inspectorName:'SIMULACIÓN HTTP'})).status,200);
 fs.writeFileSync('../external-transport-http-results.json',JSON.stringify({orderId:o.id,shipments:5,externalCount:extCount,total:o.totals.total,pendingBlocked:true,rejectionBlocked:true,expiredBlocked:true,costChangeNeedsConfirmation:true,idempotency:true,assignment:true,trackingByShipment:true,testOrderCancelled:true},null,2));
 console.log('External HTTP: delay, rejection, acceptance, expiry, price reconfirmation, 5 mixed dispatches, idempotency, assignment and tracking passed. Simulation configuration remains available only in this isolated app.');
} catch(error) {await set(initial.config);throw error;}
