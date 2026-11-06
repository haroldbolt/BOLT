import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { WAREHOUSES, validateWarehouseConfiguration } from '../data/warehouseConfig';
import { INITIAL_ORDERS } from '../data/seedData';
import { OrdersRepository } from '../lib/ordersRepository';
import { PushNotificationService } from '../lib/notifications';
import { describeWarehouse,makeWarehouseAssignment,resolveOrderWarehouse } from '../lib/warehouseAssignment';
import { resolveTerritorialAssignment } from '../lib/territoryConfig';
import { evaluateDeliveryQuote } from '../lib/deliveryService';
import type { Order,Store } from '../types';

let count=0;
const test=(name:string,fn:()=>void)=>{fn();++count;console.log('PASS',name)};
const memory=()=>{const values=new Map<string,string>();return {getItem:(k:string)=>values.get(k) || null,setItem:(k:string,v:string)=>{values.set(k,v)}}};
const createFixture=(store:Store,id=store.id):Order=>({...structuredClone(INITIAL_ORDERS[0]),id:'TEST-'+id,storeId:store.id,storeName:store.name,warehouseAssignment:makeWarehouseAssignment('TEST-'+id,store)});
for(const id of ['HUB_KENNEDY','HUB_ALAMOS','HUB_SUBA'])test('Server assignment message '+id,()=>{
 const store=WAREHOUSES.find(s=>s.id===id)!;const order=createFixture(store);const service=new PushNotificationService(memory());
 const n=service.notifyWarehouseAssignment(order)!;
 assert.equal(n.id,order.warehouseAssignment!.id);assert.equal(n.message,`Tu pedido será preparado y despachado desde nuestra sede de ${store.customerName}.`);
 assert.equal(n.type,'WAREHOUSE_ASSIGNED');assert.equal(resolveOrderWarehouse(order)?.id,store.id);
});
test('Repeated renders, polling, retries and refresh do not duplicate assignment',()=>{
 const storage=memory();const service=new PushNotificationService(storage);const order=createFixture(WAREHOUSES[2]);let alerts=0;
 service.subscribe(()=>alerts++);service.notifyWarehouseAssignment(order);
 for(let i=0;i<6;i++)assert.equal(service.notifyWarehouseAssignment(structuredClone(order)),null);
 assert.equal(alerts,1);const refreshed=new PushNotificationService(storage);
 assert.equal(refreshed.notifyWarehouseAssignment(order),null);assert.equal(refreshed.getActiveNotification(),null);
 assert.equal(refreshed.getNotifications().filter(n=>n.id===order.warehouseAssignment!.id).length,1);
});
test('Assignment deduplication survives notification list trimming',()=>{
 const storage=memory(),service=new PushNotificationService(storage),order=createFixture(WAREHOUSES[0]);service.notifyWarehouseAssignment(order);
 for(let i=0;i<35;i++)service.triggerNotification('Fixture','Aviso de prueba');
 assert.equal(new PushNotificationService(storage).notifyWarehouseAssignment(order),null);
});
test('Authorized changed assignment announced once; stale revisions suppressed',()=>{
 const order=createFixture(WAREHOUSES[0]),service=new PushNotificationService(memory());
 const changed={...order,storeId:WAREHOUSES[2].id,warehouseAssignment:makeWarehouseAssignment(order.id,WAREHOUSES[2],order.warehouseAssignment)};
 assert.equal(service.notifyWarehouseAssignment(changed)?.message,'La sede asignada a tu pedido cambió a Suba.');
 assert.equal(service.notifyWarehouseAssignment(changed),null);assert.equal(service.notifyWarehouseAssignment(order),null);
 assert.equal(makeWarehouseAssignment(order.id,WAREHOUSES[2],changed.warehouseAssignment).id,changed.warehouseAssignment.id);
});
test('Failed or unknown assignment cannot produce a success notification',()=>{
 const service=new PushNotificationService(memory()),order=createFixture(WAREHOUSES[0]);
 assert.equal(service.notifyWarehouseAssignment({...order,warehouseAssignment:undefined}),null);
 assert.equal(service.notifyWarehouseAssignment({...order,storeId:'UNKNOWN'}),null);
 assert.equal(resolveOrderWarehouse({storeId:'UNKNOWN'}),undefined);
});
test('Legacy order resolved by stable ID, never a browser or saved display name',()=>{
 const legacy={storeId:'HUB_SUBA',warehouseAssignment:undefined};
 assert.equal(resolveOrderWarehouse(legacy,WAREHOUSES)?.customerName,'Suba');
 assert.equal(resolveOrderWarehouse({storeId:'UNKNOWN'},WAREHOUSES),undefined);
});
test('Commercial address visibility is respected',()=>assert.equal(describeWarehouse({...WAREHOUSES[0],showAddressToCustomer:false})?.address,undefined));
test('Fourth configured test warehouse works dynamically and does not enable unassigned coverage',()=>{
 const original=WAREHOUSES[2].scheduledLocalities;
 const fourth:Store={...WAREHOUSES[2],id:'TEST_FOURTH_WAREHOUSE',name:'Bolt Pets Sede Temporal',customerName:'Sede Temporal',scheduledLocalities:[],scheduledMunicipalities:[],enabledModes:['PROGRAMADO']};
 WAREHOUSES.push(fourth);
 try {
   assert.notEqual(resolveTerritorialAssignment({municipality:'Bogotá',locality:'Usaquén'}).assignedStoreId,fourth.id);
   WAREHOUSES[2].scheduledLocalities=['Suba'];fourth.scheduledLocalities=['Usaquén'];
   assert.equal(resolveTerritorialAssignment({municipality:'Bogotá',locality:'Usaquén'}).assignedStoreId,fourth.id);
   const q=evaluateDeliveryQuote({destination:{address:'Calle 150 #16-56',municipality:'Bogotá',locality:'Usaquén',coordinates:{lat:4.731531,lng:-74.041785}},requestedMode:'PROGRAMADO'},WAREHOUSES);
   assert.equal(q.assignedStoreId,fourth.id);assert.equal(q.scheduledEligible,true);
   const order=createFixture(fourth),service=new PushNotificationService(memory());assert.equal(service.notifyWarehouseAssignment(order)?.message,'Tu pedido será preparado y despachado desde nuestra sede de Sede Temporal.');
   assert.equal(resolveOrderWarehouse(order)?.customerName,'Sede Temporal');
   const disabled=evaluateDeliveryQuote({destination:q.destination,requestedMode:'PROGRAMADO'},WAREHOUSES.map(s=>s.id===fourth.id?{...s,enabledModes:[]}:s));
   assert.equal(disabled.scheduledEligible,false);assert.equal(disabled.reasonCode,'MODE_UNAVAILABLE');
 } finally {WAREHOUSES.pop();WAREHOUSES[2].scheduledLocalities=original}
 assert.ok(!WAREHOUSES.some(s=>s.id===fourth.id));
});
test('Assignment and event ID survive repository restart; same operation has no extra event',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bolt-warehouse-'));
 try {
   const repo=new OrdersRepository({dataDir:dir}),store=WAREHOUSES[0];const order=createFixture(store,'PERSISTENCE');order.warehouseAssignment=undefined;
   order.creationRequestId='test-idempotency';order.creationRequestFingerprint='same';
   const saved=repo.createOrder(order,undefined,store).order!;assert.ok(saved.warehouseAssignment);
   const loaded=new OrdersRepository({dataDir:dir});assert.deepEqual(loaded.getOrderById(order.id)?.warehouseAssignment,saved.warehouseAssignment);
   assert.equal(loaded.createOrder({...order,id:'DIFFERENT-ID'},undefined,store).order?.id,order.id);
   assert.throws(()=>loaded.recordWarehouseAssignment(order.id,WAREHOUSES[2],{role:'CLIENTE',name:'Fixture'}),/autorizada/);
   const changed=loaded.recordWarehouseAssignment(order.id,WAREHOUSES[2],{role:'ADMINISTRADOR',name:'Fixture'});
   assert.equal(changed.warehouseAssignment?.kind,'CHANGED');const eventId=changed.warehouseAssignment?.id;
   assert.equal(loaded.recordWarehouseAssignment(order.id,WAREHOUSES[2],{role:'ADMINISTRADOR',name:'Fixture'}).warehouseAssignment?.id,eventId);
   assert.equal(new OrdersRepository({dataDir:dir}).getOrderById(order.id)?.warehouseAssignment?.id,eventId);
 } finally {fs.rmSync(dir,{recursive:true,force:true})}
});
test('Read state persists in notification center',()=>{
 const storage=memory(),service=new PushNotificationService(storage),order=createFixture(WAREHOUSES[2]);const n=service.notifyWarehouseAssignment(order)!;
 service.markAsRead(n.id);assert.equal(new PushNotificationService(storage).getNotifications().find(x=>x.id===n.id)?.read,true);
});
test('Configuration rejects duplicate IDs and territorial overlap',()=>{
 assert.throws(()=>validateWarehouseConfiguration([WAREHOUSES[0],WAREHOUSES[0]]),/duplicado/);
 assert.throws(()=>validateWarehouseConfiguration([WAREHOUSES[0],{...WAREHOUSES[0],id:'TEST_DUPLICATE_TERRITORY'}]),/más de una/);
});
console.log(`${count} warehouse notification cases passed`);
