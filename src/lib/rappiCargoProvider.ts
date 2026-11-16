import { createHash } from 'node:crypto';
import type { DispatchProvider, ProviderQuote, ProviderResult, ProviderShipmentContext } from './dispatchProviders';
import type { TransportVehicle } from '../types/transport';

const SANDBOX_API = 'https://microservices.dev.rappi.com/api/cargo-api-gateway';
const PROVIDER_ID = 'rappi-cargo-sandbox';
const QUOTE_TTL_MS = 60_000;
const TIMEOUT_MS = 5_000;

export interface RappiCargoSandboxConfig {
  token: string;
  pickingPoints: Record<string, number | string>;
  vehicle: TransportVehicle;
  vehicleType: 'BIKE' | 'CAR';
  testClient: { firstName: string; lastName: string; email: string; phone: string };
  fetch?: typeof fetch;
  now?: () => number;
}

type Json = Record<string, unknown>;
const isJson = (value: unknown): value is Json => !!value && typeof value === 'object' && !Array.isArray(value);
const positiveMoney = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
const pointValid = (value: unknown) =>
  positiveMoney(value) || (typeof value === 'string' && value.trim().length > 0);
const hasSurcharge = (value: unknown) => value !== undefined && value !== null && value !== 0 && value !== false;
const draftHash = (value: Json) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

function externalStatus(payload: Json, reference: string): ProviderResult {
  const courier = payload.storeKeeper;
  const driver = isJson(courier) && positiveMoney(courier.id)
    ? { id: String(courier.id), name: [courier.first_name, courier.last_name].filter(part => typeof part === 'string').join(' ').trim() || 'Repartidor de Rappi Cargo' }
    : undefined;
  const result = { reference, ...(driver && { driver }) };
  const state = payload.state;
  switch (state) {
    case 'created':
    case 'finding_courier':
    case 'schedule':
      return { ...result, status: 'ACCEPTED' };
    case 'in_progress':
    case 'in_store':
      return { ...result, status: 'ASSIGNED' };
    case 'on_the_route':
    case 'arrive':
      return { ...result, status: 'ASSIGNED', stage: 'PICKED_UP' };
    case 'delivered_to_user':
    case 'pending_review':
      return { ...result, status: 'ASSIGNED', stage: 'DELIVERED' };
    case 'failed_delivery':
    case 'return_in_store':
    case 'failed_return':
      return { ...result, status: 'ASSIGNED', stage: 'FAILED' };
    case 'returned':
      return { ...result, status: 'ASSIGNED', stage: 'RETURNED' };
    case 'canceled':
    case 'canceled_by_automation':
    case 'canceled_by_fraud':
      return { ...result, status: 'CANCELLED' };
    default:
      return { ...result, status: 'UNKNOWN' };
  }
}

export class RappiCargoSandboxProvider implements DispatchProvider {
  readonly id = PROVIDER_ID;
  readonly name = 'Rappi Cargo · Desarrollo';
  readonly simulation = false;
  readonly sandboxOnly = true;
  readonly capabilities = { quote: true, request: true, status: true, cancel: true, cashCollection: false };
  readonly #fetch: typeof fetch;
  readonly #now: () => number;

  constructor(private readonly config: RappiCargoSandboxConfig) {
    const { token, testClient, vehicle } = config;
    if (!token.trim() || /\s/.test(token) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(testClient.email) ||
        !/^3\d{9}$/.test(testClient.phone) || testClient.firstName.trim().length < 3 || !testClient.lastName.trim() ||
        !vehicle.enabled || !positiveMoney(vehicle.maxLoadGrams) || !positiveMoney(vehicle.maxVolumeCm3) ||
        vehicle.cargoDimensionsCm.length !== 3 ||
        !vehicle.cargoDimensionsCm.every(dimension => Number.isFinite(dimension) && dimension > 0) ||
        !Number.isSafeInteger(vehicle.packagingGrams) || vehicle.packagingGrams < 0 ||
        !vehicle.modes.includes('TURBO') ||
        !Object.keys(config.pickingPoints).some(storeId => vehicle.storeIds.includes(storeId) && pointValid(config.pickingPoints[storeId])))
      throw Error('Configuración incompleta del sandbox de Rappi Cargo.');
    this.#fetch = config.fetch ?? fetch;
    this.#now = config.now ?? Date.now;
  }

  private async post(endpoint: string, payload: Json, okStatus: number): Promise<Json> {
    const response = await this.#fetch(SANDBOX_API + endpoint, {
      method: 'POST',
      headers: { 'user-token': this.config.token, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      redirect: 'error',
    });
    const body: unknown = await response.json().catch(() => null);
    if (response.status !== okStatus) throw Error(`Cargo sandbox respondió HTTP ${response.status}`);
    if (!isJson(body)) throw Error('Cargo sandbox devolvió un formato inesperado.');
    return body;
  }

  private orderData(storeId: string, shipment?: ProviderShipmentContext): Json | null {
    const point = this.config.pickingPoints[storeId];
    if (!pointValid(point) || !this.config.vehicle.storeIds.includes(storeId) || !shipment || shipment.hasRestrictedItems ||
        !positiveMoney(shipment.totalValueCOP) || !shipment.items.length ||
        shipment.items.some(item => !item.productId.trim() || !item.name.trim() ||
          !positiveMoney(item.quantity) || !positiveMoney(item.unitPriceCOP))) return null;
    const { destination } = shipment;
    const { lat, lng } = destination.coordinates;
    if (!destination.address.trim() || !destination.city.trim() ||
        !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
    const test = this.config.testClient;
    return {
      total_value: shipment.totalValueCOP,
      vehicle_type: this.config.vehicleType,
      payment_method: 'ONLINE',
      partner_channel: 'ECOMMERCE',
      action_points: [
        {
          ...(typeof point === 'number' ? { picking_point_id: point } : { external_picking_point_id: point }),
          action_type: 'PICK_UP',
          location_type: 'STORE',
          products: shipment.items.map(item => ({
            product_id: item.productId, name: item.name, units: item.quantity, unit_price: item.unitPriceCOP,
          })),
        },
        { action_type: 'DROP_OFF', location_type: 'CLIENT', products: [] },
      ],
      client_info: {
        email: test.email, phone: test.phone, phone_country_code: '57',
        first_name: test.firstName, last_name: test.lastName, address: destination.address,
        city: destination.city, lat, lng, ...(destination.details && { complement: destination.details }),
      },
    };
  }

  async quote(input: Parameters<DispatchProvider['quote']>[0]): Promise<ProviderQuote | null> {
    if (input.cashCOP !== 0 || !['TURBO', 'TURBO_DIVIDIDO'].includes(input.mode)) return null;
    const payload = this.orderData(input.storeId, input.shipment);
    if (!payload) return null;
    const result = await this.post('/v3/order-validate', payload, 201);
    const minutes = result.eta_for_immediate_delivery;
    const distance = result.trip_distance;
    if (result.active !== true || result.service_delivery !== 'IMMEDIATE_DELIVERY' ||
        typeof minutes !== 'number' || !Number.isFinite(minutes) || minutes <= 0 ||
        typeof distance !== 'number' || !Number.isFinite(distance) || distance < 0 ||
        !positiveMoney(result.estimated_price) ||
        [result.rain_charge, result.raining_charge, result.high_demand_charge].some(hasSurcharge)) return null;
    const now = this.#now();
    return {
      id: draftHash(payload), providerId: this.id, expiresAt: now + QUOTE_TTL_MS, costCOP: result.estimated_price,
      estimate: { kind: 'GEOGRAPHIC', meters: Math.round(distance * 1000), source: PROVIDER_ID, observedAt: now },
      deliveryEtaSeconds: Math.ceil(minutes * 60),
      vehicle: { ...this.config.vehicle, storeIds: [input.storeId] },
      canCollectCash: false, simulation: false,
    };
  }

  async request(input: Parameters<DispatchProvider['request']>[0]): Promise<ProviderResult> {
    const reference = input.idempotencyKey;
    if (!reference || reference.length > 255 || input.quote.providerId !== this.id ||
        input.quote.expiresAt <= this.#now()) return { status: 'REJECTED' };
    const [storeId, ...otherStores] = input.quote.vehicle.storeIds;
    const payload = otherStores.length ? null : this.orderData(storeId, input.shipment);
    if (!payload || draftHash(payload) !== input.quote.id) return { status: 'REJECTED' };
    try {
      const result = await this.post('/v3/order-create', { ...payload, order_id: reference }, 201);
      if (result.external_order_id === reference &&
          (result.cargo_order_id != null || result.rappi_order_id != null)) return { status: 'ACCEPTED', reference };
    } catch {
      // Even an error or timeout can hide an accepted booking. Never create again here.
    }
    return this.status(reference);
  }

  async status(reference: string): Promise<ProviderResult> {
    try {
      const result = await this.post('/v3/order-status', { external_order_id: reference }, 200);
      if (result.external_order_id === reference) return externalStatus(result, reference);
    } catch {
      // No evidence that this service is safe to replace.
    }
    return { status: 'UNKNOWN', reference };
  }

  async cancel(reference: string): Promise<ProviderResult> {
    const prior = await this.status(reference);
    if (prior.stage) return prior;
    const unknown: ProviderResult = { status: 'UNKNOWN', reference };
    if (prior.status !== 'ACCEPTED' && prior.status !== 'ASSIGNED') return unknown;
    let acknowledged = false;
    try {
      const reply = await this.post('/v3/order-cancel', {
        external_order_id: reference,
        partner_cancelation_reason: 'WILL_USE_OTHER_PROVIDER',
      }, 201);
      acknowledged = reply.successfull === true;
    } catch {
      // A canceled status alone cannot establish whether Cargo had custody.
    }
    const after = await this.status(reference);
    if (after.stage || (acknowledged && after.status === 'CANCELLED')) return after;
    return unknown;
  }
}
