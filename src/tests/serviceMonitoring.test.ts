import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import type { Request, Response } from 'express';
import { createServiceMonitoring } from '../lib/serviceMonitoring';

const start = Date.UTC(2026, 10, 22, 12);
const requestId = 'd8dcce9b-d214-40a4-b217-20090cb7c35c';
const tick = () => new Promise<void>(resolve => setImmediate(resolve));

function simulate(monitor: ReturnType<typeof createServiceMonitoring>, status: number, options: {
  route?: string; id?: string; abort?: boolean; elapsed?: () => void;
} = {}) {
  const req = { method: 'GET', originalUrl: options.route || '/api/v1/orders/internal-order-1/tracking?access=secret-query',
    headers: { authorization: 'secret-header' }, body: { pin:'SECRET-PIN' } } as unknown as Request;
  const res = Object.assign(new EventEmitter(), {
    statusCode: status, locals: { requestId: options.id ?? requestId }, writableFinished: !options.abort,
  });
  monitor.middleware(req, res as unknown as Response, () => {});
  options.elapsed?.();
  res.emit(options.abort ? 'close' : 'finish');
  res.emit('close');
}

test('Métricas de API independientes del contenido de la solicitud, desconexión y ventana acotada', () => {
  let now=start;
  const lines:string[]=[];
  const monitor=createServiceMonitoring({env:{},clock:()=>now,log:line=>lines.push(line)});
  simulate(monitor,503,{elapsed:()=>{now+=600;}});
  simulate(monitor,503);
  simulate(monitor,404);
  simulate(monitor,200,{abort:true});
  assert.equal(lines.length,1);
  assert.deepEqual(JSON.parse(lines[0]),{
    service:'bolt-pets',signal:'http_5xx',area:'tracking',status:503,method:'GET',
    timestamp:new Date(start+600).toISOString(),requestId,suppressedSinceLast:0,
  });
  const state=monitor.snapshot();
  assert.equal(state.http.completed,3);
  assert.equal(state.http.aborted,1);
  assert.equal(state.http.maxMs,600);
  assert.deepEqual(state.http.latencyBins,[2,0,1,0,0]);
  assert.equal(state.httpByArea.tracking.http5xx,2);
  assert.equal(state.recentMinutes[0].http.http4xx,1);
  assert.equal(state.alerts.configured,false);
  assert.equal(state.suppressedLogs,1);
  for (let i=0;i<10;i++) simulate(monitor,429);
  assert.equal(JSON.parse(lines.at(-1)!).signal,'http_429_burst');
  now+=6*60000;
  simulate(monitor,503,{id:'private-untrusted-id'});
  assert.equal(JSON.parse(lines.at(-1)!).requestId,undefined);
  assert.equal(JSON.parse(lines.at(-1)!).suppressedSinceLast,1);
  assert.equal(monitor.snapshot().recentMinutes.length,1);
  assert.equal(monitor.snapshot().recentMinutes[0].http.completed,1);
  assert.doesNotMatch(lines.join(' ')+JSON.stringify(state), /secret-query|secret-header|SECRET-PIN|internal-order|private-untrusted/);
});

test('Webhook fijo por configuración, sin redirecciones ni esperas en la operación; límite de concurrencia y cooldown', async () => {
  let now=start;
  const destination='https://fixture.invalid/private-webhook';
  const calls:unknown[]=[];
  let respond!: (response:Response | globalThis.Response) => void;
  const monitor=createServiceMonitoring({
    env:{ BOLT_ALERT_WEBHOOK_URL: destination, BOLT_ALERT_COOLDOWN_SECONDS:'60' }, clock:()=>now, log:()=>{},
    request:async (url,init)=>{
      assert.equal(String(url),destination);
      assert.equal(init?.redirect,'error');
      assert.ok(init?.signal);
      assert.equal(init?.method,'POST');
      calls.push(JSON.parse(String(init?.body)));
      return new Promise(resolve=>{respond=(value)=>resolve(value as globalThis.Response);});
    },
  });
  monitor.workerFailure('dispatch');
  monitor.workerFailure('customer_mail');
  assert.equal(calls.length,1);
  assert.equal(monitor.snapshot().workerFailures.customer_mail,1);
  respond(new globalThis.Response(null,{status:502}));await tick();
  assert.equal(monitor.snapshot().alerts.failed,1);
  now+=10000;
  monitor.workerFailure('dispatch');
  assert.equal(calls.length,1);
  now+=50000;
  monitor.workerFailure('dispatch');
  respond(new globalThis.Response(null,{status:204}));await tick();
  assert.equal(monitor.snapshot().alerts.sent,1);
  assert.equal(monitor.snapshot().alerts.suppressed,2);
  assert.deepEqual(Object.keys(calls[0] as object).sort(),['area','service','signal','timestamp']);
  assert.ok(!JSON.stringify(monitor.snapshot()).includes(destination));
  assert.throws(()=>createServiceMonitoring({env:{BOLT_ALERT_WEBHOOK_URL:'http://fixture.invalid'}}),/HTTPS/);
  assert.throws(()=>createServiceMonitoring({env:{BOLT_ALERT_WEBHOOK_URL:'https://user:secret@fixture.invalid'}}),/HTTPS/);
});

test('Cupo máximo por hora incluye intentos fallidos', async () => {
  let now=start, calls=0;
  const monitor=createServiceMonitoring({env:{BOLT_ALERT_WEBHOOK_URL:'https://fixture.invalid',BOLT_ALERT_COOLDOWN_SECONDS:'60'},
    clock:()=>now,log:()=>{},request:async()=>{++calls;throw Error('private downstream response');}});
  for(let i=0;i<20;i++){
    monitor.workerFailure('dispatch');
    await tick();
    now+=60000;
  }
  assert.equal(calls,12);
  assert.equal(monitor.snapshot().alerts.failed,12);
  now=start+3600000;
  monitor.workerFailure('dispatch');await tick();
  assert.equal(calls,13);
});

test('Solo se anuncian incidencias y búsquedas agotadas añadidas tras el arranque', () => {
  let now = start;
  const lines: string[] = [];
  const monitor = createServiceMonitoring({env:{},clock:()=>now,log:line=>lines.push(line)});
  const events = [
    {id:'hist',type:'INCIDENT',detail:'private historical order'},
    {id:'hist2',type:'SEARCH_EXHAUSTED',detail:'private historical courier'},
  ];
  monitor.observeDispatchEvents(events);
  monitor.observeDispatchEvents(events);
  assert.equal(lines.length,0);
  events.push({id:'new1',type:'INCIDENT',detail:'private address'});
  events.push({id:'new2',type:'SEARCH_EXHAUSTED',detail:'private contact'});
  events.push({id:'new3',type:'DISPATCH_ASSIGNED',detail:'private phone'});
  monitor.observeDispatchEvents(events);
  monitor.observeDispatchEvents(events);
  assert.deepEqual(lines.map(line=>JSON.parse(line).signal), ['dispatch_incident','dispatch_search_exhausted']);
  const replacement = structuredClone(events);
  replacement.push({id:'new4',type:'INCIDENT',detail:'private pin'});
  monitor.observeDispatchEvents(replacement);
  assert.equal(lines.length,2);
  assert.deepEqual(monitor.snapshot().dispatchSignals,{incidents:2,searchesExhausted:1});
  assert.ok(!lines.join('').includes('private'));
  // A removed or replaced prefix is a fresh baseline, never a historical replay.
  const rotated = [{id:'archive',type:'INCIDENT'}];
  monitor.observeDispatchEvents(rotated);
  now+=60000;
  rotated.push({id:'new5',type:'SEARCH_EXHAUSTED'});
  monitor.observeDispatchEvents(rotated);
  assert.equal(lines.length,3);
  const restarted = createServiceMonitoring({env:{},log:()=>assert.fail('history replayed')});
  restarted.observeDispatchEvents(rotated);
  assert.deepEqual(restarted.snapshot().dispatchSignals,{incidents:0,searchesExhausted:0});
});

test('el diagnóstico de direcciones parte sin consultas y separa ambos sentidos sin datos privados', async () => {
  const env = {GOOGLE_MAPS_SERVER_API_KEY:'fixture-key-not-for-logs'};
  let now = start;
  const monitor = createServiceMonitoring({env,clock:()=>now});
  assert.deepEqual(monitor.snapshot().geocoding, {configured:true,forward:null,reverse:null});
  monitor.recordGeocoding('forward', 'DENIED');
  now += 1000;
  monitor.recordGeocoding('reverse', 'NO_RESULTS');
  assert.deepEqual(monitor.snapshot().geocoding, {configured:true,
    forward:{outcome:'DENIED',at:new Date(start).toISOString()},
    reverse:{outcome:'NO_RESULTS',at:new Date(now).toISOString()}});
  assert.doesNotMatch(JSON.stringify(monitor.snapshot()), /fixture-key-not-for-logs/);
  assert.equal(createServiceMonitoring({env:{}}).snapshot().geocoding.configured,false);
});
