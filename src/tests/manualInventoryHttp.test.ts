import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import net from 'node:net';
import {spawn,ChildProcess} from 'node:child_process';import {once} from 'node:events';import assert from 'node:assert/strict';
const source=process.cwd(),root=fs.mkdtempSync(path.join(os.tmpdir(),'bolt-inventory-http-'));
fs.mkdirSync(path.join(root,'src/data'),{recursive:true});fs.cpSync(path.join(source,'src/data/geography'),path.join(root,'src/data/geography'),{recursive:true});
fs.mkdirSync(path.join(root,'src/data/catalogo-local'));for(const name of ['productos','bodegas'])fs.writeFileSync(path.join(root,`src/data/catalogo-local/${name}.json`),'[]');
const socket=net.createServer();socket.listen(0,'127.0.0.1');await once(socket,'listening');const port=(socket.address() as net.AddressInfo).port;socket.close();await once(socket,'close');
const url=`http://127.0.0.1:${port}/api/v1`;let child:ChildProcess,logs='';
async function req(route:string,method='GET',body?:any,token?:string,headers={}){const r=await fetch(url+route,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{}),...headers},body:body?JSON.stringify(body):undefined});return {status:r.status,body:await r.json()};}
async function start(){child=spawn(process.execPath,['--import',path.join(source,'node_modules/tsx/dist/loader.mjs'),path.join(source,'server.ts')],{cwd:root,env:{...process.env,PORT:String(port),NODE_ENV:'production',BOLT_DATA_DIR:path.join(root,'orders')},stdio:['ignore','pipe','pipe']});child.stdout?.on('data',b=>logs+=b);child.stderr?.on('data',b=>logs+=b);for(let i=0;i<100;i++){if(child.exitCode!==null)throw Error(logs);try{if((await req('/catalog')).status===200)return;}catch{}await new Promise(r=>setTimeout(r,100));}throw Error('Isolated server did not start');}
async function stop(){if(child?.exitCode===null){child.kill('SIGTERM');await once(child,'exit');}}
try{
 await start();const payload={id:'http-plus5',delta:5,reason:'Ajuste manual autorizado de prueba aislada'};
 assert.equal((await req('/admin/catalog/inventory-batches','POST',payload)).status,401);
 assert.equal((await req('/admin/catalog/inventory-batches','POST',payload,undefined,{'X-Role':'ADMIN'})).status,401);
 assert.equal((await req('/admin/catalog/inventory-batches','POST',payload,'invalid')).status,403);
 const setup=await req('/auth/setup-admin','POST',{email:'inventory@example.invalid',name:'Fixture inventory',password:'Isolated-inventory-test-83!'});assert.equal(setup.status,201);let token=setup.body.token;
 const before=(await req('/admin/catalog','GET',undefined,token)).body,orders=(await req('/orders','GET',undefined,token)).body;
 assert.equal((await req('/admin/catalog/inventory-batches','POST',{...payload,delta:-5},token)).status,400);
 const prepared=await req('/admin/catalog/inventory-batches','POST',payload,token);assert.equal(prepared.status,200);assert.equal(prepared.body.status,'PREPARED');assert.deepEqual((await req('/admin/catalog','GET',undefined,token)).body,before);
 const first=await req('/admin/catalog/batches/http-plus5/apply','POST',{limit:1},token);assert.equal(first.body.status,'RUNNING');
 await stop();await start();token=(await req('/auth/login','POST',{email:'inventory@example.invalid',password:'Isolated-inventory-test-83!'})).body.token;
 let applied=await req('/admin/catalog/batches/http-plus5/apply','POST',{limit:500},token);assert.equal(applied.status,200);assert.equal(applied.body.status,'COMPLETED');
 const after=(await req('/admin/catalog','GET',undefined,token)).body;
 for(const row of applied.body.rows){const p=after.find((p:any)=>p.id===row.productId),v=p.presentaciones.find((v:any)=>v.varianteId===row.variantId),old=before.find((p:any)=>p.id===row.productId).presentaciones.find((v:any)=>v.varianteId===row.variantId);assert.equal(v.price,old.price);assert.deepEqual(v.reservedStockByStore,old.reservedStockByStore);for(const s of row.stocks){assert.equal(s.status,'APPLIED');assert.equal(s.after,s.before+5);assert.equal(v.stockByStore[s.storeId],s.after);}}
 await req('/admin/catalog/batches/http-plus5/apply','POST',{},token);await req('/admin/catalog/inventory-batches','POST',payload,token);assert.deepEqual((await req('/admin/catalog','GET',undefined,token)).body,after);assert.deepEqual((await req('/orders','GET',undefined,token)).body,orders);
 const customer=(await req('/catalog')).body;for(const p of customer)assert.deepEqual(p,after.find((a:any)=>a.id===p.id));
 await stop();await start();token=(await req('/auth/login','POST',{email:'inventory@example.invalid',password:'Isolated-inventory-test-83!'})).body.token;
 assert.deepEqual((await req('/admin/catalog','GET',undefined,token)).body,after);assert.equal((await req('/admin/catalog/batches/http-plus5','GET',undefined,token)).body.status,'COMPLETED');
 console.log('PASS HTTP manual inventory: session required, +5 only, backup/prepare, interrupted apply/resume, repeated request, admin/customer consistency, orders intact and restart persistence.');
}finally{await stop();fs.rmSync(root,{recursive:true,force:true});}
