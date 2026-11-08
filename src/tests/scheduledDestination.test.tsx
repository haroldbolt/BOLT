import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {ScheduledDeliveryModal, EMPTY_SCHEDULE_DATE} from '../components/customer/ScheduledDeliveryModal';
import {evaluateDeliveryQuote, generateScheduledSlots, getBogotaTime} from '../lib/deliveryService';
import {enrichDestination} from '../lib/serverGeography';
import {COVERAGE_MUNICIPALITIES, COVERAGE_NOTICE} from '../data/coverageConfig';
import {INITIAL_STORES} from '../data/seedData';
import {fixtureConfig, fixtureDrivers, fixtureProduct} from './transportFixtures';
import fixtures from './municipal-coverage-fixtures.json';
import original from './coverage-address-fixtures.json';
const product=fixtureProduct('SIM-schedule-regression',1000);
const context={config:fixtureConfig(),drivers:fixtureDrivers,orders:[]};
const items=[{productId:product.id,quantity:1}];
const chia=original.find(f=>f.name==='Chia')!,cajica=fixtures[0],cota=fixtures[1];
const destination=(f:any)=>enrichDestination({address:f.address,coordinates:f.coordinates,municipality:'Bogotá',locality:'Kennedy'});
const quote=(f:any,orders:any[]=[],scheduledWindow?:any,ctx=context)=>evaluateDeliveryQuote({destination:destination(f),items,requestedMode:'TURBO',scheduledWindow},INITIAL_STORES,[product],orders,ctx);
let count=0;const test=(name:string,fn:()=>void)=>{fn();console.log('PASS',name);count++};
for(const f of [chia,cajica]) test(f.name+' overrides previous Turbo/hub using approved Suba schedules and Bogotá pricing',()=>{
 const q=quote(f);assert.equal(q.effectiveMode,'PROGRAMADO');assert.equal(q.recommendedMode,'PROGRAMADO');assert.equal(q.assignedStoreId,'HUB_SUBA');assert.equal(q.availableModes.turbo,false);assert.equal(q.territoryInfo?.isCovered,true);
 assert.deepEqual(q.charges?.shipping,quote(original[0]).charges?.shipping);
 assert.deepEqual(q.scheduledSlots.map(s=>[s.date,s.startTime,s.endTime,s.maxCapacity]),quote(original[0]).scheduledSlots.map(s=>[s.date,s.startTime,s.endTime,s.maxCapacity]));
});
test('Bogotá date and cutoffs across UTC midnight',()=>{
 const now=new Date('2026-11-08T02:00:00Z');assert.equal(getBogotaTime(now).dateString,'2026-11-07');
 const slots=generateScheduledSlots(now);assert.equal(slots[0].date,'2026-11-08');assert.equal(slots[0].startTime,'09:00');
});
test('A full date is operational; alternatives checked against Suba fleet and hub reservations',()=>{
 const slot=quote(chia).scheduledSlots.at(-1)!;
 const orders=quote(chia).scheduledSlots.filter(s=>s.date===slot.date).flatMap(s=>Array.from({length:10},()=>({storeId:'HUB_SUBA',deliveryMode:'PROGRAMADO',status:'CONFIRMADO',scheduledWindow:s})));
 const q=quote(chia,orders,slot);assert.equal(q.reasonCode,'SLOT_CAPACITY_EXCEEDED');assert.equal(q.basketValidated,false);assert.equal(q.territoryInfo?.isCovered,true);assert.ok(q.scheduledSlots.filter(s=>s.date===slot.date).every(s=>s.availableCapacity===0));assert.ok(q.scheduledSlots.some(s=>s.date!==slot.date&&s.availableCapacity>0));
 const html=renderToStaticMarkup(<ScheduledDeliveryModal isOpen onClose={()=>{}} onSelectSlot={()=>{}} scheduledSlots={q.scheduledSlots} selectedSlotId={slot.slotId} quote={q}/>);
 assert.ok(html.includes(EMPTY_SCHEDULE_DATE));assert.match(html,/disabled=""/);assert.ok(!html.includes(COVERAGE_NOTICE.title));
 const other=quote(chia,orders.map(o=>({...o,storeId:'HUB_KENNEDY'})),slot);assert.ok(other.scheduledSlots.filter(s=>s.date===slot.date).every(s=>s.availableCapacity>0));
});
test('One full slot does not label an entire date full when another window is available',()=>{
 const slot=quote(chia).scheduledSlots.at(-1)!;
 const orders=Array.from({length:10},()=>({storeId:'HUB_SUBA',deliveryMode:'PROGRAMADO',status:'CONFIRMADO',scheduledWindow:slot}));
 const q=quote(chia,orders,slot);assert.equal(q.reasonCode,'SLOT_CAPACITY_EXCEEDED');assert.equal(q.message,'La franja no tiene cupo. Selecciona otro horario.');
 assert.ok(q.scheduledSlots.some(s=>s.date===slot.date && s.availableCapacity>0));
});
test('No fleet is not a geographic rejection or a promise of another available day',()=>{
 const q=quote(cajica,[],undefined,{...context,config:{...context.config,vehicles:[]}});assert.equal(q.territoryInfo?.isCovered,true);assert.equal(q.basketValidated,false);assert.ok(q.scheduledSlots.every(s=>s.availableCapacity===0));assert.ok(q.scheduledSlots.some(s=>s.unavailableReason==='TRANSPORT'));
 const html=renderToStaticMarkup(<ScheduledDeliveryModal isOpen onClose={()=>{}} onSelectSlot={()=>{}} scheduledSlots={q.scheduledSlots} quote={q}/>);assert.ok(html.includes(q.message));assert.ok(!html.includes(COVERAGE_NOTICE.title));
});
test('Disabled Programado cannot expose alternative dates through an invalid slot',()=>{
 const stores=INITIAL_STORES.map(s=>s.id==='HUB_SUBA'?{...s,enabledModes:['TURBO' as const]}:s);
 const q=evaluateDeliveryQuote({destination:destination(chia),items,requestedMode:'PROGRAMADO',scheduledWindow:{date:'2099-01-01',slotId:'invalid'} as any},stores,[product],[],context);
 assert.equal(q.reasonCode,'MODE_UNAVAILABLE');assert.equal(q.availableModes.scheduled,false);assert.equal(q.basketValidated,false);assert.equal(q.selectedSlotInvalid,false);
 const html=renderToStaticMarkup(<ScheduledDeliveryModal isOpen onClose={()=>{}} onSelectSlot={()=>{}} scheduledSlots={q.scheduledSlots} quote={q}/>);
 assert.ok(html.includes(q.message));assert.ok(!html.includes('franjas disponibles'));
});
test('Missing service remains explicit, never fabricated',()=>{
 const policies=structuredClone(COVERAGE_MUNICIPALITIES);policies.find(p=>p.code==='25175')!.scheduledService=null;
 const q=evaluateDeliveryQuote({destination:destination(chia),items,requestedMode:'TURBO'},INITIAL_STORES,[product],[],context,policies);
 assert.equal(q.reasonCode,'SCHEDULED_SERVICE_PENDING');assert.equal(q.assignedStoreId,'HUB_SUBA');assert.equal(q.effectiveMode,'PROGRAMADO');assert.equal(q.scheduledSlots.length,0);
});
test('No automatic slot selection; accessible Suba modal uses server capacity, without invented free surcharge',()=>{
 const q=quote(chia);const html=renderToStaticMarkup(<ScheduledDeliveryModal isOpen onClose={()=>{}} onSelectSlot={()=>{}} scheduledSlots={q.scheduledSlots} quote={q}/>);
 assert.match(html,/role="dialog"/);assert.ok(html.includes('Sede '+q.assignedStoreName));assert.match(html,/disabled=""/);assert.ok(!html.includes('Sin recargo'));assert.ok(html.includes('Selecciona una franja'));
});
test('Cota → Chía → Cajicá → Cota → Cedritos and Soacha never retain previous rejection or warehouse',()=>{
 const sequence=[cota,chia,cajica,cota,original[0],original.find(f=>f.name==='Soacha')!];
 const results=sequence.map(f=>quote(f));
 assert.deepEqual(results.map(q=>q.assignedStoreId),[undefined,'HUB_SUBA','HUB_SUBA',undefined,'HUB_SUBA','HUB_KENNEDY']);
 assert.equal(results[0].reasonCode,'TERRITORY_OUT_OF_COVERAGE');assert.equal(results[3].reasonCode,'TERRITORY_OUT_OF_COVERAGE');assert.ok(results[1].availableModes.scheduled);assert.ok(results[2].availableModes.scheduled);
});
console.log(`${count} scheduled destination cases passed`);
