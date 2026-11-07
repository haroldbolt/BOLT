import assert from 'node:assert/strict';
import fixtures from './coverage-address-fixtures.json';
import { enrichDestination, inGeometry } from '../lib/serverGeography';
import { parseAddressComponents, validDestinationCoordinates } from '../lib/addressGeography';
import { evaluateDeliveryQuote, generateScheduledSlots } from '../lib/deliveryService';
import { INITIAL_PRODUCTS, INITIAL_STORES } from '../data/seedData';
import { KENNEDY_LOCALITIES, ALAMOS_LOCALITIES, SUBA_LOCALITIES, resolveTerritorialAssignment } from '../lib/territoryConfig';

let count=0;
function test(name:string,fn:()=>void){fn();count++;console.log('PASS',name)}
const cedritos=fixtures[0];
const destination=()=>enrichDestination({address:cedritos.address,coordinates:cedritos.coordinates,neighborhood:'Cedritos',locality:'Bogotá'});
test('Cedritos resolves from official polygons even when locality incorrectly contains Bogotá',()=>{
 const d=destination();assert.equal(d.locality,'Usaquén');assert.equal(d.municipality,'Bogotá D.C.');
 const q=evaluateDeliveryQuote({destination:d,requestedMode:'PROGRAMADO'},INITIAL_STORES,INITIAL_PRODUCTS);
 assert.equal(q.assignedStoreId,'HUB_SUBA'); assert.equal(q.scheduledEligible,true); assert.equal(q.availableModes.turbo,false); assert.ok(q.scheduledSlots.length);
});
for(const f of fixtures) test('Verified provider fixture: '+f.name,()=>{
 const d=enrichDestination({address:f.address,coordinates:f.coordinates});
 const q=evaluateDeliveryQuote({destination:d,requestedMode:'PROGRAMADO'},INITIAL_STORES,INITIAL_PRODUCTS);
 if(f.expectedStoreId){assert.equal(q.assignedStoreId,f.expectedStoreId);assert.equal(q.scheduledEligible,!(f as any).expectedReason);if((f as any).expectedReason)assert.equal(q.reasonCode,(f as any).expectedReason);if(f.expectedLocality)assert.equal(q.locality,f.expectedLocality)}
 else {assert.equal(q.eligibilityStatus,'OUT_OF_COVERAGE');assert.equal(q.scheduledEligible,false)}
});
for(const [localities,storeId] of [[KENNEDY_LOCALITIES,'HUB_KENNEDY'],[ALAMOS_LOCALITIES,'HUB_ALAMOS'],[SUBA_LOCALITIES,'HUB_SUBA']] as const) {
 for(const locality of localities) test('Territorial mapping '+locality,()=>assert.equal(resolveTerritorialAssignment({municipality:'Bogotá D.C.',locality:locality.toUpperCase()}).assignedStoreId,storeId));
}
test('Neighborhood never becomes locality; component order independent',()=>{
 const components=[{long_name:'Cedritos',types:['neighborhood']},{long_name:'Bogotá',types:['locality']},{long_name:'Usaquén',types:['sublocality_level_1','political']}];
 for(const list of [components,[...components].reverse()]) assert.deepEqual(parseAddressComponents(list),{municipality:'Bogotá',locality:'Usaquén',neighborhood:'Cedritos'});
 assert.equal(parseAddressComponents(components.slice(0,2)).locality,undefined);
 assert.equal(parseAddressComponents([{long_name:'Chía',types:['locality']}]).municipality,'Chía');
});
test('Incomplete address and missing, transposed, NaN and infinite coordinates are pending information',()=>{
 for(const coordinates of [undefined,{lat:-74.04,lng:4.73},{lat:Infinity,lng:-74},{lat:NaN,lng:-74},{lat:'4.73',lng:'-74.04'}]) {
  const q=evaluateDeliveryQuote({destination:{address:cedritos.address,coordinates:coordinates as any}},INITIAL_STORES);
  assert.equal(q.eligibilityStatus,'ADDRESS_NEEDS_CONFIRMATION');
 }
 assert.equal(evaluateDeliveryQuote({destination:{address:' ',coordinates:cedritos.coordinates}}).reasonCode,'ADDRESS_INCOMPLETE');
 assert.equal(evaluateDeliveryQuote({destination:{address:'Calle 150',coordinates:cedritos.coordinates}}).reasonCode,'ADDRESS_INCOMPLETE');
});
test('Unidentified locality is pending, not geographic rejection',()=>{
 assert.equal(evaluateDeliveryQuote({destination:{address:'Calle 150 #16-56',coordinates:cedritos.coordinates}}).reasonCode,'MUNICIPALITY_NEEDS_CONFIRMATION');
 assert.equal(resolveTerritorialAssignment({municipality:'Bogotá',locality:'Cedritos'}).status,'NEEDS_CONFIRMATION');
});
test('Street words do not enable Soacha or override verified geography',()=>{
 const f=fixtures.find(f=>f.name==='Chia')!;
 const q=evaluateDeliveryQuote({destination:enrichDestination({address:'Calle 11 #11-29, San Mateo, Cedritos, Bogotá',municipality:'Bogotá',locality:'Usaquén',coordinates:f.coordinates}),requestedMode:'PROGRAMADO'});
 assert.equal(q.municipality,'Chía');assert.equal(q.reasonCode,'SCHEDULED_SERVICE_PENDING');
 assert.equal(resolveTerritorialAssignment({municipality:'San Mateo',locality:'Usaquén'}).status,'OUT_OF_COVERAGE');
});
test('Sumapaz stays excluded (structured territorial fixture, no fabricated coordinates)',()=>assert.equal(resolveTerritorialAssignment({municipality:'Bogotá',locality:'Sumapaz'}).status,'OUT_OF_COVERAGE'));
test('Inactive warehouse retains geographic assignment with operational rejection',()=>{
 const q=evaluateDeliveryQuote({destination:destination(),requestedMode:'PROGRAMADO'},INITIAL_STORES.map(s=>({...s,isActive:s.id==='HUB_SUBA'?false:s.isActive})),INITIAL_PRODUCTS);
 assert.equal(q.reasonCode,'STORE_INACTIVE');assert.equal(q.territoryInfo?.isCovered,true);
});
test('Insufficient stock is not lack of coverage',()=>{
 const p=INITIAL_PRODUCTS[0];
 const q=evaluateDeliveryQuote({destination:destination(),requestedMode:'PROGRAMADO',items:[{productId:p.id,quantity:999999}]},INITIAL_STORES,INITIAL_PRODUCTS);
 assert.equal(q.reasonCode,'INSUFFICIENT_STOCK');assert.equal(q.eligibilityStatus,'INSUFFICIENT_STOCK');assert.equal(q.territoryInfo?.isCovered,true);
});
test('Full slot has separate rejection and free alternatives',()=>{
 const slot=generateScheduledSlots()[0];
 const orders=Array.from({length:10},()=>({deliveryMode:'PROGRAMADO',storeId:'HUB_SUBA',scheduledWindow:slot,status:'CONFIRMADO'}));
 const q=evaluateDeliveryQuote({destination:destination(),requestedMode:'PROGRAMADO',scheduledWindow:slot},INITIAL_STORES,INITIAL_PRODUCTS,orders);
 assert.equal(q.reasonCode,'SLOT_CAPACITY_EXCEEDED');assert.equal(q.territoryInfo?.isCovered,true);assert.ok(q.scheduledSlots.some(s=>s.availableCapacity>0));
 const q2=evaluateDeliveryQuote({destination:destination(),requestedMode:'PROGRAMADO'},INITIAL_STORES,INITIAL_PRODUCTS,orders.map(o=>({...o,status:'CANCELADO'})));
 assert.equal(q2.scheduledSlots[0].availableCapacity,10);
});
test('A rejection does not survive the next destination',()=>{
 const bad=fixtures.find(f=>f.name==='Chia')!;
 assert.equal(evaluateDeliveryQuote({destination:enrichDestination({address:bad.address,coordinates:bad.coordinates})}).reasonCode,'SCHEDULED_SERVICE_PENDING');
 assert.equal(evaluateDeliveryQuote({destination:destination(),requestedMode:'PROGRAMADO'}).scheduledEligible,true);
});
test('Point in polygon respects holes and longitude latitude order',()=>{
 const g={type:'Polygon',coordinates:[[[0,0],[3,0],[3,3],[0,3],[0,0]],[[1,1],[2,1],[2,2],[1,2],[1,1]]]};
 assert.equal(inGeometry({lat:.5,lng:.5},g),true);assert.equal(inGeometry({lat:1.5,lng:1.5},g),false);assert.equal(validDestinationCoordinates({lat:-74,lng:4}),false);
});
console.log(`${count} regression cases passed`);
