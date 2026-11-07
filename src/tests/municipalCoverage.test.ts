import assert from 'node:assert/strict';
import {renderToStaticMarkup} from 'react-dom/server';
import React from 'react';
import fs from 'node:fs';
import {inGeometry} from '../lib/serverGeography';
import {PushNotificationBanner} from '../components/notifications/PushNotificationBanner';
import {COVERAGE_MUNICIPALITIES,COVERAGE_NOTICE,coverageMunicipality,scheduledServiceReady} from '../data/coverageConfig';
import {enrichDestination} from '../lib/serverGeography';
import {parseAddressComponents} from '../lib/addressGeography';
import {resolveTerritorialAssignment} from '../lib/territoryConfig';
import {evaluateDeliveryQuote,generateScheduledSlots} from '../lib/deliveryService';
import {INITIAL_STORES} from '../data/seedData';
import oldFixtures from './coverage-address-fixtures.json';
import fixtures from './municipal-coverage-fixtures.json';
import {fixtureProduct,fixtureConfig,fixtureDrivers} from './transportFixtures';
let passed=0;const test=(name:string,fn:()=>void)=>{fn();passed++;console.log('PASS',name)};
const cedritos=oldFixtures[0];
const product=fixtureProduct('coverage-fixture',1000);
const context={config:fixtureConfig(),drivers:fixtureDrivers,orders:[]};
const items=[{productId:product.id,quantity:1}];
const quote=(f:any,overrides:any={})=>evaluateDeliveryQuote({destination:enrichDestination({address:f.address,coordinates:f.coordinates,...overrides}),items,requestedMode:'PROGRAMADO'},INITIAL_STORES,[product],[],context);
test('Allowlist exactly four; names normalized; warehouse alone cannot authorize another city',()=>{
 assert.deepEqual(COVERAGE_MUNICIPALITIES.filter(m=>m.active).map(m=>m.name),['Bogotá D.C.','Soacha','Chía','Cajicá']);
 for(const name of [' CHÍA  ','Chia','chia cundinamarca',' CAJICÁ '])assert.ok(coverageMunicipality(name));
 assert.equal(resolveTerritorialAssignment({municipality:'Cota'}).isCovered,false);
});
for(const f of fixtures.filter(f=>f.name!=='Cajicá')) test('Provider fixture '+f.name+' rejected despite allowed words and forged identifiers',()=>{
 for(const address of [f.address,'Carrera 5 #12-14, vía Chía, Bogotá, Usaquén']) {
  const q=quote(f,{address,municipality:'Bogotá',locality:'Usaquén',municipalityCode:'11001',countryCode:'CO',geographicExclusion:undefined});
  assert.equal(q.eligibilityStatus,'OUT_OF_COVERAGE');assert.equal(q.reasonCode,'TERRITORY_OUT_OF_COVERAGE');assert.equal(q.territoryInfo?.isCovered,false);assert.equal(q.assignedStoreId,undefined);assert.equal(q.availableModes.scheduled,false);
 }
});
for(const f of [oldFixtures.find(f=>f.name==='Chia')!,fixtures[0]]) test(f.name+' is Suba, Programado only; pending operation is not geographical exclusion',()=>{
 const q=quote(f);assert.equal(q.territoryInfo?.isCovered,true);assert.equal(q.municipality,f.name==='Chia'?'Chía':'Cajicá');assert.equal(q.assignedStoreId,'HUB_SUBA');assert.equal(q.reasonCode,'SCHEDULED_SERVICE_PENDING');assert.equal(q.basketValidated,false);assert.equal(q.availableModes.turbo,false);assert.equal(q.availableModes.turboDividido,false);assert.equal(q.scheduledSlots.length,0);assert.equal(q.confirmationToken,undefined);
 const policies=structuredClone(COVERAGE_MUNICIPALITIES);const policy=policies.find(p=>p.name===q.municipality)!;
 policy.scheduledService={routeReference:'SIMULACIÓN AISLADA, NO OPERATIVA',verifiedAt:new Date().toISOString(),weekdays:[0,1,2,3,4,5,6],windowIds:['HORARIO_2'],capacityPerWindow:2,pricing:{shipping:12300,freeShippingFrom:200000,serviceFee:1500}};
 const configured=evaluateDeliveryQuote({destination:enrichDestination({address:f.address,coordinates:f.coordinates}),items,requestedMode:'TURBO'},INITIAL_STORES,[product],[],context,policies);
 assert.equal(configured.recommendedMode,'PROGRAMADO');assert.equal(configured.basketValidated,true);assert.equal(configured.assignedStoreId,'HUB_SUBA');assert.equal(configured.charges?.shipping,12300);assert.ok(configured.scheduledSlots.every(s=>s.windowId==='HORARIO_2'));assert.equal(configured.availableModes.turbo,false);
 const noFleet=evaluateDeliveryQuote({destination:enrichDestination({address:f.address,coordinates:f.coordinates}),items,requestedMode:'PROGRAMADO'},INITIAL_STORES,[product],[],{...context,config:{...context.config,vehicles:[]}},policies);
 assert.equal(noFleet.basketValidated,false);assert.equal(noFleet.territoryInfo?.isCovered,true);
});
test('Municipality missing never defaults to Bogotá; invalid coordinates are pending',()=>{
 assert.equal(resolveTerritorialAssignment({address:'Calle 1 #2-3, Bogotá, Chía',locality:'Usaquén'}).status,'NEEDS_CONFIRMATION');
 const q=quote(cedritos,{coordinates:undefined});assert.equal(q.eligibilityStatus,'ADDRESS_NEEDS_CONFIRMATION');
 assert.equal(quote(cedritos,{address:''}).reasonCode,'ADDRESS_INCOMPLETE');
});
test('Municipality and country read by component type, neighborhood is separate',()=>{
 const c=[{long_name:'Colombia',short_name:'CO',types:['country']},{long_name:'Cota',types:['locality']},{long_name:'Chía',types:['route']},{long_name:'Cundinamarca',types:['administrative_area_level_1']}];
 for(const ordered of [c,[...c].reverse()])assert.deepEqual(parseAddressComponents(ordered),{countryCode:'CO',municipality:'Cota',locality:undefined,neighborhood:undefined});
});
test('Configuration does not invent missing tariffs, route or time windows',()=>{
 assert.equal(scheduledServiceReady(null),false);assert.equal(scheduledServiceReady({routeReference:'missing'} as any),false);
 assert.ok(COVERAGE_MUNICIPALITIES.filter(m=>['Chía','Cajicá'].includes(m.name)).every(m=>m.scheduledService===null));
});
test('Switching from blocked destination to Cedritos clears geographic rejection',()=>{
 assert.equal(quote(fixtures[1]).reasonCode,'TERRITORY_OUT_OF_COVERAGE');const q=quote(cedritos);assert.equal(q.assignedStoreId,'HUB_SUBA');assert.equal(q.basketValidated,true);assert.equal(q.recommendedMode,'PROGRAMADO');
});
test('Sumapaz and rural Chía remain excluded using explicit geometry-derived test points',()=>{
 const localities=JSON.parse(fs.readFileSync('src/data/geography/localities.json','utf8')).features;
 const municipal=JSON.parse(fs.readFileSync('src/data/geography/municipalities.json','utf8')).features;
 const urban=JSON.parse(fs.readFileSync('src/data/geography/northern-urban.json','utf8')).features;
 // Test points derived from official geometry, not represented as verified postal addresses.
 for(const feature of [localities.find((f:any)=>f.properties.name.toUpperCase()==='SUMAPAZ'),municipal.find((f:any)=>f.properties.MPIO_CDPMP==='25175')]) {
  const points=feature.geometry.coordinates.flat(feature.geometry.type==='Polygon'?1:2);
  const xs=points.map((p:any)=>p[0]),ys=points.map((p:any)=>p[1]);let candidate:any;
  for(let i=1;i<20&&!candidate;i++)for(let j=1;j<20;j++) {
   const point={lng:Math.min(...xs)+(Math.max(...xs)-Math.min(...xs))*i/20,lat:Math.min(...ys)+(Math.max(...ys)-Math.min(...ys))*j/20};
   if(inGeometry(point,feature.geometry)&&!urban.some((f:any)=>inGeometry(point,f.geometry))){candidate=point;break;}
  }
  assert.ok(candidate);const q=quote({address:'Calle 1 #1-1 (fixture geográfico sintético)',coordinates:candidate});assert.equal(q.reasonCode,'TERRITORY_OUT_OF_COVERAGE');assert.equal(q.territoryInfo?.isCovered,false);
 }
});
test('Existing in-app banner exposes exact accessible coverage alert and action',()=>{
 const html=renderToStaticMarkup(React.createElement(PushNotificationBanner,{onNavigateToOrder:()=>{},notice:{...COVERAGE_NOTICE,onAction:()=>{},onDismiss:()=>{}}}));
 assert.match(html,/role="alert"/);assert.ok(html.includes(COVERAGE_NOTICE.title));assert.ok(html.includes(COVERAGE_NOTICE.message));assert.ok(html.includes('Cambiar dirección'));assert.ok(!html.includes('Ver pedido'));
});
console.log(`${passed} municipal coverage cases passed`);
