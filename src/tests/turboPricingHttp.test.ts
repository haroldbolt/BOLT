import { checkoutFetch } from './checkoutBrowserFixture.mjs';
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
  const res = await checkoutFetch(base + p, {
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

// Prices and measured transport below exist exclusively in this disposable fixture.
const file=path.join(root,'src/data/persisted-catalog-overrides.json');
const data=JSON.parse(fs.readFileSync(file,'utf8'));
const template=data.customProducts[0];
for(const price of [59999,60000,60001]) data.customProducts.push({...structuredClone(template),id:'PRICE-'+price,sku:'PRICE-'+price,name:'SIMULACIÓN TARIFA '+price,price,weightKg:1,transport:{...template.transport,weightGrams:1000},presentaciones:undefined});
data.customProducts.push({ ...structuredClone(data.customProducts[1]), id: 'RX-TEST', sku: 'RX-TEST',
  name: 'Fórmula de prueba', requiresPrescription: true });
const lastUnit = data.customProducts.find((p:any) => p.id === 'PRICE-59999');
lastUnit.bodegaIds = ['HUB_SUBA', 'HUB_KENNEDY', 'HUB_ALAMOS'];
lastUnit.stockByStore = {HUB_SUBA:1, HUB_KENNEDY:7, HUB_ALAMOS:9};
lastUnit.reservedStockByStore = {HUB_SUBA:0, HUB_KENNEDY:0, HUB_ALAMOS:0};
fs.writeFileSync(file,JSON.stringify(data));
const destination={address:'Carrera 107 #143-31, Bogotá, Colombia',coordinates:{lat:4.747154,lng:-74.098137},municipality:'Bogotá',locality:'Suba'};
try {
 await start();const info=await call('/simulation','GET',undefined,'');admin=(await call('/auth/login','POST',info.admin,'')).token;
 await call('/admin/simulation/fleet','POST',{count:2});
 const quote=async(price:number)=>call('/delivery/quote','POST',{destination,items:[{productId:'PRICE-'+price,quantity:1}],requestedMode:'TURBO'},'');
 for(const price of [59999,60000,60001]) {const q=await quote(price);assert.equal(q.recommendedMode,'TURBO',JSON.stringify(q));assert.ok(q.confirmationToken);assert.equal(q.charges.shipping,price<60000?10000:0);assert.equal(q.charges.serviceFee,0);assert.equal(q.charges.mode,'TURBO');}
 assert.equal((await call('/orders')).length,0);
 const q=await quote(59999);const payload={items:[{productId:'PRICE-59999',price:59999,quantity:1}],deliveryAddress:destination,deliveryMode:'TURBO',confirmationToken:q.confirmationToken,customer:{name:'SIMULACIÓN TARIFA',phone:'0000000000',email:'tarifa@example.invalid',isGuest:true},paymentMethod:'CASH_ON_DELIVERY',tip:0,shipping:0,serviceFee:1500,total:1};
 await call('/integrations/status', 'GET', undefined, '', 401);
 const integration = await call('/integrations/status');
 assert.equal(integration.wompi.status, 'Pagos en línea desactivados');
 assert.equal(integration.wompi.lastTransaction, undefined);
 idem = 'rejected-tenders';
 for (const paymentMethod of ['WOMPI_CARD', 'WOMPI_PSE', 'WOMPI_BANCOLOMBIA', 'UNKNOWN']) {
   const refused = await call('/orders', 'POST', {...payload, paymentMethod}, '', 400);
   assert.equal(refused.code, paymentMethod === 'UNKNOWN' ? 'INVALID_PAYMENT_METHOD' : 'PAYMENT_UNAVAILABLE');
 }
 assert.equal((await call('/orders')).length, 0);
 assert.equal((await call('/catalog')).find((p:any) => p.id === 'PRICE-59999').reservedStockByStore.HUB_SUBA ?? 0, 0);
 const race = async (key:string) => {
   const response = await checkoutFetch(base+'/orders', {method:'POST', headers:{'Content-Type':'application/json','Idempotency-Key':key}, body:JSON.stringify(payload)});
   return {status:response.status, result:await response.json(), key};
 };
 // Distinct checkout attempts deliberately compete for one sellable unit.
 const attempts = await Promise.all([race('last-unit-a'), race('last-unit-b')]);
 const winners = attempts.filter(attempt => attempt.status === 201);
 assert.equal(winners.length, 1, JSON.stringify(attempts.map(a=>({status:a.status, code:a.result.code}))));
 const loser = attempts.find(a => a !== winners[0])!;
 assert.equal(loser.status, 400);
 assert.ok(['INSUFFICIENT_STOCK','OUT_OF_STOCK_AUTO_SCHEDULED'].includes(loser.result.code) || /inventario insuficiente/i.test(loser.result.error), 'El rechazo debe deberse a existencias.');
 const created = winners[0].result;
 assert.equal(created.storeId, 'HUB_SUBA');
 assert.equal(created.fulfillmentStatus, 'CONFIRMADO');
 const assertOnlyOneReserve = async () => {
   const rows = await call('/orders');
   const purchases = rows.filter((o:any) => o.items.some((item:any) => item.productId === lastUnit.id));
   assert.deepEqual(purchases.map((o:any)=>o.id), [created.id]);
   assert.deepEqual(purchases[0].items.map((item:any)=>[item.productId,item.quantity]), [[lastUnit.id,1]]);
   const row = (await call('/catalog')).find((p:any)=>p.id === lastUnit.id);
   const variant = row.presentaciones.find((v:any)=>v.sku === lastUnit.sku);
   assert.ok(variant);
   for (const [store, stock] of Object.entries(lastUnit.stockByStore)) {
     assert.equal(variant.stockByStore[store], stock);
     assert.equal(variant.reservedStockByStore[store], store === 'HUB_SUBA' ? 1 : 0);
   }
 };
 await assertOnlyOneReserve();
 idem = winners[0].key;
 guest = created.guestAccessToken;
 assert.equal(created.payment.status,'PENDIENTE');
 assert.equal(created.payment.transactionId,undefined);
 assert.equal(created.totals.shipping,10000);assert.equal(created.totals.serviceFee,0);assert.equal(created.totals.total,69999);assert.equal(created.payment.cashToCollect,69999);
 const tracking=await call('/orders/'+created.id+'/tracking','GET',undefined,'');
 assert.equal(tracking.timing.source,null);
 assert.equal(tracking.timing.startedAt,null);
 assert.equal(tracking.timing.dueAt,null);
 assert.equal(tracking.telemetry,null);
 assert.equal((await call('/orders','POST',payload,'')).id,created.id);idem='';
 const rxQuote = await call('/delivery/quote', 'POST', {destination, items:[{productId:'RX-TEST', quantity:1}], requestedMode:'TURBO'}, '');
 const ordinaryGuest = guest;
 idem = 'rx-review';
 const rx = await call('/orders','POST',{...payload,paymentMethod:'EFECTIVO',confirmationToken:rxQuote.confirmationToken,
   items:[{productId:'RX-TEST',price:59999,quantity:1,picked:true,verifiedLot:'CLIENT-SUPPLIED'}]},'',201);
 assert.equal(rx.payment.method,'CASH_ON_DELIVERY');
 assert.equal(rx.payment.status,'PENDIENTE');
 assert.equal(rx.items[0].picked,undefined);
 assert.equal(rx.items[0].verifiedLot,undefined);
 assert.equal(rx.prescriptionReview.status,'PENDIENTE_REVISION');
 assert.equal(rx.prescriptionReview.reviewedBy,undefined);
 const rxOrder = '/orders/' + rx.id;
 const rxOps = '/operations/orders/' + rx.id;
 await call(rxOps+'/status','POST',{status:'EN_ALISTAMIENTO'},admin,409);
 await call(rxOps+'/prescription/review','POST',{status:'APROBADA'},admin,400);
 guest = rx.guestAccessToken;
 await call(rxOrder+'/prescription','POST',{documentUrl:'javascript:alert(1)',documentName:'fórmula'},'',400);
 await call(rxOrder+'/prescription','POST',{documentUrl:'https://fixture.invalid/formula.pdf',documentName:'Fórmula de prueba'},'',200);
 const reviewed = await call(rxOps+'/prescription/review','POST',{status:'APROBADA',reviewerName:'CLIENT-SUPPLIED'});
 assert.equal(reviewed.order.prescriptionReview.status,'APROBADA');
 assert.notEqual(reviewed.order.prescriptionReview.reviewedBy,'CLIENT-SUPPLIED');
 await call(rxOps+'/status','POST',{status:'EN_ALISTAMIENTO'});
 await call(rxOrder+'/cancel','POST',{reason:'Cierre del pedido de fórmula de prueba.'});
 guest = ordinaryGuest;
 idem = '';
 const stale=await quote(60000);const previous=await call('/admin/transport');
 await call('/admin/transport','PUT',{config:previous.config,revision:previous.revision},'',401);
 const next=structuredClone(previous.config);next.pricing.turbo.shipping=9000;next.pricing.turbo.freeShippingFrom=61000;
 await call('/admin/transport','PUT',{config:next,revision:previous.revision});
 await call('/admin/transport','PUT',{config:previous.config,revision:previous.revision},admin,409);
 idem='stale-pricing';await call('/orders','POST',{...payload,items:[{productId:'PRICE-60000',price:60000,quantity:1}],confirmationToken:stale.confirmationToken},'',409);idem='';
 assert.equal((await call('/orders/'+created.id,'GET',undefined,'')).totals.total,69999);
 await stop();await start();admin=(await call('/auth/login','POST',info.admin,'')).token;
 assert.equal((await call('/orders/'+created.id,'GET',undefined,'')).totals.total,69999);assert.equal((await call('/admin/transport')).config.pricing.turbo.shipping,9000);
 await assertOnlyOneReserve();
 console.log('PASS concurrencia HTTP con dos claves distintas: una sola compra de la última unidad, una reserva en Suba y saldos de Kennedy/Álamos conservados tras reinicio.');
 assert.equal((await call(rxOrder)).prescriptionReview.status,'APROBADA');
 assert.equal((await call('/catalog')).find((p:any)=>p.id==='PRICE-59999').reservedStockByStore.HUB_SUBA,1);
 console.log('PASS pricing HTTP: 59999/60000/60001, server totals ignore client fees, idempotency, one reserve, old quote rejected after tariff edit, historical total unchanged, authenticated CAS update and restart, unavailable payment methods reserve nothing, and persistent prescription review.');
} finally {await stop();fs.rmSync(root,{recursive:true,force:true});}
