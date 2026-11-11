import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {CatalogOperations} from '../lib/catalogOperations';
import type {Product,Store,Order} from '../types';
const root=fs.mkdtempSync(path.join(os.tmpdir(),'bolt-manual-stock-'));
const actor={email:'fixture@example.invalid',name:'Prueba aislada'};
const reason='Solicitud de prueba aislada de inventario';
const stores=[{id:'A',name:'A',isActive:true},{id:'B',name:'B',isActive:true,shopifyLocationGid:'gid-location-B'},{id:'OFF',name:'OFF',isActive:false}] as Store[];
const products=[{id:'p',name:'Dos tamaños',price:100,status:'ARCHIVED',sku:'P',stockByStore:{A:10},reservedStockByStore:{A:3},presentaciones:[
 {varianteId:'v1',nombre:'1 kg',sku:'ONE',price:100,bodegaIds:['A','OFF'],stockByStore:{A:10,OFF:7},reservedStockByStore:{A:3}},
 {varianteId:'v2',nombre:'5 kg',sku:'FIVE',price:200,bodegaIds:['A','gid-location-B'],stockByStore:{A:0,B:0},reservedStockByStore:{A:0,B:0}}]},
 {id:'single',name:'Sin variantes explícitas',presentation:'1 unidad',price:300,sku:'S',stockByStore:{A:0},reservedStockByStore:{A:0},bodegaIds:['A']}] as unknown as Product[];
let orders:Order[]=[];
const file=path.join(root,'operations.json');
const create=()=>new CatalogOperations({file,products:()=>products,stores:()=>stores,orders:()=>orders});
try{
 let op=create();op.initializeOrderTracking();
 for(const bad of [0,-5,0.5,NaN,Infinity,1000001])assert.throws(()=>op.prepareInventory('bad-delta',bad,actor,reason));
 assert.throws(()=>op.prepareInventory('bad-reason',5,actor,''));
 const before=op.getProducts();let batch=op.prepareInventory('manual-plus5',5,actor,reason);
 assert.deepEqual(op.getProducts(),before);assert.ok(fs.existsSync(path.join(batch.backupPath,'operations-before.json')));
 assert.equal(batch.rows.length,3);assert.equal(batch.rows.flatMap(r=>r.stocks).length,4);
 assert.ok(batch.rows.every(r=>r.price.status==='NOT_REQUESTED'));
 assert.deepEqual(op.prepareInventory('manual-plus5',5,actor,reason),batch);
 assert.throws(()=>op.prepareInventory('manual-plus5',6,actor,reason));
 assert.throws(()=>op.prepareInventory('manual-plus5',5,actor,'Otro motivo autorizado distinto'));
 orders=[{id:'concurrent',storeId:'A',fulfillmentStatus:'CONFIRMADO',items:[{productId:'p',quantity:2}]} as Order];
 batch=op.apply('manual-plus5',actor,1);
 assert.equal(batch.status,'RUNNING');assert.equal(batch.rows[0].stocks[0].before,10);assert.equal(batch.rows[0].stocks[0].after,15);assert.equal(batch.rows[0].stocks[0].reserved,5);
 op=create();op.apply('manual-plus5',actor,500);
 const after=op.getProducts();assert.equal(after[0].presentaciones![1].stockByStore!.A,5);assert.equal(after[0].presentaciones![1].stockByStore!.B,5);assert.equal(after[1].stockByStore.A,5);
 assert.equal(after[0].presentaciones![0].stockByStore!.OFF,7);assert.equal(after[0].status,'ARCHIVED');assert.equal(after[0].price,100);assert.equal(after[0].presentaciones![1].price,200);
 const auditCount=op.getBatch('manual-plus5').audit.length;op.apply('manual-plus5',actor);assert.deepEqual(op.getProducts(),after);assert.equal(op.getBatch('manual-plus5').audit.length,auditCount);
 orders[0].fulfillmentStatus='ENTREGADO';op=create();
 const current=op.getProducts()[0];op.edit('p',{variantId:'v1',priceCOP:333,stockByStore:{A:20},expectedRevision:current.presentaciones![0].commerceRevision},actor);
 op.reverse('manual-plus5',actor);assert.equal(op.getProducts()[0].stockByStore.A,15);assert.equal(op.getProducts()[0].price,333);assert.equal(op.getProducts()[0].reservedStockByStore!.A,3);assert.equal(orders[0].fulfillmentStatus,'ENTREGADO');
 const reversed=op.getProducts();op.reverse('manual-plus5',actor);assert.deepEqual(op.getProducts(),reversed);
 assert.throws(()=>op.apply('manual-plus5',actor));
 const conflict=new CatalogOperations({file:path.join(root,'conflict.json'),products:()=>products,stores:()=>stores,orders:()=>[]});
 conflict.prepareInventory('concurrent-edit',5,actor,reason);
 conflict.edit('p',{variantId:'v1',priceCOP:999,stockByStore:{A:30},expectedRevision:conflict.getProducts()[0].presentaciones![0].commerceRevision},actor);
 const c=conflict.apply('concurrent-edit',actor);assert.equal(c.rows[0].stocks[0].before,30);assert.equal(conflict.getProducts()[0].stockByStore.A,35);assert.equal(conflict.getProducts()[0].price,999);
 const fail=new CatalogOperations({file:path.join(root,'fail.json'),products:()=>products,stores:()=>stores,orders:()=>[]});
 fail.prepareInventory('write-failure',5,actor,reason);const unchanged=fail.getProducts();fs.mkdirSync(path.join(root,'fail.json.tmp'));assert.throws(()=>fail.apply('write-failure',actor));assert.deepEqual(fail.getProducts(),unchanged);assert.equal(fail.getBatch('write-failure').status,'PREPARED');
 console.log('PASS manual inventory: +5, zero, multiple variants, reservations, active associations, archived status, no price import, idempotency, restart/resume, concurrent edits, compensating reversal and failed persistence.');
}finally{fs.rmSync(root,{recursive:true,force:true});}
