/** Isolated loopback-only demonstration harness. Never enables real provider integrations. */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type { Express, Request, Response, NextFunction } from "express";
import { INITIAL_ORDERS } from "../data/seedData";
import type { Order, Product, Store } from "../types";
import type {
  DispatchProvider,
  ProviderQuote,
  ProviderResult,
} from "./dispatchProviders";
import { DispatchService, DispatchError } from "./dispatchService";
import type { OrdersRepository } from "./ordersRepository";
import type { TransportRepository } from "./transportRepository";
import { planTransport } from "./transportPlanner";
const marker = path.join(
  process.cwd(),
  ".bolt-private",
  "dispatch-simulation.json",
);
export function simulationEnabled() {
  if (process.env.BOLT_DISPATCH_SIMULATION !== "1") return false;
  const data = fs.realpathSync(process.env.BOLT_DATA_DIR || ".");
  if (
    !path.basename(process.cwd()).startsWith("bolt-dispatch-simulation-") ||
    !data.startsWith(process.cwd() + path.sep) ||
    !fs.existsSync(marker)
  )
    throw Error(
      "Simulation requires an isolated simulation directory and data directory",
    );
  const m = JSON.parse(fs.readFileSync(marker, "utf8"));
  if (m.kind !== "DISPATCH_SIMULATION" || m.version !== 1)
    throw Error("Invalid simulation marker");
  return true;
}
export class LocalSimulationProvider implements DispatchProvider {
  id = "sandbox-network";
  name = "Red externa ficticia";
  simulation = true;
  capabilities = {
    quote: true,
    request: true,
    status: true,
    cancel: true,
    cashCollection: false,
  };
  private file = path.join(
    process.cwd(),
    ".bolt-private",
    "simulation-provider.json",
  );
  constructor(private vehicle: () => any) {}
  read(): {
    mode: "ACCEPT" | "DELAY" | "REJECT";
    enabled: boolean;
    requests: Record<string, ProviderResult>;
  } {
    return fs.existsSync(this.file)
      ? JSON.parse(fs.readFileSync(this.file, "utf8"))
      : { mode: "ACCEPT", enabled: false, requests: {} };
  }
  save(data: ReturnType<LocalSimulationProvider["read"]>) {
    fs.writeFileSync(this.file + ".tmp", JSON.stringify(data), { mode: 0o600 });
    fs.renameSync(this.file + ".tmp", this.file);
  }
  configure(mode: any, enabled: boolean) {
    if (!["ACCEPT", "DELAY", "REJECT"].includes(mode))
      throw Error("Modo inválido");
    this.save({ ...this.read(), mode, enabled });
  }
  async quote(): Promise<ProviderQuote | null> {
    const state = this.read();
    if (!state.enabled) return null;
    return {
      id: crypto.randomUUID(),
      providerId: this.id,
      expiresAt: Date.now() + 60000,
      costCOP: 1000,
      estimate: {
        kind: "ROUTE",
        meters: 3000,
        seconds: 600,
        source: "SIMULATION",
        observedAt: Date.now(),
      },
      vehicle: { ...this.vehicle(), driverId: "SIM-EXTERNAL" },
      canCollectCash: false,
      simulation: true,
    };
  }
  async request(input: { idempotencyKey: string }) {
    const state = this.read();
    if (!state.requests[input.idempotencyKey]) {
      state.requests[input.idempotencyKey] = {
        reference: input.idempotencyKey,
        status:
          state.mode === "ACCEPT"
            ? "ASSIGNED"
            : state.mode === "REJECT"
              ? "REJECTED"
              : "UNKNOWN",
        ...(state.mode === "ACCEPT"
          ? {
              driver: {
                id: "SIM-EXTERNAL-" + input.idempotencyKey,
                name: "Repartidor externo ficticio",
              },
            }
          : {}),
      };
      this.save(state);
    }
    return state.requests[input.idempotencyKey];
  }
  async status(key: string) {
    return (
      this.read().requests[key] || {
        status: "UNKNOWN" as const,
        reference: key,
      }
    );
  }
  async cancel(key: string) {
    const state = this.read();
    state.requests[key] = { status: "CANCELLED", reference: key };
    this.save(state);
    return state.requests[key];
  }
  resolve(key: string, accept: boolean) {
    const state = this.read();
    if (
      !state.requests[key] ||
      !["UNKNOWN", "ACCEPTED"].includes(state.requests[key].status)
    )
      throw Error("Solicitud pendiente requerida");
    state.requests[key] = {
      reference: key,
      status: accept ? "ASSIGNED" : "REJECTED",
      ...(accept
        ? {
            driver: {
              id: "SIM-EXTERNAL-" + key,
              name: "Repartidor externo ficticio",
            },
          }
        : {}),
    };
    this.save(state);
  }
}
export function mountDispatchSimulation(
  app: Express,
  s: DispatchService,
  repo: OrdersRepository,
  transport: TransportRepository,
  products: () => Product[],
  stores: () => Store[],
  provider: LocalSimulationProvider,
  admin: (q: Request, r: Response, n: NextFunction) => unknown,
) {
  if (!simulationEnabled()) throw Error("Simulation disabled");
  const config = JSON.parse(fs.readFileSync(marker, "utf8")),
    store = stores().find((x) => x.id === "HUB_SUBA")!;
  const fixtureIds: string[] = config.drivers.map((d: any) => d.driver.id);
  for (const d of config.drivers)
    if (!repo.dispatchState.accounts[d.driver.id])
      s.provision(d, "simulation-setup");
  if (!config.initialized) {
    s.updateConfig(
      { ...repo.dispatchState.config, offerSeconds: 120 },
      "simulation-setup",
    );
    config.initialized = true;
    fs.writeFileSync(marker, JSON.stringify(config), { mode: 0o600 });
  }
  function info() {
    return {
      enabled: true,
      admin: config.admin,
      drivers: config.drivers.map((d: any) => ({
        id: d.driver.id,
        name: d.driver.name,
        email: d.email,
        password: d.password,
      })),
      provider: provider.read(),
      orders: repo
        .getAllOrders()
        .filter((o) => o.id.startsWith("SIM-"))
        .map((o) => ({
          id: o.id,
          code: o.purchaseCode,
          status: o.fulfillmentStatus,
          guestAccessToken: s.guestToken(o),
        })),
    };
  }
  const wrap = (fn: (q: Request) => any) => (q: Request, r: Response) =>
    Promise.resolve()
      .then(() => fn(q))
      .then((v) => r.json(v ?? { ok: true }))
      .catch((e) =>
        r
          .status(e instanceof DispatchError ? e.status : 400)
          .json({ error: e.message }),
      );
  app.get("/api/v1/simulation", (_q, r) =>
    r
      .set("Cache-Control", "no-store")
      .json({
        enabled: true,
        admin: config.admin,
        drivers: config.drivers.map((d: any) => ({
          id: d.driver.id,
          name: d.driver.name,
          email: d.email,
          password: d.password,
        })),
      }),
  );
  app.use("/api/v1/admin/simulation", admin, (_q, r, n) => {
    r.set("Cache-Control", "no-store");
    n();
  });
  app.get(
    "/api/v1/admin/simulation",
    wrap(() => info()),
  );
  app.post(
    "/api/v1/admin/simulation/fleet",
    wrap((q) => {
      const count = Number(q.body.count);
      if (![0, 1, 2].includes(count))
        throw Error("Selecciona 0, 1 o 2 conductores ficticios");
      for (const [index, id] of fixtureIds.entries()) {
        const a = repo.dispatchState.accounts[id];
        if (["BUSY", "OFFER_PENDING"].includes(a.status)) continue;
        s.shift(id, index < count ? "START" : "END");
        if (index < count)
          s.location(id, {
            latitude: store.coordinates.lat + 0.001 * (index + 1),
            longitude: store.coordinates.lng,
            accuracy: 5,
            timestamp: Date.now(),
          });
      }
      return info();
    }),
  );
  app.post(
    "/api/v1/admin/simulation/provider",
    wrap((q) => {
      provider.configure(q.body.mode, !!q.body.enabled);
      return info();
    }),
  );
  app.post(
    "/api/v1/admin/simulation/resolve",
    wrap(async (q) => {
      provider.resolve(q.body.key, q.body.accept === true);
      await s.tick();
      return info();
    }),
  );
  app.post(
    "/api/v1/admin/simulation/expire",
    wrap(async (q) => {
      const o = repo.dispatchState.offers[q.body.offerId];
      if (!o || o.status !== "PENDING" || !fixtureIds.includes(o.driverId))
        throw Error("Oferta ficticia pendiente requerida");
      repo.transaction(() => {
        o.expiresAt = Date.now() - 1;
      });
      await s.tick();
      return info();
    }),
  );
  app.post(
    "/api/v1/admin/simulation/purchases",
    wrap((q) => {
      const key = String(q.body.requestId || "");
      if (!/^[\w-]{10,100}$/.test(key))
        throw Error("Identificador de solicitud requerido");
      const previous = repo
        .getAllOrders()
        .find((o) => o.creationRequestId === key);
      if (previous)
        return { order: previous, guestAccessToken: s.guestToken(previous) };
      const p = products().find((p) => p.id === "SIM-FOOD-20KG")!;
      if (!p) throw Error("Catálogo de pruebas no cargado");
      // Quote fixtures represent verified synthetic capacity. Assignment still uses real service availability.
      const c = transport.read().config;
      const plan = planTransport(
        [{ productId: p.id, quantity: 3 }],
        [p],
        store.id,
        "TURBO",
        {
          config: c,
          drivers: config.drivers.map((d: any) => ({
            ...d.driver,
            isOnline: true,
            currentStatus: "DISPONIBLE",
          })),
          orders: [],
        },
      );
      if (!plan.feasible) throw Error(plan.message);
      const now = new Date().toISOString(),
        id = "SIM-" + crypto.randomUUID();
      const item = {
        productId: p.id,
        sku: p.sku,
        name: p.name,
        brand: p.brand,
        presentation: p.presentation,
        price: p.price,
        quantity: 3,
        image: p.image,
        weightKg: p.weightKg,
        requiresPrescription: false,
      };
      const base: Order = {
        ...structuredClone(INITIAL_ORDERS[0]),
        id,
        orderNumber: id,
        creationRequestId: key,
        creationRequestFingerprint: "SIMULATION",
        purchaseCode: undefined,
        assignmentId: undefined,
        tripId: undefined,
        createdAt: now,
        storeId: store.id,
        storeName: store.name,
        customer: {
          name: "Cliente de simulación",
          phone: "0000000000",
          email: "cliente@simulation.test",
          isGuest: true,
        },
        deliveryAddress: {
          address: "Destino ficticio de prueba · Cedritos, Bogotá",
          details: "Simulación; no realizar entrega",
          porteriaPolicy: "ENTREGAR_PERSONALMENTE" as any,
          coordinates: { lat: 4.72422, lng: -74.03991 },
        },
        items: [item],
        isSplitOrder: true,
        driver: undefined,
        transportLoad: undefined,
        fulfillmentStatus: "CONFIRMADO",
        deliveryMode: "TURBO",
        scheduledWindow: undefined,
        secretDeliveryCode: String(crypto.randomInt(1000, 10000)),
        statusHistory: [],
        timestamps: {},
        estimatedDeliveryMinutes: 0,
        originalPromiseWindow: {
          start: now,
          end: new Date(Date.now() + 7200000).toISOString(),
        },
        totals: {
          subtotal: 30000,
          shipping: 4900,
          serviceFee: 1500,
          tip: 0,
          discount: 0,
          total: 36400,
          totalWeightKg: 60,
        },
        payment: { method: "WOMPI_CARD", status: "APROBADO", cashToCollect: 0 },
        childShipments: plan.shipments.map((load, i) => ({
          shipmentId: id + "-S" + (i + 1),
          shipmentIndex: i + 1,
          shipmentCount: plan.shipments.length,
          parentOrderId: id,
          storeId: store.id,
          items: load.items.map((x) => ({ ...item, quantity: x.quantity })),
          weightKg: load.productWeightGrams / 1000,
          weightGrams: load.productWeightGrams,
          transportLoad: load,
          subtotal: load.items.reduce((n, x) => n + x.quantity * p.price, 0),
          cashToCollect: 0,
          fulfillmentStatus: "CONFIRMADO",
          secretDeliveryCode: String(crypto.randomInt(1000, 10000)),
          estimatedDeliveryMinutes: 0,
          timestamps: {},
        })),
      };
      const result = s.createOrder(base, products(), store);
      if (!result.success) throw Error(result.error);
      return {
        order: result.order,
        guestAccessToken: s.guestToken(result.order!),
      };
    }),
  );
  // Driver middleware has already authenticated this path. Never accepts a driver id from the browser.
  app.post(
    "/api/v1/driver/simulation/location",
    wrap((q) => {
      const id = (q as any).driverId;
      if (!fixtureIds.includes(id)) throw Error("Conductor ficticio requerido");
      const run = Object.values(repo.dispatchState.runs).find(
        (r) => r.driverId === id && r.status === "PICKED_UP",
      );
      const now = Date.now(),
        o = run ? repo.getOrderById(run.orderId) : undefined;
      const loc = o
        ? {
            lat:
              (store.coordinates.lat + o.deliveryAddress.coordinates.lat) / 2,
            lng:
              (store.coordinates.lng + o.deliveryAddress.coordinates.lng) / 2,
          }
        : { lat: store.coordinates.lat + 0.001, lng: store.coordinates.lng };
      s.location(id, {
        latitude: loc.lat,
        longitude: loc.lng,
        accuracy: 5,
        timestamp: now,
      });
      if (run) {
        const shipment = run.shipmentId
          ? o!.childShipments!.find((x) => x.shipmentId === run.shipmentId)!
          : o!;
        const result = repo.recordTelemetry(
          {
            driverId: id,
            orderId: o!.id,
            shipmentId: run.shipmentId,
            assignmentId: run.id,
            tripId: shipment.tripId!,
            latitude: loc.lat,
            longitude: loc.lng,
            accuracy: 5,
            timestamp: now,
            sequenceNumber: now,
            speed: 0,
            heading: 0,
          },
          { role: "CONDUCTOR", id },
        );
        if (!result.success) throw Error(result.error);
      }
      return s.profile(id);
    }),
  );
}
