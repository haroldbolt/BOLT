/** Full HTTP test in an independently created simulator, including restart and capability checks. */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn, execFileSync } from "node:child_process";
import assert from "node:assert/strict";
import net from "node:net";
const source = process.cwd(),
  root = path.join(
    os.tmpdir(),
    "bolt-dispatch-simulation-" + crypto.randomUUID(),
  );
execFileSync(
  process.execPath,
  ["--import", "tsx", "scripts/dispatch-simulation.ts", root],
  { cwd: source },
);
const sock = net.createServer();
await new Promise<void>((r) => sock.listen(0, "127.0.0.1", r));
const port = (sock.address() as net.AddressInfo).port;
await new Promise<void>((r) => sock.close(() => r()));
let child: any;
let output = "";
const base = `http://127.0.0.1:${port}/api/v1`;
let idem = "";
let admin = "",
  guest = "";
async function call(
  p: string,
  method = "GET",
  body?: any,
  token = admin,
  expected = 200,
) {
  const res = await fetch(base + p, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(idem?{"Idempotency-Key":idem}:{}),
      ...(token ? { Authorization: "Bearer " + token } : {}),
      ...(guest ? { "X-Order-Token": guest } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json();
  assert.equal(
    res.status,
    expected,
    JSON.stringify({ p, status: res.status, data }),
  );
  return data;
}
async function start() {
  child = spawn(process.execPath, ["--import", "tsx", "server.ts"], {
    cwd: root,
    env: {
      ...process.env,
      BOLT_DISPATCH_SIMULATION: "1",
      BOLT_DATA_DIR: path.join(root, ".bolt-private/orders"),
      PORT: String(port),
      NODE_ENV: "production",
      BOLT_ADMIN_EMAIL: "",
      BOLT_ADMIN_PASSWORD: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (b: any) => (output += b));
  child.stderr.on("data", (b: any) => (output += b));
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null) throw Error(output);
    try {
      const r = await fetch(base + "/simulation");
      if (r.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw Error(output);
}
async function stop() {
  if (child && child.exitCode === null) {
    child.kill("SIGTERM");
    await new Promise((r) => child.once("exit", r));
  }
}

// Only this disposable runtime has unmeasured fixture data; no real catalog mutation.
const overridesFile=path.join(root,'src/data/persisted-catalog-overrides.json');
const overrides=JSON.parse(fs.readFileSync(overridesFile,'utf8'));const fixture=overrides.customProducts[0];const measured=fixture.transport;delete fixture.transport;
fs.writeFileSync(overridesFile,JSON.stringify(overrides));
const destination={address:'Calle 150 #16-56, Bogotá',coordinates:{lat:4.731531,lng:-74.041785},municipality:'Bogotá',locality:'Usaquén'};
try {
 await start();const info=await call('/simulation','GET',undefined,'');admin=(await call('/auth/login','POST',info.admin,'')).token;
 const catalog=await call('/catalog'),p=catalog.find((p:any)=>p.id===fixture.id);assert.ok(p);
 const request={destination,items:[{productId:p.id,quantity:3}],requestedMode:'PROGRAMADO'};
 const q=await call('/delivery/quote','POST',request,'');assert.equal(q.reasonCode,'TRANSPORT_DATA_PENDING');assert.ok(q.reviewRequestToken);assert.equal(q.confirmationToken,undefined);assert.equal(q.transportPlan.feasible,false);assert.equal(q.charges.mode,'PROGRAMADO');assert.equal(q.charges.subtotal,30000);
 assert.equal((await call('/orders')).length,0);
 idem='pending-fixture';
 const payload={requestDeliveryReview:true,reviewRequestToken:q.reviewRequestToken,items:[{productId:p.id,price:p.price,quantity:3}],deliveryMode:'PROGRAMADO',deliveryAddress:{...destination,details:'Referencia opcional añadida en checkout',porteriaPolicy:'DEJAR_EN_PORTERIA'},customer:{name:'SIMULACIÓN SOLICITUD',phone:'0000000000',email:'fixture@example.invalid',isGuest:true},paymentMethod:'CASH_ON_DELIVERY',tip:0};
 const created=await call('/orders','POST',payload,'',201);guest=created.guestAccessToken;
 assert.equal(created.fulfillmentStatus,'PENDIENTE_CONFIRMACION');assert.equal(created.payment.status,'PENDIENTE');assert.equal(created.payment.cashToCollect,0);assert.equal(created.dispatches.length,0);assert.equal(created.estimatedDeliveryMinutes,0);assert.equal(created.deliveryMode,undefined);assert.equal(created.transportLoad,undefined);
 assert.equal((await call('/orders','POST',payload,'')).id,created.id);idem='';
 const current=()=>call('/catalog').then(ps=>ps.find((x:any)=>x.id===p.id));
 assert.equal((await current()).reservedStockByStore.HUB_SUBA,(p.reservedStockByStore.HUB_SUBA||0)+3);
 const privateGuest=guest;guest='';await call('/orders/'+created.id,'GET',undefined,'',403);guest=privateGuest;
 const reviews=await call('/admin/dispatch');assert.equal(reviews.pendingDeliveryReviews.length,1);assert.equal(reviews.orders.length,0);assert.equal(reviews.historicalOrders.length,0);
 await call('/operations/orders/'+created.id+'/status','POST',{status:'CONFIRMADO'},admin,409);
 const endpoint='/admin/orders/'+created.id+'/delivery-review/';
 await call(endpoint+'quote','POST',{},'',401);
 await call(endpoint+'confirm','POST',{confirmationToken:'forged'},admin,400);
 await stop();await start();admin=(await call('/auth/login','POST',info.admin,'')).token;
 assert.equal((await call('/orders/'+created.id,'GET',undefined,'')).fulfillmentStatus,'PENDIENTE_CONFIRMACION');assert.equal((await call('/admin/dispatch')).pendingDeliveryReviews.length,1);assert.equal((await current()).reservedStockByStore.HUB_SUBA,3);
 // A second pending receipt can be cancelled without collecting or releasing another order's stock.
 const q2=await call('/delivery/quote','POST',{...request,items:[{productId:p.id,quantity:1}]},'');
 idem='cancel-fixture';const second=await call('/orders','POST',{...payload,reviewRequestToken:q2.reviewRequestToken,items:[{productId:p.id,price:p.price,quantity:1}]},'',201);idem='';
 guest=second.guestAccessToken;await call('/orders/'+second.id+'/cancel','POST',{reason:'SIMULACIÓN cancelación'},'');await call('/orders/'+second.id+'/cancel','POST',{reason:'SIMULACIÓN reintento'},'');
 assert.equal((await current()).reservedStockByStore.HUB_SUBA,3);guest=privateGuest;
 // Administrative catalog completion, using explicit fictitious dimensions only.
 await call('/admin/catalog/transport','PUT',{productId:p.id,transport:measured,previous:null});
 await call('/admin/simulation/fleet','POST',{count:2});
 let proposal=await call(endpoint+'quote','POST',{deliveryMode:'PROGRAMADO'});assert.ok(proposal.confirmationToken,JSON.stringify(proposal));assert.equal(proposal.transportPlan.shipments.length,2);
 const slot=proposal.transportWindow;assert.ok(slot);
 proposal=await call(endpoint+'quote','POST',{deliveryMode:'PROGRAMADO',scheduledWindow:slot});
 const confirmation={confirmationToken:proposal.confirmationToken,deliveryMode:'PROGRAMADO',scheduledWindow:slot,customerAccepted:true,customerAgreementReference:'SIMULACIÓN: cliente de prueba acepta total y franja'};
 await call(endpoint+'confirm','POST',{...confirmation,confirmationToken:'stale'},admin,409);
 const confirmed=await call(endpoint+'confirm','POST',confirmation,admin,201);assert.equal(confirmed.id,created.id);assert.equal(confirmed.purchaseCode,created.purchaseCode);assert.equal(confirmed.createdAt,created.createdAt);assert.equal(confirmed.fulfillmentStatus,'CONFIRMADO');assert.equal(confirmed.childShipments.length,2);assert.equal(confirmed.payment.status,'PENDIENTE');assert.equal(confirmed.childShipments.reduce((a:number,s:any)=>a+s.items.reduce((n:number,i:any)=>n+i.quantity,0),0),3);
 assert.equal((await current()).reservedStockByStore.HUB_SUBA,3);assert.equal((await current()).stockByStore.HUB_SUBA,p.stockByStore.HUB_SUBA);
 assert.equal((await call(endpoint+'confirm','POST',confirmation)).id,created.id);assert.equal((await call('/orders')).length,2);assert.equal((await call('/admin/dispatch')).orders[0].dispatches.length,2);
 assert.equal((await call('/orders/'+created.id,'GET',undefined,'')).id,created.id);
 // Known physical data is still mandatory for dispatch. No arbitrary review request bypass.
 idem='illegal-review';await call('/orders','POST',{...payload,reviewRequestToken:'forged'},'',409);idem='';
 const blocked=await call('/delivery/quote','POST',{...request,destination:{address:'Cota menciona Bogotá',municipality:'Cota',coordinates:{lat:4.809,lng:-74.101}}},'');assert.equal(blocked.reviewRequestToken,undefined);
 const stock=await call('/delivery/quote','POST',{...request,items:[{productId:p.id,quantity:1001}]},'');assert.equal(stock.reviewRequestToken,undefined);
 await stop();await start();admin=(await call('/auth/login','POST',info.admin,'')).token;
 assert.equal((await call('/orders/'+created.id,'GET',undefined,'')).childShipments.length,2);assert.equal((await current()).reservedStockByStore.HUB_SUBA,3);
 console.log('PASS isolated HTTP: pending receipt, no payment/ETA/dispatch, idempotency, one reservation, private access, admin protections, restart, capacity revalidation, stale quote rejection, accepted conversion into two dispatches, same codes/stock, retry and second restart.');
} finally {await stop();fs.rmSync(root,{recursive:true,force:true});}
