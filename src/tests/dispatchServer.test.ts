/** Smoke the actual server and its legacy-route guards in an isolated working/data directory. */
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import assert from "node:assert/strict";
import net from "node:net";
import addressFixtures from "./coverage-address-fixtures.json";
const source = process.cwd(),
  root = fs.mkdtempSync(path.join(os.tmpdir(), "bolt-dispatch-http-"));
fs.cpSync(path.join(source, "src/data"), path.join(root, "src/data"), {
  recursive: true,
  filter: (p) =>
    !path.basename(p).startsWith("persisted-") &&
    !path.basename(p).startsWith("tmp-"),
});
fs.symlinkSync(
  fs.realpathSync(path.join(source, "node_modules")),
  path.join(root, "node_modules"),
  "dir",
);
const data = path.join(root, "orders");
fs.mkdirSync(data);
fs.writeFileSync(path.join(data, "persisted-orders.json"), "[]");
fs.writeFileSync(path.join(data, "persisted-drivers.json"), "[]");
fs.mkdirSync(path.join(root, "dist"));
fs.writeFileSync(
  path.join(root, "dist/index.html"),
  "<title>Isolated backend test</title>",
);
const socket = net.createServer();
await new Promise<void>((resolve) => socket.listen(0, "127.0.0.1", resolve));
const port = (socket.address() as net.AddressInfo).port;
await new Promise<void>((resolve) => socket.close(() => resolve()));
const setupKey = randomUUID();
const child = spawn(
  process.execPath,
  ["--import", "tsx", "--import", path.join(source, "src/tests/geocodingHttpProvider.mjs"), path.join(source, "server.ts")],
  {
    cwd: root,
    env: {
      ...process.env,
      PORT: String(port),
      NODE_ENV: "production",
      BOLT_DATA_DIR: data,
      BOLT_ADMIN_EMAIL: "",
      BOLT_ADMIN_PASSWORD: "",
      BOLT_ADMIN_SETUP_TOKEN: setupKey,
      GOOGLE_MAPS_SERVER_API_KEY: "fixture-server-geocode",
    },
    stdio: ["ignore", "pipe", "pipe"],
  },
);
let output = "";
child.stdout.on("data", (b) => {
  output += b;
});
child.stderr.on("data", (b) => {
  output += b;
});
const base = `http://127.0.0.1:${port}`,
  call = (p: string, method = "GET", body?: any, headers: any = {}) =>
    fetch(base + "/api/v1" + p, {
      method,
      headers: { "Content-Type": "application/json", ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
try {
  let ready = false;
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null) throw Error("Server failed: " + output);
    try {
      ready = (await call("/health")).ok;
      if (ready) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  assert(ready, "Server startup");
  const absent = await call("/no-such-operation");
  assert.equal(absent.status, 404);
  assert.equal((await absent.json()).requestId, absent.headers.get("x-request-id"));
  const invalid = await fetch(base + "/api/v1/delivery/quote", {method:"POST", headers:{"Content-Type":"application/json"}, body:"{"});
  assert.equal(invalid.status, 400);
  assert.equal((await invalid.json()).code, "INVALID_REQUEST");
  const publicHealth = await (await call("/health")).json();
  assert.equal(publicHealth.privateInventory, undefined);
  assert.equal(publicHealth.operations, undefined);
  assert.equal((await call("/admin/observability")).status, 401);
  assert.equal((await call("/inventory/status")).status, 401);
  assert.equal((await call("/shopify/status")).status, 401);
  const publicCatalog = await (await call("/catalog?all=true")).json();
  assert.ok(publicCatalog.length);
  assert.ok(publicCatalog.every((p: { status?: string }) => !p.status || p.status === "ACTIVE"));
  assert.equal((await call("/orders")).status, 401);
  assert.equal((await call("/orders/KNOWN-ID")).status, 403);
  assert.equal(
    (
      await call("/driver/profile", "GET", undefined, {
        "x-driver-id": "DRV-CARLOS-01",
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await call(
        "/operations/orders/KNOWN-ID/status",
        "POST",
        { status: "ENTREGADO", role: "ADMINISTRADOR" },
        { "x-actor-role": "ADMINISTRADOR" },
      )
    ).status,
    401,
  );
  assert.equal(
    (
      await call("/stores/HUB_SUBA/verify-entrance", "POST", {
        coordinates: { lat: 1, lng: 1 },
      })
    ).status,
    401,
  );
  assert.equal((await call("/orders", "POST", {})).status, 400);
  const master = await call("/auth/setup-admin", "POST", {
    email: "coordination@example.invalid", password: randomUUID(), name: "Coordinación de prueba",
  }, { "X-Bolt-Admin-Setup-Token": setupKey });
  assert.equal(master.status, 201);
  const coordinator = { Authorization: "Bearer " + (await master.json()).token };
  const credentials = { email: "operator@example.invalid", password: randomUUID(), name: "Operación de prueba", storeId: "HUB_SUBA" };
  assert.equal((await call("/admin/store-operators", "POST", credentials)).status, 401);
  assert.equal((await call("/admin/store-operators", "POST", { ...credentials, storeId: "UNKNOWN" }, coordinator)).status, 400);
  const created = await call("/admin/store-operators", "POST", credentials, coordinator);
  assert.equal(created.status, 201);
  const { id } = await created.json();
  const signedIn = await call("/auth/login", "POST", credentials);
  const operator = { Authorization: "Bearer " + (await signedIn.json()).token };
  assert.equal((await call("/admin/observability", "GET", undefined, operator)).status, 403);
  const metrics = await call("/admin/observability", "GET", undefined, coordinator);
  assert.equal(metrics.status, 200);
  assert.match(metrics.headers.get("cache-control") || "", /no-store/);
  const view = await metrics.json();
  assert.ok(view.service.http.completed > 0);
  assert.ok(view.operations);
  assert.ok(!JSON.stringify(view).includes(credentials.email));
  assert.deepEqual(view.service.geocoding, {configured:true, forward:null, reverse:null});
  const {address, coordinates} = addressFixtures[0];
  const reversePath = "/geocode/reverse?lat=" + coordinates.lat + "&lng=" + coordinates.lng;
  const rejected = await call(reversePath);
  assert.equal(rejected.status, 503);
  assert.doesNotMatch(await rejected.text(), /REQUEST_DENIED|PRIVATE_PROVIDER_DETAIL|fixture-server-geocode/);
  assert.equal((await call(reversePath)).status, 404);
  const success = await call(reversePath);
  assert.equal(success.status, 200);
  assert.equal((await success.json()).address, addressFixtures[0].formattedAddress);
  const forward = await call("/geocode/forward?" + new URLSearchParams({address,municipality:"Bogotá"}));
  assert.equal(forward.status, 200);
  assert.equal((await forward.json()).status, "UNAVAILABLE");
  const diagnostics = (await (await call("/admin/observability", "GET", undefined, coordinator)).json()).service.geocoding;
  assert.equal(diagnostics.reverse.outcome, "OK");
  assert.equal(diagnostics.forward.outcome, "QUOTA");
  assert.doesNotMatch(JSON.stringify(diagnostics), /PRIVATE_PROVIDER_DETAIL|fixture-server-geocode|Cedritos/);
  assert.equal(publicHealth.geocoding, undefined);
  const profile = await (await call("/bolt-admin/session", "GET", undefined, operator)).json();
  assert.deepEqual(profile.actor.storeIds, ["HUB_SUBA"]);
  assert.equal(profile.actor.canAdjustPrices, false);
  assert.equal((await call("/bolt-admin/orders?storeId=HUB_SUBA", "GET", undefined, operator)).status, 200);
  assert.equal((await call("/bolt-admin/orders?storeId=HUB_KENNEDY", "GET", undefined, operator)).status, 403);
  assert.equal((await call("/bolt-admin/inventory?storeId=HUB_ALAMOS", "GET", undefined, operator)).status, 403);
  for (const route of ["/orders", "/orders/PRIVATE-ID/tracking", "/orders/PRIVATE-ID/entrance-photo", "/admin/dispatch", "/inventory/status", "/shopify/status"]) {
    assert.equal((await call(route, "GET", undefined, operator)).status, 403);
  }
  assert.equal((await call("/admin/store-operators", "POST", credentials, operator)).status, 403);
  assert.equal((await call("/shopify/status", "GET", undefined, coordinator)).status, 200);
  assert.equal((await call("/admin/store-operators/" + id, "DELETE", undefined, coordinator)).status, 204);
  assert.equal((await call("/bolt-admin/orders", "GET", undefined, operator)).status, 401);
  assert.equal((await call("/auth/login", "POST", credentials)).status, 401);
  const q = await (
    await call("/delivery/quote", "POST", {
      destination: {
        address: "Carrera 5 #12-14, Cota, Cundinamarca",
        coordinates: { lat: 4.809501, lng: -74.101627 },
        municipality: "Bogotá",
      },
      items: [],
    })
  ).json();
  assert.equal(q.eligibilityStatus, "OUT_OF_COVERAGE");
  assert.deepEqual(
    JSON.parse(
      fs.readFileSync(path.join(data, "persisted-orders.json"), "utf8"),
    ),
    [],
  );
  assert(
    !fs.existsSync(path.join(data, "persisted-fulfillment.json")),
    "Read-only requests cannot migrate/create dispatches",
  );
  console.log(
    "PASS actual server: public catalog and private data isolation, geography and no-write assertions; isolated process",
  );
} finally {
  child.kill("SIGTERM");
  await new Promise<void>((resolve) => child.once("exit", () => resolve()));
  fs.rmSync(root, { recursive: true, force: true });
}
