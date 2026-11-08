/** Smoke the actual server and its legacy-route guards in an isolated working/data directory. */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import assert from "node:assert/strict";
import net from "node:net";
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
const child = spawn(
  process.execPath,
  ["--import", "tsx", path.join(source, "server.ts")],
  {
    cwd: root,
    env: {
      ...process.env,
      PORT: String(port),
      NODE_ENV: "production",
      BOLT_DATA_DIR: data,
      BOLT_ADMIN_EMAIL: "",
      BOLT_ADMIN_PASSWORD: "",
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
    "PASS actual server: 9 security, geography and no-write assertions; isolated process",
  );
} finally {
  child.kill("SIGTERM");
  await new Promise<void>((resolve) => child.once("exit", () => resolve()));
  fs.rmSync(root, { recursive: true, force: true });
}
