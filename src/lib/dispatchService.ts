import crypto from "node:crypto";
import type {
  Order,
  ChildShipment,
  DriverProfile,
  Store,
  Product,
  OrderActor,
} from "../types";
import type {
  DispatchRun,
  DispatchOffer,
  DriverAccount,
  PickupEstimate,
  DispatchConfig,
} from "../types/dispatch";
import type { TransportConfig, TransportVehicle } from "../types/transport";
import { planTransport } from "./transportPlanner";
import { OrdersRepository } from "./ordersRepository";
import type {
  DispatchProvider,
  ProviderQuote,
  ProviderResult,
} from "./dispatchProviders";
import { DISABLED_LIVE_PROVIDERS } from "./dispatchProviders";
export class DispatchError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
const fail = (code: string, message: string, status = 409): never => {
  throw new DispatchError(status, code, message);
};
const hash = (s: string) => crypto.createHash("sha256").update(s).digest("hex");
const secret = () => crypto.randomBytes(32).toString("base64url");
const passwordHash = (password: string, salt: string) =>
  crypto.scryptSync(password, salt, 64).toString("hex");
const equal = (a: string, b: string) =>
  a.length === b.length &&
  crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
const terminal = (s: string) => ["ENTREGADO", "CANCELADO"].includes(s);
const actor = (id: string): OrderActor => ({ role: "CONDUCTOR", id });
function distance(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
) {
  const rad = Math.PI / 180,
    dlat = (b.lat - a.lat) * rad,
    dlng = (b.lng - a.lng) * rad;
  return (
    6371000 *
    2 *
    Math.asin(
      Math.sqrt(
        Math.sin(dlat / 2) ** 2 +
          Math.cos(a.lat * rad) *
            Math.cos(b.lat * rad) *
            Math.sin(dlng / 2) ** 2,
      ),
    )
  );
}
export interface DispatchDependencies {
  repo: OrdersRepository;
  stores: () => Store[];
  products: () => Product[];
  transport: () => TransportConfig;
  now?: () => number;
  providers?: DispatchProvider[];
  simulation?: boolean;
  routeEstimate?: (
    driver: DriverProfile,
    store: Store,
  ) => Promise<PickupEstimate | null>;
}
export class DispatchService {
  private inFlight = new Set<string>();
  private async bounded<T>(promise: Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout>;
    try {
      return await Promise.race([
        promise,
        new Promise<T>((_, reject) => {
          timer = setTimeout(
            () => reject(Error("provider timeout")),
            this.state.config.providerTimeoutSeconds * 1000,
          );
        }),
      ]);
    } finally {
      clearTimeout(timer!);
    }
  }
  constructor(private deps: DispatchDependencies) {}
  private get repo() {
    return this.deps.repo;
  }
  private get state() {
    return this.repo.dispatchState;
  }
  private now = () => this.deps.now?.() ?? Date.now();
  private event(
    type: string,
    actorId: string,
    dispatchId?: string,
    detail?: string,
  ) {
    this.state.events.push({
      id: crypto.randomUUID(),
      at: this.now(),
      type,
      actorId,
      dispatchId,
      detail,
    });
  }
  private run(id: string) {
    const r = this.state.runs[id];
    if (!r) fail("NOT_FOUND", "Despacho no encontrado", 404);
    return r;
  }
  private target(r: DispatchRun): {
    order: Order;
    shipment: Order | ChildShipment;
  } {
    const order = this.repo.getOrderById(r.orderId);
    const shipment = r.shipmentId
      ? order?.childShipments?.find((s) => s.shipmentId === r.shipmentId)
      : order;
    if (!order || !shipment) fail("NOT_FOUND", "Despacho no encontrado", 404);
    return { order: order!, shipment: shipment! };
  }
  private account(id: string) {
    const a = this.state.accounts[id];
    if (!a?.enabled) fail("UNAUTHORIZED", "Sesión de conductor inválida", 401);
    return a;
  }
  private assertOwned(r: DispatchRun, id: string) {
    this.account(id);
    if (r.driverId !== id)
      fail("FORBIDDEN", "No tienes acceso a este despacho", 403);
  }
  private checkResult(r: { success: boolean; error?: string; code?: number }) {
    if (!r.success)
      fail(
        "INVALID_TRANSITION",
        r.error || "Transición rechazada",
        r.code || 409,
      );
  }
  private releaseDriver(r: DispatchRun) {
    if (r.driverId) {
      const a = this.state.accounts[r.driverId],
        d = this.repo.getDriverById(r.driverId);
      if (a?.activeDispatchId === r.id) {
        a.activeDispatchId = undefined;
        a.status = "OFF_DUTY";
      }
      if (d?.activeAssignmentId === r.id) {
        d.activeAssignmentId = undefined;
        d.activeOrderId = undefined;
        d.currentStatus = "FUERA_DE_TURNO";
        d.isOnline = false;
      }
    }
  }
  private unreserveOffer(o: DispatchOffer) {
    const a = this.state.accounts[o.driverId],
      d = this.repo.getDriverById(o.driverId);
    if (a?.activeDispatchId === o.dispatchId) {
      a.activeDispatchId = undefined;
      a.status = "AVAILABLE";
      if (d) {
        d.currentStatus = "DISPONIBLE";
        d.activeAssignmentId = undefined;
        d.activeOrderId = undefined;
      }
    }
  }
  /** Called in the same transaction as confirmed order creation. Never called during quote/cart edits. */
  registerOrder(order: Order, legacy = false) {
    if (Object.values(this.state.runs).some((r) => r.orderId === order.id))
      return;
    if (terminal(order.fulfillmentStatus)) return;
    order.purchaseCode ||= `BP-${String(++this.state.counter).padStart(6, "0")}`;
    if (!legacy) order.orderNumber = order.purchaseCode;
    if (!this.state.guestSecret) this.state.guestSecret = secret();
    this.state.guestHashes[order.id] = hash(this.guestToken(order));
    const shipments = order.childShipments?.length
      ? order.childShipments
      : [order];
    // The confirmed checkout is the authority for amounts. Never charge total to every driver.
    let remaining =
      order.payment.method === "CASH_ON_DELIVERY"
        ? (order.payment.cashToCollect ?? order.totals.total)
        : 0;
    if (
      !Number.isSafeInteger(remaining) ||
      remaining < 0 ||
      remaining > order.totals.total
    )
      fail("CASH_INVALID", "Saldo contraentrega inválido");
    shipments.forEach((s, i) => {
      const id = s.assignmentId!;
      if (!id)
        fail(
          "ASSIGNMENT_ID_REQUIRED",
          "Falta identificador estable del despacho",
        );
      const code = `${order.purchaseCode}-E${String(i + 1).padStart(2, "0")}`;
      s.dispatchCode = code;
      const cash =
        i === shipments.length - 1
          ? remaining
          : Math.min(
              remaining,
              Math.round(
                (order.payment.cashToCollect || order.totals.total) *
                  (("subtotal" in s ? s.subtotal : order.totals.subtotal) /
                    Math.max(1, order.totals.subtotal)),
              ),
            );
      remaining -= cash;
      // Quoted capacity is not an accepted driver assignment. Historical active drivers need explicit reconciliation.
      const legacyAssigned =
        legacy &&
        !!s.driver &&
        ["REPARTIDOR_ASIGNADO", "EN_CAMINO", "CON_INCIDENCIA"].includes(
          s.fulfillmentStatus,
        );
      if (!legacyAssigned) s.driver = undefined;
      this.state.runs[id] = {
        id,
        orderId: order.id,
        shipmentId: "shipmentId" in s ? s.shipmentId : undefined,
        code,
        status: terminal(s.fulfillmentStatus)
          ? s.fulfillmentStatus === "ENTREGADO"
            ? "DELIVERED"
            : "CANCELLED"
          : legacy
            ? "INCIDENT"
            : "PENDING",
        createdAt: this.now(),
        attempted: [],
        cashDue: legacy ? 0 : cash,
        cashCollected: 0,
        pinFailures: 0,
        reason: legacy
          ? "LEGACY_ASSIGNMENT_REQUIRES_RECONCILIATION"
          : undefined,
      };
      this.event("DISPATCH_CREATED", "SYSTEM", id);
    });
  }
  createOrder(order: Order, products: Product[], warehouse?: Store) {
    return this.repo.transaction(() => {
      const result = this.repo.createOrder(order, products, warehouse);
      if (result.success) this.registerOrder(result.order!);
      return result;
    });
  }
  guestToken(order: Order) {
    return crypto
      .createHmac("sha256", this.state.guestSecret)
      .update(`guest:${order.id}:${order.creationRequestId || ""}`)
      .digest("base64url");
  }
  authorizeGuest(orderId: string, token?: string) {
    const o = this.repo.getOrderById(orderId);
    return (
      !!o &&
      !!token &&
      !!this.state.guestHashes[o.id] &&
      equal(hash(token), this.state.guestHashes[o.id])
    );
  }
  provision(
    input: {
      driver: DriverProfile;
      email: string;
      password: string;
      storeIds: string[];
    },
    adminId: string,
  ) {
    return this.repo.transaction(() => {
      const { driver, email, password, storeIds } = input;
      if (
        !driver?.id ||
        !/^[\w-]{1,100}$/.test(driver.id) ||
        !driver.name?.trim() ||
        !email?.includes("@") ||
        !password ||
        password.length < 12 ||
        password.length > 200 ||
        !Array.isArray(storeIds) ||
        !storeIds.length ||
        storeIds.some(
          (id) => !this.deps.stores().some((s) => s.id === id && s.isActive),
        )
      )
        fail(
          "INVALID_PROFILE",
          "Completa conductor, correo, contraseña de 12 caracteres y sedes autorizadas",
          400,
        );
      if (
        this.state.accounts[driver.id] ||
        Object.values(this.state.accounts).some(
          (a) => a.email === email.toLowerCase().trim(),
        )
      )
        fail("DUPLICATE_ACCOUNT", "El conductor o usuario ya está registrado");
      if (!this.repo.getDriverById(driver.id))
        this.repo.addDriver({
          ...driver,
          isOnline: false,
          currentStatus: "FUERA_DE_TURNO",
          activeOrderId: undefined,
          activeAssignmentId: undefined,
          currentLocation: {
            lat: 0,
            lng: 0,
            updatedAt: new Date(0).toISOString(),
          },
          cashBalance: 0,
        });
      const salt = crypto.randomBytes(16).toString("hex");
      this.state.accounts[driver.id] = {
        driverId: driver.id,
        userId: crypto.randomUUID(),
        email: email.toLowerCase().trim(),
        salt,
        passwordHash: passwordHash(password, salt),
        enabled: true,
        storeIds,
        status: "OFF_DUTY",
      };
      this.event("DRIVER_PROVISIONED", adminId, undefined, driver.id);
      return this.profile(driver.id);
    });
  }
  updateAccount(
    id: string,
    input: { enabled: boolean; storeIds: string[] },
    adminId: string,
  ) {
    return this.repo.transaction(() => {
      const a = this.state.accounts[id];
      if (!a) fail("NOT_FOUND", "Conductor no registrado", 404);
      if (a.activeDispatchId)
        fail(
          "ACTIVE_ASSIGNMENT",
          "Libera o transfiere la custodia antes de modificar al conductor",
        );
      if (
        typeof input.enabled !== "boolean" ||
        !Array.isArray(input.storeIds) ||
        !input.storeIds.length ||
        input.storeIds.some(
          (id) => !this.deps.stores().some((s) => s.id === id),
        )
      )
        fail("INVALID_PROFILE", "Sedes o estado inválidos", 400);
      a.enabled = input.enabled;
      a.storeIds = input.storeIds;
      a.status = "OFF_DUTY";
      const d = this.repo.getDriverById(id)!;
      d.isOnline = false;
      d.currentStatus = "FUERA_DE_TURNO";
      for (const [key, s] of Object.entries(this.state.sessions))
        if (s.driverId === id) delete this.state.sessions[key];
      this.event("DRIVER_UPDATED", adminId, undefined, id);
      return this.profile(id, true);
    });
  }
  login(email: string, password: string) {
    return this.repo.transaction(() => {
      const key = String(email || "")
          .trim()
          .toLowerCase(),
        f = this.state.loginFailures[key];
      if (f && f.count >= 5 && f.until > this.now())
        return {
          error: "Demasiados intentos. Intenta más tarde.",
          status: 429,
        };
      const a = Object.values(this.state.accounts).find(
        (a) => a.email === key && a.enabled,
      );
      const computed = passwordHash(
        String(password || "").slice(0, 200),
        a?.salt || "invalid-account-salt",
      );
      if (!a || !equal(computed, a.passwordHash)) {
        this.state.loginFailures[key] = {
          count: f && f.until > this.now() ? f.count + 1 : 1,
          until: this.now() + 15 * 60_000,
        };
        return { error: "Credenciales inválidas", status: 401 };
      }
      delete this.state.loginFailures[key];
      const token = secret();
      this.state.sessions[hash(token)] = {
        driverId: a.driverId,
        expiresAt: this.now() + this.state.config.driverSessionHours * 3600_000,
      };
      return { token, profile: this.profile(a.driverId) };
    });
  }
  authenticate(token?: string) {
    const s = token ? this.state.sessions[hash(token)] : null;
    return s &&
      s.expiresAt > this.now() &&
      this.state.accounts[s.driverId]?.enabled
      ? s.driverId
      : null;
  }
  logout(token: string) {
    this.repo.transaction(() => {
      delete this.state.sessions[hash(token)];
    });
  }
  profile(id: string, allowDisabled = false) {
    const a = allowDisabled ? this.state.accounts[id] : this.account(id),
      d = this.repo.getDriverById(id)!;
    const age = Math.max(
      0,
      (this.now() - Date.parse(d.currentLocation.updatedAt)) / 1000,
    );
    return {
      userId: a.userId,
      driverId: id,
      name: d.name,
      email: a.email,
      enabled: a.enabled,
      status: a.status,
      storeIds: a.storeIds,
      activeDispatchId: a.activeDispatchId,
      vehicle: this.deps.transport().vehicles.find((v) => v.driverId === id),
      location: {
        ...d.currentLocation,
        ageSeconds: age,
        stale: age > this.state.config.locationMaxAgeSeconds,
      },
      heartbeatStale:
        !a.heartbeatAt ||
        this.now() - a.heartbeatAt >
          this.state.config.heartbeatMaxAgeSeconds * 1000,
    };
  }
  shift(id: string, action: string) {
    return this.repo.transaction(() => {
      const a = this.account(id),
        d = this.repo.getDriverById(id)!;
      if (!["START", "END"].includes(action))
        fail("INVALID_ACTION", "Turno inválido", 400);
      if (a.activeDispatchId)
        fail(
          "ACTIVE_ASSIGNMENT",
          "Finaliza o libera tu despacho antes de cambiar el turno",
        );
      a.status = action === "START" ? "AVAILABLE" : "OFF_DUTY";
      a.heartbeatAt = this.now();
      d.isOnline = action === "START";
      d.currentStatus = d.isOnline ? "DISPONIBLE" : "FUERA_DE_TURNO";
      this.event("SHIFT_" + action, id);
      return this.profile(id);
    });
  }
  heartbeat(id: string) {
    return this.repo.transaction(() => {
      const a = this.account(id);
      if (a.status === "OFF_DUTY")
        fail("OFF_DUTY", "Inicia turno antes de informar disponibilidad");
      a.heartbeatAt = this.now();
      return this.profile(id);
    });
  }
  location(
    id: string,
    p: {
      latitude: number;
      longitude: number;
      accuracy: number;
      timestamp: number;
    },
  ) {
    return this.repo.transaction(() => {
      const a = this.account(id),
        d = this.repo.getDriverById(id)!;
      if (a.status === "OFF_DUTY")
        fail("OFF_DUTY", "No se registra ubicación fuera de turno");
      if (
        !p ||
        ![p.latitude, p.longitude, p.accuracy, p.timestamp].every(
          Number.isFinite,
        ) ||
        Math.abs(p.latitude) > 90 ||
        Math.abs(p.longitude) > 180 ||
        p.accuracy < 0 ||
        p.timestamp > this.now() + 10000 ||
        p.timestamp < this.now() - 86400_000 ||
        p.timestamp < Date.parse(d.currentLocation.updatedAt)
      )
        fail(
          "INVALID_LOCATION",
          "Ubicación inválida o anterior al último dato",
          400,
        );
      d.currentLocation = {
        lat: p.latitude,
        lng: p.longitude,
        updatedAt: new Date(p.timestamp).toISOString(),
      };
      a.accuracy = p.accuracy;
      a.heartbeatAt = this.now();
      return this.profile(id);
    });
  }
  updateConfig(config: DispatchConfig, adminId: string) {
    return this.repo.transaction(() => {
      const keys = Object.keys(this.state.config);
      if (
        !config ||
        keys.some(
          (k) =>
            !Number.isSafeInteger((config as any)[k]) ||
            (config as any)[k] < 1 ||
            (config as any)[k] > 86400,
        ) ||
        config.offerSeconds > config.searchSeconds ||
        config.pinAttempts > 10 ||
        config.driverSessionHours > 48
      )
        fail("INVALID_CONFIG", "Parámetros operativos inválidos", 400);
      this.state.config = Object.fromEntries(
        keys.map((k) => [k, (config as any)[k]]),
      ) as any;
      this.event("CONFIG_CHANGED", adminId);
      return this.state.config;
    });
  }
  private fit(r: DispatchRun, v: TransportVehicle) {
    const { order, shipment } = this.target(r),
      mode = order.deliveryMode === "PROGRAMADO" ? "PROGRAMADO" : "TURBO";
    if (
      !v.enabled ||
      !v.storeIds.includes(order.storeId) ||
      !v.modes.includes(mode)
    )
      return null;
    const slot = order.scheduledWindow
      ? `${order.scheduledWindow.date}|${order.scheduledWindow.slotId}`
      : undefined;
    const fake = {
      id: v.driverId,
      isOnline: true,
      currentStatus: "DISPONIBLE",
    } as DriverProfile;
    const plan = planTransport(
      shipment.items,
      this.deps.products(),
      order.storeId,
      mode,
      {
        config: {
          ...this.deps.transport(),
          maxDispatches: 1,
          vehicles: [{ ...v, externalOffer: undefined }],
          externalProviders: [],
        },
        drivers: [fake],
        orders: [],
      },
      slot,
    );
    return plan.feasible && plan.shipments.length === 1
      ? plan.shipments[0]
      : null;
  }
  private eligible(r: DispatchRun, id: string, allowOffer = false) {
    const a = this.state.accounts[id],
      d = this.repo.getDriverById(id),
      v = this.deps.transport().vehicles.find((v) => v.driverId === id),
      { order } = this.target(r),
      now = this.now(),
      c = this.state.config;
    if (
      !a?.enabled ||
      !d ||
      !v ||
      !(
        a.status === "AVAILABLE" ||
        (allowOffer &&
          a.status === "OFFER_PENDING" &&
          a.activeDispatchId === r.id)
      ) ||
      !a.storeIds.includes(order.storeId) ||
      (a.activeDispatchId && a.activeDispatchId !== r.id) ||
      !a.heartbeatAt ||
      now - a.heartbeatAt > c.heartbeatMaxAgeSeconds * 1000 ||
      !Number.isFinite(Date.parse(d.currentLocation.updatedAt)) ||
      now - Date.parse(d.currentLocation.updatedAt) >
        c.locationMaxAgeSeconds * 1000 ||
      Date.parse(d.currentLocation.updatedAt) > now + 10000 ||
      a.accuracy === undefined ||
      a.accuracy > c.locationAccuracyMeters
    )
      return null;
    if (
      this.repo
        .getAllOrders()
        .some((o) =>
          (o.childShipments?.length ? o.childShipments : [o]).some(
            (s) =>
              s.assignmentId !== r.id &&
              s.driver?.id === id &&
              (!terminal(s.fulfillmentStatus) || s.physicalReturnPending),
          ),
        )
    )
      return null;
    return this.fit(r, v) ? { driver: d, vehicle: v } : null;
  }
  private windowEnd(order: Order) {
    return order.scheduledWindow
      ? Date.parse(
          `${order.scheduledWindow.date}T${order.scheduledWindow.endTime}:00-05:00`,
        )
      : Date.parse(order.originalPromiseWindow.end);
  }
  private windowAllows(order: Order, seconds: number) {
    return (
      this.now() +
        (seconds + Math.max(0, order.estimatedDeliveryMinutes * 60)) * 1000 <=
      this.windowEnd(order)
    );
  }
  async search(id: string, adminId = "SYSTEM") {
    if (this.inFlight.has(id)) return;
    this.inFlight.add(id);
    try {
      const r = this.run(id),
        { order, shipment } = this.target(r);
      if (
        order.scheduledWindow &&
        this.now() + Math.max(0, order.estimatedDeliveryMinutes * 60) * 1000 <
          Date.parse(
            `${order.scheduledWindow.date}T${order.scheduledWindow.startTime}:00-05:00`,
          )
      )
        return;
      if (
        r.external &&
        ["REQUESTING", "UNKNOWN", "ACCEPTED", "ASSIGNED"].includes(
          r.external.status,
        )
      )
        return;
      if (
        !["PENDING", "SEARCHING"].includes(r.status) ||
        shipment.fulfillmentStatus !== "LISTO_PARA_DESPACHO"
      )
        return;
      if (
        this.now() >= this.windowEnd(order) ||
        (r.searchStartedAt !== undefined &&
          this.now() - r.searchStartedAt >=
            this.state.config.searchSeconds * 1000)
      ) {
        this.repo.transaction(() => {
          r.status = "SEARCH_EXHAUSTED";
          r.reason = "NO_CAPACITY_WITHIN_SEARCH_WINDOW";
          this.event("SEARCH_EXHAUSTED", "SYSTEM", id);
        });
        return;
      }
      this.repo.transaction(() => {
        r.status = "SEARCHING";
        r.searchStartedAt ??= this.now();
      });
      const store = this.deps
        .stores()
        .find((s) => s.id === order.storeId && s.isActive);
      if (!store) {
        this.repo.transaction(() => {
          r.status = "SEARCH_EXHAUSTED";
          r.reason = "WAREHOUSE_INACTIVE";
        });
        return;
      }
      const candidates: {
        id: string;
        vehicle: TransportVehicle;
        estimate: PickupEstimate;
      }[] = [];
      for (const a of Object.values(this.state.accounts)) {
        if (r.attempted.includes(a.driverId)) continue;
        const c = this.eligible(r, a.driverId);
        if (!c) continue;
        let route: PickupEstimate | null = null;
        try {
          route = this.deps.routeEstimate
            ? await this.bounded(this.deps.routeEstimate(c.driver, store))
            : null;
        } catch {}
        const valid =
          route?.kind === "ROUTE" &&
          Number.isFinite(route.seconds) &&
          route.seconds! >= 0 &&
          route.observedAt <= this.now() &&
          this.now() - route.observedAt <=
            this.state.config.routeMaxAgeSeconds * 1000;
        const estimate: PickupEstimate = valid
          ? route!
          : {
              kind: "GEOGRAPHIC",
              meters: Math.round(
                distance(c.driver.currentLocation, store.coordinates),
              ),
              source: "HAVERSINE_ESTIMATE_NOT_ETA",
              observedAt: this.now(),
            };
        if (valid && !this.windowAllows(order, estimate.seconds!)) continue;
        candidates.push({ id: a.driverId, vehicle: c.vehicle, estimate });
      }
      // Only comparable route times are ordered as ETA. Geographic fallback makes no promise of minutes.
      const allRouted = candidates.every((c) => c.estimate.kind === "ROUTE");
      candidates.sort(
        (a, b) =>
          (allRouted
            ? a.estimate.seconds! - b.estimate.seconds!
            : distance(
                this.repo.getDriverById(a.id)!.currentLocation,
                store.coordinates,
              ) -
              distance(
                this.repo.getDriverById(b.id)!.currentLocation,
                store.coordinates,
              )) || a.id.localeCompare(b.id),
      );
      const quotes: { provider: DispatchProvider; quote: ProviderQuote }[] = [];
      for (const p of this.deps.providers || []) {
        if (
          !this.deps.simulation ||
          !p.simulation ||
          !p.capabilities.quote ||
          !p.capabilities.request ||
          !p.capabilities.status ||
          r.attempted.includes("provider:" + p.id) ||
          (r.cashDue > 0 && !p.capabilities.cashCollection)
        )
          continue;
        try {
          const q = await this.bounded(
            p.quote({
              dispatchId: id,
              storeId: order.storeId,
              mode: order.deliveryMode || "TURBO",
              cashCOP: r.cashDue,
            }),
          );
          if (
            q &&
            q.simulation &&
            q.providerId === p.id &&
            q.expiresAt > this.now() &&
            Number.isSafeInteger(q.costCOP) &&
            q.costCOP >= 0 &&
            q.estimate.kind === "ROUTE" &&
            Number.isFinite(q.estimate.seconds) &&
            q.estimate.seconds! >= 0 &&
            q.estimate.observedAt <= this.now() &&
            this.now() - q.estimate.observedAt <=
              this.state.config.routeMaxAgeSeconds * 1000 &&
            this.windowAllows(order, q.estimate.seconds!) &&
            this.fit(r, q.vehicle) &&
            (!r.cashDue || q.canCollectCash) &&
            this.externalCostAllowed(r, q.costCOP)
          )
            quotes.push({ provider: p, quote: q });
        } catch {}
      }
      quotes.sort(
        (a, b) =>
          a.quote.estimate.seconds! - b.quote.estimate.seconds! ||
          a.provider.id.localeCompare(b.provider.id),
      );
      if (r !== this.state.runs[id] || r.status !== "SEARCHING") return;
      if (
        this.now() >= this.windowEnd(order) ||
        this.now() - r.searchStartedAt! >=
          this.state.config.searchSeconds * 1000
      ) {
        this.repo.transaction(() => {
          r.status = "SEARCH_EXHAUSTED";
          r.reason = "SEARCH_WINDOW_ELAPSED";
          this.event("SEARCH_EXHAUSTED", "SYSTEM", id);
        });
        return;
      }
      const own = candidates.find((c) => this.eligible(r, c.id)),
        external = quotes[0];
      // When estimates are not comparable, prefer an eligible own driver, without claiming external proximity.
      const useExternal =
        external &&
        (!own ||
          (own.estimate.kind === "ROUTE" &&
            external.quote.estimate.seconds! +
              this.state.config.routeTieSeconds <
              own.estimate.seconds!));
      if (useExternal) {
        await this.requestExternal(r, external.provider, external.quote);
        return;
      }
      if (own)
        this.repo.transaction(() => {
          if (r.status !== "SEARCHING" || !this.eligible(r, own.id)) return;
          const offer: DispatchOffer = {
            id: crypto.randomUUID(),
            dispatchId: id,
            driverId: own.id,
            createdAt: this.now(),
            expiresAt: this.now() + this.state.config.offerSeconds * 1000,
            status: "PENDING",
            estimate: own.estimate,
            vehicle: own.vehicle,
          };
          this.state.offers[offer.id] = offer;
          r.offerId = offer.id;
          r.status = "OFFER_PENDING";
          r.estimate = own.estimate;
          r.attempted.push(own.id);
          r.reason = allRouted
            ? "LOWEST_COMPARABLE_PICKUP_ETA"
            : "GEOGRAPHIC_PICKUP_ESTIMATE";
          const a = this.account(own.id);
          a.status = "OFFER_PENDING";
          a.activeDispatchId = id;
          const d = this.repo.getDriverById(own.id)!;
          d.currentStatus = "OFERTA_PENDIENTE";
          d.activeAssignmentId = id;
          this.event("OFFER_CREATED", adminId, id, offer.id);
        });
      else
        this.repo.transaction(() => {
          r.reason = "NO_ELIGIBLE_CAPACITY";
          this.event("NO_ELIGIBLE_CAPACITY", "SYSTEM", id);
        });
    } finally {
      this.inFlight.delete(id);
    }
  }
  private externalCostAllowed(r: DispatchRun, cost: number) {
    const { order, shipment } = this.target(r);
    const contracted = Object.values(this.state.runs)
      .filter(
        (x) =>
          x.orderId === order.id &&
          x.id !== r.id &&
          x.external &&
          !["CANCELLED", "REJECTED"].includes(x.external.status),
      )
      .reduce((sum, x) => sum + x.external!.costCOP, 0);
    return cost + contracted <= order.totals.shipping;
  }
  private async requestExternal(
    r: DispatchRun,
    p: DispatchProvider,
    q: ProviderQuote,
  ) {
    let request = false;
    this.repo.transaction(() => {
      if (
        r !== this.state.runs[r.id] ||
        r.status !== "SEARCHING" ||
        q.expiresAt <= this.now() ||
        !this.fit(r, q.vehicle) ||
        (r.external &&
          !["REJECTED", "CANCELLED"].includes(r.external.status)) ||
        !this.externalCostAllowed(r, q.costCOP)
      )
        return;
      const key = `${r.id}:${crypto.randomUUID()}`;
      r.attempted.push("provider:" + p.id);
      r.external = {
        key,
        providerId: p.id,
        status: "REQUESTING",
        quoteId: q.id,
        providerName: p.name,
        confirmedLoad: this.fit(r, q.vehicle)!,
        costCOP: q.costCOP,
        startedAt: this.now(),
        updatedAt: this.now(),
        simulation: true,
        estimate: q.estimate,
      };
      r.reason = "EXTERNAL_REQUEST_PENDING";
      this.event("EXTERNAL_REQUESTED", "SYSTEM", r.id, p.id);
      request = true;
    });
    if (!request) return;
    const key = r.external!.key;
    const pending = p.request({
      idempotencyKey: key,
      quote: q,
      dispatchId: r.id,
    });
    // A timed-out call can still complete. Apply that response only to the same durable request key.
    void pending
      .then((result) => this.applyExternal(r.id, key, result))
      .catch(() => {});
    try {
      this.applyExternal(r.id, key, await this.bounded(pending));
    } catch {
      this.applyExternal(r.id, key, { status: "UNKNOWN" });
    }
  }
  applyExternal(id: string, key: string, result: ProviderResult) {
    this.repo.transaction(() => {
      const r = this.run(id),
        e = r.external;
      if (
        !e ||
        e.key !== key ||
        ["CANCELLED", "REJECTED"].includes(e.status) ||
        ["DELIVERED", "CANCELLED"].includes(r.status)
      )
        return;
      if (
        !["UNKNOWN", "ACCEPTED", "ASSIGNED", "REJECTED", "CANCELLED"].includes(
          result.status,
        )
      )
        fail("INVALID_PROVIDER_STATUS", "Estado del proveedor inválido");
      if (
        e.status === "ASSIGNED" &&
        ["UNKNOWN", "ACCEPTED", "REJECTED"].includes(result.status)
      )
        return;
      if (e.status === "ASSIGNED" && result.status === "ASSIGNED") return;
      if (result.status === "CANCELLED") e.cancellationPending = false;
      e.status =
        result.status === "ASSIGNED" && !result.driver
          ? "ACCEPTED"
          : result.status;
      e.reference = result.reference || e.reference;
      e.updatedAt = this.now();
      if (result.status === "ASSIGNED" && result.driver) {
        const { order, shipment } = this.target(r);
        if (
          shipment.fulfillmentStatus !== "LISTO_PARA_DESPACHO" &&
          r.status !== "ASSIGNED"
        ) {
          r.status = "INCIDENT";
          r.reason = "LATE_EXTERNAL_ASSIGNMENT_REQUIRES_RECONCILIATION";
          return;
        }
        e.driver = { id: result.driver.id, name: result.driver.name };
        if (e.confirmedLoad) shipment.transportLoad = e.confirmedLoad;
        r.providerId = e.providerId;
        r.estimate = e.estimate;
        r.status = "ASSIGNED";
        r.assignedAt ??= this.now();
        this.checkResult(
          this.repo.transitionStatus(
            order.id,
            "REPARTIDOR_ASIGNADO",
            { role: "SISTEMA" },
            { shipmentId: r.shipmentId },
          ),
        );
        this.event("DISPATCH_ASSIGNED", "SYSTEM", id, e.providerId);
      } else if (
        result.status === "REJECTED" ||
        result.status === "CANCELLED"
      ) {
        const { order, shipment } = this.target(r);
        if (r.pickedUpAt) {
          r.status = "INCIDENT";
          r.reason = "EXTERNAL_CUSTODY_REQUIRES_RECONCILIATION";
        } else {
          if (shipment.fulfillmentStatus === "REPARTIDOR_ASIGNADO")
            this.checkResult(
              this.repo.transitionStatus(
                order.id,
                "LISTO_PARA_DESPACHO",
                { role: "SISTEMA" },
                { shipmentId: r.shipmentId },
              ),
            );
          r.status = "PENDING";
          r.providerId = undefined;
          r.assignedAt = undefined;
          r.reason = "EXTERNAL_" + result.status;
        }
        this.event("EXTERNAL_" + result.status, "SYSTEM", id);
      } else {
        r.reason =
          result.status === "UNKNOWN"
            ? "EXTERNAL_RESULT_UNKNOWN_RECONCILE"
            : "EXTERNAL_ACCEPTED_AWAITING_DRIVER";
      }
    });
  }
  async reconcile(id: string) {
    const r = this.run(id),
      e = r.external;
    if (!e || ["CANCELLED", "REJECTED"].includes(e.status)) return;
    const p = this.deps.providers?.find(
      (p) => p.id === e.providerId && p.simulation && this.deps.simulation,
    );
    if (!p?.capabilities.status) return;
    try {
      this.applyExternal(
        id,
        e.key,
        await this.bounded(p.status(e.reference || e.key)),
      );
    } catch {
      /* Keep unknown/pending. Never book a second service on timeout. */
    }
  }
  respond(id: string, offerId: string, action: "accept" | "reject") {
    const response = this.repo.transaction(() => {
      const o = this.state.offers[offerId];
      if (!o || o.driverId !== id)
        fail("FORBIDDEN", "Oferta no autorizada", 403);
      const r = this.run(o.dispatchId);
      this.account(id);
      if (o.status === "ACCEPTED" && action === "accept" && r.driverId === id)
        return { ok: true, dispatchId: r.id };
      if (o.status !== "PENDING" || r.offerId !== offerId)
        fail("OFFER_CLOSED", "La oferta ya no está disponible");
      if (o.expiresAt <= this.now() || action === "reject") {
        o.status = action === "reject" ? "REJECTED" : "EXPIRED";
        this.unreserveOffer(o);
        r.status = "PENDING";
        r.offerId = undefined;
        this.event("OFFER_" + o.status, id, r.id);
        return { ok: false, dispatchId: r.id };
      }
      const candidate = this.eligible(r, id, true),
        { order, shipment } = this.target(r);
      if (
        !candidate ||
        shipment.fulfillmentStatus !== "LISTO_PARA_DESPACHO" ||
        this.now() >= this.windowEnd(order)
      )
        fail(
          "NO_LONGER_ELIGIBLE",
          "El conductor, vehículo o ventana ya no son elegibles",
        );
      shipment.transportLoad = this.fit(r, candidate!.vehicle)!;
      this.checkResult(
        this.repo.assignDriver(order.id, id, { role: "SISTEMA" }, r.shipmentId),
      );
      o.status = "ACCEPTED";
      r.status = "ASSIGNED";
      r.driverId = id;
      r.assignedAt = this.now();
      r.providerId = "OWN";
      r.reason = undefined;
      const a = this.account(id);
      a.status = "BUSY";
      a.activeDispatchId = r.id;
      const d = this.repo.getDriverById(id)!;
      d.activeOrderId = order.id;
      d.activeAssignmentId = r.id;
      d.currentStatus = "EN_RUTA_A_HUB";
      this.event("DISPATCH_ASSIGNED", id, r.id);
      return { ok: true, dispatchId: r.id };
    });
    return response;
  }
  arrived(id: string, dispatchId: string) {
    return this.repo.transaction(() => {
      const r = this.run(dispatchId);
      this.assertOwned(r, id);
      if (r.status !== "ASSIGNED")
        fail("INVALID_STATE", "No hay una recogida asignada");
      r.arrivedAt ??= this.now();
      this.event("ARRIVED_HUB", id, r.id);
      return this.driverDispatch(r, id);
    });
  }
  pickup(id: string, dispatchId: string, packages: number) {
    return this.repo.transaction(() => {
      const r = this.run(dispatchId);
      this.assertOwned(r, id);
      if (r.status === "PICKED_UP") return this.driverDispatch(r, id);
      if (r.status !== "ASSIGNED" || r.releaseRequested)
        fail("INVALID_STATE", "La recogida no está autorizada");
      const { order, shipment } = this.target(r);
      const vehicle = this.deps
        .transport()
        .vehicles.find((v) => v.driverId === id);
      if (!vehicle || !this.fit(r, vehicle))
        fail(
          "CAPACITY_CHANGED",
          "La capacidad del vehículo debe volver a validarse antes de recoger",
        );
      if (packages !== shipment.items.reduce((n, i) => n + i.quantity, 0))
        fail(
          "PACKAGE_MISMATCH",
          "Confirma las unidades vendibles completas indicadas",
          400,
        );
      this.checkResult(
        this.repo.confirmPickup(order.id, actor(id), r.shipmentId),
      );
      r.status = "PICKED_UP";
      r.pickedUpAt = this.now();
      this.repo.getDriverById(id)!.currentStatus = "EN_CAMINO_CLIENTE";
      this.event("PICKUP_CONFIRMED", id, r.id);
      return this.driverDispatch(r, id);
    });
  }
  deliver(id: string, dispatchId: string, pin: string, amount: number) {
    return this.finishDelivery(dispatchId, pin, amount, id, false);
  }
  private finishDelivery(
    dispatchId: string,
    pin: string,
    amount: number,
    id: string,
    external: boolean,
  ) {
    const result = this.repo.transaction(() => {
      const r = this.run(dispatchId);
      if (!external) this.assertOwned(r, id);
      else if (!r.external || r.external.status !== "ASSIGNED")
        fail("INVALID_STATE", "Servicio externo no asignado");
      if (r.status === "DELIVERED") return { ok: true };
      if (r.status !== "PICKED_UP" || (r.transfer && !r.transfer.acceptedAt))
        fail("INVALID_STATE", "Confirma recogida y custodia antes de entregar");
      if (r.pinLockedUntil && r.pinLockedUntil > this.now())
        return { ok: false, status: 429 };
      if (
        !Number.isSafeInteger(amount) ||
        amount !== r.cashDue - r.cashCollected
      )
        fail(
          "CASH_MISMATCH",
          "El recaudo debe coincidir con el saldo autorizado para este despacho",
          400,
        );
      const { order, shipment } = this.target(r);
      if (
        !/^\d{4}$/.test(String(pin)) ||
        !equal(String(pin), shipment.secretDeliveryCode)
      ) {
        r.pinFailures++;
        if (r.pinFailures >= this.state.config.pinAttempts)
          r.pinLockedUntil = this.now() + 15 * 60_000;
        this.event("DELIVERY_PIN_REJECTED", id, r.id);
        return { ok: false, status: 403 };
      }
      // Inventory is derived from existing persisted order state by CatalogOperations, not adjusted a second time.
      this.checkResult(
        this.repo.verifyDelivery(
          order.id,
          pin,
          external ? { role: "ADMINISTRADOR", id } : actor(id),
          r.shipmentId,
        ),
      );
      r.status = "DELIVERED";
      r.deliveredAt = this.now();
      r.cashCollected += amount;
      if (!external) this.repo.getDriverById(id)!.cashBalance += amount;
      const totalCollected = Object.values(this.state.runs)
        .filter((x) => x.orderId === order.id)
        .reduce((n, x) => n + x.cashCollected, 0);
      order.payment.cashToCollect = Math.max(
        0,
        (order.payment.method === "CASH_ON_DELIVERY" ? order.totals.total : 0) -
          totalCollected,
      );
      // Delivered != settled at warehouse. Separate settlement ledger is explicit.
      order.payment.cashSettled = order.payment.method !== "CASH_ON_DELIVERY";
      this.releaseDriver(r);
      this.event("DELIVERED", id, r.id);
      return { ok: true };
    });
    if (!result.ok)
      fail(
        "PIN_REJECTED",
        "No se pudo verificar el código de entrega",
        result.status,
      );
    return { ok: true };
  }
  incident(id: string, dispatchId: string, type: string) {
    return this.repo.transaction(() => {
      const r = this.run(dispatchId);
      this.assertOwned(r, id);
      if (!["ASSIGNED", "PICKED_UP", "INCIDENT"].includes(r.status))
        fail("INVALID_STATE", "Incidencia no aplicable");
      const { order } = this.target(r);
      this.checkResult(
        this.repo.reportIncident(
          order.id,
          actor(id),
          "DRIVER_INCIDENT",
          String(type || "NOVEDAD").slice(0, 200),
          r.shipmentId,
        ),
      );
      r.status = "INCIDENT";
      r.reason = "DRIVER_INCIDENT";
      this.event("INCIDENT", id, r.id);
    });
  }
  requestRelease(dispatchId: string, adminId: string) {
    return this.repo.transaction(() => {
      const r = this.run(dispatchId);
      if (r.pickedUpAt)
        fail(
          "CUSTODY_TRANSFER_REQUIRED",
          "Después de recoger se requiere transferencia de custodia autorizada",
        );
      if (r.external && !["CANCELLED", "REJECTED"].includes(r.external.status))
        fail(
          "EXTERNAL_CANCEL_REQUIRED",
          "Cancela y reconcilia primero el servicio externo",
        );
      if (r.status === "OFFER_PENDING") {
        const o = this.state.offers[r.offerId!]!;
        o.status = "RELEASED";
        this.unreserveOffer(o);
        r.status = "PENDING";
        r.offerId = undefined;
      } else if (r.status === "ASSIGNED") r.releaseRequested = true;
      else fail("INVALID_STATE", "No existe asignación que liberar");
      this.event("RELEASE_REQUESTED", adminId, r.id);
      return r;
    });
  }
  confirmRelease(id: string, dispatchId: string) {
    return this.repo.transaction(() => {
      const r = this.run(dispatchId);
      this.assertOwned(r, id);
      if (!r.releaseRequested || r.pickedUpAt)
        fail("INVALID_STATE", "Liberación no autorizada");
      const { order, shipment } = this.target(r);
      this.checkResult(
        this.repo.transitionStatus(
          order.id,
          "LISTO_PARA_DESPACHO",
          { role: "SISTEMA" },
          { shipmentId: r.shipmentId },
        ),
      );
      this.releaseDriver(r);
      shipment.driver = undefined;
      r.driverId = undefined;
      r.providerId = undefined;
      r.assignedAt = undefined;
      r.status = "PENDING";
      r.releaseRequested = false;
      r.offerId = undefined;
      this.event("RELEASE_CONFIRMED", id, r.id);
    });
  }
  async cancelExternal(id: string, adminId: string) {
    const r = this.run(id);
    if (r.pickedUpAt)
      fail(
        "CUSTODY_TRANSFER_REQUIRED",
        "No se cancela automáticamente un servicio con custodia",
      );
    const e = r.external,
      p = this.deps.providers?.find((p) => p.id === e?.providerId);
    if (!e || !p?.capabilities.cancel || !p.simulation || !this.deps.simulation)
      fail(
        "CANCELLATION_UNAVAILABLE",
        "Cancelación no disponible; requiere reconciliación con el proveedor",
      );
    this.repo.transaction(() => {
      e!.cancellationPending = true;
      r.reason = "EXTERNAL_CANCELLATION_PENDING";
      this.event("EXTERNAL_CANCELLATION_REQUESTED", adminId, id);
    });
    let result: ProviderResult;
    try {
      result = await this.bounded(p!.cancel(e!.reference || e!.key));
    } catch {
      result = { status: "UNKNOWN" };
    }
    if (result.status !== "CANCELLED") {
      this.repo.transaction(() => {
        r.reason = "EXTERNAL_CANCELLATION_UNCONFIRMED";
        this.event("CANCELLATION_UNCONFIRMED", adminId, id);
      });
      return;
    }
    this.repo.transaction(() => {
      if (
        r !== this.state.runs[id] ||
        r.external?.key !== e!.key ||
        r.pickedUpAt
      )
        fail("STATE_CHANGED", "El estado cambió; reconcilia el servicio");
      const { order, shipment } = this.target(r);
      if (shipment.fulfillmentStatus === "REPARTIDOR_ASIGNADO")
        this.checkResult(
          this.repo.transitionStatus(
            order.id,
            "LISTO_PARA_DESPACHO",
            { role: "SISTEMA" },
            { shipmentId: r.shipmentId },
          ),
        );
      e!.status = "CANCELLED";
      e!.cancellationPending = false;
      r.assignedAt = undefined;
      r.status = "PENDING";
      r.providerId = undefined;
      this.event("EXTERNAL_CANCELLED", adminId, id);
    });
  }
  restart(id: string, adminId: string) {
    this.repo.transaction(() => {
      const r = this.run(id);
      if (r.status !== "SEARCH_EXHAUSTED")
        fail(
          "INVALID_STATE",
          "Solo se reinicia una búsqueda agotada sin asignación",
        );
      r.status = "PENDING";
      r.searchStartedAt = undefined;
      r.attempted = [];
      this.event("SEARCH_RESTARTED", adminId, id);
    });
  }
  /** Only a supervised simulator action; no public webhook impersonation. Live callbacks require provider verification. */
  externalProgress(
    id: string,
    action: string,
    adminId: string,
    pin?: string,
    amount = 0,
  ) {
    const r = this.run(id);
    if (
      !this.deps.simulation ||
      !r.external?.simulation ||
      r.external.status !== "ASSIGNED" ||
      r.external.cancellationPending
    )
      fail("SIMULATION_ONLY", "Acción disponible solo para servicio simulado");
    if (action === "delivered")
      return this.finishDelivery(id, String(pin), amount, adminId, true);
    return this.repo.transaction(() => {
      if (action !== "pickup" || r.status !== "ASSIGNED")
        fail("INVALID_STATE", "Estado simulado inválido");
      this.checkResult(
        this.repo.confirmPickup(
          r.orderId,
          { role: "ADMINISTRADOR", id: adminId },
          r.shipmentId,
        ),
      );
      r.status = "PICKED_UP";
      r.pickedUpAt = this.now();
      this.event("SIMULATED_PICKUP", adminId, id);
      return { ok: true };
    });
  }
  reconcileLegacy(
    dispatchId: string,
    input: { driverId?: string; cashDueCOP: number; note: string },
    adminId: string,
  ) {
    return this.repo.transaction(() => {
      const r = this.run(dispatchId),
        { order, shipment } = this.target(r);
      if (
        r.reason !== "LEGACY_ASSIGNMENT_REQUIRES_RECONCILIATION" ||
        terminal(shipment.fulfillmentStatus)
      )
        fail(
          "INVALID_LEGACY",
          "Solo aplica a un despacho histórico activo pendiente de conciliación",
        );
      if (
        !input.note?.trim() ||
        !Number.isSafeInteger(input.cashDueCOP) ||
        input.cashDueCOP < 0
      )
        fail(
          "RECONCILIATION_REQUIRED",
          "Confirma saldo pendiente e incidencia",
          400,
        );
      const other = Object.values(this.state.runs)
        .filter((x) => x.orderId === order.id && x.id !== r.id)
        .reduce((n, x) => n + x.cashDue - x.cashCollected, 0);
      const outstanding =
        order.payment.method === "CASH_ON_DELIVERY"
          ? order.payment.cashToCollect || 0
          : 0;
      if (input.cashDueCOP + other > outstanding)
        fail("CASH_MISMATCH", "El saldo supera el pendiente de la compra");
      if (shipment.driver) {
        if (input.driverId !== shipment.driver.id)
          fail(
            "CUSTODY_MISMATCH",
            "La conciliación debe conservar al conductor previamente registrado",
          );
        const a = this.account(input.driverId!);
        if (a.activeDispatchId && a.activeDispatchId !== r.id)
          fail("DRIVER_BUSY", "El conductor tiene otro despacho");
        const v = this.deps
          .transport()
          .vehicles.find((v) => v.driverId === input.driverId);
        if (!v || !this.fit(r, v))
          fail(
            "CAPACITY_PENDING",
            "Configura y verifica el vehículo antes de conciliar",
          );
        a.status = "BUSY";
        a.activeDispatchId = r.id;
        r.driverId = input.driverId;
        r.providerId = "OWN";
        r.assignedAt = Date.parse(
          shipment.timestamps.assignedAt || new Date(this.now()).toISOString(),
        );
        const d = this.repo.getDriverById(input.driverId!)!;
        d.activeAssignmentId = r.id;
        d.activeOrderId = order.id;
        d.isOnline = true;
        d.currentStatus = shipment.timestamps.pickedUpAt
          ? "EN_CAMINO_CLIENTE"
          : "EN_RUTA_A_HUB";
        r.pickedUpAt = shipment.timestamps.pickedUpAt
          ? Date.parse(shipment.timestamps.pickedUpAt)
          : undefined;
        r.status = r.pickedUpAt ? "PICKED_UP" : "ASSIGNED";
      } else {
        if (shipment.fulfillmentStatus === "EN_CAMINO")
          fail(
            "CUSTODY_REQUIRED",
            "Resuelve primero la custodia física del pedido histórico",
          );
        r.status = "PENDING";
      }
      r.cashDue = input.cashDueCOP;
      r.reason = undefined;
      this.event("LEGACY_RECONCILED", adminId, r.id, input.note.slice(0, 200));
      return { ok: true };
    });
  }
  quoteDrivers() {
    return this.repo.getAllDrivers().map((d) => {
      const a = this.state.accounts[d.id];
      return {
        ...d,
        operationalEligible:
          !!a?.enabled &&
          a.status === "AVAILABLE" &&
          !!a.heartbeatAt &&
          this.now() - a.heartbeatAt <=
            this.state.config.heartbeatMaxAgeSeconds * 1000 &&
          this.now() - Date.parse(d.currentLocation.updatedAt) <=
            this.state.config.locationMaxAgeSeconds * 1000,
      };
    });
  }
  requestTransfer(id: string, to: string, adminId: string) {
    return this.repo.transaction(() => {
      const r = this.run(id);
      if (
        !r.pickedUpAt ||
        !r.driverId ||
        (r.external &&
          !["CANCELLED", "REJECTED"].includes(r.external.status)) ||
        !["PICKED_UP", "INCIDENT"].includes(r.status) ||
        r.transfer
      )
        fail(
          "INVALID_CUSTODY",
          "La transferencia requiere custodia propia activa",
        );
      if (!this.eligible(r, to))
        fail(
          "INELIGIBLE_DRIVER",
          "El receptor no tiene capacidad o disponibilidad comprobada",
        );
      r.transfer = { from: r.driverId!, to, requestedBy: adminId };
      const a = this.account(to);
      a.status = "OFFER_PENDING";
      a.activeDispatchId = id;
      this.repo.getDriverById(to)!.currentStatus = "OFERTA_PENDIENTE";
      this.event("CUSTODY_TRANSFER_REQUESTED", adminId, id);
      return r.transfer;
    });
  }
  releaseCustody(id: string, dispatchId: string) {
    return this.repo.transaction(() => {
      const r = this.run(dispatchId);
      this.assertOwned(r, id);
      if (!r.transfer || r.transfer.from !== id)
        fail("INVALID_CUSTODY", "No existe transferencia autorizada");
      r.transfer!.releasedAt ??= this.now();
      this.event("CUSTODY_RELEASED", id, dispatchId);
      return { ok: true };
    });
  }
  acceptCustody(id: string, dispatchId: string) {
    return this.repo.transaction(() => {
      const r = this.run(dispatchId),
        t = r.transfer;
      if (!t || t.to !== id || !t.releasedAt)
        fail(
          "INVALID_CUSTODY",
          "El conductor anterior debe confirmar la entrega de custodia",
        );
      if (t!.acceptedAt) return { ok: true };
      const c = this.eligible(r, id, true);
      if (!c)
        fail("INELIGIBLE_DRIVER", "Capacidad o disponibilidad no válidas");
      const { order, shipment } = this.target(r);
      this.releaseDriver(r);
      r.driverId = id;
      const d = this.repo.getDriverById(id)!;
      shipment.transportLoad = this.fit(r, c!.vehicle)!;
      shipment.driver = {
        id: d.id,
        name: d.name,
        phone: d.phone,
        vehiclePlate: d.vehiclePlate,
        vehicleType: d.vehicleType,
        rating: d.rating,
        photo: d.photo,
      };
      if (shipment.fulfillmentStatus === "CON_INCIDENCIA")
        this.checkResult(
          this.repo.transitionStatus(
            order.id,
            "EN_CAMINO",
            { role: "ADMINISTRADOR", id: t!.requestedBy },
            { shipmentId: r.shipmentId },
          ),
        );
      r.status = "PICKED_UP";
      t!.acceptedAt = this.now();
      const a = this.account(id);
      a.status = "BUSY";
      a.activeDispatchId = r.id;
      d.activeOrderId = order.id;
      d.activeAssignmentId = r.id;
      d.isOnline = true;
      d.currentStatus = "EN_CAMINO_CLIENTE";
      this.event("CUSTODY_ACCEPTED", id, r.id);
      return { ok: true };
    });
  }
  settlement(id: string) {
    this.account(id);
    return {
      driverId: id,
      cashHeldCOP: this.repo.getDriverById(id)!.cashBalance,
      collections: Object.values(this.state.runs)
        .filter((r) => r.driverId === id && r.cashCollected > 0)
        .map((r) => ({
          dispatchId: r.id,
          code: r.code,
          collectedCOP: r.cashCollected,
        })),
    };
  }
  settle(id: string, amount: number, receiptId: string, adminId: string) {
    return this.repo.transaction(() => {
      this.account(id);
      if (
        !receiptId ||
        receiptId.length > 100 ||
        !Number.isSafeInteger(amount) ||
        amount <= 0
      )
        fail("INVALID_SETTLEMENT", "Importe y recibo requeridos", 400);
      const prior = this.state.settlements[receiptId];
      if (prior) {
        if (prior.driverId !== id || prior.amountCOP !== amount)
          fail(
            "RECEIPT_CONFLICT",
            "El recibo ya se utilizó para otra operación",
          );
        return { ok: true };
      }
      const d = this.repo.getDriverById(id)!;
      if (amount > d.cashBalance)
        fail("CASH_MISMATCH", "El recibo supera el efectivo pendiente");
      d.cashBalance -= amount;
      this.state.settlements[receiptId] = {
        driverId: id,
        amountCOP: amount,
        adminId,
        at: this.now(),
      };
      this.event("CASH_SETTLED", adminId, id, receiptId);
      return { ok: true };
    });
  }
  synchronizeOrders() {
    const changed = Object.values(this.state.runs).filter((r) => {
      const status = this.target(r).shipment.fulfillmentStatus;
      return (
        terminal(status) &&
        r.status !== (status === "ENTREGADO" ? "DELIVERED" : "CANCELLED")
      );
    });
    if (!changed.length) return;
    this.repo.transaction(() => {
      for (const r of changed) {
        if (
          r.external &&
          !["CANCELLED", "REJECTED"].includes(r.external.status)
        ) {
          r.status = "INCIDENT";
          r.reason = "CANCELLED_ORDER_EXTERNAL_RECONCILIATION";
          continue;
        }
        const offer = r.offerId ? this.state.offers[r.offerId] : undefined;
        if (offer?.status === "PENDING") {
          offer.status = "RELEASED";
          this.unreserveOffer(offer);
        }
        r.status =
          this.target(r).shipment.fulfillmentStatus === "ENTREGADO"
            ? "DELIVERED"
            : "CANCELLED";
        this.event("ORDER_STATE_SYNCHRONIZED", "SYSTEM", r.id);
      }
    });
  }
  async tick() {
    this.synchronizeOrders();
    if (
      Object.values(this.state.offers).some(
        (o) => o.status === "PENDING" && o.expiresAt <= this.now(),
      )
    )
      this.repo.transaction(() => {
        for (const o of Object.values(this.state.offers)) {
          if (o.status === "PENDING" && o.expiresAt <= this.now()) {
            o.status = "EXPIRED";
            const r = this.run(o.dispatchId);
            this.unreserveOffer(o);
            r.status = "PENDING";
            r.offerId = undefined;
            this.event("OFFER_EXPIRED", "SYSTEM", r.id);
          }
        }
      });
    for (const r of Object.values(this.state.runs)) {
      if (
        r.external &&
        (["REQUESTING", "UNKNOWN", "ACCEPTED"].includes(r.external.status) ||
          r.external.cancellationPending)
      ) {
        if (
          this.now() - r.external.startedAt >
            this.state.config.searchSeconds * 1000 &&
          r.status !== "INCIDENT"
        )
          this.repo.transaction(() => {
            r.status = "INCIDENT";
            r.reason = "EXTERNAL_PENDING_RECONCILIATION";
            this.event("INCIDENT", "SYSTEM", r.id);
          });
        await this.reconcile(r.id);
        continue;
      }
      if (["PENDING", "SEARCHING"].includes(r.status)) await this.search(r.id);
    }
  }
  driverDispatch(r: DispatchRun, id: string) {
    const offer = r.offerId ? this.state.offers[r.offerId] : undefined;
    if (
      r.driverId !== id &&
      !(offer?.driverId === id && offer.status === "PENDING") &&
      !(r.transfer?.to === id && !r.transfer.acceptedAt)
    )
      fail("FORBIDDEN", "No tienes acceso a este despacho", 403);
    const { order, shipment } = this.target(r);
    return {
      dispatchId: r.id,
      assignmentId: r.id,
      tripId: shipment.tripId,
      purchaseCode: order.purchaseCode,
      dispatchCode: r.code,
      orderId: order.id,
      shipmentId: r.shipmentId,
      status: r.status,
      offer:
        offer?.driverId === id
          ? { id: offer.id, expiresAt: offer.expiresAt, status: offer.status }
          : undefined,
      warehouse: this.deps.stores().find((s) => s.id === order.storeId),
      items: shipment.items.map((i) => ({
        productId: i.productId,
        name: i.name,
        presentation: i.presentation,
        quantity: i.quantity,
      })),
      sellablePackages: shipment.items.reduce((n, i) => n + i.quantity, 0),
      weightGrams: shipment.transportLoad?.grossWeightGrams,
      volumeCm3: shipment.transportLoad?.volumeCm3,
      warnings: [
        "Transportar unidades cerradas; verificar embalaje y precintos",
      ],
      destination: r.driverId === id ? order.deliveryAddress : undefined,
      customerPhone: r.driverId === id ? order.customer.phone : undefined,
      pickupEstimate: r.estimate,
      cashToCollect: r.cashDue - r.cashCollected,
      releaseRequested: r.releaseRequested,
      transfer: r.transfer
        ? {
            from: r.transfer.from,
            to: r.transfer.to,
            released: !!r.transfer.releasedAt,
            accepted: !!r.transfer.acceptedAt,
          }
        : undefined,
      actions:
        r.transfer && !r.transfer.acceptedAt
          ? r.transfer.to === id
            ? r.transfer.releasedAt
              ? ["accept-custody"]
              : []
            : ["release-custody"]
          : offer?.status === "PENDING"
            ? ["accept", "reject"]
            : r.status === "ASSIGNED"
              ? r.releaseRequested
                ? ["release"]
                : ["arrived-hub", "pickup", "incident"]
              : r.status === "PICKED_UP"
                ? ["delivered", "incident"]
                : [],
    };
  }
  driverAssignments(id: string) {
    this.account(id);
    return Object.values(this.state.runs)
      .filter(
        (r) =>
          (r.driverId === id &&
            !["DELIVERED", "CANCELLED"].includes(r.status)) ||
          (r.offerId &&
            this.state.offers[r.offerId]?.driverId === id &&
            this.state.offers[r.offerId]?.status === "PENDING") ||
          (r.transfer?.to === id && !r.transfer.acceptedAt),
      )
      .map((r) => this.driverDispatch(r, id));
  }
  customerMessage(orderId: string) {
    const runs = Object.values(this.state.runs).filter(
      (r) => r.orderId === orderId,
    );
    if (runs.some((r) => ["SEARCH_EXHAUSTED", "INCIDENT"].includes(r.status)))
      return "Estamos coordinando tu entrega. Te informaremos cuando tengamos una opción confirmada.";
    if (runs.some((r) => ["SEARCHING", "OFFER_PENDING"].includes(r.status)))
      return "Estamos confirmando un repartidor para tu entrega.";
    if (runs.some((r) => r.status === "PENDING"))
      return "Estamos preparando tu entrega; el repartidor aún no está confirmado.";
    return undefined;
  }
  customerDispatches(orderId: string) {
    return Object.values(this.state.runs)
      .filter((r) => r.orderId === orderId)
      .map((r) => ({
        id: r.id,
        code: r.code,
        status:
          r.status === "SEARCH_EXHAUSTED" || r.status === "INCIDENT"
            ? "REQUIERE_ATENCION"
            : r.status === "OFFER_PENDING" || r.status === "SEARCHING"
              ? "BUSCANDO_REPARTIDOR"
              : r.status,
        provider:
          r.providerId === "OWN"
            ? "Flota propia BOLT"
            : r.external?.status === "ASSIGNED"
              ? r.external.providerName || r.external.providerId
              : undefined,
        driverConfirmed: !!r.assignedAt,
        pickupEstimate:
          r.assignedAt && r.estimate
            ? {
                ...r.estimate,
                ageSeconds: Math.max(
                  0,
                  (this.now() - r.estimate.observedAt) / 1000,
                ),
                stale:
                  this.now() - r.estimate.observedAt >
                  this.state.config.routeMaxAgeSeconds * 1000,
                seconds:
                  this.now() - r.estimate.observedAt <=
                  this.state.config.routeMaxAgeSeconds * 1000
                    ? r.estimate.seconds
                    : undefined,
              }
            : undefined,
        cashToCollect: r.cashDue - r.cashCollected,
        events: this.state.events
          .filter(
            (e) =>
              e.dispatchId === r.id &&
              [
                "DISPATCH_ASSIGNED",
                "PICKUP_CONFIRMED",
                "DELIVERED",
                "INCIDENT",
                "RELEASE_CONFIRMED",
                "CUSTODY_ACCEPTED",
              ].includes(e.type),
          )
          .map(({ id, at, type }) => ({ id, at, type })),
      }));
  }
  adminView() {
    return {
      config: this.state.config,
      providers: DISABLED_LIVE_PROVIDERS,
      simulation: !!this.deps.simulation,
      drivers: Object.keys(this.state.accounts).map((id) =>
        this.profile(id, true),
      ),
      orders: this.repo
        .getAllOrders()
        .filter((o) =>
          Object.values(this.state.runs).some((r) => r.orderId === o.id),
        )
        .map((o) => ({
          id: o.id,
          code: o.purchaseCode,
          storeId: o.storeId,
          status: o.fulfillmentStatus,
          dispatches: Object.values(this.state.runs)
            .filter((r) => r.orderId === o.id)
            .map((r) => ({
              ...r,
              offers: Object.values(this.state.offers).filter(
                (of) => of.dispatchId === r.id,
              ),
            })),
        })),
      metrics: this.metrics(),
      events: this.state.events,
    };
  }
  metrics() {
    const runs = Object.values(this.state.runs),
      assigned = runs.filter((r) => r.assignedAt),
      picked = runs.filter((r) => r.arrivedAt && r.pickedUpAt);
    return {
      dispatches: runs.length,
      assigned: assigned.length,
      averageAssignmentSeconds: assigned.length
        ? assigned.reduce(
            (n, r) =>
              n + (r.assignedAt! - (r.searchStartedAt ?? r.createdAt)) / 1000,
            0,
          ) / assigned.length
        : null,
      averageWarehouseWaitSeconds: picked.length
        ? picked.reduce(
            (n, r) => n + (r.pickedUpAt! - r.arrivedAt!) / 1000,
            0,
          ) / picked.length
        : null,
      expiredOffers: Object.values(this.state.offers).filter(
        (o) => o.status === "EXPIRED",
      ).length,
      rejectedOffers: Object.values(this.state.offers).filter(
        (o) => o.status === "REJECTED",
      ).length,
      failedSearches: this.state.events.filter(
        (e) => e.type === "SEARCH_EXHAUSTED",
      ).length,
      incidents: this.state.events.filter((e) => e.type === "INCIDENT").length,
      unknownExternal: runs.filter((r) => r.external?.status === "UNKNOWN")
        .length,
    };
  }
}
