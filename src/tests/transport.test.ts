import {externalAvailability} from '../lib/externalDelivery';
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {planTransport,validateTransportConfig,validateTransportAttributes,type TransportContext} from '../lib/transportPlanner';
import {TransportRepository} from '../lib/transportRepository';
import {fixtureConfig,fixtureDrivers,fixtureProduct,fixtureExternalProvider} from './transportFixtures';
import {INITIAL_STORES,INITIAL_ORDERS} from '../data/seedData';
import {OrdersRepository} from '../lib/ordersRepository';
import {orderEffects,CatalogOperations} from '../lib/catalogOperations';
import {evaluateDeliveryQuote,generateScheduledSlots} from '../lib/deliveryService';
import {saleVariant} from '../lib/variantCommerce';
let passed=0;const check=(name:string,fn:()=>void)=>{fn();passed++;console.log('PASS',name);};
const config=fixtureConfig(),context:TransportContext={config,drivers:fixtureDrivers,orders:[]};
const f=(id:string,g:number,category:any='Alimentos',light=false)=>fixtureProduct(id,g,category,light);
const plan=(products:any[],counts=products.map(()=>1),ctx=context)=>planTransport(products.map((p,i)=>({productId:p.id,quantity:counts[i]})),products,'HUB_KENNEDY','TURBO',ctx);
check('36 kg y 50 kg de comida admitidos con carga física verificada',()=>{for(const kg of [36,50]){const r=plan([f('comida',kg*1000)]);assert.equal(r.feasible,true);assert.equal(r.shipments.length,1);}});
check('50 + 2 y 50 + 3 kg ligeros; margen acumulado, embalaje incluido',()=>{for(const extra of [2,3]){const r=plan([f('comida',50000),f('snack',1000,'Snacks',true)],[1,extra]);assert.equal(r.shipments.length,1);assert.equal(r.shipments[0].lightMarginUsedGrams,extra*1000);assert.ok(r.shipments[0].grossWeightGrams>r.shipments[0].productWeightGrams);}});
check('50 + 4 kg ligeros requiere 2 despachos',()=>assert.equal(plan([f('comida',50000),f('snack',1000,'Snacks',true)],[1,4]).shipments.length,2));
check('Comida y arena marcadas elegibles NO usan margen',()=>{for(const category of ['Alimentos','Arenas'])assert.equal(plan([f('base',50000),f('extra',1000,category,true)]).shipments.length,2);});
check('30 kg comida + 20 kg arena comparten despacho',()=>assert.equal(plan([f('comida',30000),f('arena',20000,'Arenas')]).shipments.length,1));
check('Tres bolsas de 20 kg completas: 40 + 20',()=>{const r=plan([f('bolsa',20000)],[3]);assert.deepEqual(r.shipments.map(s=>s.productWeightGrams),[40000,20000]);assert.equal(r.shipments.flatMap(s=>s.items).reduce((a,i)=>a+i.quantity,0),3);});
check('Extras ocupan despachos existentes sin crear tercero',()=>assert.equal(plan([f('bolsa',20000),f('snack',1000,'Snacks',true)],[3,5]).shipments.length,2));
check('Producto ligero voluminoso no cabe; no se inventan dimensiones',()=>{const p=f('cama',1000,'Accesorios',true);p.transport!.bulky=true;p.transport!.dimensionsCm=[100,100,100];assert.equal(plan([p]).reasonCode,'UNIT_EXCEEDS_CAPACITY');});
check('Sin peso, embalaje o dimensiones: información pendiente, no cero',()=>{for(const key of ['weightGrams','packagingGrams','dimensionsCm']){const p=f('pendiente',1000);delete (p.transport as any)[key];assert.equal(plan([p]).reasonCode,'TRANSPORT_DATA_PENDING');}});
check('Capacidad física inferior prevalece y no divide una unidad',()=>{const ctx=structuredClone(context);ctx.config.vehicles.forEach(v=>v.maxLoadGrams=25000);assert.equal(plan([f('bolsa',36000)],undefined,ctx).feasible,false);});
check('53 kg de comida no es nuevo límite general',()=>assert.equal(plan([f('comida',53000)]).feasible,false));
check('Elegibilidad requiere indicador, categoría, peso <=3 kg y no voluminoso',()=>{for(const p of [f('snack',2000,'Snacks',false),f('farmacia',2000,'Farmacia',true),f('aseo',4000,'Higiene',true)])assert.equal(plan([f('base',50000),p]).shipments.length,2);});
check('Capacidad física incluye embalaje y volumen',()=>{const ctx=structuredClone(context);ctx.config.vehicles.forEach(v=>v.maxLoadGrams=53000);assert.equal(plan([f('base',50000),f('extra',3000,'Snacks',true)],undefined,ctx).shipments.length,2);ctx.config.vehicles.forEach(v=>v.maxVolumeCm3=1);assert.equal(plan([f('pequeño',10)],undefined,ctx).feasible,false);});
check('Falta de conductores y máximo por compra',()=>{const ctx=structuredClone(context);ctx.drivers.forEach(d=>d.isOnline=false);assert.equal(plan([f('p',100)],undefined,ctx).reasonCode,'NO_AVAILABLE_VEHICLES');assert.equal(plan([f('bolsa',50000)],[4]).reasonCode,'INSUFFICIENT_VEHICLES');});
check('Cantidades fraccionarias/negativas rechazadas y propuesta sin mutaciones',()=>{const before=JSON.stringify(context);for(const n of [-1,0,1.5,1001])assert.equal(plan([f('p',1)],[n]).feasible,false);assert.equal(JSON.stringify(context),before);});
check('Variante utiliza sus datos físicos, sin heredar otra presentación',()=>{const p=f('padre',3000);p.presentaciones=[{varianteId:'v1',nombre:'3 kg',sku:'1',foto:'',bodegaIds:[],transport:p.transport},{varianteId:'v2',nombre:'15 kg',sku:'2',foto:'',bodegaIds:[]}];assert.equal(saleVariant(p,'v1').transport?.weightGrams,3000);assert.equal(saleVariant(p,'v2').transport,undefined);});
check('Configuración valida conductores, sedes y límites; persiste y protege concurrencia',()=>{validateTransportConfig(config,fixtureDrivers,INITIAL_STORES.map(s=>s.id));assert.throws(()=>validateTransportConfig({...config,baseLimitGrams:53000},fixtureDrivers,INITIAL_STORES.map(s=>s.id)));assert.equal(validateTransportAttributes({weightGrams:0}),false);const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bolt-transport-'));const repo=new TransportRepository(path.join(dir,'config.json'));const saved=repo.update(config,'initial',{email:'fixture@example.invalid',name:'Prueba'},fixtureDrivers,INITIAL_STORES);assert.deepEqual(new TransportRepository(path.join(dir,'config.json')).read().config,config);assert.throws(()=>repo.update(config,'initial',{email:'',name:''},fixtureDrivers,INITIAL_STORES));assert.equal(saved.audit.length,1);fs.rmSync(dir,{recursive:true});});
check('Cotiza Programado con vehículo y franja comprobados cuando una unidad no cabe en Turbo',()=>{const ctx=structuredClone(context);ctx.config.vehicles.forEach(v=>{v.modes=['PROGRAMADO'];v.maxLoadGrams=100000;});const p=f('unidad',60000);const q=evaluateDeliveryQuote({destination:{address:'Calle 3 #78-20, Kennedy',coordinates:{lat:4.6365,lng:-74.1448},municipality:'Bogotá',locality:'Kennedy'},items:[{productId:p.id,quantity:1}]},INITIAL_STORES,[p],[],ctx);assert.equal(q.recommendedMode,'PROGRAMADO');assert.equal(q.transportPlan?.shipments.length,1);assert.ok(q.scheduledSlots.some(s=>s.availableCapacity>0));});
check('Compra agrupada conserva cantidades, idempotencia, PIN por entrega y devolución parcial',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bolt-group-'));fs.writeFileSync(path.join(dir,'persisted-orders.json'),'[]');fs.writeFileSync(path.join(dir,'persisted-drivers.json'),JSON.stringify(fixtureDrivers));
 const repo=new OrdersRepository({dataDir:dir});const product=f('bolsa',20000);const base=structuredClone(INITIAL_ORDERS[0]);const item={...base.items[0],productId:product.id,quantity:1,price:10000,weightKg:20};
 const order={...base,id:'TEST-GROUP',creationRequestId:'test-idem',creationRequestFingerprint:'same',storeId:'HUB_KENNEDY',fulfillmentStatus:'CONFIRMADO' as const,isSplitOrder:true,items:[{...item,quantity:3}],driver:undefined,childShipments:[2,1].map((qty,i)=>({shipmentId:`TEST-S${i}`,shipmentIndex:i+1,shipmentCount:2,parentOrderId:'TEST-GROUP',storeId:'HUB_KENNEDY',items:[{...item,quantity:qty}],weightKg:qty*20,weightGrams:qty*20000,subtotal:qty*10000,cashToCollect:qty*10000,fulfillmentStatus:'CONFIRMADO' as const,secretDeliveryCode:`111${i}`,estimatedDeliveryMinutes:15,timestamps:{}}))};
 assert.equal(repo.createOrder(order,[product]).success,true);assert.equal(product.reservedStockByStore.HUB_KENNEDY,3);assert.equal(repo.createOrder(order,[product]).success,true);assert.equal(product.reservedStockByStore.HUB_KENNEDY,3);assert.equal(new OrdersRepository({dataDir:dir}).getOrderById(order.id)?.childShipments?.length,2);
 const actor={role:'ADMINISTRADOR' as const,name:'Fixture'};
 for(const c of order.childShipments) for(const status of ['EN_ALISTAMIENTO','LISTO_PARA_DESPACHO','REPARTIDOR_ASIGNADO','EN_CAMINO'] as const)assert.equal(repo.transitionStatus(order.id,status,actor,{shipmentId:c.shipmentId,catalogProducts:[product]}).success,true);
 assert.equal(repo.verifyDelivery(order.id,'bad',actor,'TEST-S0',[product]).success,false);assert.equal(repo.verifyDelivery(order.id,'1110',actor,'TEST-S0',[product]).success,true);assert.notEqual(order.fulfillmentStatus,'ENTREGADO');
 assert.equal(repo.transitionStatus(order.id,'CANCELADO',actor,{shipmentId:'TEST-S1',catalogProducts:[product]}).success,true);assert.equal(product.stockByStore.HUB_KENNEDY,98);assert.equal(product.reservedStockByStore.HUB_KENNEDY,1);
 assert.equal(repo.confirmPhysicalReturn(order.id,'Fixture',[product],undefined,'TEST-S0').success,false);assert.equal(repo.confirmPhysicalReturn(order.id,'Fixture',[product],undefined,'TEST-S1').success,true);assert.equal(product.reservedStockByStore.HUB_KENNEDY,0);assert.equal(product.stockByStore.HUB_KENNEDY,98);assert.deepEqual(Object.values(orderEffects([order]))[0],{sold:2,reserved:0});assert.notEqual(order.fulfillmentStatus,'ENTREGADO');fs.rmSync(dir,{recursive:true});
});

check('Franja llena conserva el motivo de cupo; no se presenta como capacidad aprobada',()=>{
 const p=f('comida',20000),slot=generateScheduledSlots(new Date()).find(s=>!s.cutoffPassed)!;
 const orders=Array.from({length:10},(_,i)=>({id:`full-${i}`,deliveryMode:'PROGRAMADO',storeId:'HUB_KENNEDY',fulfillmentStatus:'CONFIRMADO',scheduledWindow:slot}));
 const q=evaluateDeliveryQuote({destination:{address:'Calle 3 #78-20, Kennedy',coordinates:{lat:4.6365,lng:-74.1448},municipality:'Bogotá',locality:'Kennedy'},items:[{productId:p.id,quantity:1}],requestedMode:'PROGRAMADO',scheduledWindow:slot},INITIAL_STORES,[p],orders,context);
 assert.equal(q.reasonCode,'SLOT_CAPACITY_EXCEEDED');assert.equal(q.basketValidated,false);assert.equal(q.transportPlan,undefined);
});
check('Una división no activa una modalidad deshabilitada en la sede',()=>{
 const p=f('comida',20000),stores=structuredClone(INITIAL_STORES);stores.forEach(s=>s.enabledModes=['TURBO','PROGRAMADO']);
 const q=evaluateDeliveryQuote({destination:{address:'Calle 3 #78-20, Kennedy',coordinates:{lat:4.6365,lng:-74.1448},municipality:'Bogotá',locality:'Kennedy'},items:[{productId:p.id,quantity:3}],requestedMode:'TURBO'},stores,[p],[],context);
 assert.equal(q.availableModes.turboDividido,false);assert.equal(q.recommendedMode,'PROGRAMADO');
});
check('Las tarifas y beneficio se cotizan una sola vez desde la configuración',()=>{
 const p=f('comida',20000),ctx=structuredClone(context);ctx.config.pricing={shipping:6000,serviceFee:2000,freeShippingFrom:50000};
 const q=evaluateDeliveryQuote({destination:{address:'Calle 3 #78-20, Kennedy',coordinates:{lat:4.6365,lng:-74.1448},municipality:'Bogotá',locality:'Kennedy'},items:[{productId:p.id,quantity:3}]},INITIAL_STORES,[p],[],ctx);
 assert.equal(q.charges?.total,38000);assert.equal(q.charges?.freeShippingFrom,50000);assert.equal(q.transportPlan?.shipments.length,2);
});

check('Inicializar seguimiento no ajusta stock/precios ni reaplica históricos; nuevas reservas persisten',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bolt-stock-baseline-')),p=f('stock',20000);p.reservedStockByStore.HUB_KENNEDY=2;
 const orders:any[]=[{id:'anterior',storeId:'HUB_KENNEDY',fulfillmentStatus:'ENTREGADO',items:[{productId:p.id,quantity:5}]}];
 const create=()=>new CatalogOperations({file:path.join(dir,'catalog.json'),products:()=>[p],stores:()=>INITIAL_STORES,orders:()=>orders});
 let op=create();op.initializeOrderTracking();assert.equal(op.getSalesProducts()[0].stockByStore.HUB_KENNEDY,100);assert.equal(op.getSalesProducts()[0].price,10000);
 orders.push({id:'nuevo',storeId:'HUB_KENNEDY',fulfillmentStatus:'CONFIRMADO',items:[{productId:p.id,quantity:3}]});
 op=create();op.initializeOrderTracking();assert.equal(op.getSalesProducts()[0].reservedStockByStore.HUB_KENNEDY,5);
 orders[1].fulfillmentStatus='ENTREGADO';op=create();assert.equal(op.getSalesProducts()[0].stockByStore.HUB_KENNEDY,97);assert.equal(op.getSalesProducts()[0].reservedStockByStore.HUB_KENNEDY,2);
 assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir,'catalog.json'),'utf8')).batches,{});fs.rmSync(dir,{recursive:true});
});

check('Tope opcional: cinco despachos mixtos; cantidades por sede no son límites del negocio',()=>{
 const ctx=structuredClone(context);ctx.config.maxDispatches=null;ctx.config.externalProviders=[fixtureExternalProvider()];
 const r=plan([f('bolsa',50000)],[5],ctx);assert.equal(r.shipments.length,5);assert.equal(r.shipments.filter(s=>!!s.vehicle.externalOffer).length,2);
 ctx.config.maxDispatches=4;assert.equal(plan([f('bolsa',50000)],[5],ctx).reasonCode,'INSUFFICIENT_VEHICLES');
});
check('Sin tope logístico fijo de tres ni veinte: 30 unidades requieren 30 vehículos disponibles',()=>{
 const ctx=structuredClone(context);ctx.config.vehicles=[];ctx.config.maxDispatches=null;const provider=fixtureExternalProvider();provider.availableVehicles=30;ctx.config.externalProviders=[provider];validateTransportConfig(ctx.config,ctx.drivers,INITIAL_STORES.map(s=>s.id));assert.equal(plan([f('bolsa',50000)],[30],ctx).shipments.length,30);
});
check('Proveedor simulado: demora no confirma, aceptación al responder, rechazo y vencimiento no aportan flota',()=>{
 const ctx=structuredClone(context);ctx.config.vehicles=[];ctx.config.maxDispatches=null;const p=fixtureExternalProvider();ctx.config.externalProviders=[p];p.response='DELAYED';assert.equal(plan([f('p',1000)],undefined,ctx).reasonCode,'PROVIDER_RESPONSE_PENDING');assert.equal(externalAvailability(ctx.config,Date.parse(p.respondsAt)+1).responses[0].status,'ACCEPTED');p.response='REJECTED';assert.equal(plan([f('p',1000)],undefined,ctx).feasible,false);p.response='ACCEPTED';p.offerExpiresAt=new Date(Date.now()-1).toISOString();assert.equal(plan([f('p',1000)],undefined,ctx).feasible,false);
});
check('Proveedor respeta carga física, volumen, regla 50+3 y plazo Turbo',()=>{
 const ctx=structuredClone(context);ctx.config.vehicles=[];ctx.config.maxDispatches=null;const p=fixtureExternalProvider();ctx.config.externalProviders=[p];assert.equal(plan([f('base',50000),f('snack',1000,'Snacks',true)],[1,3],ctx).shipments.length,1);assert.equal(plan([f('comida',53000)],undefined,ctx).feasible,false);p.maxLoadGrams=53000;assert.equal(plan([f('base',50000),f('snack',1000,'Snacks',true)],[1,3],ctx).shipments.length,2);p.maxVolumeCm3=1;assert.equal(plan([f('p',1000)],undefined,ctx).feasible,false);p.maxVolumeCm3=288000;p.estimatedMinutes=35;assert.equal(plan([f('p',1000)],undefined,ctx).feasible,false);
});
check('Cotización Turbo mixta conserva costos operativos y aplica tarifa cliente una vez',()=>{
 const ctx=structuredClone(context);ctx.config.maxDispatches=null;ctx.config.externalProviders=[fixtureExternalProvider()];const p=f('bolsa',50000);
 const q=evaluateDeliveryQuote({destination:{address:'Calle 3 #78-20, Kennedy',coordinates:{lat:4.6365,lng:-74.1448},municipality:'Bogotá',locality:'Kennedy'},items:[{productId:p.id,quantity:5}]},INITIAL_STORES,[p],[],ctx);
 assert.equal(q.transportPlan?.shipments.length,5);assert.equal(q.charges?.externalShipping,0);assert.equal(q.charges?.ownShipping,10000);assert.equal(q.charges?.serviceFee,0);assert.equal(q.charges?.total,60000);assert.equal(q.transportPlan!.shipments.reduce((n,s)=>n+(s.vehicle.externalOffer?.shippingCOP||0),0),16000);assert.ok(q.estimatedMinutes!>=20);assert.equal(q.providerResponses?.[0].simulation,true);
});
check('Recurso externo ocupado no se reutiliza en otra compra',()=>{
 const ctx=structuredClone(context);ctx.config.vehicles=[];ctx.config.maxDispatches=null;const p=fixtureExternalProvider();p.availableVehicles=1;ctx.config.externalProviders=[p];const r=plan([f('p',1000)],undefined,ctx);ctx.orders=[{id:'occupied',deliveryMode:'TURBO',fulfillmentStatus:'CONFIRMADO',driver:r.shipments[0].vehicle.externalOffer!.driver} as any];assert.equal(plan([f('p',1000)],undefined,ctx).feasible,false);
});
check('Rappi real no se habilita como si ya existiera integración',()=>{
 const ctx=structuredClone(context);const p=fixtureExternalProvider();(p as any).integration='RAPPI';ctx.config.externalProviders=[p];assert.throws(()=>validateTransportConfig(ctx.config,ctx.drivers,INITIAL_STORES.map(s=>s.id)));assert.equal(externalAvailability(ctx.config).vehicles.length,0);
});
console.log(`${passed} transport checks passed`);
