/** Local-only review fixtures. No operational data is copied or modified. */
import fs from 'node:fs';import path from 'node:path';import {execFileSync} from 'node:child_process';
import {INITIAL_ORDERS} from '../data/seedData';import {fixtureProduct,fixtureDrivers} from './transportFixtures';
const destination=path.resolve(process.argv[2]||'../bolt-dispatch-simulation-integration-review');
execFileSync(process.execPath,['--import','tsx','scripts/dispatch-simulation.ts',destination],{stdio:'pipe'});
const createdAt=new Date(Date.now()-3600000).toISOString();
const items=[{productId:'SIM-FOOD-20KG',sku:'SIM-FOOD-20KG',name:'Alimento de prueba — SIMULACIÓN',presentation:'20 kg',quantity:1,price:10000,weightKg:20,image:'',requiresPrescription:false}];
const orders=[['HIST-READY','LISTO_PARA_DESPACHO'],['HIST-WAY','EN_CAMINO'],['HIST-CLOSED','ENTREGADO']].map(([id,status])=>{
 const o:any={...structuredClone(INITIAL_ORDERS[0]),id,orderNumber:id,assignmentId:'ASG-'+id,tripId:'TRP-'+id,purchaseCode:undefined,creationRequestId:undefined,creationRequestFingerprint:undefined,storeId:'HUB_SUBA',storeName:'Suba',customer:{name:'SIMULACIÓN REVISIÓN',phone:'0000000000',email:'fixture@example.invalid',isGuest:true},items,fulfillmentStatus:status,isSplitOrder:false,childShipments:undefined,transportLoad:undefined,statusHistory:[],driver:undefined,deliveryMode:'TURBO',scheduledWindow:undefined,createdAt,timestamps:{confirmedAt:createdAt},estimatedDeliveryMinutes:10,originalPromiseWindow:{start:createdAt,end:new Date(Date.now()+7200000).toISOString()},payment:{method:'CARD',status:'APROBADO',cashToCollect:0},totals:{subtotal:10000,total:10000,shipping:0,discount:0,serviceFee:0,tip:0,totalWeightKg:20}};
 if(id==='HIST-WAY'){o.driver=fixtureDrivers.find(d=>d.id==='SIM-HUB_SUBA-1');o.timestamps.assignedAt=createdAt;}
 return o;
});
fs.writeFileSync(path.join(destination,'.bolt-private/orders/persisted-orders.json'),JSON.stringify(orders));
const file=path.join(destination,'src/data/persisted-catalog-overrides.json');const catalog=JSON.parse(fs.readFileSync(file,'utf8'));
const card=fixtureProduct('SIM-CARD',1000);card.name='SIMULACIÓN tarjeta de presentaciones';card.presentaciones=[{varianteId:'SIM-CARD-1',sku:'SIM-CARD-1',nombre:'1 kg',price:25000,stockByStore:{HUB_SUBA:100},bodegaIds:['HUB_SUBA'],transport:card.transport},{varianteId:'SIM-CARD-2',sku:'SIM-CARD-2',nombre:'2 kg',price:40000,stockByStore:{HUB_SUBA:100},bodegaIds:['HUB_SUBA'],transport:{...card.transport!,weightGrams:2000}}] as any;card.price=25000;card.presentation='1 kg';catalog.customProducts.push(card);fs.writeFileSync(file,JSON.stringify(catalog));
console.log(JSON.stringify({directory:destination,historicalFixtures:orders.map(o=>({id:o.id,status:o.fulfillmentStatus})),note:'Only fictional data; generated credentials remain private'}));
