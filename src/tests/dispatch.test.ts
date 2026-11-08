/** Completely isolated fleet, orders, auth, vehicles and provider fixtures. No production writes. */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { INITIAL_ORDERS, INITIAL_STORES } from "../data/seedData";
import {
  fixtureProduct,
  fixtureConfig,
  fixtureDrivers,
} from "./transportFixtures";
import {
  SimulatedDispatchProvider,
  type ProviderQuote,
} from "../lib/dispatchProviders";
import type { Order } from "../types";
const root = fs.mkdtempSync(path.join(os.tmpdir(), "bolt-dispatch-"));
process.env.BOLT_DATA_DIR = path.join(root, "singleton");
const { OrdersRepository } = await import("../lib/ordersRepository");
const { DispatchService } = await import("../lib/dispatchService");
let n = 0;
const tests: Array<[string, () => any]> = [];
const test = (name: string, fn: () => any) => tests.push([name, fn]);
function setup(
  options: {
    providers?: any[];
    simulation?: boolean;
    routeEstimate?: any;
  } = {},
) {
  const dir = path.join(root, String(++n));
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, "persisted-orders.json"), "[]");
  fs.writeFileSync(
    path.join(dir, "persisted-drivers.json"),
    JSON.stringify(
      fixtureDrivers.map((d) => ({
        ...d,
        currentLocation: {
          lat: 0,
          lng: 0,
          updatedAt: new Date(0).toISOString(),
        },
      })),
    ),
  );
  const repo = new OrdersRepository({ dataDir: dir });
  let now = Date.parse("2026-11-07T15:00:00Z");
  const product = fixtureProduct("test-food", 20000),
    config = fixtureConfig();
  config.maxDispatches = null;
  const store = INITIAL_STORES.find((s) => s.id === "HUB_SUBA")!;
  const service = new DispatchService({
    repo,
    stores: () => INITIAL_STORES,
    products: () => [product],
    transport: () => config,
    now: () => now,
    ...options,
  });
  const ids = fixtureDrivers
    .filter((d) => d.id.includes("SUBA"))
    .map((d) => d.id);
  function provision(id = ids[0], offset = 0) {
    service.provision(
      {
        driver: repo.getDriverById(id)!,
        email: id + "@fixture.test",
        password: "Fixture-only-Password!",
        storeIds: ["HUB_SUBA"],
      },
      "fixture-admin",
    );
    assert.equal(service.profile(id).location,undefined,"No GPS sample must be shown as a pending location, not epoch coordinates");
    service.shift(id, "START");
    service.location(id, {
      latitude: store.coordinates.lat + offset,
      longitude: store.coordinates.lng,
      accuracy: 5,
      timestamp: now,
    });
    return id;
  }
  function order(count = 1, cash = false): Order {
    const base = structuredClone(INITIAL_ORDERS[0]);
    const id = "TEST-" + crypto.randomUUID(),
      item = {
        productId: product.id,
        sku: product.sku,
        name: product.name,
        brand: "TEST",
        presentation: "20kg",
        price: 10000,
        quantity: 1,
        image: "",
        weightKg: 20,
        requiresPrescription: false,
      };
    Object.assign(base, {
      id,
      creationRequestId: crypto.randomUUID(),
      creationRequestFingerprint: "fixture",
      purchaseCode: undefined,
      assignmentId: undefined,
      tripId: undefined,
      storeId: "HUB_SUBA",
      driver: undefined,
      transportLoad: undefined,
      fulfillmentStatus: "LISTO_PARA_DESPACHO",
      items: [{ ...item, quantity: count }],
      isSplitOrder: count > 1,
      deliveryMode: "TURBO",
      scheduledWindow: undefined,
      secretDeliveryCode: "1234",
      statusHistory: [],
      timestamps: {},
      createdAt: new Date(now).toISOString(),
      originalPromiseWindow: {
        start: new Date(now).toISOString(),
        end: new Date(now + 3600_000).toISOString(),
      },
      totals: {
        subtotal: count * 10000,
        shipping: 10000,
        serviceFee: 0,
        tip: 0,
        discount: 0,
        total: count * 10000 + 10000,
        totalWeightKg: count * 20,
      },
      payment: {
        method: cash ? "CASH_ON_DELIVERY" : "CARD",
        status: cash ? "PENDIENTE" : "APROBADO",
        cashToCollect: cash ? count * 10000 + 10000 : 0,
      },
    });
    base.childShipments =
      count > 1
        ? Array.from({ length: count }, (_, i) => ({
            shipmentId: id + "-S" + i,
            shipmentIndex: i + 1,
            shipmentCount: count,
            parentOrderId: id,
            storeId: "HUB_SUBA",
            items: [{ ...item }],
            weightKg: 20,
            weightGrams: 20000,
            subtotal: 10000,
            cashToCollect: 0,
            fulfillmentStatus: "LISTO_PARA_DESPACHO",
            secretDeliveryCode: String(1234 + i),
            estimatedDeliveryMinutes: 10,
            timestamps: {},
          }))
        : undefined;
    assert.equal(service.createOrder(base, [product], store).success, true);
    return repo.getOrderById(id)!;
  }
  function runs(o: Order) {
    return Object.values(repo.dispatchState.runs).filter(
      (r) => r.orderId === o.id,
    );
  }
  return {
    repo,
    service,
    config,
    product,
    store,
    ids,
    dir,
    provision,
    order,
    runs,
    now: () => now,
    advance: (ms: number) => {
      now += ms;
    },
    restart: () => new OrdersRepository({ dataDir: dir }),
  };
}
test("Closest eligible driver is measured to pickup warehouse, stable codes and no early driver disclosure", async () => {
  const x = setup();
  x.provision(x.ids[0], 0.02);
  x.provision(x.ids[1], 0.001);
  const o = x.order(),
    r = x.runs(o)[0];
  assert.match(o.purchaseCode!, /^BP-\d{6}$/);
  assert.equal(r.code, o.purchaseCode + "-E01");
  await x.service.search(r.id);
  assert.equal(x.repo.dispatchState.offers[r.offerId!].driverId, x.ids[1]);
  assert.equal(r.estimate?.kind, "GEOGRAPHIC");
  assert.equal(r.estimate?.seconds, undefined);
  assert.equal(o.driver, undefined);
  assert.equal(x.service.customerDispatches(o.id)[0].driverConfirmed, false);
});
test("Route ETA overrides geographic distance; stale routes fall back explicitly", async () => {
  const x = setup({
    routeEstimate: async (d: any) => ({
      kind: "ROUTE",
      meters: 1000,
      seconds: d.id.endsWith("1") ? 80 : 20,
      source: "TEST_ROUTE",
      observedAt: Date.parse("2026-11-07T15:00:00Z"),
    }),
  });
  x.provision(x.ids[0], 0);
  x.provision(x.ids[1], 0.02);
  const r = x.runs(x.order())[0];
  await x.service.search(r.id);
  assert.equal(x.repo.dispatchState.offers[r.offerId!].driverId, x.ids[1]);
  assert.equal(r.estimate!.seconds, 20);
});
test("Closer incompatible, unavailable and stale drivers are excluded", async () => {
  const x = setup();
  x.provision(x.ids[0], 0);
  x.provision(x.ids[1], 0.01);
  x.config.vehicles.find((v) => v.driverId === x.ids[0])!.maxLoadGrams = 10000;
  const r = x.runs(x.order())[0];
  await x.service.search(r.id);
  assert.equal(x.repo.dispatchState.offers[r.offerId!].driverId, x.ids[1]);
  const y = setup();
  y.provision();
  y.advance(100_000);
  const r2 = y.runs(y.order())[0];
  await y.service.search(r2.id);
  assert.equal(r2.offerId, undefined);
  assert.equal(r2.reason, "NO_ELIGIBLE_CAPACITY");
});
test("Reject and expiry seek next eligible candidate; bounded search does not promise Turbo forever", async () => {
  const x = setup();
  x.provision(x.ids[0]);
  x.provision(x.ids[1], 0.001);
  const r = x.runs(x.order())[0];
  await x.service.search(r.id);
  x.service.respond(x.ids[0], r.offerId!, "reject");
  await x.service.search(r.id);
  assert.equal(x.repo.dispatchState.offers[r.offerId!].driverId, x.ids[1]);
  x.advance(31_000);
  await x.service.tick();
  assert.equal(
    Object.values(x.repo.dispatchState.offers).filter(
      (o) => o.status === "EXPIRED",
    ).length,
    1,
  );
  x.advance(180_000);
  await x.service.tick();
  assert.equal(r.status, "SEARCH_EXHAUSTED");
  assert.equal(x.service.metrics().failedSearches, 1);
});
test("Concurrent acceptance and retry cannot duplicate assignments, codes or reserves", async () => {
  const x = setup();
  x.provision();
  x.provision(x.ids[1]);
  const o = x.order(),
    r = x.runs(o)[0];
  await Promise.all([x.service.search(r.id), x.service.search(r.id)]);
  const offer = x.repo.dispatchState.offers[r.offerId!];
  const results = await Promise.allSettled([
    Promise.resolve().then(() =>
      x.service.respond(offer.driverId, offer.id, "accept"),
    ),
    Promise.resolve().then(() =>
      x.service.respond(x.ids[1], offer.id, "accept"),
    ),
    Promise.resolve().then(() =>
      x.service.respond(offer.driverId, offer.id, "accept"),
    ),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 2);
  assert.equal(Object.keys(x.repo.dispatchState.offers).length, 1);
  assert.equal(x.service.metrics().assigned, 1);
  assert.equal(x.repo.getOrderById(o.id)!.driver!.id, offer.driverId);
  assert.equal(
    x.service.createOrder(o, [x.product], x.store).order!.purchaseCode,
    o.purchaseCode,
  );
  assert.equal(x.product.reservedStockByStore.HUB_SUBA, 1);
  assert.equal(
    x.service.adminView().events.filter((e) => e.type === "DISPATCH_ASSIGNED")
      .length,
    1,
  );
});
test("Authentication, privacy, assignment ownership and PIN attempt limit", async () => {
  const x = setup();
  x.provision();
  x.provision(x.ids[1]);
  assert.equal(
    x.service.login(x.ids[0] + "@fixture.test", "wrong").status,
    401,
  );
  const login = x.service.login(
    x.ids[0] + "@fixture.test",
    "Fixture-only-Password!",
  );
  assert.equal(x.service.authenticate(login.token), x.ids[0]);
  assert.equal(x.service.authenticate(x.ids[0]), null);
  const o = x.order(),
    r = x.runs(o)[0];
  assert.equal(x.service.authorizeGuest(o.id, o.purchaseCode), false);
  assert.equal(x.service.authorizeGuest(o.id, x.service.guestToken(o)), true);
  await x.service.search(r.id);
  x.service.respond(x.ids[0], r.offerId!, "accept");
  assert.throws(() => x.service.driverDispatch(r, x.ids[1]));
  const dto = JSON.stringify(x.service.driverDispatch(r, x.ids[0]));
  assert(!dto.includes("1234"));
  assert(!dto.includes("secretDeliveryCode"));
  assert.throws(() => x.service.pickup(x.ids[1], r.id, 1));
  x.service.pickup(x.ids[0], r.id, 1);
  for (let i = 0; i < 5; i++)
    assert.throws(() => x.service.deliver(x.ids[0], r.id, "0000", 0));
  assert.throws(() => x.service.deliver(x.ids[0], r.id, "1234", 0));
  assert(
    x.repo.dispatchState.events.every(
      (e) => e.detail !== "0000" && !("deliveryCode" in e),
    ),
  );
});
test("Grouped dispatches, independent PINs, partial completion, cash exactly once and warehouse wait metrics", async () => {
  const x = setup();
  x.provision();
  x.provision(x.ids[1], 0.001);
  const o = x.order(2, true),
    [a, b] = x.runs(o);
  assert.equal(a.cashDue + b.cashDue, o.totals.total);
  for (const r of [a, b]) {
    await x.service.search(r.id);
    const offer = x.repo.dispatchState.offers[r.offerId!];
    x.service.respond(offer.driverId, offer.id, "accept");
    x.service.arrived(offer.driverId, r.id);
    x.advance(2000);
    x.service.pickup(offer.driverId, r.id, 1);
  }
  x.service.deliver(a.driverId!, a.id, "1234", a.cashDue);
  assert.notEqual(o.fulfillmentStatus, "ENTREGADO");
  const balance = x.repo.getDriverById(a.driverId!)!.cashBalance;
  x.service.deliver(a.driverId!, a.id, "1234", a.cashDue);
  assert.equal(x.repo.getDriverById(a.driverId!)!.cashBalance, balance);
  assert.throws(() =>
    x.service.deliver(b.driverId!, b.id, "1235", o.totals.total),
  );
  x.service.deliver(b.driverId!, b.id, "1235", b.cashDue);
  assert.equal(o.fulfillmentStatus, "ENTREGADO");
  assert.equal(o.payment.cashToCollect, 0);
  assert.equal(o.payment.cashSettled, false);
  assert.equal(x.service.metrics().averageWarehouseWaitSeconds, 2);
});
test("Restart persists assignments, sessions, codes, cash and offers; transactions roll back", async () => {
  const x = setup();
  x.provision();
  const o = x.order(),
    r = x.runs(o)[0];
  await x.service.search(r.id);
  x.service.respond(x.ids[0], r.offerId!, "accept");
  const token = x.service.login(
    x.ids[0] + "@fixture.test",
    "Fixture-only-Password!",
  ).token;
  const restart = x.restart();
  assert.equal(restart.getOrderById(o.id)!.purchaseCode, o.purchaseCode);
  assert.equal(restart.dispatchState.runs[r.id].driverId, x.ids[0]);
  assert(Object.keys(restart.dispatchState.sessions).length);
  const prior = fs.readFileSync(
    path.join(x.dir, "persisted-fulfillment.json"),
    "utf8",
  );
  assert.throws(() =>
    restart.transaction(() => {
      restart.dispatchState.counter = 999;
      throw Error("interrupt");
    }),
  );
  assert.equal(
    fs.readFileSync(path.join(x.dir, "persisted-fulfillment.json"), "utf8"),
    prior,
  );
  assert.equal(restart.dispatchState.counter, 1);
});
test("Release requires previous driver confirmation; custody transfer requires both drivers", async () => {
  const x = setup();
  x.provision();
  x.provision(x.ids[1], 0.001);
  const r = x.runs(x.order())[0];
  await x.service.search(r.id);
  x.service.respond(x.ids[0], r.offerId!, "accept");
  x.service.requestRelease(r.id, "admin");
  assert.throws(() => x.service.pickup(x.ids[0], r.id, 1));
  x.service.confirmRelease(x.ids[0], r.id);
  await x.service.search(r.id);
  x.service.respond(x.ids[1], r.offerId!, "accept");
  x.service.pickup(x.ids[1], r.id, 1);
  assert.throws(() => x.service.requestRelease(r.id, "admin"));
  x.service.shift(x.ids[0], "START");
  x.service.location(x.ids[0], {
    latitude: x.store.coordinates.lat,
    longitude: x.store.coordinates.lng,
    accuracy: 5,
    timestamp: x.now(),
  });
  x.service.requestTransfer(r.id, x.ids[0], "admin");
  assert.throws(() => x.service.acceptCustody(x.ids[0], r.id));
  x.service.releaseCustody(x.ids[1], r.id);
  x.service.acceptCustody(x.ids[0], r.id);
  assert.equal(r.driverId, x.ids[0]);
  assert.equal(r.status, "PICKED_UP");
  assert.equal(x.repo.getDriverById(x.ids[1])!.activeAssignmentId, undefined);
});
function provider(
  x: ReturnType<typeof setup>,
  status: any = "ASSIGNED",
  seconds = 10,
) {
  const q: ProviderQuote = {
    id: "SIM-QUOTE",
    providerId: "fixture-provider",
    expiresAt: x.now() + 3600_000,
    costCOP: 5000,
    estimate: {
      kind: "ROUTE",
      meters: 1000,
      seconds,
      source: "SIMULATION",
      observedAt: x.now(),
    },
    vehicle: {
      ...x.config.vehicles.find((v) => v.driverId === x.ids[0])!,
      driverId: "SIM-EXT",
    },
    canCollectCash: false,
    simulation: true,
  };
  return new SimulatedDispatchProvider(
    "fixture-provider",
    "Proveedor FICTICIO",
    q,
    {
      status,
      driver:
        status === "ASSIGNED"
          ? { id: "SIM-EXT-DRIVER", name: "Simulado" }
          : undefined,
    },
  );
}
test("External quote is not assignment; unknown result blocks fallback; late assigned result reconciles once", async () => {
  const providers: any[] = [];
  const x = setup({ providers, simulation: true });
  providers.push(provider(x, "UNKNOWN"));
  const o = x.order(),
    r = x.runs(o)[0];
  await x.service.search(r.id);
  assert.equal(r.external!.status, "UNKNOWN");
  assert.equal(x.service.customerDispatches(o.id)[0].driverConfirmed, false);
  const key = r.external!.key;
  x.advance(1000);
  await x.service.search(r.id);
  assert.equal(r.external!.key, key);
  providers[0].response = { status: "ACCEPTED" };
  await x.service.reconcile(r.id);
  assert.equal(r.external!.status, "ACCEPTED");
  assert.equal(r.status, "SEARCHING");
  providers[0].response = {
    status: "ASSIGNED",
    driver: { id: "sim-late", name: "Simulado tardío" },
  };
  await x.service.reconcile(r.id);
  await x.service.reconcile(r.id);
  assert.equal(r.status, "ASSIGNED");
  assert.equal(
    x.service.adminView().events.filter((e) => e.type === "DISPATCH_ASSIGNED")
      .length,
    1,
  );
  assert.equal(x.service.customerDispatches(o.id)[0].driverConfirmed, true);
});
test("External rejection, cancellation certainty, late stale response, unsupported COD and live providers disabled", async () => {
  const providers: any[] = [];
  const x = setup({ providers, simulation: true });
  const p = provider(x, "REJECTED");
  providers.push(p);
  const r = x.runs(x.order())[0];
  await x.service.search(r.id);
  assert.equal(r.external!.status, "REJECTED");
  x.service.applyExternal(r.id, r.external!.key, {
    status: "ASSIGNED",
    driver: { id: "late", name: "Late" },
  });
  assert.notEqual(r.status, "ASSIGNED");
  const y = setup({ providers, simulation: false });
  await y.service.search(y.runs(y.order())[0].id);
  assert.equal(y.runs(y.repo.getAllOrders()[0])[0].external, undefined);
  const z = setup({ providers, simulation: true });
  await z.service.search(z.runs(z.order(1, true))[0].id);
  assert.equal(z.runs(z.repo.getAllOrders()[0])[0].external, undefined);
});
test("Mixed own/external grouped purchase and own tie priority", async () => {
  const ps: any[] = [];
  const x = setup({
    providers: ps,
    simulation: true,
    routeEstimate: async () => ({
      kind: "ROUTE",
      meters: 2000,
      seconds: 10,
      source: "TEST",
      observedAt: Date.parse("2026-11-07T15:00:00Z"),
    }),
  });
  x.provision();
  ps.push(provider(x, "ASSIGNED", 10));
  const o = x.order(2),
    [a, b] = x.runs(o);
  await x.service.search(a.id);
  assert(a.offerId);
  x.service.respond(x.ids[0], a.offerId!, "accept");
  await x.service.search(b.id);
  assert.equal(b.providerId, "fixture-provider");
  assert.equal(x.service.adminView().orders[0].dispatches.length, 2);
  assert.equal(
    o.childShipments!.every((s) => s.storeId === "HUB_SUBA"),
    true,
  );
});
test("Physics still enforce 50kg base, light margin and vehicle capacity", async () => {
  const x = setup();
  x.provision();
  x.product.transport!.weightGrams = 50000;
  x.product.transport!.packagingGrams = 0;
  x.product.weightKg = 50;
  const r = x.runs(x.order())[0];
  await x.service.search(r.id);
  assert(r.offerId);
  const y = setup();
  y.provision();
  y.product.transport!.weightGrams = 53000;
  y.product.transport!.packagingGrams = 0;
  const ry = y.runs(y.order())[0];
  await y.service.search(ry.id);
  assert.equal(ry.offerId, undefined);
});

test("HTTP routes authenticate real driver/admin sessions and deny cross-driver and visible-code access", async () => {
  const express = (await import("express")).default;
  const { mountDispatchRoutes, mountOrderAccess } = await import(
    "../lib/dispatchRoutes"
  );
  const { AdminAuthService } = await import("../lib/adminAuthService");
  const x = setup();
  x.provision();
  x.provision(x.ids[1], 0.01);
  const o = x.order(),
    r = x.runs(o)[0];
  await x.service.search(r.id);
  const auth = new AdminAuthService(path.join(x.dir, "admin-test.json"));
  const admin = auth.setupMasterAdmin({
    email: "admin@fixture.test",
    name: "Fixture Admin",
    password: "Isolated-admin-123!",
  });
  assert(admin.success);
  const app = express();
  app.use(express.json());
  const gate = (req: any, res: any, next: any) => {
    const session = auth.verifySession(
      req.get("Authorization")?.replace(/^Bearer /, ""),
    );
    if (!session) return res.status(401).json({ error: "Unauthorized" });
    req.adminSession = session;
    next();
  };
  mountDispatchRoutes(app, x.service, x.repo, gate);
  mountOrderAccess(app, x.service, (t) => auth.verifySession(t));
  app.get("/api/v1/orders/:orderId", (req, res) =>
    res.json({ id: req.params.orderId }),
  );
  const server = await new Promise<any>((resolve, reject) => {
    const server = app.listen(0, "127.0.0.1", () => resolve(server));
    server.on("error", reject);
  });
  const base = "http://127.0.0.1:" + server.address().port;
  const call = (url: string, method = "GET", body?: any, headers: any = {}) =>
    fetch(base + url, {
      method,
      headers: { "Content-Type": "application/json", ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  try {
    assert.equal(
      (
        await call("/api/v1/driver/profile", "GET", undefined, {
          "x-driver-id": x.ids[0],
          "x-actor-role": "ADMINISTRADOR",
        })
      ).status,
      401,
    );
    assert.equal(
      (
        await call("/api/v1/admin/dispatch", "GET", undefined, {
          "x-actor-role": "ADMINISTRADOR",
        })
      ).status,
      401,
    );
    const login = await (
      await call("/api/v1/driver/auth/login", "POST", {
        email: x.ids[0] + "@fixture.test",
        password: "Fixture-only-Password!",
      })
    ).json();
    const other = await (
      await call("/api/v1/driver/auth/login", "POST", {
        email: x.ids[1] + "@fixture.test",
        password: "Fixture-only-Password!",
      })
    ).json();
    assert.equal(
      (
        await call("/api/v1/driver/assignments/" + r.id, "GET", undefined, {
          Authorization: "Bearer " + other.token,
          "x-driver-id": x.ids[0],
        })
      ).status,
      403,
    );
    const assignments = await (
      await call("/api/v1/driver/assignments", "GET", undefined, {
        Authorization: "Bearer " + login.token,
      })
    ).json();
    assert.equal(assignments.assignments.length, 1);
    assert(!JSON.stringify(assignments).includes("secretDeliveryCode"));
    assert.equal(
      (
        await call(
          "/api/v1/driver/assignments/" + r.id + "/accept",
          "POST",
          { offerId: r.offerId, driverId: x.ids[1] },
          { Authorization: "Bearer " + login.token },
        )
      ).status,
      200,
    );
    assert.equal(r.driverId, x.ids[0]);
    assert.equal(
      (
        await call("/api/v1/orders/" + o.id, "GET", undefined, {
          "X-Order-Token": o.purchaseCode,
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await call("/api/v1/orders/" + o.id, "GET", undefined, {
          Authorization: "Bearer " + login.token,
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await call("/api/v1/orders/" + o.id, "GET", undefined, {
          "X-Order-Token": x.service.guestToken(o),
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await call("/api/v1/admin/dispatch", "GET", undefined, {
          Authorization: "Bearer " + admin.token,
        })
      ).status,
      200,
    );
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
test("Provider timeout remains unknown until late response; no duplicate external request on retry", async () => {
  const ps: any[] = [];
  const x = setup({ providers: ps, simulation: true });
  x.repo.dispatchState.config.providerTimeoutSeconds = 1;
  const p = provider(x, "UNKNOWN");
  let complete: (v: any) => void = () => {};
  let requests = 0;
  p.request = async () => {
    requests++;
    return await new Promise((resolve) => {
      complete = resolve;
    });
  };
  ps.push(p);
  const r = x.runs(x.order())[0];
  await x.service.search(r.id);
  assert.equal(r.external!.status, "UNKNOWN");
  await x.service.search(r.id);
  assert.equal(requests, 1);
  complete({
    status: "ASSIGNED",
    reference: "SIM-LATE",
    driver: { id: "late", name: "Simulado" },
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(r.status, "ASSIGNED");
  assert.equal(requests, 1);
});

test("Confirmed external cancellation releases once; unknown cancellation blocks reassignment", async () => {
  const ps: any[] = [];
  const x = setup({ providers: ps, simulation: true });
  const p = provider(x);
  ps.push(p);
  const o = x.order(),
    r = x.runs(o)[0];
  await x.service.search(r.id);
  const code = r.code,
    key = r.external!.key;
  p.cancelResponse = { status: "UNKNOWN" };
  await x.service.cancelExternal(r.id, "admin");
  assert.equal(r.status, "ASSIGNED");
  assert.equal(r.reason, "EXTERNAL_CANCELLATION_UNCONFIRMED");
  p.cancelResponse = { status: "CANCELLED" };
  await x.service.cancelExternal(r.id, "admin");
  assert.equal(r.status, "PENDING");
  assert.equal(o.fulfillmentStatus, "LISTO_PARA_DESPACHO");
  x.service.applyExternal(r.id, key, {
    status: "ASSIGNED",
    driver: { id: "late", name: "late" },
  });
  assert.equal(r.status, "PENDING");
  assert.equal(r.code, code);
});
test("No stock/purchase mutations in selection; pause and missing dimensions reject capacity", async () => {
  const x = setup();
  x.provision();
  const o = x.order(),
    r = x.runs(o)[0],
    before = x.product.reservedStockByStore.HUB_SUBA;
  delete (x.product.transport as any).dimensionsCm;
  await x.service.search(r.id);
  assert.equal(r.offerId, undefined);
  assert.equal(x.repo.getAllOrders().length, 1);
  assert.equal(x.product.reservedStockByStore.HUB_SUBA, before);
  x.advance(190_000);
  await x.service.tick();
  assert.equal(r.status, "SEARCH_EXHAUSTED");
});
test("Cancellation and delivered history are not automatically migrated; legacy reconciliation preserves custody", async () => {
  const x = setup();
  x.provision();
  const o = x.order(),
    r = x.runs(o)[0];
  await x.service.search(r.id);
  x.service.respond(x.ids[0], r.offerId!, "accept");
  x.service.pickup(x.ids[0], r.id, 1);
  const code = r.code;
  delete x.repo.dispatchState.runs[r.id];
  x.repo.transaction(() => x.service.registerOrder(o, true));
  const migrated = x.runs(o)[0];
  assert.equal(migrated.status, "INCIDENT");
  assert.equal(migrated.cashDue, 0);
  assert.equal(migrated.code, code);
  x.repo.dispatchState.accounts[x.ids[0]].activeDispatchId = undefined;
  x.service.reconcileLegacy(
    migrated.id,
    {
      driverId: x.ids[0],
      cashDueCOP: 0,
      note: "TEST: verify physical custody",
    },
    "admin",
  );
  assert.equal(migrated.status, "PICKED_UP");
  assert.equal(migrated.driverId, x.ids[0]);
});
test("Incident before pickup releases only after driver confirmation; stale estimates are labeled in both panels", async()=>{
 const x=setup();x.provision();const o=x.order(),r=x.runs(o)[0];await x.service.search(r.id);x.service.respond(x.ids[0],r.offerId!,"accept");x.advance(61000);
 assert.equal(x.service.driverDispatch(r,x.ids[0]).pickupEstimate?.stale,true);assert.equal(x.service.adminView().orders[0].dispatches[0].estimate?.stale,true);
 x.service.incident(x.ids[0],r.id,"TEST: vehicle issue before pickup");x.service.requestRelease(r.id,"admin");assert.deepEqual(x.service.driverDispatch(r,x.ids[0]).actions,["release"]);x.service.confirmRelease(x.ids[0],r.id);assert.equal(r.status,"PENDING");assert.equal(r.driverId,undefined);assert.equal(o.items[0].quantity,1);
});
let failed = 0;
for (const [name, fn] of tests) {
  try {
    await fn();
    console.log("PASS", name);
  } catch (e) {
    failed++;
    console.error("FAIL", name, e);
  }
}
console.log(`${tests.length - failed}/${tests.length} dispatch cases passed`);
if (failed) process.exitCode = 1;
else fs.rmSync(root, { recursive: true, force: true });
