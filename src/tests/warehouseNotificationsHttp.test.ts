// Only run against the isolated preview, never against production.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { PushNotificationService } from '../lib/notifications';
const base=process.env.BOLT_TEST_BASE_URL;
if(base!=='http://localhost:3002')throw Error('Use the isolated test server on localhost:3002');
const post=async(body:any,key:string)=>{const res=await fetch(base+'/api/v1/orders',{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':key},body:JSON.stringify(body)});return {status:res.status,body:await res.json()}};
const resultFile=process.env.BOLT_TEST_RESULT || '/tmp/bolt-warehouse-http.json';
if(process.argv.includes('--verify-restart')) {
 const prior=JSON.parse(fs.readFileSync(resultFile,'utf8'));
 for(const row of prior) {
   const order=await (await fetch(base+'/api/v1/orders/'+row.orderId)).json();
   assert.deepEqual(order.warehouseAssignment,row.assignment);console.log('PASS restart',row.storeId,row.assignment.id);
 }
} else {
 const before=await (await fetch(base+'/api/v1/orders')).json();
 const stores=await (await fetch(base+'/api/v1/stores')).json();
 const products=await (await fetch(base+'/api/v1/catalog')).json();
 const rows=[];
 const storageValues=new Map<string,string>();const storage={getItem:(k:string)=>storageValues.get(k)||null,setItem:(k:string,v:string)=>{storageValues.set(k,v)}};
 const alerts=new PushNotificationService(storage);let liveCount=0;alerts.subscribe(()=>liveCount++);
 for(const id of ['HUB_KENNEDY','HUB_ALAMOS','HUB_SUBA']) {
   const store=stores.find((s:any)=>s.id===id);
   const quote=await (await fetch(base+'/api/v1/delivery/quote',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({destination:{address:store.address,coordinates:store.coordinates},requestedMode:'PROGRAMADO'})})).json();
   assert.equal(quote.assignedStoreId,id);assert.equal(quote.warehouse.id,id);
   const product=products.find((p:any)=>p.price>0 && !p.requiresPrescription && (p.stockByStore[id]||0)-(p.reservedStockByStore[id]||0)>3);
   const payload={storeId:'UNTRUSTED_BROWSER_STORE',deliveryMode:'PROGRAMADO',scheduledWindow:quote.scheduledSlots.find((s:any)=>s.availableCapacity>0),items:[{productId:product.id,quantity:1,name:product.name,price:product.price,weightKg:product.weightKg}],customer:{name:'PRUEBA AISLADA AVISO SEDE - NO DESPACHAR',email:'warehouse@example.invalid',phone:'+57 300 000 0000'},deliveryAddress:quote.destination,paymentMethod:'EFECTIVO'};
   const key='warehouse-http-'+id+'-'+Date.now();
   const created=await post(payload,key);assert.equal(created.status,201,JSON.stringify(created.body));
   assert.equal(created.body.storeId,id);assert.equal(created.body.warehouseAssignment.store.id,id);
   assert.equal(created.body.warehouse.customerName,quote.warehouse.customerName);
   const tracking=await (await fetch(base+'/api/v1/orders/'+created.body.id+'/tracking')).json();
   assert.equal(tracking.warehouse.id,id);assert.deepEqual(tracking.warehouseAssignment,created.body.warehouseAssignment);
   alerts.notifyWarehouseAssignment(created.body);assert.equal(liveCount,rows.length+1);
   const retry=await post(payload,key);assert.equal(retry.status,200);assert.equal(retry.body.id,created.body.id);assert.deepEqual(retry.body.warehouseAssignment,created.body.warehouseAssignment);
   assert.equal(alerts.notifyWarehouseAssignment(retry.body),null);
   assert.equal(new PushNotificationService(storage).notifyWarehouseAssignment(retry.body),null);
   const conflict=await post({...payload,tip:5000},key);assert.equal(conflict.status,409);
   const failure=await post({...payload,items:[{...payload.items[0],quantity:999999}]},key+'-fail');assert.equal(failure.status,400);assert.equal(failure.body.warehouseAssignment,undefined);
   assert.equal(liveCount,rows.length+1);
   rows.push({storeId:id,orderId:created.body.id,assignment:created.body.warehouseAssignment,message:alerts.getNotifications().find(n=>n.id===created.body.warehouseAssignment.id)?.message});
   console.log('PASS API quote, create, retry, conflict and failure',id);
 }
 const after=await (await fetch(base+'/api/v1/orders')).json();
 assert.equal(after.length,before.length+3);
 for(const old of before)assert.deepEqual(after.find((o:any)=>o.id===old.id),old);
 const old=before.find((o:any)=>!o.warehouseAssignment && stores.some((s:any)=>s.id===o.storeId));
 const legacy=await (await fetch(base+'/api/v1/orders/'+old.id)).json();assert.equal(legacy.warehouse.id,old.storeId);
 fs.writeFileSync(resultFile,JSON.stringify(rows,null,2));console.log('PASS legacy ID resolution; existing copied orders unchanged');
}
