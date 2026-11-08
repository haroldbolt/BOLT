import { api } from "./api";
import type { DispatchService } from "./dispatchService";
export type AdminDispatchData = ReturnType<DispatchService["adminView"]>;
export type DriverAssignment = ReturnType<DispatchService["driverDispatch"]>;
export type DriverStatus = ReturnType<DispatchService["profile"]>;
export type PublicDispatch = ReturnType<
  DispatchService["customerDispatches"]
>[number];
const driverKey = "bolt_driver_session_v1";
let memoryToken = "";
export const driverSession = {
  get() {
    try {
      return sessionStorage.getItem(driverKey) || memoryToken;
    } catch {
      return memoryToken;
    }
  },
  set(token: string) {
    memoryToken = token;
    try {
      if (token) sessionStorage.setItem(driverKey, token);
      else sessionStorage.removeItem(driverKey);
    } catch {}
  },
};
async function request<T>(
  path: string,
  token: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const res = await fetch("/api/v1/" + path, {
    method,
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: "Bearer " + token } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok)
    throw Object.assign(
      new Error(data.error || "No se pudo completar la operación"),
      { status: res.status, code: data.code },
    );
  return data;
}
export const dispatchClient = {
  admin: <T = AdminDispatchData>(path = "", method = "GET", body?: unknown) =>
    request<T>(
      "admin/dispatch" + path,
      api.getStoredAdminToken() || "",
      method,
      body,
    ),
  driver: <T = any>(path: string, method = "GET", body?: unknown) =>
    request<T>("driver/" + path, driverSession.get(), method, body),
  simulation: <T = any>(path = "", method = "GET", body?: unknown) =>
    request<T>(
      "admin/simulation" + path,
      api.getStoredAdminToken() || "",
      method,
      body,
    ),
  simulationInfo: () => request<any>("simulation", ""),
  async login(email: string, password: string) {
    const r = await request<{ token: string; profile: DriverStatus }>(
      "driver/auth/login",
      "",
      "POST",
      { email, password },
    );
    driverSession.set(r.token);
    return r.profile;
  },
  async logout() {
    try {
      await this.driver("auth/logout", "POST");
    } finally {
      driverSession.set("");
    }
  },
};
export const dispatchLabels: Record<string, string> = {
  PENDING: "Pendiente de preparación",
  SEARCHING: "Buscando repartidor",
  BUSCANDO_REPARTIDOR: "Buscando repartidor",
  OFFER_PENDING: "Oferta pendiente",
  ASSIGNED: "Repartidor confirmado",
  PICKED_UP: "En camino",
  DELIVERED: "Entregado",
  CANCELLED: "Cancelado",
  INCIDENT: "Requiere atención",
  SEARCH_EXHAUSTED: "Búsqueda sin capacidad",
  REQUIERE_ATENCION: "Estamos coordinando la entrega",
  AVAILABLE: "Disponible",
  OFF_DUTY: "Fuera de turno",
  BUSY: "Ocupado",
  ACCEPTED: "Servicio aceptado, repartidor pendiente",
  OFFER_ACCEPTED: "Oferta aceptada",
  UNKNOWN: "Resultado pendiente de conciliar",
  REQUESTING: "Solicitud enviada",
  REJECTED: "Rechazado",
  EXPIRED: "Vencida",
  RELEASED: "Liberada",
};
export function pickupText(estimate: any) {
  if (!estimate) return "Recogida pendiente de estimar";
  if (estimate.stale) return "Estimación anterior; pendiente de actualizar";
  return estimate.kind === "ROUTE" && Number.isFinite(estimate.seconds)
    ? `${Math.ceil(estimate.seconds / 60)} min estimados a la bodega${estimate.source === "SIMULATION" ? " · simulación" : ""}`
    : `${(estimate.meters / 1000).toFixed(1)} km estimados a la bodega · sin ETA por ruta`;
}
