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
import { getCheckoutPreviewOrder } from "./checkoutPreview";
import { cashDemoDriverId, cashDemoDriverName, cashDemoVehicle } from "./demoCashCheckout";
const trackingPrefix = "SIM-TRACK-";
const trackingFingerprint = "SIMULATION_TRACKING_V1";
const trackingDriverId = "SIM-TRACK-COURIER";
const trackingDriverEmail = "tracking-courier@simulation.test";
const trackingDurationMs = 4 * 60_000;
const trackingPulseMs = 7_000;

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
  if (!config.cashCheckoutDriver) {
    const seed = config.drivers[0].driver;
    config.cashCheckoutDriver = {
      driver: {
        ...seed,
        id: cashDemoDriverId,
        name: cashDemoDriverName,
        maxWeightKg: cashDemoVehicle.maxLoadGrams / 1000,
      },
      email: "efectivo-suba-conductor@simulation.test",
      password: "Sim-" + crypto.randomBytes(18).toString("hex"),
      storeIds: [store.id],
    };
    const temporaryMarker = marker + ".tmp";
    fs.writeFileSync(temporaryMarker, JSON.stringify(config), { mode: 0o600 });
    fs.renameSync(temporaryMarker, marker);
  }
  const availableFixtures = [...config.drivers, config.cashCheckoutDriver];
  const fixtureIds: string[] = config.drivers.map((d: any) => d.driver.id);
  const allFixtureIds: string[] = availableFixtures.map((d: any) => d.driver.id);
  for (const d of availableFixtures)
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
  const publicFixture = (fixture: { driver: { id: string; name: string }; email: string; password: string }) => ({
    id: fixture.driver.id,
    name: fixture.driver.name,
    email: fixture.email,
    password: fixture.password,
  });
  function info() {
    return {
      enabled: true,
      admin: config.admin,
      drivers: config.drivers.map(publicFixture),
      cashCheckoutDriver: publicFixture(config.cashCheckoutDriver),
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
  app.get("/api/v1/simulation/checkout-preview", (q, r) => {
    const state = q.query.estado;
    r.set("Cache-Control", "no-store");
    if (state !== "confirmado" && state !== "pendiente") {
      return r.status(400).json({ error: "Selecciona un pedido de prueba." });
    }
    return r.json(getCheckoutPreviewOrder(state));
  });
  app.get("/api/v1/simulation", (_q, r) =>
    r
      .set("Cache-Control", "no-store")
      .json({
        enabled: true,
        admin: config.admin,
        drivers: config.drivers.map(publicFixture),
        cashCheckoutDriver: publicFixture(config.cashCheckoutDriver),
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
  function trackingDriver(order: Order) {
    const [kind, id, initialShift] = order.creationRequestFingerprint?.split(":") ?? [];
    if (!order.id.startsWith(trackingPrefix) || kind !== trackingFingerprint ||
        (id !== trackingDriverId && !fixtureIds.includes(id)) || !["OFF_DUTY", "AVAILABLE"].includes(initialShift))
      return undefined;
    return { id, initialShift };
  }

  function trackingPulse(order: Order, now = Date.now()) {
    const driver = trackingDriver(order);
    const run = order.assignmentId && repo.dispatchState.runs[order.assignmentId];
    if (!driver || !run || run.orderId !== order.id || run.driverId !== driver.id ||
        run.status !== "PICKED_UP" || run.transfer || !run.pickedUpAt || !order.tripId ||
        order.fulfillmentStatus !== "EN_CAMINO" || order.payment.cashToCollect !== 0 ||
        repo.dispatchState.accounts[driver.id]?.activeDispatchId !== run.id) return;
    const deadline = Date.parse(order.originalPromiseWindow.end);
    if (!Number.isFinite(deadline)) return;
    if (now >= deadline) {
      repo.transaction(() => {
        s.deliver(driver.id, run.id, order.secretDeliveryCode, 0);
        if (driver.initialShift === "OFF_DUTY") s.shift(driver.id, "END");
      });
      return;
    }
    const previous = repo.getLatestTelemetry(order.id);
    if (previous && now <= previous.timestamp) return;
    const origin = store.verifiedEntrance ?? store.coordinates;
    const destination = order.deliveryAddress.coordinates;
    const progress = Math.max(0, Math.min(1, (now - run.pickedUpAt) / (trackingDurationMs - trackingPulseMs)));
    const result = repo.recordTelemetry({
      orderId: order.id,
      assignmentId: run.id,
      tripId: order.tripId,
      driverId: driver.id,
      latitude: origin.lat + (destination.lat - origin.lat) * progress,
      longitude: origin.lng + (destination.lng - origin.lng) * progress,
      timestamp: now,
      sequenceNumber: Math.max(now, (previous?.sequenceNumber ?? 0) + 1),
      accuracy: 5,
      speed: 0,
      heading: 0,
    }, { role: "CONDUCTOR", id: driver.id });
    if (!result.success) throw Error("No se pudo actualizar la posición ficticia.");
  }

  function ensureTrackingCourier() {
    const account = repo.dispatchState.accounts[trackingDriverId];
    if (account && account.email !== trackingDriverEmail || !account && repo.getDriverById(trackingDriverId))
      throw Error("El identificador del repartidor de pruebas está ocupado.");
    if (!account) {
      s.provision({
        driver: {
          id: trackingDriverId, name: "Repartidor de prueba BOLT", phone: "0000000000",
          vehiclePlate: "SIMULADO", vehicleType: "MOTO", maxWeightKg: 55,
          rating: 0, photo: "", isOnline: false, currentStatus: "FUERA_DE_TURNO",
          currentLocation: { lat: 0, lng: 0, updatedAt: new Date(0).toISOString() },
          cashBalance: 0,
        },
        email: trackingDriverEmail,
        password: crypto.randomBytes(32).toString("base64url"),
        storeIds: [store.id],
      }, "sim-tracking");
    }
    const current = transport.read();
    if (!current.config.vehicles.some(vehicle => vehicle.driverId === trackingDriverId)) {
      return transport.update({
        ...current.config,
        vehicles: [...current.config.vehicles, {
          driverId: trackingDriverId, storeIds: [store.id], enabled: true, modes: ["TURBO"],
          maxLoadGrams: 55_000, cargoDimensionsCm: [80, 60, 60], maxVolumeCm3: 288_000,
          packagingGrams: 500, scheduledSlots: [],
        }],
      }, current.revision, {email: trackingDriverEmail, name: "Simulación de seguimiento"},
      repo.getAllDrivers(), stores()).config;
    }
    return current.config;
  }

  async function startTrackingPreview(requestId: string) {
    const orders = repo.getAllOrders();
    const previous = orders.find(order => order.creationRequestId === requestId);
    if (previous) {
      if (!trackingDriver(previous)) throw Error("Identificador utilizado por otra simulación.");
      return { order: previous, guestAccessToken: s.guestToken(previous) };
    }
    const current = orders.find(order => trackingDriver(order) && order.fulfillmentStatus === "EN_CAMINO");
    if (current) {
      const stillRunning = Date.now() < Date.parse(current.originalPromiseWindow.end);
      if (stillRunning) return { order: current, guestAccessToken: s.guestToken(current) };
      trackingPulse(current);
    }
    const catalog = products();
    const product = catalog.find(entry => entry.id === "SIM-FOOD-20KG");
    if (!product) throw Error("Catálogo de pruebas no cargado.");
    ensureTrackingCourier();
    const transportConfig = ensureTrackingCourier();
    const driver = repo.dispatchState.accounts[trackingDriverId];
    const profile = repo.getDriverById(trackingDriverId);
    if (!driver.enabled || !profile || driver.activeDispatchId ||
        !["OFF_DUTY", "AVAILABLE"].includes(driver.status))
      throw Error("El repartidor exclusivo de esta prueba está ocupado.");
    const plan = planTransport([{ productId: product.id, quantity: 1 }], [product], store.id, "TURBO", {
      config: {
        ...transportConfig,
        vehicles: transportConfig.vehicles.filter(vehicle => vehicle.driverId === trackingDriverId),
        externalProviders: [],
      },
      drivers: [{ ...profile, isOnline: true, currentStatus: "DISPONIBLE" }],
      orders: [],
    });
    if (!plan.feasible || plan.shipments.length !== 1) throw Error("La capacidad del vehículo ficticio no permite iniciar el recorrido.");
    const candidate = { id: trackingDriverId, initialShift: driver.status, load: plan.shipments[0] };

    const now = Date.now();
    const confirmedAt = new Date(now).toISOString();
    const id = trackingPrefix + crypto.randomUUID();
    const fixture = structuredClone(INITIAL_ORDERS[0]);
    const order: Order = {
      ...fixture,
      id,
      orderNumber: id,
      creationRequestId: requestId,
      creationRequestFingerprint: [trackingFingerprint, candidate.id, candidate.initialShift].join(":"),
      purchaseCode: undefined,
      assignmentId: undefined,
      tripId: undefined,
      createdAt: confirmedAt,
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
        details: "Simulación de seguimiento; no realizar entrega.",
        porteriaPolicy: "DEJAR_EN_PORTERIA",
        coordinates: { lat: 4.72422, lng: -74.03991 },
      },
      items: [{
        productId: product.id, sku: product.sku, name: product.name, brand: product.brand,
        presentation: product.presentation, price: product.price, quantity: 1, image: product.image,
        weightKg: product.weightKg, requiresPrescription: false,
      }],
      isSplitOrder: false,
      childShipments: undefined,
      driver: undefined,
      transportLoad: candidate.load,
      fulfillmentStatus: "CONFIRMADO",
      deliveryMode: "TURBO",
      scheduledWindow: undefined,
      secretDeliveryCode: String(crypto.randomInt(1000, 10000)),
      statusHistory: [],
      timestamps: { confirmedAt },
      // This timer belongs exclusively to the isolated walkthrough, not to an operational quote.
      transportConfirmation: "sim-tracking-" + id,
      deliveryQuoteSnapshot: {
        quoteId: "sim-tracking-" + id, assignedStoreId: store.id,
        totalSeconds: trackingDurationMs / 1000, estimatedMinutes: trackingDurationMs / 60_000,
        geographicDistanceMeters: 0, roadDistanceMeters: 0, configVersion: trackingFingerprint,
      },
      // Search still validates the fixture's timer window. The real checkout uses its own ETA.
      estimatedDeliveryMinutes: 0,
      originalPromiseWindow: { start: confirmedAt, end: new Date(now + trackingDurationMs).toISOString() },
      totals: {
        subtotal: product.price, shipping: 0, serviceFee: 0, tip: 0, discount: 0,
        total: product.price, totalWeightKg: product.weightKg,
      },
      payment: { method: "WOMPI_CARD", status: "APROBADO", cashToCollect: 0 },
    };
    const runId = repo.transaction(() => {
      const result = s.createOrder(order, catalog, store);
      if (!result.success || !result.order?.assignmentId) throw Error(result.error || "No se pudo crear el pedido de prueba.");
      const run = repo.dispatchState.runs[result.order.assignmentId];
      // Scope the search for this new dispatch alone. Other demo orders, offers and providers are untouched.
      run.attempted = [
        "provider:" + provider.id,
        ...Object.keys(repo.dispatchState.accounts).filter(id => id !== candidate.id),
      ];
      for (const status of ["EN_ALISTAMIENTO", "LISTO_PARA_DESPACHO"] as const) {
        const step = repo.transitionStatus(order.id, status, { role: "SISTEMA", id: "sim-tracking" }, { catalogProducts: catalog });
        if (!step.success) throw Error(step.error);
      }
      if (candidate.initialShift === "OFF_DUTY") s.shift(candidate.id, "START");
      const location = store.verifiedEntrance ?? store.coordinates;
      s.location(candidate.id, { latitude: location.lat, longitude: location.lng, accuracy: 5, timestamp: now });
      return run.id;
    });

    await s.search(runId, "sim-tracking");
    const ready = repo.getOrderById(order.id)!;
    const run = repo.dispatchState.runs[runId];
    const offer = run.offerId ? repo.dispatchState.offers[run.offerId] : undefined;
    if (!offer || offer.driverId !== candidate.id || offer.status !== "PENDING") {
      repo.transitionStatus(order.id, "CANCELADO", { role: "SISTEMA", id: "sim-tracking" }, {
        reason: "Simulación sin oferta vigente",
        catalogProducts: catalog,
      });
      const account = repo.dispatchState.accounts[candidate.id];
      if (candidate.initialShift === "OFF_DUTY" && !account.activeDispatchId) s.shift(candidate.id, "END");
      throw Error("El conductor de prueba ya no está disponible. Vuelve a intentar.");
    }
    repo.transaction(() => {
      s.respond(candidate.id, offer.id, "accept");
      s.arrived(candidate.id, run.id);
      s.pickup(candidate.id, run.id, 1);
      trackingPulse(ready);
    });
    return { order: ready, guestAccessToken: s.guestToken(ready) };
  }

  let startingPreview: ReturnType<typeof startTrackingPreview> | undefined;
  app.post("/api/v1/admin/simulation/tracking-preview", wrap(q => {
    const requestId = String(q.body?.requestId || "");
    if (!/^[\w-]{10,100}$/.test(requestId)) throw Error("Identificador de solicitud requerido.");
    startingPreview ??= startTrackingPreview(requestId).finally(() => { startingPreview = undefined; });
    return startingPreview;
  }));

  const trackingInterval = setInterval(() => {
    for (const order of repo.getAllOrders()) {
      if (order.fulfillmentStatus === "EN_CAMINO" && order.id.startsWith(trackingPrefix)) {
        try { trackingPulse(order); }
        catch { console.error("No se pudo avanzar el recorrido simulado de seguimiento."); }
      }
    }
  }, trackingPulseMs);
  trackingInterval.unref();

  // Driver middleware has already authenticated this path. Never accepts a driver id from the browser.
  app.post(
    "/api/v1/driver/simulation/location",
    wrap((q) => {
      const id = (q as any).driverId;
      if (!allFixtureIds.includes(id)) throw Error("Conductor ficticio requerido");
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
