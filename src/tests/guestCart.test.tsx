import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { GuestCartStore, GUEST_CART_KEY, readGuestCart, resolveGuestCart, productReference } from '../lib/guestCart';
import { saleVariant } from '../lib/variantCommerce';
import { INITIAL_PRODUCTS, INITIAL_STORES } from '../data/seedData';
import { api } from '../lib/api';
import { useGuestCart } from '../components/customer/useGuestCart';
import { CartDrawer } from '../components/customer/CartDrawer';
import type { Product } from '../types';

const fixture = { id:'fixture-parent',name:'Producto aislado',price:12000,image:'/current.png',presentation:'3 kg',stockByStore:{HUB_SUBA:8},reservedStockByStore:{HUB_SUBA:2},presentaciones:[
  {varianteId:'fixture-a',nombre:'3 kg · pollo',price:12000,foto:'/a.png',stockByStore:{HUB_SUBA:8},reservedStockByStore:{HUB_SUBA:2}},
  {varianteId:'fixture-b',nombre:'3 kg · pescado',price:18000,foto:'/b.png',stockByStore:{HUB_SUBA:5},reservedStockByStore:{HUB_SUBA:1}},
]} as unknown as Product;
const a=saleVariant(fixture,'fixture-a'),b=saleVariant(fixture,'fixture-b');
function memory(initial?:string) {
  const data=new Map<string,string>([['bolt_admin_token','keep-admin'],['addresses','keep-address']]);
  if(initial!==undefined)data.set(GUEST_CART_KEY,initial);
  let writes=0;
  return {data,get writes(){return writes;},getItem:(key:string)=>data.get(key)??null,setItem:(key:string,value:string)=>{writes++;data.set(key,value);}};
}
let passed=0;
const check=async(name:string,fn:()=>void|Promise<void>)=>{await fn();passed++;console.log('PASS',name);};
const snapshot=(items:unknown[])=>JSON.stringify({version:1,items});
await check('Primera visita vacía sin escribir durante inicialización',()=>{const disk=memory(),cart=new GuestCartStore(disk);assert.deepEqual(cart.getSnapshot().references,[]);assert.equal(disk.writes,0);});
await check('Carrito vacío explícito se conserva al reiniciar',()=>{const disk=memory(snapshot([]));assert.deepEqual(new GuestCartStore(disk).getSnapshot().references,[]);assert.equal(disk.writes,0);});
await check('Identificadores y cantidades exclusivamente; precio e imagen se obtienen del catálogo',()=>{const disk=memory();const cart=new GuestCartStore(disk);cart.add(b,2);assert.deepEqual(JSON.parse(disk.getItem(GUEST_CART_KEY)!),{version:1,items:[{productId:fixture.id,variantId:'fixture-b',quantity:2}]});const result=resolveGuestCart(new GuestCartStore(disk).getSnapshot().references,[fixture]);assert.equal(result.items[0].product.price,18000);assert.equal(result.items[0].product.image,'/b.png');});
await check('Campos comerciales inyectados no se recuperan',()=>{const disk=memory(snapshot([{productId:fixture.id,variantId:'fixture-b',quantity:1,price:1,name:'alterado',stockByStore:{HUB_SUBA:999}}]));const refs=readGuestCart(disk).references;assert.deepEqual(refs,[{productId:fixture.id,variantId:'fixture-b',quantity:1}]);assert.equal(resolveGuestCart(refs,[fixture]).items[0].product.price,18000);});
await check('Retraso del catálogo y montajes repetidos no sobrescriben el guardado',()=>{const raw=snapshot([{productId:fixture.id,variantId:'fixture-b',quantity:2}]),disk=memory(raw);for(let n=0;n<3;n++){const cart=new GuestCartStore(disk);assert.deepEqual(resolveGuestCart(cart.getSnapshot().references,null),{items:[],unavailable:[]});assert.equal(resolveGuestCart(cart.getSnapshot().references,[fixture]).items[0].quantity,2);}assert.equal(disk.getItem(GUEST_CART_KEY),raw);assert.equal(disk.writes,0);});
await check('Dos presentaciones persisten como líneas distintas y cantidad acumulada exacta',()=>{const disk=memory(),cart=new GuestCartStore(disk);cart.add(a);cart.add(b);cart.add(a);assert.deepEqual(resolveGuestCart(new GuestCartStore(disk).getSnapshot().references,[fixture]).items.map(i=>[i.product.variantId,i.quantity]),[['fixture-a',2],['fixture-b',1]]);});
await check('Cambio de orden de presentaciones no cambia la selección',()=>{const refs=[productReference(b,1)];const reordered={...fixture,presentaciones:[...fixture.presentaciones!].reverse()};assert.equal(resolveGuestCart(refs,[reordered]).items[0].product.variantId,'fixture-b');});
await check('Variante retirada, producto archivado y variante no especificada nunca eligen otra',()=>{for(const catalog of [[{...fixture,presentaciones:[fixture.presentaciones![0]]}],[{...fixture,status:'ARCHIVED'}],[]]){const resolved=resolveGuestCart([productReference(b,2)],catalog);assert.equal(resolved.items.length,0);assert.equal(resolved.unavailable[0].quantity,2);}assert.equal(resolveGuestCart([{productId:fixture.id,quantity:1}],[fixture]).unavailable.length,1);});
await check('Una variante retirada no desaparece del guardado al agregar otra',()=>{const disk=memory(snapshot([productReference(b,2)])),cart=new GuestCartStore(disk);cart.add(a);assert.equal(cart.getSnapshot().references.length,2);assert.equal(resolveGuestCart(cart.getSnapshot().references,[{...fixture,presentaciones:[fixture.presentaciones![0]]}]).unavailable.length,1);});
await check('Cantidades editadas, eliminación y vaciado guardados antes de notificar a React',()=>{const disk=memory(),cart=new GuestCartStore(disk);cart.add(a);cart.subscribe(()=>assert.deepEqual(JSON.parse(disk.getItem(GUEST_CART_KEY)!).items,cart.getSnapshot().references));cart.setQuantity(productReference(a,1),4);assert.equal(new GuestCartStore(disk).getSnapshot().references[0].quantity,4);cart.setQuantity(productReference(a,1),0);assert.deepEqual(new GuestCartStore(disk).getSnapshot().references,[]);cart.add(a);cart.clear();assert.deepEqual(new GuestCartStore(disk).getSnapshot().references,[]);});
await check('NexGard y Meloxicam admitidos como selecciones legítimas',()=>{const disk=memory(),cart=new GuestCartStore(disk);cart.add(INITIAL_PRODUCTS[4]);cart.add(INITIAL_PRODUCTS[8]);const items=resolveGuestCart(new GuestCartStore(disk).getSnapshot().references,INITIAL_PRODUCTS).items;assert.equal(items.length,2);assert.equal(items.reduce((sum,i)=>sum+i.quantity*i.product.price,0),106500);});
await check('JSON corrupto, versión desconocida y registros inválidos no bloquean ni se borran',()=>{for(const raw of ['{broken','null',JSON.stringify({version:2,items:[]}),snapshot([{productId:'',quantity:1},{productId:'p',quantity:-1},{productId:'p',quantity:1.5},{productId:'p',variantId:3,quantity:1}])]){const disk=memory(raw),cart=new GuestCartStore(disk);assert.deepEqual(cart.getSnapshot().references,[]);assert.ok(cart.getSnapshot().warning);assert.equal(disk.getItem(GUEST_CART_KEY),raw);assert.equal(disk.writes,0);cart.add(a);assert.equal(cart.getSnapshot().references.length,1);}});
await check('Duplicados malformados no suman unidades y conservan registros válidos',()=>{const disk=memory(snapshot([productReference(a,1),productReference(a,2),{productId:'bad',quantity:0},productReference(b,1)]));const result=readGuestCart(disk);assert.equal(result.references.length,2);assert.equal(result.references[0].quantity,2);assert.ok(result.warning);});
await check('Almacenamiento bloqueado permite operar en memoria y avisa',()=>{const cart=new GuestCartStore({getItem:()=>{throw Error('denied');},setItem:()=>{throw Error('quota');}});cart.add(a);assert.equal(cart.getSnapshot().references.length,1);assert.match(cart.getSnapshot().warning,/solo mientras/);});
await check('No altera otras claves, inventario ni reservas al restaurar o editar',()=>{const before=JSON.stringify(fixture),disk=memory(),cart=new GuestCartStore(disk);cart.add(a);cart.setQuantity(productReference(a,1),3);resolveGuestCart(cart.getSnapshot().references,[fixture]);cart.clear();assert.equal(JSON.stringify(fixture),before);assert.equal(disk.data.get('bolt_admin_token'),'keep-admin');assert.equal(disk.data.get('addresses'),'keep-address');});
await check('Precios y existencias actualizados en la restauración sin reducir cantidad silenciosamente',()=>{const refs=[productReference(b,3)],changed={...fixture,presentaciones:fixture.presentaciones!.map(v=>({...v,price:22000,stockByStore:{HUB_SUBA:0}}))};const line=resolveGuestCart(refs,[changed]).items[0];assert.equal(line.product.price,22000);assert.equal(line.product.stockByStore.HUB_SUBA,0);assert.equal(line.quantity,3);});
await check('Panel muestra variante retirada y bloquea checkout, sin datos inventados',()=>{const html=renderToStaticMarkup(<CartDrawer isOpen onClose={()=>{}} cartItems={[]} unavailableItems={[productReference(b,2)]} blockReason="Revisa tu carrito" onClearCart={()=>{}} onUpdateQuantity={()=>{}} onProceedToCheckout={()=>{}} currentStore={INITIAL_STORES[0]} />);assert.match(html,/Presentación guardada no disponible/);assert.match(html,/No la hemos sustituido/);assert.ok(!html.includes('Tu carrito está vacío'));assert.ok(!html.includes('Continuar con el pedido'));});
await check('Catálogo autoritativo rechaza fallos y no restaura contra semillas',async()=>{
  const previousWindow=Object.getOwnPropertyDescriptor(globalThis,'window'), previousFetch=globalThis.fetch;
  Object.defineProperty(globalThis,'window',{configurable:true,value:{location:{origin:'http://fixture.test'}}});
  try {
    globalThis.fetch=async()=>new Response('offline',{status:503});
    await assert.rejects(api.getCatalog(undefined,{requireServer:true}));
    assert.deepEqual(await api.getCatalog(),INITIAL_PRODUCTS);
    globalThis.fetch=async()=>Response.json([]);
    assert.deepEqual(await api.getCatalog(undefined,{requireServer:true}),[]);
  } finally {globalThis.fetch=previousFetch;if(previousWindow)Object.defineProperty(globalThis,'window',previousWindow);else Reflect.deleteProperty(globalThis,'window');}
});
await check('Renderizados de React y StrictMode no escriben ni duplican la selección guardada',()=>{
  const disk=memory(snapshot([productReference(a,2),productReference(b,1)]));
  const previousWindow=Object.getOwnPropertyDescriptor(globalThis,'window');
  Object.defineProperty(globalThis,'window',{configurable:true,value:{localStorage:disk}});
  const Fixture=({catalog}:{catalog:Product[]|null})=>{const cart=useGuestCart(catalog);return <output>{cart.items.map(i=>i.quantity).join(',')}</output>;};
  try {for(let n=0;n<3;n++){assert.equal(renderToStaticMarkup(<React.StrictMode><Fixture catalog={null}/></React.StrictMode>),'<output></output>');assert.equal(renderToStaticMarkup(<React.StrictMode><Fixture catalog={[fixture]}/></React.StrictMode>),'<output>2,1</output>');}assert.equal(disk.writes,0);}finally{if(previousWindow)Object.defineProperty(globalThis,'window',previousWindow);else Reflect.deleteProperty(globalThis,'window');}
});
console.log(`${passed} guest cart checks passed`);
