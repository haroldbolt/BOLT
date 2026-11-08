import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import net from 'node:net';
import {spawn} from 'node:child_process';
import assert from 'node:assert/strict';
import {INITIAL_ORDERS} from '../data/seedData';
import {fixtureProduct,fixtureDrivers,fixtureConfig} from '../tests/transportFixtures';
import {api} from '../lib/api';

const source=process.cwd(),root=fs.mkdtempSync(path.join(os.tmpdir(),'bolt-audit-legacy-'));
const digest=(x:any)=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const sourceData=path.join(source,'src/data'),data=path.join(root,'orders');
fs.cpSync(sourceData,path.join(root,'src/data'),{recursive:true,filter:p=>!path.basename(p).startsWith('persisted-')&&!path.basename(p).startsWith('tmp-')});
fs.mkdirSync(data);fs.mkdirSync(path.join(root,'dist'));fs.mkdirSync(path.join(root,'.bolt-private'));
fs.writeFileSync(path.join(root,'dist/index.html'),'<title>Isolated diagnostic fixture</title>');
fs.symlinkSync(fs.realpathSync(path.join(source,'node_modules')),path.join(root,'node_modules'),'dir');
const product=fixtureProduct('AUDIT-PRODUCT',1000);product.reservedStockByStore.HUB_SUBA=7;
fs.writeFileSync(path.join(root,'src/data/persisted-catalog-overrides.json'),JSON.stringify({version:'1.0.0',customProducts:[product],overrides:{},auditLog:[]}));
const drivers=fixtureDrivers.filter(d=>d.id.includes('SUBA')).map(d=>({...d,isOnline:false,currentStatus:'FUERA_DE_TURNO',currentLocation:{lat:0,lng:0,updatedAt:new Date(0).toISOString()}}));
const cases=[['pending','PENDIENTE_CONFIRMACION'],['confirmed','CONFIRMADO'],['preparing','EN_ALISTAMIENTO'],['ready','LISTO_PARA_DESPACHO'],['onway','EN_CAMINO'],['onway_missing_pickup','EN_CAMINO'],['onway_missing_driver','EN_CAMINO'],['delivered','ENTREGADO'],['cancelled','CANCELADO']] as const;
const now=new Date().toISOString();
const fixtures=cases.map(([key,status])=>{
 const o=structuredClone(INITIAL_ORDERS[0]) as any;
 Object.assign(o,{id:'AUDIT-'+key,orderNumber:'TEST-'+key,assignmentId:'ASG-AUDIT-'+key,tripId:'TRP-AUDIT-'+key,creationRequestId:undefined,creationRequestFingerprint:undefined,purchaseCode:undefined,guestAccessToken:undefined,customer:{name:'ISOLATED FIXTURE',phone:'0000000000',email:'fixture@example.invalid',isGuest:true},storeId:'HUB_SUBA',storeName:'Suba',driver:undefined,deliveryMode:'TURBO',isSplitOrder:false,childShipments:undefined,transportLoad:undefined,scheduledWindow:undefined,statusHistory:[],fulfillmentStatus:status,createdAt:now,timestamps:{confirmedAt:now},originalPromiseWindow:{start:now,end:new Date(Date.now()+3600000).toISOString()},estimatedDeliveryMinutes:10,payment:{method:'CARD',status:'APROBADO',cashToCollect:0},totals:{subtotal:10000,total:10000,shipping:0,discount:0,serviceFee:0,tip:0,totalWeightKg:1},items:[{productId:product.id,sku:product.sku,name:'ISOLATED FIXTURE',presentation:'1 kg',price:10000,quantity:1,image:'',weightKg:1,requiresPrescription:false}],secretDeliveryCode:'0000'});
 if(key==='onway'||key==='onway_missing_pickup'){o.driver={...drivers[key==='onway'?0:1]};o.timestamps.assignedAt=now;if(key==='onway')o.timestamps.pickedUpAt=now;}
 return JSON.parse(JSON.stringify(o));
});
fs.writeFileSync(path.join(data,'persisted-orders.json'),JSON.stringify(fixtures));
fs.writeFileSync(path.join(data,'persisted-drivers.json'),JSON.stringify(drivers));
const initialFileHash=digest(fs.readFileSync(path.join(data,'persisted-orders.json'),'utf8'));
const socket=net.createServer();await new Promise<void>(r=>socket.listen(0,'127.0.0.1',r));const port=(socket.address() as net.AddressInfo).port;await new Promise<void>(r=>socket.close(()=>r()));
const base=`http://127.0.0.1:${port}/api/v1`;
let child:any,output='',admin='',driverToken='';
const evidence:any={candidate:path.basename(source),fixtures:'9 synthetic historical orders; no operational data',before:[],registered:[],reconciliation:[],warehouse:[],preservation:{}};
async function request(p:string,method='GET',body?:any,auth=admin,extra:any={}){
 const res=await fetch(base+p,{method,headers:{'Content-Type':'application/json',...(auth?{Authorization:`Bearer ${auth}`} :{}),...extra},body:body===undefined?undefined:JSON.stringify(body)});
 const response=await res.json();return {status:res.status,data:response};
}
async function start(){
 child=spawn(process.execPath,['--import','tsx',path.join(source,'server.ts')],{cwd:root,env:{...process.env,PORT:String(port),NODE_ENV:'production',BOLT_DATA_DIR:data,BOLT_DISPATCH_SIMULATION:'0',BOLT_ADMIN_EMAIL:'',BOLT_ADMIN_PASSWORD:''},stdio:['ignore','pipe','pipe']});
 child.stdout.on('data',(b:any)=>output+=b);child.stderr.on('data',(b:any)=>output+=b);
 for(let i=0;i<100;i++){if(child.exitCode!==null)throw Error('Isolated server exited');try{if((await request('/health','GET',undefined,'')).status===200)return;}catch{}await new Promise(r=>setTimeout(r,100));}throw Error('Isolated server failed readiness');
}
async function stop(){if(child&&child.exitCode===null){child.kill('SIGTERM');await new Promise(r=>child.once('exit',r));}}
const credentials={email:'audit@example.invalid',password:'Temporary-'+crypto.randomUUID(),name:'Isolated administrator'};
try {
 await start();assert.equal((await request('/auth/setup-admin','POST',credentials,'')).status,201);
 admin=(await request('/auth/login','POST',credentials,'')).data.token;assert.ok(admin);
 assert.equal((await request('/auth/me')).data.user.role,'ADMINISTRADOR');
 const originalCatalog=await request('/catalog');const catalogHash=digest(originalCatalog.data);
 const adminBefore=await request('/admin/dispatch');assert.equal(adminBefore.data.orders.length,0);
 for(const f of fixtures){
  const stored=await request('/orders/'+f.id);assert.equal(stored.status,200);
  const guest=await request('/orders/'+f.id+'/tracking','GET',undefined,'');assert.equal(guest.status,403);
  const assigning=await request('/operations/orders/'+f.id+'/assign-driver','POST',{});assert.equal(assigning.status,409);
  evidence.before.push({case:f.id,status:f.fulfillmentStatus,stored:stored.status,visibleInDispatchPanel:false,guestTracking:guest.status,guestCode:guest.data.code,assign:assigning.status,message:assigning.data.error});
 }
 assert.equal(digest(fs.readFileSync(path.join(data,'persisted-orders.json'),'utf8')),initialFileHash);
 evidence.preservation.readOnlyRequestsPreservedHistoricalFile=true;
 const memory=new Map([['bolt_admin_token',admin]]);
 (globalThis as any).localStorage={getItem:(k:string)=>memory.get(k)||null,setItem:(k:string,v:string)=>memory.set(k,v),removeItem:(k:string)=>memory.delete(k)};
 (globalThis as any).sessionStorage=(globalThis as any).localStorage;
 const realFetch=globalThis.fetch;
 let clientRequest:any;
 globalThis.fetch=(async(input:any,init:any)=>{clientRequest={path:String(input),authorizationPresent:new Headers(init?.headers).has('Authorization')};const r=await realFetch(new URL(String(input),base),init);clientRequest.status=r.status;return r;}) as any;
 let clientError='';try{await api.verifyStoreEntrance('HUB_SUBA',null as any);}catch(e:any){clientError=e.message;}
 globalThis.fetch=realFetch;
 assert.equal(clientRequest.status,400);assert.equal(clientRequest.authorizationPresent,true);
 evidence.warehouse.push({...clientRequest,case:'actual frontend call with valid stored admin session',message:clientError});
 for(const [label,auth,extra] of [['no credential','',{}],['forged role','',{'x-actor-role':'ADMINISTRADOR'}],['invalid token','invalid-fixture-token',{}],['valid admin',admin,{}]] as any[]){
  const r=await request('/stores/HUB_SUBA/verify-entrance','POST',{coordinates:null},auth,extra);
  evidence.warehouse.push({case:label,status:r.status,code:r.data.code,message:r.data.error});
  assert.equal(r.status,label==='valid admin'?400:label==='invalid token'?403:401);
 }
 const store=(await request('/stores')).data.find((s:any)=>s.id==='HUB_SUBA');
 const validEntrance=await request('/stores/HUB_SUBA/verify-entrance','POST',{coordinates:store.coordinates});
 assert.equal(validEntrance.status,200);evidence.warehouse.push({case:'valid admin with existing warehouse coordinates',status:200,structuralCoordinateValidationPassed:true,physicalPresenceVerified:false});
 for(const f of fixtures){
  if(f.fulfillmentStatus==='PENDIENTE_CONFIRMACION'){assert.equal((await request('/admin/dispatch/orders/'+f.id+'/register','POST',{})).status,409);continue;}
  const registered=await request('/admin/dispatch/orders/'+f.id+'/register','POST',{});assert.equal(registered.status,200);
  const view=(await request('/admin/dispatch')).data;
  const row=view.orders.find((o:any)=>o.id===f.id);const run=row?.dispatches[0];
  const terminal=['ENTREGADO','CANCELADO'].includes(f.fulfillmentStatus);
  assert.equal(!!run,!terminal);
  if(run){assert.equal(run.status,'INCIDENT');assert.equal(run.reason,'LEGACY_ASSIGNMENT_REQUIRES_RECONCILIATION');}
  const codes=run?{purchase:row.code,dispatch:run.code}:null;
  await request('/admin/dispatch/orders/'+f.id+'/register','POST',{});
  const retry=(await request('/admin/dispatch')).data.orders.find((o:any)=>o.id===f.id);
  assert.equal(retry?.dispatches.length,run?1:undefined);
  if(run)assert.equal(retry.dispatches[0].code,run.code);
  const guest=await request('/orders/'+f.id+'/tracking','GET',undefined,'');assert.equal(guest.status,403);
  evidence.registered.push({case:f.id,registrationStatus:200,dispatchCreated:!!run,runStatus:run?.status,reason:run?.reason,codes,repeatCreatesDuplicate:false,returnsGuestToken:!!registered.data.guestAccessToken,guestStillBlocked:guest.status===403});
 }
 const reconcile=async(key:string,body:any)=>{
  const r=await request('/admin/dispatch/ASG-AUDIT-'+key+'/reconcile-legacy','POST',body);
  evidence.reconciliation.push({case:key,status:r.status,code:r.data.code,message:r.data.error});return r;
 };
 assert.equal((await reconcile('confirmed',{cashDueCOP:0})).status,400);
 for(const key of ['confirmed','preparing'])assert.equal((await reconcile(key,{cashDueCOP:0,note:'Synthetic paid-order audit evidence'})).status,200);
 assert.equal((await reconcile('onway_missing_driver',{cashDueCOP:0,note:'Missing custodian fixture'})).data.code,'CUSTODY_REQUIRED');
 assert.equal((await reconcile('onway',{driverId:drivers[1].id,cashDueCOP:0,note:'Wrong custodian fixture'})).data.code,'CUSTODY_MISMATCH');
 assert.equal((await reconcile('onway',{driverId:drivers[0].id,cashDueCOP:0,note:'Account absent fixture'})).data.code,'UNAUTHORIZED');
 for(const d of drivers.slice(0,2)){
  const password='Temporary-'+crypto.randomUUID();
  assert.equal((await request('/admin/dispatch/drivers','POST',{driver:d,email:d.id+'@example.invalid',password,storeIds:['HUB_SUBA']})).status,200);
  driverToken=(await request('/driver/auth/login','POST',{email:d.id+'@example.invalid',password},'')).data.token;
 }
 const deniedDriver=await request('/stores/HUB_SUBA/verify-entrance','POST',{coordinates:null},driverToken);
 assert.equal(deniedDriver.status,403);evidence.warehouse.push({case:'authenticated driver',status:deniedDriver.status,code:deniedDriver.data.code});
 assert.equal((await reconcile('onway',{driverId:drivers[0].id,cashDueCOP:0,note:'Capacity absent fixture'})).data.code,'CAPACITY_PENDING');
 const config=fixtureConfig();config.maxDispatches=null;
 fs.writeFileSync(path.join(root,'.bolt-private/transport-config.json'),JSON.stringify({config,revision:'isolated-fixture',audit:[]}));
 assert.equal((await reconcile('onway',{driverId:drivers[0].id,cashDueCOP:0,note:'Verified synthetic custodian, paid balance and capacity'})).status,200);
 const noTimestamp=await reconcile('onway_missing_pickup',{driverId:drivers[1].id,cashDueCOP:0,note:'Synthetic custody has no pickup timestamp'});
 assert.equal(noTimestamp.status,409);assert.equal(noTimestamp.data.code,'PICKUP_EVIDENCE_REQUIRED');
 const blocked=(await request('/admin/dispatch')).data.orders.find((o:any)=>o.id==='AUDIT-onway_missing_pickup').dispatches[0];
 assert.equal(blocked.status,'INCIDENT');assert.equal(blocked.driverId,undefined);
 const input={driverId:drivers[1].id,cashDueCOP:0,note:'Verified synthetic source',pickupEvidence:{pickedUpAt:now,sourceReference:'CASE-fixture-pickup'}};
 assert.equal((await reconcile('onway_missing_pickup',input)).status,200);
 assert.equal((await reconcile('onway_missing_pickup',input)).status,200);
 assert.equal((await reconcile('onway_missing_pickup',{...input,note:'Different attempt'})).status,409);
 const finalView=(await request('/admin/dispatch')).data;
 const known=finalView.orders.find((o:any)=>o.id==='AUDIT-onway').dispatches[0];
 const unknown=finalView.orders.find((o:any)=>o.id==='AUDIT-onway_missing_pickup').dispatches[0];
 assert.equal(known.status,'PICKED_UP');assert.equal(unknown.status,'PICKED_UP');assert.equal(unknown.pickedUpAt,Date.parse(now));
 assert.equal(finalView.metrics.averageAssignmentSeconds,null,'Historical registration is not a measured assignment duration');
 evidence.missingPickupTimestamp={fulfillmentStatus:'EN_CAMINO',reconciliationStatus:noTimestamp.status,dispatchStatus:unknown.status,driverPreserved:unknown.driverId===drivers[1].id};
 const runsBeforeRecovery=(await request('/admin/dispatch')).data.orders.length;
 for(const f of fixtures){
  const id=crypto.randomUUID(),secret=crypto.randomBytes(32).toString('hex');
  const begin=await request('/tracking-recovery','POST',{id,secret,reference:f.orderNumber},'');assert.equal(begin.status,200);
  assert.equal((await request('/tracking-recovery/status','POST',{id,secret:'wrong'},'')).status,403);
  const pending=await request('/tracking-recovery/status','POST',{id,secret},'');assert.equal(pending.data.status,'PENDING');assert.equal(pending.data.guestAccessToken,undefined);
  assert.equal((await request('/admin/dispatch/recoveries/'+id+'/approve','POST',{},'')).status,401);
  assert.equal((await request('/admin/dispatch/recoveries/'+id+'/approve','POST',{method:'CONTACT_DETAILS',evidenceReference:'known-name',verifiedOwner:true})).status,400);
  assert.equal((await request('/admin/dispatch/recoveries/'+id+'/approve','POST',{method:'PAYMENT_RECEIPT_REVIEW',evidenceReference:'CASE-fixture-invalid-payment',transactionReference:'WRONG',verifiedOwner:true})).status,409);
  const approval={method:'IN_PERSON_DOCUMENT_REVIEW',evidenceReference:'CASE-fixture-verified-owner',verifiedOwner:true};
  assert.equal((await request('/admin/dispatch/recoveries/'+id+'/approve','POST',approval)).status,200);
  assert.equal((await request('/admin/dispatch/recoveries/'+id+'/approve','POST',approval)).status,200);
  const access=(await request('/tracking-recovery/status','POST',{id,secret},'')).data;
  assert.ok(access.guestAccessToken);
  assert.equal((await request('/orders/'+f.id+'/tracking','GET',undefined,'',{'X-Order-Token':access.guestAccessToken})).status,200);
  const listing=await request('/admin/dispatch/recoveries');assert.ok(!JSON.stringify(listing).includes(secret));assert.ok(!JSON.stringify(listing).includes(access.guestAccessToken));
  const persisted=fs.readFileSync(path.join(data,'persisted-fulfillment.json'),'utf8');assert.ok(!persisted.includes(secret));assert.ok(!persisted.includes(access.guestAccessToken));
 }
 assert.equal((await request('/admin/dispatch')).data.orders.length,runsBeforeRecovery);
 const finalOrders=(await request('/orders')).data;
 const relevant=(o:any)=>Object.fromEntries(['id','items','totals','payment','fulfillmentStatus','createdAt','statusHistory','customer','deliveryAddress','storeId','assignmentId','tripId','timestamps'].map(k=>[k,o[k]]));
 for(const f of fixtures)assert.equal(digest(relevant(finalOrders.find((o:any)=>o.id===f.id))),digest(relevant(f)),'Historical commercial fields preserved');
 for(const f of fixtures.filter(o=>['ENTREGADO','CANCELADO'].includes(o.fulfillmentStatus))) {
  const saved=finalOrders.find((o:any)=>o.id===f.id);
  assert.equal(saved.purchaseCode,undefined);
 }
 assert.equal(digest((await request('/catalog')).data),catalogHash);
 const beforeRestart=finalView.orders.map((o:any)=>({id:o.id,code:o.code,dispatches:o.dispatches.map((d:any)=>({id:d.id,code:d.code,status:d.status,driverId:d.driverId}))}));
 await stop();await start();admin=(await request('/auth/login','POST',credentials,'')).data.token;
 const restarted=(await request('/admin/dispatch')).data.orders.map((o:any)=>({id:o.id,code:o.code,dispatches:o.dispatches.map((d:any)=>({id:d.id,code:d.code,status:d.status,driverId:d.driverId}))}));
 assert.deepEqual(restarted,beforeRestart);
 assert.equal(digest((await request('/catalog')).data),catalogHash);
 evidence.preservation={...evidence.preservation,pricesStockReservationsCatalogHashUnchanged:true,historicalCommercialFieldsAndStatusesUnchanged:true,terminalOrdersNotReopened:true,registrationRetryIdempotent:true,restartPreservesCodesAssignmentsAndStates:true,unifiedFileCreated:fs.existsSync(path.join(data,'persisted-fulfillment.json'))};
 fs.writeFileSync(path.join(root,'evidence.json'),JSON.stringify(evidence,null,2));
 console.log('PASS integration HTTP: 9 historical states, register/conciliate/retry, missing custody evidence rollback, verified pickup source, assisted guest recovery open/closed, access denied, warehouse auth, privacy, commercial preservation and restart');
} finally {await stop();fs.rmSync(root,{recursive:true,force:true});}
