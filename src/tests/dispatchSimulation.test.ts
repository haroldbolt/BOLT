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
  assert.equal(
    (
      await fetch(base + "/simulation", {
        headers: { Origin: "https://untrusted.example" },
      })
    ).status,
    403,
  );
  await call("/admin/simulation/fleet", "POST", { count: 2 });
  const requestId = crypto.randomUUID(),
    created = await call("/admin/simulation/purchases", "POST", { requestId });
  const order = created.order;
  guest = created.guestAccessToken;
  const retry = await call("/admin/simulation/purchases", "POST", {
    requestId,
  });
  assert.equal(retry.order.id, order.id);
  assert.equal((await call("/admin/simulation")).orders.length, 1);
  assert.deepEqual(
    order.childShipments.map((s: any) =>
      s.items.reduce((n: number, i: any) => n + i.quantity, 0),
    ),
    [2, 1],
  );
  const tokens = await Promise.all(
    info.drivers.map(
      async (d: any) => (await call("/driver/auth/login", "POST", d, "")).token,
    ),
  );
  for (const s of order.childShipments) {
    await call("/operations/orders/" + order.id + "/status", "POST", {
      status: "EN_ALISTAMIENTO",
      shipmentId: s.shipmentId,
    });
    await call("/operations/orders/" + order.id + "/status", "POST", {
      status: "LISTO_PARA_DESPACHO",
      shipmentId: s.shipmentId,
    });
  }
  let view = await call("/admin/dispatch");
  for (const d of view.orders[0].dispatches)
    await call("/admin/dispatch/" + d.id + "/search", "POST");
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    const tasks = await call("/driver/assignments", "GET", undefined, token);
    assert.equal(tasks.assignments.length, 1);
    const task = tasks.assignments[0];
    assert(!JSON.stringify(task).includes("secretDeliveryCode"));
    await call(
      "/driver/assignments/" + task.assignmentId + "/accept",
      "POST",
      { offerId: task.offer.id },
      tokens[1 - index],
      403,
    );
    await call(
      "/driver/assignments/" + task.assignmentId + "/accept",
      "POST",
      { offerId: task.offer.id },
      token,
    );
    await call(
      "/driver/assignments/" + task.assignmentId + "/accept",
      "POST",
      { offerId: task.offer.id },
      token,
    );
    await call(
      "/driver/assignments/" + task.assignmentId + "/arrived-hub",
      "POST",
      {},
      token,
    );
    await call(
      "/driver/assignments/" + task.assignmentId + "/pickup",
      "POST",
      { sellablePackages: task.sellablePackages },
      token,
    );
    await call("/driver/simulation/location", "POST", {}, token);
    const tracking = await call(
      "/orders/" + order.id + "/tracking?shipmentId=" + task.shipmentId,
      "GET",
      undefined,
      "",
    );
    assert(tracking.telemetry);
    const own = await call("/orders/" + order.id, "GET", undefined, "");
    const pin = own.childShipments.find(
      (s: any) => s.shipmentId === task.shipmentId,
    ).secretDeliveryCode;
    await call(
      "/driver/assignments/" + task.assignmentId + "/delivered",
      "POST",
      { deliveryCode: pin, collectedCOP: 0 },
      token,
    );
    const after = await call("/orders/" + order.id, "GET", undefined, "");
    if (index === 0) assert.notEqual(after.fulfillmentStatus, "ENTREGADO");
    else assert.equal(after.fulfillmentStatus, "ENTREGADO");
  }
  const before = await call("/admin/dispatch");
  await stop();
  await start();
  admin = (await call("/auth/login", "POST", info.admin, "")).token;
  const afterRestart = await call("/orders/" + order.id, "GET", undefined, "");
  assert.equal(afterRestart.fulfillmentStatus, "ENTREGADO");
  assert.equal(afterRestart.purchaseCode, order.purchaseCode);
  assert.equal(
    (await call("/admin/dispatch")).orders.length,
    before.orders.length,
  );
  // External outcome unknown is retained, then accepted exactly once after reconciliation.
  await call("/admin/simulation/fleet", "POST", { count: 0 });
  await call("/admin/simulation/provider", "POST", {
    enabled: true,
    mode: "DELAY",
  });
  const ext = await call("/admin/simulation/purchases", "POST", {
    requestId: crypto.randomUUID(),
  });
  for (const s of ext.order.childShipments) {
    await call("/operations/orders/" + ext.order.id + "/status", "POST", {
      status: "EN_ALISTAMIENTO",
      shipmentId: s.shipmentId,
    });
    await call("/operations/orders/" + ext.order.id + "/status", "POST", {
      status: "LISTO_PARA_DESPACHO",
      shipmentId: s.shipmentId,
    });
  }
  view = await call("/admin/dispatch");
  const extOrder = view.orders.find((o: any) => o.id === ext.order.id);
  for (const d of extOrder.dispatches)
    await call("/admin/dispatch/" + d.id + "/search", "POST");
  view = await call("/admin/dispatch");
  const runs = view.orders.find((o: any) => o.id === ext.order.id).dispatches;
  assert(runs.every((r: any) => r.external.status === "UNKNOWN"));
  const key = runs[0].external.key;
  await call("/admin/simulation/resolve", "POST", { key, accept: true });
  await call("/admin/simulation/resolve", "POST", {
    key: runs[1].external.key,
    accept: false,
  });
  view = await call("/admin/dispatch");
  assert.equal(
    view.orders.find((o: any) => o.id === ext.order.id).dispatches[0].status,
    "ASSIGNED",
  );
  assert.equal(
    Object.keys((await call("/admin/simulation")).provider.requests).length,
    2,
  );
  console.log(
    "PASS isolated simulator HTTP: grouped purchase/idempotency, authenticated roles, cross-driver denial, pickup/GPS/PIN, partial/full completion, restart, delayed external acceptance and rejection, origin guard",
  );
} catch (e) {
  console.error(output.slice(-2000));
  throw e;
} finally {
  await stop();
  fs.rmSync(root, { recursive: true, force: true });
}
