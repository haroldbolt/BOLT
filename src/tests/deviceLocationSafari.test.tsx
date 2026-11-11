import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {beginDeviceLocation, DeviceLocationRequest, DeviceLocationError} from '../lib/deviceLocation';
import {CurrentLocationAction} from '../components/customer/CurrentLocationAction';
import fixtures from './coverage-address-fixtures.json';

const coordinates = fixtures[0].coordinates; // Verified Cedritos fixture; never the device's real position.
const now = 1794100000000;
const position = {coords:{latitude:coordinates.lat,longitude:coordinates.lng,accuracy:18},timestamp:now} as GeolocationPosition;
let count = 0;
async function test(name:string, run:()=>unknown|Promise<unknown>) {await run(); ++count; console.log('PASS',name);}
function setup() {
  let calls=0, inClick=false;
  let success!:PositionCallback, failure!:PositionErrorCallback;
  const reader = new DeviceLocationRequest(()=>({secure:true,geolocation:{
    getCurrentPosition(ok:PositionCallback,fail:PositionErrorCallback) {
      assert.equal(inClick,true,'Native request must run before the click handler returns');
      ++calls; success=ok;failure=fail;
    },
  } as Geolocation}),()=>now);
  return {click:()=>{inClick=true;const attempt=beginDeviceLocation(reader);inClick=false;return attempt},
    get calls(){return calls}, success:()=>success(position), fail:(code:number)=>failure({code} as GeolocationPositionError)};
}

await test('Header starts native permission synchronously and hands the SAME result to the modal',async()=>{
  const s=setup(), attempt=s.click();assert.equal(s.calls,1);
  // Delayed render and a StrictMode resubscription consume the same promise.
  await Promise.resolve();const first=attempt.result.then(x=>x), second=attempt.result.then(x=>x);
  s.success();assert.deepEqual(await first,await second);assert.equal(s.calls,1);
});
await test('Closing or switching to manual entry cancels and ignores late device readings',async()=>{
  const s=setup(),attempt=s.click();attempt.cancel();s.success();assert.equal(await attempt.result,null);
});
await test('A blocked request can be retried after the customer changes Safari settings',async()=>{
  const s=setup(),first=s.click();s.fail(1);
  await assert.rejects(first.result,(e:any)=>e instanceof DeviceLocationError && e.kind==='permission');
  const next=s.click();s.success();assert.deepEqual((await next.result)?.coordinates,coordinates);assert.equal(s.calls,2);
});
await test('Immediate denial before the modal mounts stays available to its subscriber',async()=>{
  const reader=new DeviceLocationRequest(()=>({secure:true,geolocation:{getCurrentPosition(_s:PositionCallback,e:PositionErrorCallback){e({code:1} as GeolocationPositionError)}} as Geolocation}));
  const attempt=beginDeviceLocation(reader);await new Promise(resolve=>setTimeout(resolve,0));
  await assert.rejects(attempt.result,(e:any)=>e.kind==='permission');
});
await test('Location and timeout failures remain distinct from blocked permission',async()=>{
  for(const [code,kind] of [[2,'unavailable'],[3,'timeout']] as const){const s=setup(),a=s.click();s.fail(code);await assert.rejects(a.result,(e:any)=>e.kind===kind);}
});
await test('Insecure and unsupported environments retain distinct recovery instructions',async()=>{
  for(const [secure,kind] of [[false,'insecure'],[true,'unsupported']] as const){const a=beginDeviceLocation(new DeviceLocationRequest(()=>({secure,geolocation:undefined})));await assert.rejects(a.result,(e:any)=>e.kind===kind);}
});
await test('Blocked permission shows Safari site and iPhone device settings, retry and manual entry',()=>{
  const html=renderToStaticMarkup(<CurrentLocationAction onClick={()=>{}} error="No tenemos permiso" errorKind="permission" onManualAddress={()=>{}}/>);
  for(const text of ['role="alert"','Configuración del sitio web','Preguntar o Permitir','Privacidad y seguridad','Sitios web de Safari','Volver a intentar ubicación','Escribir dirección','no puede cambiar'])assert.ok(html.includes(text),text);
  assert.ok(!html.includes('disabled=""'));
});
await test('Timeout does not accuse the customer of blocking permission',()=>{
  const html=renderToStaticMarkup(<CurrentLocationAction onClick={()=>{}} error="La ubicación tardó demasiado" errorKind="timeout" onManualAddress={()=>{}}/>);
  assert.ok(!html.includes('Configuración del sitio web'));assert.ok(html.includes('Escribir dirección'));
});
await test('Waiting explains the native prompt, prevents a duplicate click and allows manual cancellation',()=>{
  const html=renderToStaticMarkup(<CurrentLocationAction onClick={()=>{}} busy onManualAddress={()=>{}}/>);
  assert.ok(html.includes('elige Permitir'));assert.ok(html.includes('disabled=""'));assert.ok(html.includes('Escribir dirección'));
});
console.log(`${count} Safari location regression cases passed`);
