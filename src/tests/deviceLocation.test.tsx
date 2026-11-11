import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {DeviceLocationRequest, DEVICE_LOCATION_OPTIONS} from '../lib/deviceLocation';
import {CurrentLocationAction} from '../components/customer/CurrentLocationAction';
import {SavedAddressesModal} from '../components/customer/SavedAddressesModal';
import fixtures from './coverage-address-fixtures.json';

const point = fixtures[0].coordinates; // Verified Cedritos fixture; not the test device's real location.
const now = 1794100000000;
const position = (patch: any = {}) => ({coords:{latitude:point.lat,longitude:point.lng,accuracy:18},timestamp:now,...patch}) as GeolocationPosition;
function setup(options: {secure?:boolean; unsupported?:boolean; deadline?:number} = {}) {
  const calls: {success:PositionCallback;error:PositionErrorCallback|null|undefined;options?:PositionOptions}[] = [];
  const geo = {getCurrentPosition(success:PositionCallback,error?:PositionErrorCallback|null,options?:PositionOptions){calls.push({success,error,options})}} as Geolocation;
  const reader = new DeviceLocationRequest(()=>({secure:options.secure ?? true,geolocation:options.unsupported ? undefined : geo}),()=>now,options.deadline ?? 20000);
  return {reader,calls};
}
let count = 0;
async function test(name:string,run:()=>void|Promise<void>) {await run();count++;console.log('PASS',name)}
await test('No location permission or lookup before the customer requests it',()=>{const s=setup();assert.equal(s.calls.length,0)});
await test('Uses a fresh high-accuracy reading and preserves latitude/longitude and accuracy',async()=>{
  const s=setup(),result=s.reader.request();assert.deepEqual(s.calls[0].options,DEVICE_LOCATION_OPTIONS);
  s.calls[0].success(position());assert.deepEqual(await result,{coordinates:point,accuracyMeters:18,ageSeconds:0});
});
await test('Repeated clicks share one pending request',async()=>{
  const s=setup(),a=s.reader.request(),b=s.reader.request();assert.equal(a,b);assert.equal(s.calls.length,1);s.calls[0].success(position());await a;
});
for(const [code,message] of [[1,/permiso/],[2,/No pudimos/],[3,/tardó demasiado/]] as const) await test('Device error '+code+' is actionable and never becomes outside coverage',async()=>{
  const s=setup(),pending=s.reader.request();s.calls[0].error!({code} as GeolocationPositionError);await assert.rejects(pending,message);
  const retry=s.reader.request();assert.equal(s.calls.length,2);s.calls[1].success(position());assert.ok(await retry);
});
await test('Insecure HTTP is explained before contacting geolocation',async()=>{const s=setup({secure:false});await assert.rejects(s.reader.request(),/HTTPS/);assert.equal(s.calls.length,0)});
await test('Unavailable geolocation retains the manual-address option',async()=>{const s=setup({unsupported:true});await assert.rejects(s.reader.request(),/escribe la dirección/)});
await test('Permission prompt without a response has a bounded waiting time',async()=>{const s=setup({deadline:5});await assert.rejects(s.reader.request(),/tardó demasiado/)});
await test('Closing or editing cancels the result, including late browser callbacks',async()=>{
  const s=setup(),old=s.reader.request();s.reader.cancel();assert.equal(await old,null);
  const next=s.reader.request();s.calls[0].success(position());s.calls[1].success(position({coords:{latitude:point.lat,longitude:point.lng,accuracy:3000}}));
  assert.equal((await next)?.accuracyMeters,3000);
});
await test('A callback after the watchdog deadline cannot replace a newer result',async()=>{
  const s=setup({deadline:5}),old=s.reader.request();await assert.rejects(old);const next=s.reader.request();s.calls[0].success(position());s.calls[1].success(position());assert.ok(await next);
});
await test('Rejects invalid, transposed, stale or future device readings',async()=>{
  for(const value of [position({coords:{latitude:NaN,longitude:point.lng,accuracy:1}}),position({coords:{latitude:point.lng,longitude:point.lat,accuracy:1}}),position({coords:{latitude:point.lat,longitude:point.lng,accuracy:-1}}),position({timestamp:now-61000}),position({timestamp:now+60000})]) {
    const s=setup(),pending=s.reader.request();s.calls[0].success(value);await assert.rejects(pending,/coordenadas|ubicación antigua|hora de la ubicación/);
  }
});
await test('Low accuracy is reported, not replaced by an invented position',async()=>{
  const s=setup(),pending=s.reader.request();s.calls[0].success(position({coords:{latitude:point.lat,longitude:point.lng,accuracy:3000}}));
  const location=await pending;assert.deepEqual(location?.coordinates,point);
  const html=renderToStaticMarkup(<CurrentLocationAction onClick={()=>{}} accuracyMeters={location?.accuracyMeters}/>);
  assert.match(html,/3\.000 m/);assert.match(html,/ajusta el punto/);
});
await test('Accessible action blocks repeated input while pending and exposes errors',()=>{
  const html=renderToStaticMarkup(<CurrentLocationAction onClick={()=>{}} busy error="Permiso bloqueado"/>);
  for(const expected of ['disabled=""','aria-busy="true"','role="alert"','Permiso bloqueado','antes de confirmar'])assert.ok(html.includes(expected));
});
await test('Saved-address entry exposes current location without running it at render',()=>{
  let requested=0;const noop=()=>{};
  const html=renderToStaticMarkup(<SavedAddressesModal isOpen onClose={noop} addresses={[]} current={null} quote={null} warning="" message="" onAdd={noop} onEdit={noop} onUse={noop} onRemove={noop} onDefault={noop} onSave={()=>true} onContinue={noop} onUseCurrentLocation={()=>{requested++}}/>);
  assert.match(html,/Usar mi ubicación actual/);assert.match(html,/Agregar nueva dirección/);assert.equal(requested,0);
});
console.log(`${count} device location cases passed`);
