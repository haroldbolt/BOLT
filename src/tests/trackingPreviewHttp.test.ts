/** Real HTTP walkthrough in a throwaway runtime with no production services. */
import assert from "node:assert/strict";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

const source = process.cwd();
const root = path.join(os.tmpdir(), "bolt-dispatch-simulation-" + crypto.randomUUID());
const clockFile = path.join(root, "fixture-time.txt");
let child: ChildProcess | undefined;
let childOutput = "";
try {
  execFileSync(process.execPath, ["--import", "tsx", "src/tests/createIntegrationReview.ts", root], { cwd: source });
  const listener = net.createServer();
  listener.listen(0, "127.0.0.1");
  await once(listener, "listening");
  const port = (listener.address() as net.AddressInfo).port;
  await new Promise<void>(resolve => listener.close(() => resolve()));

  // Advance server wall time on demand so the real timer pulse can be tested quickly.
  const clock = path.join(root, "fixture-clock.mjs");
  fs.writeFileSync(clockFile, "0");
  fs.writeFileSync(clock, `import fs from 'node:fs'; const now = Date.now; Date.now = () => now() + Number(fs.readFileSync(${JSON.stringify(clockFile)}, 'utf8'));`);
  child = spawn(process.execPath, ["--import", clock, "--import", "tsx", "server.ts"], {
    cwd: root,
    env: {
      ...process.env, NODE_ENV: "production", PORT: String(port),
      BOLT_DISPATCH_SIMULATION: "1", BOLT_DATA_DIR: path.join(root, ".bolt-private/orders"),
      BOLT_ADMIN_EMAIL: "", BOLT_ADMIN_PASSWORD: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout!.on("data", value => { childOutput += value; });
  child.stderr!.on("data", value => { childOutput += value; });
  const base = `http://127.0.0.1:${port}/api/v1`;
  async function call(route: string, options: { body?: object; admin?: string; guest?: string; status?: number } = {}) {
    const result = await fetch(base + route, {
      method: options.body === undefined ? "GET" : "POST",
      headers: {
        "Content-Type": "application/json",
        ...(options.admin ? { Authorization: "Bearer " + options.admin } : {}),
        ...(options.guest ? { "X-Order-Token": options.guest } : {}),
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    assert.equal(result.status, options.status ?? 200, route);
    return result.json();
  }
  let info: any;
  for (let attempt = 0; attempt < 80; attempt++) {
    if (child.exitCode !== null) throw Error("Simulation failed to start.");
    try { info = await call("/simulation"); break; } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(info?.enabled);
  const { token: admin } = await call("/auth/login", { body: info.admin });
  const route = "/admin/simulation/tracking-preview";
  const requestId = crypto.randomUUID();
  await call(route, { body: { requestId }, status: 401 });
  const before = await call("/admin/simulation", { admin });
  const first = await call(route, { body: { requestId }, admin });
  const retry = await call(route, { body: { requestId }, admin });
  const shared = await call(route, { body: { requestId: crypto.randomUUID() }, admin });
  assert.match(first.order.id, /^SIM-TRACK-/);
  assert.equal(first.order.id, retry.order.id);
  assert.equal(first.order.id, shared.order.id);
  assert.equal(first.order.fulfillmentStatus, "EN_CAMINO");
  assert.equal(first.order.payment.cashToCollect, 0);
  const after = await call("/admin/simulation", { admin });
  assert.equal(after.orders.length, before.orders.length + 1);
  assert.notEqual(first.order.driver.id, info.drivers[0].id, "the historical out-for-delivery fixture keeps its driver");
  assert.deepEqual(after.provider.requests, before.provider.requests);
  const orderRoute = "/orders/" + first.order.id + "/tracking";
  await call(orderRoute, { status: 403 });
  const guest = first.guestAccessToken;
  const snapshot = await call(orderRoute, { guest });
  assert.equal(snapshot.simulation, true);
  assert.equal(snapshot.status, "EN_CAMINO");
  assert.equal(snapshot.timing.source, "VERIFIED_QUOTE");
  assert.equal(Date.parse(snapshot.timing.dueAt) - Date.parse(snapshot.timing.startedAt), 240_000);
  assert.equal(snapshot.locationStatus, "LIVE");
  assert.ok(snapshot.telemetry);
  const statusStorage = path.join(root, ".bolt-private/orders/persisted-fulfillment.json");
  const beforeRead = fs.readFileSync(statusStorage, "utf8");
  await call(orderRoute, { guest });
  assert.equal(fs.readFileSync(statusStorage, "utf8"), beforeRead, "GET must not write");

  const initial = snapshot.telemetry.timestamp;
  let newer: typeof snapshot | undefined;
  for (let attempt = 0; attempt < 30; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 350));
    newer = await call(orderRoute, { guest });
    if (newer.telemetry?.timestamp > initial) break;
  }
  assert.ok(newer.telemetry?.timestamp > initial);
  assert.notEqual(newer.telemetry.latitude, snapshot.telemetry.latitude);
  assert.ok(newer.trail?.coordinates.length >= 2);
  fs.writeFileSync(clockFile, "250000");
  let finished: typeof snapshot | undefined;
  for (let attempt = 0; attempt < 30; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 350));
    finished = await call(orderRoute, { guest });
    if (finished.status === "ENTREGADO") break;
  }
  assert.equal(finished?.status, "ENTREGADO");
  assert.equal(finished?.telemetry, null);
  const newOrder = await call(route, { body: { requestId: crypto.randomUUID() }, admin });
  assert.notEqual(newOrder.order.id, first.order.id);
  assert.equal(newOrder.order.fulfillmentStatus, "EN_CAMINO");
  console.log("PASS hosted tracking walkthrough: isolated private SIM order, authoritative countdown, sequenced GPS, no writes on refresh, no charge, release and repeat");
} catch (error) {
  console.error(childOutput.slice(-4000));
  throw error;
} finally {
  if (child && child.exitCode === null) {
    const exit = once(child, "exit");
    child.kill("SIGTERM");
    await exit;
  }
  fs.rmSync(root, { recursive: true, force: true });
}
