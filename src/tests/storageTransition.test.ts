import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import assert from 'node:assert/strict';
import {FulfillmentStorage,checkStorageRelease} from '../lib/fulfillmentStorage';import {newDispatchState} from '../types/dispatch';
import {backendAuthorization} from '../lib/backendRequest';
const root=fs.mkdtempSync(path.join(os.tmpdir(),'bolt-storage-transition-'));
const state={orders:[{id:'FIXTURE',status:'CONFIRMADO',items:[{quantity:2}],reserved:2}],drivers:[],audit:[],telemetry:{},dispatch:newDispatchState()};
try{
 for(const stage of ['prepared','published']){
  const dir=path.join(root,stage);fs.mkdirSync(dir);fs.writeFileSync(path.join(dir,'persisted-fulfillment.json'),JSON.stringify({version:1,...state}));
  const store=new FulfillmentStorage(dir,s=>{if(s===stage)throw Error('Simulated interruption');});
  assert.throws(()=>store.commit(state));
  const resumed=new FulfillmentStorage(dir);const read=resumed.read();assert.equal(read.version,stage==='prepared'?1:2);
  const next={...state,orders:[...state.orders,{id:'AFTER-TRANSITION',status:'ENTREGADO',items:[{quantity:1}],reserved:0}],audit:[{event:'NEW_DELIVERY'}]};
  resumed.commit(next);assert.deepEqual(resumed.read().orders,next.orders);assert.deepEqual(resumed.read().audit,next.audit);
  assert.equal(JSON.parse(fs.readFileSync(resumed.journal,'utf8')).phase,'COMMITTED');
  const compatible=path.join(root,'compatible-'+stage);fs.mkdirSync(compatible);fs.copyFileSync('storage-contract.json',path.join(compatible,'storage-contract.json'));
  assert.equal(checkStorageRelease(dir,compatible).compatible,true);
  const old=path.join(root,'old-'+stage);fs.mkdirSync(old);assert.throws(()=>checkStorageRelease(dir,old),/incompatible/);
  // Compatible rollback reader sees all post-transition movements, never restores legacy backups.
  const rollback=new FulfillmentStorage(dir);assert.deepEqual(rollback.read().orders,next.orders);assert.deepEqual(rollback.read().audit,next.audit);
 }
 const conflict=path.join(root,'conflict');fs.mkdirSync(conflict);fs.writeFileSync(path.join(conflict,'persisted-orders.json'),'[]');
 assert.throws(()=>new FulfillmentStorage(conflict,s=>{if(s==='prepared')throw Error('interrupt')}).commit(state));
 fs.writeFileSync(path.join(conflict,'persisted-orders.json'),'[{}]');assert.throws(()=>new FulfillmentStorage(conflict).commit(state),/fuente cambió/);
 const origin='https://bolt.example';
 assert.equal(backendAuthorization('/api/v1/stores/HUB_SUBA/verify-entrance','fixture',origin).has('Authorization'),true);
 for(const url of ['https://other.example/api/v1/admin/orders','//other.example/api/v1/admin/orders','/api/v1/stores','/arbitrary'])assert.equal(backendAuthorization(url,'fixture',origin).has('Authorization'),false);
 console.log('PASS storage: interruption before/after publication, resume, source conflict, compatible rollback with later movements, incompatible code blocked; same-origin credential policy');
}finally{fs.rmSync(root,{recursive:true,force:true});}
