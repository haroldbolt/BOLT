import type { RequestHandler } from 'express';

type Worker = 'dispatch' | 'customer_mail';
type Area = 'auth' | 'checkout' | 'orders' | 'payments' | 'dispatch' | 'tracking' | 'admin' | 'catalog' | 'maps' | 'health' | 'other';
type Signal = 'http_5xx' | 'http_429_burst' | 'worker_failure' | 'dispatch_incident' | 'dispatch_search_exhausted';
type Incident = {
  signal: Signal; area: Area | Worker; status?: number; method?: string; requestId?: string;
};
type Options = {
  env?: NodeJS.ProcessEnv;
  clock?: () => number;
  elapsed?: () => number;
  request?: typeof fetch;
  log?: (line: string) => void;
};

const minuteMs = 60000;
const hourMs = 60 * minuteMs;
const windowMinutes = 5;
const maxAttemptsPerHour = 12;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const methods = new Set(['GET','POST','PUT','PATCH','DELETE','HEAD','OPTIONS']);
const latencyBucketsMs = [100, 500, 1000, 5000];

// Paths, dynamic IDs, query parameters, exceptions and bodies must never become metric labels.
function areaFor(originalUrl: string, method: string): Area {
  const route = originalUrl.split('?',1)[0].toLowerCase().replace(/\/+$/, '');
  if (/^\/api\/customer(?:-auth)?(?:\/|$)/.test(route) || /^\/api\/v1\/(?:driver\/)?auth(?:\/|$)/.test(route)) return 'auth';
  if (/^\/api\/v1\/admin\/orders\/[^/]+\/payments\/wompi$/.test(route)) return 'payments';
  if (route === '/api/v1/delivery/quote' || (route === '/api/v1/orders' && method === 'POST')) return 'checkout';
  if (route.startsWith('/api/v1/tracking-recovery') || /^\/api\/v1\/orders\/[^/]+\/(tracking|telemetry)(?:\/|$)/.test(route)) return 'tracking';
  if (/^\/api\/v1\/(?:admin\/dispatch|driver|operations)(?:\/|$)/.test(route)) return 'dispatch';
  if (/^\/api\/v1\/orders(?:\/|$)/.test(route)) return 'orders';
  if (/^\/api\/v1\/(?:bolt-admin|admin)(?:\/|$)/.test(route)) return 'admin';
  if (/^\/api\/v1\/(?:catalog|stores)(?:\/|$)/.test(route)) return 'catalog';
  if (route.startsWith('/api/v1/geocode/')) return 'maps';
  return route === '/api/v1/health' ? 'health' : 'other';
}

function counters() {
  return {completed:0, aborted:0, http2xx:0, http3xx:0, http4xx:0, http5xx:0, http429:0,
    sumMs:0, maxMs:0, latencyBins:[0,0,0,0,0]};
}
type Counts = ReturnType<typeof counters>;
function record(count: Counts, status: number | null, ms: number) {
  if (status === null) { ++count.aborted; return; }
  ++count.completed;
  if (status >= 500) ++count.http5xx;
  else if (status >= 400) ++count.http4xx;
  else if (status >= 300) ++count.http3xx;
  else if (status >= 200) ++count.http2xx;
  if (status===429) ++count.http429;
  count.sumMs+=ms;
  count.maxMs=Math.max(count.maxMs,ms);
  const bin=latencyBucketsMs.findIndex(limit=>ms<=limit);
  ++count.latencyBins[bin<0?latencyBucketsMs.length:bin];
}

export function createServiceMonitoring(options: Options = {}) {
  const env=options.env || process.env, now=options.clock || Date.now;
  const elapsed=options.elapsed || (options.clock ? now : () => performance.now());
  const log=options.log || (line=>console.error(line));
  const request=options.request || fetch;
  const start=now();
  let target: URL | undefined;
  if (env.BOLT_ALERT_WEBHOOK_URL) {
    try { target=new URL(env.BOLT_ALERT_WEBHOOK_URL); }
    catch { throw Error('BOLT_ALERT_WEBHOOK_URL debe ser una dirección HTTPS válida.'); }
    if (target.protocol!=='https:' || target.username || target.password || target.hash) {
      throw Error('BOLT_ALERT_WEBHOOK_URL requiere HTTPS sin usuario, contraseña ni fragmento.');
    }
  }
  const cooldownSeconds=Number(env.BOLT_ALERT_COOLDOWN_SECONDS ?? 300);
  if (!Number.isInteger(cooldownSeconds) || cooldownSeconds<60 || cooldownSeconds>86400) {
    throw Error('BOLT_ALERT_COOLDOWN_SECONDS debe estar entre 60 y 86400.');
  }
  const total=counters(), byArea=new Map<Area,Counts>();
  const workerTotals:Record<Worker,number>={dispatch:0,customer_mail:0};
  const windows=new Map<number,{http:Counts; workers:Record<Worker,number>; rateByArea:Partial<Record<Area,number>>}>();
  const lastLog=new Map<string,{at:number;silenced:number}>();
  const lastAlert=new Map<string,number>();
  const sentAt:number[]=[];
  const alerts={attempted:0,sent:0,failed:0,suppressed:0};
  let suppressedLogs=0, busy=false;
  let dispatchCursor: { length: number; lastId: string | undefined } | undefined;
  const dispatchSignals = { incidents: 0, searchesExhausted: 0 };

  function minute(at:number) {
    const slot=Math.floor(at/minuteMs);
    for(const key of windows.keys()) if(key<=slot-windowMinutes || key>slot) windows.delete(key);
    const value=windows.get(slot) ?? {http:counters(),workers:{dispatch:0,customer_mail:0},rateByArea:{}};
    windows.set(slot,value);
    return value;
  }
  function incident(event:Incident, at:number) {
    const key=event.signal+'/'+event.area, previous=lastLog.get(key);
    const details={service:'bolt-pets',timestamp:new Date(at).toISOString(),...event};
    if(previous && at-previous.at<minuteMs) {++previous.silenced; ++suppressedLogs;}
    else {
      lastLog.set(key,{at,silenced:0});
      // Only allowlisted fields reach stderr; the deployment can forward its JSON logs.
      try {log(JSON.stringify({...details,suppressedSinceLast:previous?.silenced||0}));} catch { /* monitoring must not interrupt operations */ }
    }
    if(!target) return;
    while(sentAt.length && sentAt[0]<=at-hourMs) sentAt.shift();
    if(busy || sentAt.length>=maxAttemptsPerHour || at-(lastAlert.get(key)??-Infinity)<cooldownSeconds*1000) {
      ++alerts.suppressed;return;
    }
    busy=true;lastAlert.set(key,at);sentAt.push(at);++alerts.attempted;
    // No retries in the request or worker. A later incident can notify again after cooldown.
    void (async()=>{
      try {
        const response=await request(target,{method:'POST',redirect:'error',signal:AbortSignal.timeout(4000),
          headers:{'Content-Type':'application/json'},body:JSON.stringify(details)});
        await response.body?.cancel();
        if(!response.ok) throw Error('Webhook unavailable');
        ++alerts.sent;
      } catch {++alerts.failed;}
      finally {busy=false;}
    })();
  }

  const middleware:RequestHandler=(req,res,next)=>{
    const started=elapsed(), method=methods.has(req.method)?req.method:'OTHER', area=areaFor(req.originalUrl,method);
    let observed=false;
    const complete=(abort:boolean)=>{
      if(observed) return; observed=true;
      res.off('finish',finished);res.off('close',closed);
      const at=now(), bucket=minute(at), status=abort?null:res.statusCode;
      const counts=byArea.get(area) ?? counters();
      byArea.set(area,counts);
      const ms=Math.max(0,Math.round(elapsed()-started));
      for(const count of [total,counts,bucket.http]) record(count,status,ms);
      if(status===429) bucket.rateByArea[area]=(bucket.rateByArea[area]||0)+1;
      const signal=status!==null&&status>=500?'http_5xx':status===429 && bucket.rateByArea[area]!>=10?'http_429_burst':null;
      if(signal) {
        const requestId=res.locals?.requestId;
        incident({signal,area,status:status!,method,...(typeof requestId==='string' && uuid.test(requestId)?{requestId}:{})},at);
      }
    };
    const finished=()=>complete(false),closed=()=>complete(!res.writableFinished);
    res.once('finish',finished);res.once('close',closed);next();
  };
  return {
    middleware,
    observeDispatchEvents(events: readonly {id: string; type: string}[]) {
      const length = events.length;
      const lastId = length ? events[length - 1].id : undefined;
      const prior = dispatchCursor;
      dispatchCursor = { length, lastId };
      // Baseline after startup/truncation/replacement. A rollback can replace the
      // array with equal history; its stable last ID still identifies the cursor.
      if (!prior || length < prior.length || (prior.length && events[prior.length - 1].id !== prior.lastId)) return;
      for (let i = prior.length; i < length; i++) {
        const { type } = events[i];
        if (type === 'INCIDENT') {
          ++dispatchSignals.incidents;
          incident({ signal: 'dispatch_incident', area: 'dispatch' }, now());
        } else if (type === 'SEARCH_EXHAUSTED') {
          ++dispatchSignals.searchesExhausted;
          incident({ signal: 'dispatch_search_exhausted', area: 'dispatch' }, now());
        }
      }
    },
    workerFailure(worker:Worker) {
      const at=now();++workerTotals[worker];++minute(at).workers[worker];
      incident({signal:'worker_failure',area:worker},at);
    },
    snapshot() {
      const at=now();minute(at);
      return structuredClone({startedAt:new Date(start).toISOString(),asOf:new Date(at).toISOString(),
        latencyBinsUpperMs:[...latencyBucketsMs,null],http:total,httpByArea:Object.fromEntries(byArea),workerFailures:workerTotals,dispatchSignals,
        recentMinutes:[...windows.entries()].sort(([a],[b])=>a-b).map(([slot,{http,workers}])=>({start:new Date(slot*minuteMs).toISOString(),http,workers})),
        alerts:{configured:!!target,cooldownSeconds,maxAttemptsPerHour,...alerts},suppressedLogs});
    },
  };
}
