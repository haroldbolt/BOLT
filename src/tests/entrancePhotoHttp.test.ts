/** Full HTTP test in an independently created simulator, including restart and capability checks. */
import fs from "node:fs";
import sharp from "sharp";
import { photoDestinationKey } from "../lib/entrancePhotoShared";
import { api } from "../lib/api";
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

try {
  await start();
  const info = await call("/simulation", "GET", undefined, "");
  admin = (await call("/auth/login", "POST", info.admin, "")).token;
  await call("/admin/simulation/fleet", "POST", { count: 2 });
  const requestId = crypto.randomUUID(),
    created = await call("/admin/simulation/purchases", "POST", { requestId });
  const order = created.order;
  guest = created.guestAccessToken;
  const catalogBefore = await call("/catalog"),
    orderBefore = await call("/orders/" + order.id);
  const raw = await sharp({
    create: { width: 1400, height: 900, channels: 3, background: "#e11d48" },
  })
    .withExif({ IFD0: { Copyright: "PRIVATE FIXTURE METADATA" } })
    .jpeg()
    .toBuffer();
  const photoId = crypto.randomUUID(),
    photoPath = "/orders/" + order.id + "/entrance-photo";
  const upload = (body = raw, headers: any = {}) =>
    fetch(base + photoPath, {
      method: "PUT",
      headers: {
        "Content-Type": "image/jpeg",
        "X-Order-Token": guest,
        "X-Photo-Id": photoId,
        "X-Photo-Destination": encodeURIComponent(
          photoDestinationKey(order.deliveryAddress),
        ),
        ...headers,
      },
      body,
    });
  assert.equal((await fetch(base + photoPath)).status, 403);
  assert.equal(
    (
      await upload(raw, {
        "X-Order-Token": "invalid",
        "x-actor-role": "ADMINISTRADOR",
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await upload(raw, {
        "X-Photo-Destination": encodeURIComponent("wrong destination"),
      })
    ).status,
    409,
  );
  assert.equal((await upload(Buffer.from("<svg/>"))).status, 400);
  assert.equal((await upload(Buffer.alloc(1024 * 1024 + 1))).status, 413);
  const r = await upload(raw,{"X-Order-Token":"",Authorization:"Bearer "+admin});
  assert.equal(r.status, 201, await r.text());
  assert.equal((await upload()).status, 200);
  assert.equal(
    (await upload(raw, { "X-Photo-Id": crypto.randomUUID() })).status,
    409,
  );
  const read = await fetch(base + photoPath, {
    headers: { "X-Order-Token": guest },
  });
  assert.equal(read.status, 200);
  assert.match(read.headers.get("cache-control")!, /no-store/);
  const output = Buffer.from(await read.arrayBuffer()),
    metadata = await sharp(output).metadata();
  assert.equal(metadata.exif, undefined);
  assert.ok(metadata.width! <= 1280);
  assert.equal(read.headers.get("content-type"), "image/jpeg");
  assert.equal(
    (
      await fetch(base + photoPath, {
        headers: { Authorization: "Bearer " + admin },
      })
    ).status,
    200,
  );
  const another = await call("/admin/simulation/purchases", "POST", {
    requestId: crypto.randomUUID(),
  });
  assert.equal(
    (
      await fetch(base + photoPath, {
        headers: { "X-Order-Token": another.guestAccessToken },
      })
    ).status,
    403,
  );
  const rows = await call("/admin/dispatch");
  const run = rows.orders.find((o: any) => o.id === order.id).dispatches[0];
  const simulation = await call("/simulation", "GET", undefined, "");
  const account = simulation.drivers[0];
  const login = await call(
    "/driver/auth/login",
    "POST",
    { email: account.email, password: account.password },
    "",
  );
  const driverPath = "/driver/dispatches/" + run.id + "/entrance-photo";
  assert.equal(
    (
      await fetch(base + driverPath, {
        headers: { Authorization: "Bearer " + login.token },
      })
    ).status,
    403,
  );
  await call("/operations/orders/" + order.id + "/status", "POST", {
    status: "EN_ALISTAMIENTO",
    shipmentId: run.shipmentId,
  });
  await call("/operations/orders/" + order.id + "/status", "POST", {
    status: "LISTO_PARA_DESPACHO",
    shipmentId: run.shipmentId,
  });
  await call("/admin/dispatch/" + run.id + "/search", "POST", {});
  const view = await call("/admin/dispatch");
  const offered = view.orders.find((o: any) => o.id === order.id).dispatches[0];
  const acceptedDriver = simulation.drivers.find(
    (d: any) =>
      d.id ===
      offered.offers.find((o: any) => o.status === "PENDING")?.driverId,
  );
  assert.ok(acceptedDriver, "eligible fixture driver receives offer");
  const acceptedLogin = await call(
    "/driver/auth/login",
    "POST",
    { email: acceptedDriver.email, password: acceptedDriver.password },
    "",
  );
  const offer = offered.offers.find((o: any) => o.status === "PENDING");
  await call(
    "/driver/assignments/" + run.id + "/accept",
    "POST",
    { offerId: offer.id },
    acceptedLogin.token,
  );
  assert.equal(
    (
      await fetch(base + driverPath, {
        headers: { Authorization: "Bearer " + acceptedLogin.token },
      })
    ).status,
    200,
  );
  const otherDriver = simulation.drivers.find(
    (d: any) => d.id !== acceptedDriver.id,
  );
  const otherLogin = await call(
    "/driver/auth/login",
    "POST",
    { email: otherDriver.email, password: otherDriver.password },
    "",
  );
  assert.equal(
    (
      await fetch(base + driverPath, {
        headers: { Authorization: "Bearer " + otherLogin.token },
      })
    ).status,
    403,
  );
  // Replay the purchase key, then verify photo retry does not reserve or charge again.
  const orderAfterAssignment = await call("/orders/" + order.id),
    catalogAfterAssignment = await call("/catalog");
  await call("/admin/simulation/purchases", "POST", { requestId });
  await upload();
  assert.deepEqual(await call("/catalog"), catalogAfterAssignment);
  const replayed = await call("/orders/" + order.id);
  for (const field of [
    "id",
    "purchaseCode",
    "items",
    "totals",
    "statusHistory",
    "fulfillmentStatus",
    "childShipments",
  ])
    assert.deepEqual(replayed[field], orderAfterAssignment[field], field);
  const realFetch = globalThis.fetch;
  let sessionSent = false,
    requestCount = 0;
  (globalThis as any).localStorage = { getItem: () => null, setItem: () => {} };
  api.saveOrderAccess(order.id, guest);
  globalThis.fetch = (async (input: any, init: any) => {
    requestCount++;
    sessionSent = new Headers(init?.headers).get("X-Order-Token") === guest;
    return realFetch(new URL(String(input), base), init);
  }) as any;
  try {
    await api.uploadEntrancePhoto(
      order.id,
      photoId,
      new Blob([raw], { type: "image/jpeg" }),
      photoDestinationKey(order.deliveryAddress),
    );
    assert.ok(sessionSent);
    assert.equal(requestCount, 1);
  } finally {
    globalThis.fetch = realFetch;
  }
  await stop();
  await start();
  admin=(await call("/auth/login","POST",info.admin,"")).token;
  assert.equal(
    (await fetch(base + photoPath, { headers: { "X-Order-Token": guest } }))
      .status,
    200,
  );
  assert.equal((await upload()).status, 200);
  assert.deepEqual(await call("/catalog"), catalogAfterAssignment);
  const after = await call("/orders/" + order.id);
  assert.equal(after.id, orderBefore.id);
  assert.deepEqual(after.items, orderBefore.items);
  assert.deepEqual(after.totals, orderBefore.totals);
  const closedFixture=await call('/admin/simulation/purchases','POST',{requestId:crypto.randomUUID()});
  const closedPhotoPath=base+'/orders/'+closedFixture.order.id+'/entrance-photo';
  const closedHeaders={'Content-Type':'image/jpeg','X-Order-Token':closedFixture.guestAccessToken,'X-Photo-Id':crypto.randomUUID(),'X-Photo-Destination':encodeURIComponent(photoDestinationKey(closedFixture.order.deliveryAddress))};
  assert.equal((await fetch(closedPhotoPath,{method:'PUT',headers:closedHeaders,body:raw})).status,201);
  for(const shipment of closedFixture.order.childShipments)await call('/orders/'+closedFixture.order.id+'/cancel','POST',{reason:'Fixture: cerrar prueba de fotografía',shipmentId:shipment.shipmentId});
  assert.equal((await call('/orders/'+closedFixture.order.id)).fulfillmentStatus,'CANCELADO');
  assert.equal((await fetch(closedPhotoPath,{headers:{'X-Order-Token':closedFixture.guestAccessToken}})).status,200);
  assert.equal((await fetch(closedPhotoPath,{method:'PUT',headers:closedHeaders,body:raw})).status,200,'same completed upload remains idempotent');
  for(const shipment of another.order.childShipments)await call('/orders/'+another.order.id+'/cancel','POST',{reason:'Fixture: cerrar sin foto',shipmentId:shipment.shipmentId});
  const closedUpload=await fetch(base+'/orders/'+another.order.id+'/entrance-photo',{method:'PUT',headers:{'Content-Type':'image/jpeg','X-Order-Token':another.guestAccessToken,'X-Photo-Id':crypto.randomUUID(),'X-Photo-Destination':encodeURIComponent(photoDestinationKey(another.order.deliveryAddress))},body:raw});
  assert.equal(closedUpload.status,409);assert.equal((await call('/orders/'+another.order.id)).fulfillmentStatus,'CANCELADO');
  console.log(
    "PASS HTTP entrance photo: real private access, invalid auth/destination/MIME/size, strip EXIF, assigned driver only, snapshot immutability, purchase/upload retry, unchanged inventory/charges, restart.",
  );
} finally {
  await stop();
  fs.rmSync(root, { recursive: true, force: true });
}
