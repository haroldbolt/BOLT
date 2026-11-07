import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn,ChildProcess} from 'node:child_process';
import assert from 'node:assert/strict';
const source=process.cwd(),root=fs.mkdtempSync(path.join(os.tmpdir(),'bolt-photo-http-'));
fs.mkdirSync(path.join(root,'src/data'),{recursive:true});
fs.cpSync(path.join(source,'src/data/geography'),path.join(root,'src/data/geography'),{recursive:true});
fs.mkdirSync(path.join(root,'src/data/catalogo-local'));
fs.writeFileSync(path.join(root,'src/data/catalogo-local/productos.json'),'[]');
fs.writeFileSync(path.join(root,'src/data/catalogo-local/bodegas.json'),'[]');
let server!:ChildProcess;
const url='http://127.0.0.1:3057/api/v1';
const request=async(route:string,method='GET',body?:any,token?:string)=>{
 const r=await fetch(url+route,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},body:body?JSON.stringify(body):undefined});return {status:r.status,body:await r.json()};
};
async function start(){server=spawn(process.execPath,['--import',path.join(source,'node_modules/tsx/dist/loader.mjs'),path.join(source,'server.ts')],{cwd:root,env:{...process.env,PORT:'3057',NODE_ENV:'production',BOLT_DATA_DIR:path.join(root,'orders')},stdio:['ignore','pipe','pipe']});server.stderr?.on('data',d=>process.stderr.write(d));for(let i=0;i<80;i++){try{if((await request('/catalog')).status===200)return;}catch{}await new Promise(r=>setTimeout(r,100));}throw Error('Servidor aislado no inició');}
async function stop(){server.kill('SIGTERM');await new Promise(r=>server.once('exit',r));}
try {
 await start();
 const denied=await request('/admin/catalog/images/apply','POST',{patches:[]});assert.equal(denied.status,401);
 const setup=await request('/auth/setup-admin','POST',{email:'images@test.invalid',name:'Pruebas imágenes',password:'Image-test-only-39!'});assert.equal(setup.status,201,JSON.stringify(setup.body));const token=setup.body.token;
 const before=(await request('/admin/catalog', 'GET',undefined,token)).body;
 const p=before.find((p:any)=>p.id==='prod-nexgard-spectra-m');const v=p.presentaciones[0];
 const patch={productId:p.id,image:{before:p.image,after:'https://cdn.shopify.com/test-verified.png'},variants:[{variantId:v.varianteId,before:v.foto,after:'/uploads/catalog/test-image.png'}],source:'fixture:isolated',checkedAt:new Date().toISOString(),reason:'Prueba aislada'};
 assert.equal((await request('/admin/catalog/images/apply','POST',{patches:[{...patch,price:1}]},token)).status,409);
 assert.equal((await request('/admin/catalog/images/apply','POST',{patches:[patch]},token)).body.changed,1);
 assert.equal((await request('/admin/catalog/images/apply','POST',{patches:[patch]},token)).body.changed,0);
 const after=(await request('/catalog')).body.find((x:any)=>x.id===p.id);
 assert.equal(after.image,patch.image.after);assert.equal(after.presentaciones[0].foto,patch.variants[0].after);
 for(const k of ['price','stockByStore','reservedStockByStore','status','bodegaIds','sku'])assert.deepEqual(after[k],p[k]);
 assert.equal((await request('/admin/catalog/images/apply','POST',{patches:[{...patch,image:{before:'stale',after:'https://cdn.shopify.com/another.png'}}]},token)).status,409);
 await stop();await start();
 const restored=(await request('/catalog')).body.find((x:any)=>x.id===p.id);assert.deepEqual(restored,after);
 console.log('PASS HTTP: autenticación, campos protegidos, imágenes por variante, conflicto, idempotencia, catálogo y reinicio real sin alterar importes/stock/reservas.');
}finally{if(server?.exitCode===null)await stop();fs.rmSync(root,{recursive:true,force:true});}
