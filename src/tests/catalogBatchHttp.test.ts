// This script writes synthetic orders only in the isolated runtime on port 3004.
import assert from 'node:assert/strict';
import fs from 'node:fs';
const base='http://localhost:3004/api/v1';
if(!process.cwd().endsWith('/batch-test-runtime'))throw new Error('Solo permite el almacenamiento de pruebas aislado');
const get=async(url:string,token?:string)=>{const r=await fetch(base+url,{headers:token?{Authorization:`Bearer ${token}`}:{}});return {status:r.status,body:await r.json()};};
const post=async(url:string,body:any,token?:string,key?:string)=>{const r=await fetch(base+url,{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`} :{}),...(key?{'Idempotency-Key':key}:{})},body:JSON.stringify(body)});return {status:r.status,body:await r.json()};};
if(process.argv.includes('--verify-restart')) {
 const state=JSON.parse(fs.readFileSync('../batch-http-proof.json','utf8'));
 const catalog=(await get('/catalog')).body;const p=catalog.find((p:any)=>p.id===state.productId);
 assert.equal(p.presentaciones[1].reservedStockByStore.HUB_SUBA,state.reservedAfter);
 assert.equal(p.presentaciones[1].price,state.price);assert.equal(p.presentaciones[1].stockByStore.HUB_SUBA,state.stock);
 assert.equal((await get('/orders/'+state.orderId)).status,200);
 console.log('PASS reinicio real conserva precio, stock, reserva y pedido aislado');
} else {
 const creds=JSON.parse(fs.readFileSync('.bolt-private/test-login.json','utf8'));
 const login=await post('/auth/login',creds);assert.equal(login.status,200);const token=login.body.token;
 assert.equal((await get('/admin/catalog')).status,401);assert.equal((await post('/admin/catalog/batches/x/apply',{})).status,401);
 console.log('PASS endpoints administrativos protegidos');
 const admin=(await get('/admin/catalog',token)).body;const customer=(await get('/catalog')).body;
 const p=customer.find((p:any)=>p.id==='gid://shopify/Product/9398260629784');assert.ok(p);
 assert.equal(p.presentaciones[0].price,64000);assert.equal(p.presentaciones[1].price,160000);assert.equal(p.presentaciones[2].price,29500);
 assert.deepEqual(admin.find((x:any)=>x.id===p.id),p);console.log('PASS administrador y tienda comparten precios por variante y stock');
 const variant=p.presentaciones[1],id=variant.varianteId;
 const dest={address:'Calle 150 #16-56',coordinates:{lat:4.731531,lng:-74.041785},municipality:'Bogotá',locality:'Usaquén',neighborhood:'Cedritos'};
 const quote=await post('/delivery/quote',{destination:dest,requestedMode:'PROGRAMADO',items:[{productId:id,quantity:1}]});
 assert.equal(quote.body.assignedStoreId,'HUB_SUBA');
 const payload={deliveryMode:'PROGRAMADO',scheduledWindow:quote.body.scheduledSlots.find((s:any)=>s.availableCapacity>0),items:[{productId:id,quantity:1,name:p.name,price:variant.price}],customer:{name:'PRUEBA AISLADA LOTE - NO DESPACHAR',email:'batch@example.invalid',phone:'+57 300 000 0000'},deliveryAddress:quote.body.destination,paymentMethod:'EFECTIVO'};
 const beforeOrders=(await get('/orders')).body;
 assert.equal((await post('/orders',{...payload,items:[{...payload.items[0],price:1}]})).status,409);
 assert.equal((await post('/orders',{...payload,items:[{...payload.items[0],quantity:999999}]})).status,400);
 const key='batch-http-'+Date.now();const created=await post('/orders',payload,undefined,key);assert.equal(created.status,201,JSON.stringify(created.body));
 assert.equal(created.body.items[0].price,160000);assert.equal(created.body.items[0].productId,id);
 assert.equal((await post('/orders',payload,undefined,key)).body.id,created.body.id);
 const after=(await get('/catalog')).body.find((x:any)=>x.id===p.id).presentaciones[1];
 assert.equal(after.stockByStore.HUB_SUBA,variant.stockByStore.HUB_SUBA);
 assert.equal(after.reservedStockByStore.HUB_SUBA,variant.reservedStockByStore.HUB_SUBA+1);
 console.log('PASS pedido de segunda variante: precio del servidor y reserva única; rechaza precio manipulado y exceso de stock');
 await post('/admin/catalog/batches/BOLT-PLUS6-SHOPIFY-20261106-01/apply',{},token);
 const retried=(await get('/catalog')).body.find((x:any)=>x.id===p.id).presentaciones[1];assert.deepEqual(retried,after);
 assert.equal((await post('/shopify/sync',{},token)).status,409);
 const all=(await get('/orders')).body;for(const o of beforeOrders)assert.deepEqual(all.find((x:any)=>x.id===o.id),o);
 fs.writeFileSync('../batch-http-proof.json',JSON.stringify({orderId:created.body.id,productId:p.id,variantId:id,price:after.price,stock:after.stockByStore.HUB_SUBA,reservedAfter:after.reservedStockByStore.HUB_SUBA},null,2));
 console.log('PASS reintento de lote no sobrescribe reserva concurrente; pedidos previos intactos y sync bloqueado');
}
