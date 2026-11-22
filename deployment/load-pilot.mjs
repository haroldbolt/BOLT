// Run after npm run build. Deliberately no target, volume, credentials or traffic flags.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { once } from 'node:events';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

assert.equal(process.argv.length, 2, 'Este ensayo siempre crea su propio servidor local.');
const source = fileURLToPath(new URL('..', import.meta.url));
assert.ok(fs.existsSync(path.join(source, 'server.js')), 'Ejecuta npm run build.');
const users = 1000, rampMs = 10000, holdMs = 60000, timeoutMs = 12000;
const resources = ['catalog', 'catalog', 'stores', 'catalog', 'quote', 'catalog', 'stores', 'catalog', 'quote', 'stores'];
const volume = fs.mkdtempSync(path.join(os.tmpdir(), 'bolt-load-pilot-'));
const stateFile = path.join(volume, 'bolt-piloto-suba', '.bolt-private', 'orders', 'persisted-fulfillment.json');
const probe = net.createServer();
await new Promise((resolve, reject) => probe.once('error', reject).listen(0, '127.0.0.1', resolve));
const port = probe.address().port;
await new Promise(resolve => probe.close(resolve));
const origin = 'http://127.0.0.1:' + port;
const environment = {
  PATH: process.env.PATH, NODE_ENV:'production', PORT:String(port), BOLT_BIND_LOOPBACK_ONLY:'1',
  BOLT_PILOT_STORE_ID:'HUB_SUBA', BOLT_PILOT_VOLUME:volume, BOLT_ADMIN_SETUP_TOKEN:randomBytes(32).toString('hex'),
  // All virtual shoppers share one loopback IP; testing that IP's default cap is a separate regression.
  BOLT_API_RATE_IP_PER_MINUTE:'100000',
};
const child = spawn(process.execPath, ['--import','tsx','deployment/start-pilot.ts'], {
  cwd:source, env:environment, stdio:['ignore','ignore','pipe'],
});
const closed = once(child, 'close');
let terminated = false;
closed.then(() => { terminated = true; }, () => { terminated = true; });
let stderr = '';
child.stderr.on('data', bytes => { stderr=(stderr + bytes.toString()).slice(-1200); });
const stop = () => { if (!terminated) child.kill('SIGTERM'); };
process.once('SIGTERM',stop);
process.once('SIGINT',stop);
let ticker;
try {
  let ready = false;
  for (let i=0; i<150 && !terminated; ++i) {
    try {
      const health=await fetch(origin+'/api/v1/health',{signal:AbortSignal.timeout(1500),redirect:'error'});
      ready=health.ok && (await health.json()).service==='Bolt Pets Authoritative Backend';
      if (ready) break;
    } catch { /* freshly started process */ }
    await wait(200);
  }
  assert.ok(ready, 'El servidor aislado no arrancó. ' + stderr);
  const privateState = () => {
    const state=JSON.parse(fs.readFileSync(stateFile,'utf8'));
    return {orders:state.orders.length,dispatches:Object.keys(state.dispatch.runs).length,revision:state.revision};
  };
  async function inventorySnapshot() {
    const res=await fetch(origin+'/api/v1/catalog',{signal:AbortSignal.timeout(30000),redirect:'error'});
    assert.equal(res.status,200);
    const products=await res.json();
    assert.ok(Array.isArray(products) && products.length);
    const byReference=[];
    const searches=[];
    for(const product of products) {
      const variants=product.presentaciones?.length?product.presentaciones:[product];
      for(const item of variants) {
        const id=item.varianteId||product.id;
        for(const [store,units] of Object.entries(item.reservedStockByStore || {})) {
          assert.ok(Number.isSafeInteger(units) && units>=0, 'Reserva inválida en fixture.');
          byReference.push([id,store,units]);
        }
      }
      if (typeof product.sku==='string' && product.sku.length>=6 && product.sku.length<=120 && searches.length<24) {
        searches.push({query:product.sku, sellable:product.id});
      }
    }
    assert.ok(searches.length,'Faltan referencias públicas en la versión.');
    byReference.sort((a,b)=>String(a[0]).localeCompare(String(b[0])) || a[1].localeCompare(b[1]));
    return {inventory:{products:products.length,rows:byReference.length,units:byReference.reduce((sum,row)=>sum+row[2],0),
      digest:createHash('sha256').update(JSON.stringify(byReference)).digest('hex')},searches};
  }
  const before=privateState(), first=await inventorySnapshot(), perUser=new Uint32Array(users);
  assert.equal(before.orders,0); assert.equal(before.dispatches,0);
  const stats=new Map(['catalog','stores','quote'].map(key=>[key,{latencies:[],statuses:{},completedInHold:0,valid:0,bytes:0}]));
  const availableSearches=[];
  for(const product of first.searches) {
    const check=await fetch(origin+'/api/v1/catalog?q='+encodeURIComponent(product.query), {signal:AbortSignal.timeout(15000),redirect:'error'});
    assert.equal(check.status,200);
    const matching=await check.json();
    if(matching.some(row=>row.id===product.sellable)) availableSearches.push(product);
  }
  assert.ok(availableSearches.length,'Faltan resultados de búsqueda visibles.');
  let active=0,peakConcurrent=0,measuredStarted=0,measuredComplete=0;
  const started=performance.now(), begin=started+rampMs, end=begin+holdMs;
  const address={address:'Carrera 107 #143-31',coordinates:{lat:4.747154,lng:-74.098137},municipality:'Bogotá',locality:'Suba'};
  function percentile(values,p) {return values.length?Math.round(values[Math.max(0,Math.ceil(values.length*p)-1)]):null;}
  ticker=setInterval(()=>console.error(JSON.stringify({seconds:Math.round((performance.now()-begin)/1000),
    measuredStarted,measuredComplete,active,usersWithCompletedAttempt:perUser.filter(n=>n>0).length})),10000);
  await Promise.all(Array.from({length:users},async (_,id)=>{
    await wait(Math.floor(id*rampMs/users));
    for(let sequence=0;performance.now()<end && !terminated;sequence++) {
      const key=resources[(id+sequence)%resources.length];
      const product=availableSearches[(id+sequence)%availableSearches.length];
      const route=key==='catalog'?'/catalog?q='+encodeURIComponent(product.query):key==='stores'?'/stores':'/delivery/quote';
      const init=key==='quote'?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
        destination:address,requestedMode:sequence%2?'PROGRAMADO':'TURBO',items:[{productId:product.sellable,quantity:1}],
      })}:{};
      const t=performance.now(), measured=t>=begin;
      const slot=stats.get(key);
      if(measured) ++measuredStarted;
      ++active; peakConcurrent=Math.max(peakConcurrent,active);
      let status='NETWORK_ERROR', valid=false, size=0;
      try {
        const res=await fetch(origin+'/api/v1'+route,{...init,signal:AbortSignal.timeout(timeoutMs),redirect:'error'});
        status=String(res.status);
        // Only narrow SKU queries during the hold. Limit response memory and verify a real API representation.
        const chunks=[];
        for await(const chunk of res.body) {
          size+=chunk.length;
          if(size>512*1024) throw Error('BODY_LIMIT');
          chunks.push(chunk);
        }
        const data=JSON.parse(Buffer.concat(chunks,size).toString());
        valid=res.ok && (key==='stores'?Array.isArray(data)&&data.some(row=>row.id==='HUB_SUBA'):
          key==='catalog'?Array.isArray(data)&&data.some(row=>row.sku===product.query):
          data?.territoryInfo?.isCovered===true && (data.assignedStoreId || data.territoryInfo.assignedStoreId)==='HUB_SUBA' && data.reasonCode==='RAPPI_CASH_UNCONFIRMED');
      } catch(error) {
        status=error.name==='TimeoutError'||error.name==='AbortError'?'TIMEOUT':error.message==='BODY_LIMIT'?'BODY_LIMIT':'NETWORK_OR_PARSE_ERROR';
      } finally {
        --active;
        if(measured) {
          ++measuredComplete; ++perUser[id]; if(valid) ++slot.valid;
          slot.statuses[status]=(slot.statuses[status]||0)+1; slot.bytes+=size;
          const observed=performance.now(); slot.latencies.push(observed-t); if(observed<=end) ++slot.completedInHold;
        }
      }
      const think=8000 + (id*719+sequence*1877)%8001;
      if (performance.now()+think>=end) break;
      await wait(think);
    }
  }));
  const finished=performance.now();
  clearInterval(ticker);
  assert.ok(!terminated,'Servidor detenido durante la carga.');
  const after=privateState(), last=await inventorySnapshot();
  const rows={};
  for(const [name, r] of stats) {
    r.latencies.sort((a,b)=>a-b);
    rows[name]={started:r.latencies.length,statuses:r.statuses,valid:r.valid,errors:r.latencies.length-r.valid,
      completedInHold:r.completedInHold,completedPerSecond:r.completedInHold/(holdMs/1000),
      p50ms:percentile(r.latencies,.5),p95ms:percentile(r.latencies,.95),p99ms:percentile(r.latencies,.99),bytes:r.bytes};
  }
  const result={node:process.version,platform:process.platform,architecture:process.arch,logicalCpus:os.availableParallelism(),
    users,rampSeconds:rampMs/1000,holdSeconds:holdMs/1000,thinkSeconds:[8,16],timeoutSeconds:timeoutMs/1000,
    testIpLimitPerMinute:100000,singleWriter:true,allowedRoutes:['GET /catalog?q=<SKU>','GET /stores','POST /delivery/quote'],
    usersWithMeasuredAttempts:perUser.filter(n=>n>0).length,usersWithRepeatedMeasuredAttempts:perUser.filter(n=>n>=2).length,
    peakConcurrentRequests:peakConcurrent,postHoldDrainMs:Math.max(0,Math.round(finished-end)),resources:rows,
    before:{...before,reservations:first.inventory},after:{...after,reservations:last.inventory}};
  console.log(JSON.stringify(result,null,2));
  assert.deepEqual(after,before,'Cambió el almacenamiento de pedidos.');
  assert.deepEqual(last.inventory,first.inventory,'Cambió el saldo reservado.');
  if(result.usersWithRepeatedMeasuredAttempts!==users || Object.values(rows).some(row=>row.errors>0)) process.exitCode=2;
} finally {
  clearInterval(ticker); stop();
  await closed;
  fs.rmSync(volume,{recursive:true,force:true});
  process.off('SIGTERM',stop); process.off('SIGINT',stop);
}
