import assert from 'node:assert/strict';
import {searchDeliveryAddress} from '../lib/forwardGeocoding';
import {DeviceLocationRequest, DeviceLocationError} from '../lib/deviceLocation';
import {enrichDestination} from '../lib/serverGeography';
import fixtures from './municipal-coverage-fixtures.json';

// Google Geocoding lookup verified 2026-11-10 for the reported street, with municipality explicitly supplied.
const bogota={lat:4.6028411,lng:-74.0822618}, santaMarta={lat:11.245671,lng:-74.1995542};
const result=(point:typeof bogota,municipality:string,id='TEST-PLACE')=>({place_id:id,formatted_address:`Calle 11 #15-53, ${municipality}, Colombia`,geometry:{location:point},types:['street_address'],address_components:[
  {long_name:municipality,types:['locality']},{long_name:'Colombia',short_name:'CO',types:['country']},
]});
let count=0;
async function test(name:string,run:()=>unknown|Promise<unknown>){await run();console.log('PASS',name);count++;}
const provider=(results:any[])=>async()=>new Response(JSON.stringify({status:'OK',results}),{headers:{'Content-Type':'application/json'}});

await test('Street without municipality does not consult Google or select Santa Marta',async()=>{
  const r=await searchDeliveryAddress('calle 11 #15-53','','test-key',async()=>{throw Error('must not call provider')});
  assert.equal(r.status,'MUNICIPALITY_REQUIRED');assert.deepEqual(r.candidates,[]);
});
await test('Municipality constrains the request; Bogotá is resolved from geometry',async()=>{
  const r=await searchDeliveryAddress('calle 11 #15-53',' BOGOTÁ ','test-key',async input=>{
    const u=new URL(String(input));assert.equal(u.searchParams.get('components'),'country:CO|locality:Bogotá');
    assert.equal(u.searchParams.get('address'),'calle 11 #15-53');return provider([result(bogota,'Bogotá')])();
  });
  assert.equal(r.status,'SELECT_ADDRESS');assert.equal(r.candidates[0].municipality,'Bogotá D.C.');assert.equal(r.candidates[0].locality,'Los Mártires');
  assert.equal((r as any).coordinates,undefined,'No automatically chosen first result');
});
await test('Provider returning Santa Marta for Bogotá is rejected, not silently accepted',async()=>{
  const r=await searchDeliveryAddress('calle 11 #15-53','Bogotá','test-key',provider([result(santaMarta,'Santa Marta')]));
  assert.equal(r.status,'MUNICIPALITY_MISMATCH');assert.equal(r.candidates.length,0);
});
await test('Allowed words and provider labels cannot turn Cota coordinates into Bogotá',async()=>{
  const cota=fixtures.find(f=>f.name==='Cota')!;
  const r=await searchDeliveryAddress('Vía Bogotá','Bogotá','test-key',provider([result(cota.coordinates,'Bogotá')]));
  assert.equal(r.status,'MUNICIPALITY_MISMATCH');assert.ok(enrichDestination({coordinates:cota.coordinates,municipality:'Bogotá'}).geographicExclusion);
});
await test('Allowed municipality needs independent geometry even outside the local map snapshot',async()=>{
  const r=await searchDeliveryAddress('calle 11 #15-53','Bogotá','test-key',provider([result(santaMarta,'Bogotá')]));
  assert.equal(r.status,'MUNICIPALITY_MISMATCH');assert.equal(r.candidates.length,0);
});
await test('Other municipalities may be located but remain outside delivery coverage',async()=>{
  const r=await searchDeliveryAddress('calle 11 #15-53','Santa Marta','test-key',provider([result(santaMarta,'Santa Marta')]));
  assert.equal(r.candidates[0].municipality,'Santa Marta');assert.ok(enrichDestination(r.candidates[0]).geographicExclusion);
});
await test('Partial matches and city/route centroids cannot become delivery addresses',async()=>{
  for(const patch of [{partial_match:true},{types:['locality']},{types:['route']},{geometry:{location:{lat:NaN,lng:0}}}]) {
    const r=await searchDeliveryAddress('Calle 11','Bogotá','test-key',provider([{...result(bogota,'Bogotá'),...patch}]));assert.equal(r.candidates.length,0);
  }
});
await test('Multiple matches stay separate and require the customer to choose',async()=>{
  const r=await searchDeliveryAddress('Calle 11','Bogotá','test-key',provider([result(bogota,'Bogotá','A'),result(bogota,'Bogotá','B'),result(bogota,'Bogotá','A')]));
  assert.deepEqual(r.candidates.map(c=>c.placeId),['A','B']);
});
await test('Provider failure is not reported as geographic exclusion',async()=>{
  const r=await searchDeliveryAddress('Calle 11','Bogotá','test-key',async()=>{throw Error('offline')});assert.equal(r.status,'UNAVAILABLE');
});

const now=1794100000000;
const position=(age:number)=>({coords:{latitude:bogota.lat,longitude:bogota.lng,accuracy:18},timestamp:now-age}) as GeolocationPosition;
function device(deadline=1000){
  let initial!:PositionCallback,update!:PositionCallback,watches=0,cleared=0;
  const reader=new DeviceLocationRequest(()=>({secure:true,geolocation:{
    getCurrentPosition(ok:PositionCallback){initial=ok},
    watchPosition(ok:PositionCallback){update=ok;watches++;return 12},clearWatch(id:number){assert.equal(id,12);cleared++},
  } as Geolocation}),()=>now,deadline);
  return {reader,initial:(age:number)=>initial(position(age)),update:(age:number)=>update(position(age)),get watches(){return watches},get cleared(){return cleared}};
}
await test('Recent mobile reading older than five seconds is retained and age is disclosed',async()=>{
  const d=device(),p=d.reader.request();d.initial(20000);const r=await p;assert.equal(r?.ageSeconds,20);assert.deepEqual(r?.coordinates,bogota);assert.equal(d.watches,0);
});
await test('Old initial fix waits for a fresh fix, then stops watching',async()=>{
  const d=device(),p=d.reader.request();d.initial(120000);assert.equal(d.watches,1);d.update(90000);assert.equal(d.watches,1);
  d.update(0);assert.equal((await p)?.ageSeconds,0);assert.equal(d.cleared,1);
});
await test('Manual entry cancels refresh and ignores a late device update',async()=>{
  const d=device(),p=d.reader.request();d.initial(120000);d.reader.cancel();assert.equal(await p,null);assert.equal(d.cleared,1);d.update(0);
});
await test('Stale refresh expires with a specific error and cleans up the watch',async()=>{
  const d=device(5),p=d.reader.request();d.initial(120000);await assert.rejects(p,(e:any)=>e instanceof DeviceLocationError&&e.kind==='stale');assert.equal(d.cleared,1);
});
await test('Future timestamp reports a clock problem, not blocked permission',async()=>{
  const d=device(),p=d.reader.request();d.initial(-60000);await assert.rejects(p,(e:any)=>e.kind==='clock');assert.equal(d.watches,0);
});
console.log(`${count} address and mobile location regression cases passed`);
