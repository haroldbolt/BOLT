import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn,ChildProcess} from 'node:child_process';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {api} from '../lib/api';
import {saleVariant} from '../lib/variantCommerce';
import type {Product} from '../types';
const source=process.cwd(),root=fs.mkdtempSync(path.join(os.tmpdir(),'bolt-photo-http-'));
fs.mkdirSync(path.join(root,'src/data'),{recursive:true});
fs.cpSync(path.join(source,'src/data/geography'),path.join(root,'src/data/geography'),{recursive:true});
fs.mkdirSync(path.join(root,'src/data/catalogo-local'));
fs.writeFileSync(path.join(root,'src/data/catalogo-local/productos.json'),'[]');
fs.writeFileSync(path.join(root,'src/data/catalogo-local/bodegas.json'),'[]');
let server!:ChildProcess;
const url='http://127.0.0.1:3057/api/v1';
const adminCredentials={email:'images@test.invalid',name:'Pruebas imágenes',password:'Image-test-only-39!'};
const request=async(route:string,method='GET',body?:any,token?:string)=>{
 const r=await fetch(url+route,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},body:body?JSON.stringify(body):undefined});return {status:r.status,body:await r.json()};
};
async function start(){server=spawn(process.execPath,['--import',path.join(source,'node_modules/tsx/dist/loader.mjs'),path.join(source,'server.ts')],{cwd:root,env:{...process.env,PORT:'3057',NODE_ENV:'production',BOLT_DATA_DIR:path.join(root,'orders')},stdio:['ignore','pipe','pipe']});server.stderr?.on('data',d=>process.stderr.write(d));for(let i=0;i<80;i++){try{if((await request('/catalog')).status===200)return;}catch{}await new Promise(r=>setTimeout(r,100));}throw Error('Servidor aislado no inició');}
async function stop(){server.kill('SIGTERM');await new Promise(r=>server.once('exit',r));}
try {
 await start();
 const denied=await request('/admin/catalog/images/apply','POST',{patches:[]});assert.equal(denied.status,401);
 const setup=await request('/auth/setup-admin','POST',adminCredentials);assert.equal(setup.status,201,JSON.stringify(setup.body));const token=setup.body.token;
 const before=(await request('/admin/catalog', 'GET',undefined,token)).body;
 const p=before.find((p:any)=>p.id==='prod-nexgard-spectra-m');const v=p.presentaciones[0];
 const patch={productId:p.id,image:{before:p.image,after:'https://cdn.shopify.com/test-verified.png'},variants:[{variantId:v.varianteId,before:v.foto,after:'/uploads/catalog/test-image.png'}],source:'fixture:isolated',checkedAt:new Date().toISOString(),reason:'Prueba aislada'};
 assert.equal((await request('/admin/catalog/images/apply','POST',{patches:[{...patch,price:1}]},token)).status,409);
 // Exercise the actual #10 client through #9's centralized session mechanism.
 const realFetch=globalThis.fetch,oldStorage=globalThis.localStorage;
 (globalThis as any).localStorage={getItem:(key:string)=>key==='bolt_admin_token'?token:null};
 let sessionSent=false;
 globalThis.fetch=(async(input:any,init:any)=>{
  sessionSent=new Headers(init?.headers).get('Authorization')===`Bearer ${token}`;
  return realFetch(new URL(String(input),url),init);
 }) as any;
 try{assert.equal((await api.applyCatalogImages([patch])).changed,1);assert.equal(sessionSent,true);}
 finally{globalThis.fetch=realFetch;(globalThis as any).localStorage=oldStorage;}
 assert.equal((await request('/admin/catalog/images/apply','POST',{patches:[patch]},token)).body.changed,0);
 const after=(await request('/catalog')).body.find((x:any)=>x.id===p.id);
 assert.equal(after.image,patch.image.after);assert.equal(after.presentaciones[0].foto,patch.variants[0].after);
 for(const k of ['price','stockByStore','reservedStockByStore','status','bodegaIds','sku'])assert.deepEqual(after[k],p[k]);
 assert.equal((await request('/admin/catalog/images/apply','POST',{patches:[{...patch,image:{before:'stale',after:'https://cdn.shopify.com/another.png'}}]},token)).status,409);

 // Valid 1×1 PNGs with distinct red and blue pixels. Only this temporary catalog uses them.
 const productPng='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC';
 const variantPng='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNgYPgPAAEDAQAIicLsAAAAAElFTkSuQmCC';
 const firstVariant='PHOTO-TEST-1KG';
 const selectedVariant='PHOTO-TEST-2KG';
 const oldProductPhoto='https://cdn.shopify.com/test-old-product.png';
 const firstVariantPhoto='https://cdn.shopify.com/test-existing-variant.png';
 const fixture=await request('/admin/catalog/products','POST',{
   name:'Alimento ficticio de prueba de imágenes',sku:'PHOTO-TEST',price:15_000,image:oldProductPhoto,
   bodegaIds:['HUB_SUBA'],presentaciones:[
     {varianteId:firstVariant,nombre:'1 kg',sku:firstVariant,foto:firstVariantPhoto,bodegaIds:['HUB_SUBA'],price:15_000,stockByStore:{HUB_SUBA:8},reservedStockByStore:{HUB_SUBA:1}},
     {varianteId:selectedVariant,nombre:'2 kg',sku:selectedVariant,foto:'',bodegaIds:['HUB_SUBA'],price:24_000,stockByStore:{HUB_SUBA:12},reservedStockByStore:{HUB_SUBA:3}},
   ],
 },token);
 assert.equal(fixture.status,201);
 const productId=fixture.body.product.id;
 const readProduct=async():Promise<Product>=>{
   const catalog=await request('/catalog');
   assert.equal(catalog.status,200);
   const product=catalog.body.find((item:Product)=>item.id===productId);
   assert.ok(product);
   return product;
 };
 const commerce=(product:Product)=>({
   status:product.status,stores:product.bodegaIds,
   variants:[firstVariant,selectedVariant].map(id=>{
     const {sku,price,stockByStore,reservedStockByStore}=saleVariant(product,id);
     return {sku,price,stockByStore,reservedStockByStore};
   }),
 });
 const baseline=commerce(await readProduct());
 assert.equal(baseline.variants[1].reservedStockByStore.HUB_SUBA,3);

 const photos='/bolt-admin/inventory/photo';
 const photoQuery=photos+'?'+new URLSearchParams({productId,variantId:selectedVariant});
 const readPhotoState=async(sessionToken:string)=>{
   const state=await request(photoQuery,'GET',undefined,sessionToken);
   assert.equal(state.status,200);
   return state.body as {productImage:string;variantImage:string;gallery:string[]};
 };
 const productUpload={productId,variantId:selectedVariant,target:'product',expectedImage:oldProductPhoto,
   dataUrl:`data:image/png;base64,${productPng}`,filename:'producto.png'};
 const variantUpload={productId,variantId:selectedVariant,target:'variant',expectedImage:'',
   dataUrl:`data:image/png;base64,${variantPng}`,filename:'presentacion.png'};
 assert.equal((await request(photoQuery)).status,401);
 assert.equal((await request(photos,'PUT',productUpload)).status,401);
 const beforeUpload=await readPhotoState(token);
 assert.deepEqual(beforeUpload,{productImage:oldProductPhoto,variantImage:'',gallery:[oldProductPhoto]});

 const uploadedProduct=await request(photos,'PUT',productUpload,token);
 assert.equal(uploadedProduct.status,200,uploadedProduct.body.error);
 assert.match(uploadedProduct.body.image,/^\/uploads\/catalog\/[^/]+\.png$/);
 assert.equal(saleVariant(await readProduct(),selectedVariant).image,uploadedProduct.body.image);
 const uploadedVariant=await request(photos,'PUT',variantUpload,token);
 assert.equal(uploadedVariant.status,200,uploadedVariant.body.error);
 assert.match(uploadedVariant.body.image,/^\/uploads\/catalog\/[^/]+\.png$/);
 assert.notEqual(uploadedVariant.body.image,uploadedProduct.body.image);
 assert.equal((await request(photos,'PUT',productUpload,token)).status,409);
 assert.equal((await request(photos,'PUT',variantUpload,token)).status,409);

 const verifyPhotos=async(sessionToken:string,expectedGallery:string[],extraFiles:Array<[string,string]>=[])=>{
   const product=await readProduct();
   assert.equal(product.image,expectedGallery[0]);
   assert.deepEqual([...new Set([product.image,...(product.gallery||[])])],expectedGallery);
   assert.equal(saleVariant(product,selectedVariant).image,uploadedVariant.body.image);
   assert.equal(saleVariant(product,firstVariant).image,firstVariantPhoto);
   assert.deepEqual(commerce(product),baseline);
   assert.deepEqual(await readPhotoState(sessionToken),{
     productImage:expectedGallery[0],variantImage:uploadedVariant.body.image,gallery:expectedGallery,
   });
   const files=[[uploadedProduct.body.image,productPng],[uploadedVariant.body.image,variantPng],...extraFiles];
   await Promise.all(files.map(async ([image,encoded])=>{
     const file=await fetch(new URL(image,url));
     assert.equal(file.status,200);
     assert.match(file.headers.get('content-type')??'',/^image\/png/);
     assert.deepEqual(Buffer.from(await file.arrayBuffer()),Buffer.from(encoded,'base64'));
   }));
 };
 const priorGallery=await readPhotoState(token);
 assert.equal(priorGallery.gallery[0],uploadedProduct.body.image);
 await verifyPhotos(token,priorGallery.gallery);

 const galleryPngs=await Promise.all(['#376db6','#dc782c','#448146','#ab5790','#7084b3'].map(async background=>{
   const png=await sharp({create:{width:8,height:8,channels:3,background}}).png().toBuffer();
   return png.toString('base64');
 }));
 const galleryFiles=galleryPngs.map((png,index)=>({dataUrl:`data:image/png;base64,${png}`,filename:`galeria-${index+1}.png`}));
 const galleryUpdate={productId,variantId:selectedVariant,target:'product',expectedImage:priorGallery.productImage,
   expectedGallery:priorGallery.gallery,photos:[{url:priorGallery.productImage},...galleryFiles]};
 const tooMany=await request(photos,'PUT',{
   ...galleryUpdate,photos:[...galleryUpdate.photos,{dataUrl:productUpload.dataUrl,filename:'septima.png'}],
 },token);
 assert.equal(tooMany.status,400);
 assert.deepEqual(await readPhotoState(token),priorGallery);

 const uploadedGallery=await request(photos,'PUT',galleryUpdate,token);
 assert.equal(uploadedGallery.status,200,uploadedGallery.body.error);
 const six=await readPhotoState(token);
 assert.equal(six.gallery.length,6);
 assert.equal(new Set(six.gallery).size,6);
 assert.equal(six.gallery[0],priorGallery.productImage);
 assert.equal(uploadedGallery.body.image,six.gallery[0]);
 assert.equal(six.variantImage,priorGallery.variantImage);
 assert.equal((await request(photos,'PUT',galleryUpdate,token)).status,409,
   'La galería cambió aunque la foto principal sigue siendo la misma');

 const reordered=[six.gallery[2],six.gallery[1],six.gallery[0]];
 const reorderedGallery=await request(photos,'PUT',{
   ...galleryUpdate,expectedGallery:six.gallery,photos:reordered.map(url=>({url})),
 },token);
 assert.equal(reorderedGallery.status,200,reorderedGallery.body.error);
 assert.equal(reorderedGallery.body.image,reordered[0]);
 const finalFiles:Array<[string,string]>=[[reordered[0],galleryPngs[1]],[reordered[1],galleryPngs[0]]];
 await verifyPhotos(token,reordered,finalFiles);

 await stop();await start();
 const restored=(await request('/catalog')).body.find((x:any)=>x.id===p.id);assert.deepEqual(restored,after);
 const restarted=await request('/auth/login','POST',adminCredentials);
 assert.equal(restarted.status,200);
 await verifyPhotos(restarted.body.token,reordered,finalFiles);
 const cleared=await request(photos,'PUT',{
   ...galleryUpdate,expectedImage:reordered[0],expectedGallery:reordered,photos:[],
 },restarted.body.token);
 assert.equal(cleared.status,200,cleared.body.error);
 assert.equal(cleared.body.image,'');
 assert.deepEqual(await readPhotoState(restarted.body.token),{
   productImage:'',variantImage:uploadedVariant.body.image,gallery:[],
 });
 const emptyGalleryProduct=await readProduct();
 assert.equal(emptyGalleryProduct.image,'');
 assert.deepEqual(emptyGalleryProduct.gallery,[]);
 assert.equal(saleVariant(emptyGalleryProduct,selectedVariant).image,uploadedVariant.body.image);
 assert.deepEqual(commerce(emptyGalleryProduct),baseline);

 const inventory='/bolt-admin/inventory';
 const storeId='HUB_SUBA';
 const inventoryQuery=inventory+'?'+new URLSearchParams({storeId,query:selectedVariant});
 const adminToken=restarted.body.token;
 const readInventoryRow=async(sessionToken:string)=>{
   const response=await request(inventoryQuery,'GET',undefined,sessionToken);
   assert.equal(response.status,200);
   const row=response.body.items.find((item:any)=>item.productId===productId&&item.variantId===selectedVariant);
   assert.ok(row,'La presentación debe aparecer en el inventario de su sede');
   return row;
 };
 const beforeAdjustment=await readInventoryRow(adminToken);
 assert.deepEqual([beforeAdjustment.stock,beforeAdjustment.reserved,beforeAdjustment.available],[12,3,9]);
 assert.deepEqual([beforeAdjustment.canEditStock,beforeAdjustment.canEditPrice,beforeAdjustment.canEditPhoto],[true,true,true]);
 const adjustment={storeId,productId,variantId:selectedVariant,stock:10,expectedRevision:beforeAdjustment.revision,
   reason:'Reconteo autorizado de la presentación'};
 assert.equal((await request(inventory,'PUT',adjustment)).status,401);
 const belowReserve=await request(inventory,'PUT',{...adjustment,stock:2},adminToken);
 assert.equal(belowReserve.status,400);
 assert.match(belowReserve.body.error,/reservadas/);
 const adjusted=await request(inventory,'PUT',adjustment,adminToken);
 assert.equal(adjusted.status,200,adjusted.body.error);
 assert.deepEqual([adjusted.body.item.stock,adjusted.body.item.reserved,adjusted.body.item.available],[10,3,7]);
 assert.deepEqual([adjusted.body.item.canEditStock,adjusted.body.item.canEditPrice,adjusted.body.item.canEditPhoto],[true,true,true]);
 assert.equal((await request(inventory,'PUT',adjustment,adminToken)).status,409);

 const prices='/bolt-admin/prices';
 const promotion={productId,variantId:selectedVariant,regularPriceCOP:26_000,promoPriceCOP:20_000,
   expectedRevision:adjusted.body.item.revision,reason:'Promoción de prueba por presentación'};
 assert.equal((await request(prices,'PUT',promotion)).status,401);
 const priced=await request(prices,'PUT',promotion,adminToken);
 assert.equal(priced.status,200,priced.body.error);
 assert.deepEqual([priced.body.item.price,priced.body.item.originalPrice],[20_000,26_000]);
 const verifyInventory=async(sessionToken:string)=>{
   const row=await readInventoryRow(sessionToken);
   assert.deepEqual([row.stock,row.reserved,row.available,row.price,row.originalPrice,row.image],
     [10,3,7,20_000,26_000,uploadedVariant.body.image]);
   const product=await readProduct();
   const updated=saleVariant(product,selectedVariant);
   assert.deepEqual([updated.stockByStore,updated.reservedStockByStore,updated.price,updated.originalPrice,updated.image],
     [{...baseline.variants[1].stockByStore,[storeId]:10},baseline.variants[1].reservedStockByStore,20_000,26_000,uploadedVariant.body.image]);
   assert.deepEqual(commerce(product).variants[0],baseline.variants[0]);
   assert.equal(saleVariant(product,firstVariant).image,firstVariantPhoto);
   const history=await request(inventory+'/adjustments?'+new URLSearchParams({storeId}),'GET',undefined,sessionToken);
   assert.equal(history.status,200);
   const entries=history.body.adjustments.filter((entry:any)=>entry.reason===adjustment.reason);
   assert.deepEqual(entries.map((entry:any)=>[entry.before,entry.after,entry.actorName]),[[12,10,adminCredentials.name]]);
 };
 await verifyInventory(adminToken);
 await stop();await start();
 const restoredAdmin=await request('/auth/login','POST',adminCredentials);
 assert.equal(restoredAdmin.status,200);
 await verifyInventory(restoredAdmin.body.token);
 console.log('PASS HTTP BOLT Admin: edición de cantidades, precios y fotos de una presentación en modo operativo, reservas, auditoría y persistencia.');
 console.log('PASS HTTP BOLT Admin: límite de seis fotos, rechazo de la séptima, conflicto, orden, foto principal y retiro persistente sin cambiar las variantes.');
 console.log('PASS HTTP BOLT Admin: carga de bytes y asignación independiente a producto y variante, autenticación, conflicto y persistencia sin cambiar datos comerciales.');
 console.log('PASS HTTP: autenticación, campos protegidos, imágenes por variante, conflicto, idempotencia, catálogo y reinicio real sin alterar importes/stock/reservas.');
}finally{if(server?.exitCode===null)await stop();fs.rmSync(root,{recursive:true,force:true});}
