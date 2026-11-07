// Only writes to a disposable runtime. Never creates orders in the user's local data.
import assert from 'node:assert/strict';
import fs from 'node:fs';
const base='http://localhost:3006/api/v1';
if(!process.cwd().endsWith('/purchase-test-runtime')) throw new Error('Use the isolated purchase-test-runtime only');
const get=async(path:string)=>{const r=await fetch(base+path);assert.ok(r.ok);return r.json();};
const post=async(path:string,body:any,key?:string)=>{const r=await fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json',...(key?{'Idempotency-Key':key}:{})},body:JSON.stringify(body)});return {status:r.status,body:await r.json()};};
const proofFile='../purchase-http-proof.json';
if(process.argv.includes('--verify-restart')) {
 const proof=JSON.parse(fs.readFileSync(proofFile,'utf8'));
 const order=await get('/orders/'+proof.orderId);
 assert.deepEqual(order.items.map((i:any)=>({id:i.productId,presentation:i.presentation,price:i.price,quantity:i.quantity})),proof.items);
 console.log('PASS reinicio real conserva ambas presentaciones y sus precios en pedido');
} else {
 const catalog=await get('/catalog');
 const p=catalog.find((p:any)=>p.name==='Agility Gold Adulto Raza Grande');assert.ok(p);
 const [v1,v2]=p.presentaciones;assert.deepEqual([v1.nombre,v1.price,v2.nombre,v2.price],['3 kg',54900,'15 kg',245000]);
 const items=[{productId:p.id,quantity:2,price:v1.price},{productId:v2.varianteId,quantity:1,price:v2.price}];
 // Verified Cedritos fixture already used by coverage regression tests.
 const destination={address:'Calle 150 #16-56',coordinates:{lat:4.731531,lng:-74.041785},municipality:'Bogotá',locality:'Usaquén',neighborhood:'Cedritos'};
 const quote=(await post('/delivery/quote',{destination,items,requestedMode:'PROGRAMADO'})).body;
 assert.equal(quote.assignedStoreId,'HUB_SUBA');assert.equal(quote.totalWeightKg,21);assert.equal(quote.availableModes.scheduled,true);
 console.log('PASS cotización real: IDs distintos, 2 × 3 + 15 kg, Programado desde Suba');
 const payload={items,deliveryMode:'PROGRAMADO',scheduledWindow:quote.scheduledSlots.find((s:any)=>s.availableCapacity>0),deliveryAddress:destination,paymentMethod:'EFECTIVO',customer:{name:'PRUEBA AISLADA VARIANTES - NO DESPACHAR',phone:'+57 300 000 0000',email:'purchase@example.invalid'}};
 assert.equal((await post('/orders',{...payload,items:[{...items[0],price:1},items[1]]})).status,409);
 assert.equal((await post('/orders',{...payload,items:[{...items[0],quantity:999999}]})).status,400);
 assert.equal((await post('/orders',{...payload,items:[{...items[1],productId:'invalid-variant'}]})).status,400);
 console.log('PASS backend rechaza precio manipulado, exceso de stock y variante inexistente');
 const before=await get('/orders'), key='variant-test-'+Date.now();
 const created=await post('/orders',payload,key);assert.equal(created.status,201,JSON.stringify(created.body));
 const order=created.body;assert.equal(order.storeId,'HUB_SUBA');assert.equal(order.items.length,2);
 assert.deepEqual(order.items.map((i:any)=>[i.productId,i.presentation,i.price]),[[p.id,'3 kg',54900],[v2.varianteId,'15 kg',245000]]);
 const retry=await post('/orders',payload,key);assert.equal(retry.body.id,order.id);
 const after=(await get('/catalog')).find((x:any)=>x.id===p.id);
 for(let i=0;i<2;i++){assert.equal(after.presentaciones[i].stockByStore.HUB_SUBA,p.presentaciones[i].stockByStore.HUB_SUBA);assert.equal(after.presentaciones[i].reservedStockByStore.HUB_SUBA,p.presentaciones[i].reservedStockByStore.HUB_SUBA+(i===0?2:1));}
 for(const old of before)assert.deepEqual(await get('/orders/'+old.id),old);
 const proof={orderId:order.id,store:order.storeId,items:order.items.map((i:any)=>({id:i.productId,presentation:i.presentation,price:i.price,quantity:i.quantity})),unitPrices:[54900,245000],stockUnchanged:true,reservedExactlyOnce:true,previousOrdersUnchanged:true};
 fs.writeFileSync(proofFile,JSON.stringify(proof,null,2));
 console.log('PASS pedido aislado con dos presentaciones, reserva única por variante y datos previos intactos');
}
