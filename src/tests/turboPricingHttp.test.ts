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

// Prices and measured transport below exist exclusively in this disposable fixture.
const file=path.join(root,'src/data/persisted-catalog-overrides.json');
const data=JSON.parse(fs.readFileSync(file,'utf8'));
const template=data.customProducts[0];
for(const price of [59999,60000,60001]) data.customProducts.push({...structuredClone(template),id:'PRICE-'+price,sku:'PRICE-'+price,name:'SIMULACIÓN TARIFA '+price,price,weightKg:1,transport:{...template.transport,weightGrams:1000},presentaciones:undefined});
fs.writeFileSync(file,JSON.stringify(data));
const destination={address:'Carrera 107 #143-31, Bogotá, Colombia',coordinates:{lat:4.747154,lng:-74.098137},municipality:'Bogotá',locality:'Suba'};
try {
 await start();const info=await call('/simulation','GET',undefined,'');admin=(await call('/auth/login','POST',info.admin,'')).token;
 await call('/admin/simulation/fleet','POST',{count:2});
 const quote=async(price:number)=>call('/delivery/quote','POST',{destination,items:[{productId:'PRICE-'+price,quantity:1}],requestedMode:'TURBO'},'');
 for(const price of [59999,60000,60001]) {const q=await quote(price);assert.equal(q.recommendedMode,'TURBO',JSON.stringify(q));assert.ok(q.confirmationToken);assert.equal(q.charges.shipping,price<60000?10000:0);assert.equal(q.charges.serviceFee,0);assert.equal(q.charges.mode,'TURBO');}
 assert.equal((await call('/orders')).length,0);
 const q=await quote(59999);const payload={items:[{productId:'PRICE-59999',price:59999,quantity:1}],deliveryAddress:destination,deliveryMode:'TURBO',confirmationToken:q.confirmationToken,customer:{name:'SIMULACIÓN TARIFA',phone:'0000000000',email:'tarifa@example.invalid',isGuest:true},paymentMethod:'CASH_ON_DELIVERY',tip:0,shipping:0,serviceFee:1500,total:1};
 idem='pricing-once';const created=await call('/orders','POST',payload,'',201);guest=created.guestAccessToken;
 assert.equal(created.totals.shipping,10000);assert.equal(created.totals.serviceFee,0);assert.equal(created.totals.total,69999);assert.equal(created.payment.cashToCollect,69999);
 assert.equal((await call('/orders','POST',payload,'')).id,created.id);idem='';
 const stale=await quote(60000);const previous=await call('/admin/transport');
 await call('/admin/transport','PUT',{config:previous.config,revision:previous.revision},'',401);
 const next=structuredClone(previous.config);next.pricing.turbo.shipping=9000;next.pricing.turbo.freeShippingFrom=61000;
 await call('/admin/transport','PUT',{config:next,revision:previous.revision});
 await call('/admin/transport','PUT',{config:previous.config,revision:previous.revision},admin,409);
 idem='stale-pricing';await call('/orders','POST',{...payload,items:[{productId:'PRICE-60000',price:60000,quantity:1}],confirmationToken:stale.confirmationToken},'',409);idem='';
 assert.equal((await call('/orders/'+created.id,'GET',undefined,'')).totals.total,69999);
 await stop();await start();admin=(await call('/auth/login','POST',info.admin,'')).token;
 assert.equal((await call('/orders/'+created.id,'GET',undefined,'')).totals.total,69999);assert.equal((await call('/admin/transport')).config.pricing.turbo.shipping,9000);
 assert.equal((await call('/catalog')).find((p:any)=>p.id==='PRICE-59999').reservedStockByStore.HUB_SUBA,1);
 console.log('PASS pricing HTTP: 59999/60000/60001, server totals ignore client fees, idempotency, one reserve, old quote rejected after tariff edit, historical total unchanged, authenticated CAS update and restart.');
} finally {await stop();fs.rmSync(root,{recursive:true,force:true});}
