/** Creates a fresh isolated runtime; never copies customer, admin, inventory or order persistence. */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {
  fixtureProduct,
  fixtureDrivers,
  fixtureConfig,
} from "../src/tests/transportFixtures";
const source = process.cwd();
const dest = path.resolve(
  process.argv[2] ||
    path.join(source, "..", "bolt-dispatch-simulation-" + Date.now()),
);
if (
  fs.existsSync(dest) ||
  !path.basename(dest).startsWith("bolt-dispatch-simulation-") ||
  dest.startsWith(source + path.sep)
)
  throw Error(
    "Choose a new sibling directory named bolt-dispatch-simulation-*",
  );
fs.cpSync(source, dest, {
  recursive: true,
  filter: (p) => {
    const rel = path.relative(source, p),
      base = path.basename(p);
    return (
      !rel
        .split(path.sep)
        .some((s) =>
          ["node_modules", ".git", ".bolt-private", "dist"].includes(s),
        ) &&
      !base.startsWith("persisted-") &&
      !base.startsWith(".env") &&
      !base.startsWith("tmp-") &&
      !["server.js"].includes(base)
    );
  },
});
fs.symlinkSync(
  fs.realpathSync(path.join(source, "node_modules")),
  path.join(dest, "node_modules"),
  "dir",
);
if (fs.existsSync(path.join(source, "dist")))
  fs.cpSync(path.join(source, "dist"), path.join(dest, "dist"), {
    recursive: true,
  });
const priv = path.join(dest, ".bolt-private"),
  data = path.join(priv, "orders");
fs.mkdirSync(data, { recursive: true });
for (const name of ["orders", "drivers", "audit", "telemetry"])
  fs.writeFileSync(path.join(data, `persisted-${name}.json`), "[]");
const p = fixtureProduct("SIM-FOOD-20KG", 20000);
p.name = "Alimento de prueba — SIMULACIÓN";
p.stockByStore = { HUB_SUBA: 1000 };
// CatalogRepository overrides are an ID map, in the same shape used by the existing administrator.
fs.writeFileSync(
  path.join(dest, "src/data/persisted-catalog-overrides.json"),
  JSON.stringify({ version: 1, overrides: {}, customProducts: [p] }),
);
const drivers = fixtureDrivers.filter((d) => d.id.includes("SUBA")).slice(0, 2),
  config = fixtureConfig();
config.maxDispatches = null;
config.vehicles = config.vehicles.filter((v) =>
  drivers.some((d) => d.id === v.driverId),
);
fs.writeFileSync(
  path.join(priv, "transport-config.json"),
  JSON.stringify({ config, revision: "simulation-fixture", audit: [] }),
);
const admin = {
  email: "admin@simulation.test",
  password: "Sim-" + crypto.randomBytes(12).toString("hex"),
};
fs.writeFileSync(
  path.join(priv, "dispatch-simulation.json"),
  JSON.stringify({
    version: 1,
    kind: "DISPATCH_SIMULATION",
    admin,
    drivers: drivers.map((driver, i) => ({
      driver,
      email: `conductor${i + 1}@simulation.test`,
      password: "Sim-" + crypto.randomBytes(12).toString("hex"),
      storeIds: ["HUB_SUBA"],
    })),
  }),
  { mode: 0o600 },
);
console.log(
  JSON.stringify({
    directory: dest,
    data,
    command:
      "BOLT_DISPATCH_SIMULATION=1 BOLT_DATA_DIR=" +
      data +
      " NODE_ENV=production PORT=3030 node --import tsx server.ts",
  }),
);
