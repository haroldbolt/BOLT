import { createHash } from 'node:crypto';
import { providerQuota } from './providerQuota';
import type { DispatchProvider, ProviderQuote, ProviderResult, ProviderShipmentContext } from './dispatchProviders';
import type { TransportVehicle } from '../types/transport';

const API_COLOMBIA = 'https://services.grability.rappi.com/api/cargo-api-gateway';
const PROVIDER_ID = 'rappi-cargo';
const QUOTE_TTL_MS = 60_000;
const TIMEOUT_MS = 5_000;

type CargoEndpoint = 'order-validate' | 'order-create' | 'order-status' | 'order-cancel';
class CargoRequestNotSent extends Error {}

export interface RappiCargoSite {
  pickingPointId: number | string;
  vehicleType: 'BIKE' | 'CAR';
  vehicle: TransportVehicle;
}

export interface RappiCargoConfig {
  token: string;
  maxCashCOP: number;
  sites: Readonly<Record<string, RappiCargoSite>>;
  fetch?: typeof fetch;
  now?: () => number;
  env?: NodeJS.ProcessEnv;
}

type Json = Record<string, unknown>;
const isJson = (value: unknown): value is Json => !!value && typeof value === 'object' && !Array.isArray(value);
const nonEmpty = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const positiveMoney = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
const hasSurcharge = (value: unknown) => value !== undefined && value !== null && value !== 0 && value !== false;
const referenceValid = (value: string) => /^[\w.:-]{1,255}$/.test(value);
const draftHash = (dispatchId: string, value: Json) =>
  createHash('sha256').update(JSON.stringify([dispatchId, value])).digest('hex');

function externalStatus(payload: Json, reference: string): ProviderResult {
  const courier = payload.storeKeeper;
  const driver = isJson(courier) && positiveMoney(courier.id)
    ? {
      id: String(courier.id),
      name: [courier.first_name, courier.last_name].filter(nonEmpty).join(' ').trim() || 'Repartidor de Rappi Cargo',
    }
    : undefined;
  const result = { reference, ...(driver && { driver }) };
  switch (payload.state) {
    case 'created':
    case 'finding_courier':
    case 'schedule':
      return { ...result, status: 'ACCEPTED' };
    case 'in_progress':
    case 'in_store':
      return { ...result, status: driver ? 'ASSIGNED' : 'ACCEPTED' };
    case 'on_the_route':
    case 'arrive':
      return { ...result, status: 'ASSIGNED', stage: 'PICKED_UP' };
    case 'delivered_to_user':
      return { ...result, status: 'ASSIGNED', stage: 'DELIVERED' };
    case 'pending_review':
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

function contactForCargo(customer: ProviderShipmentContext['customer']) {
  if (!customer || !nonEmpty(customer.name) || !nonEmpty(customer.email) || !nonEmpty(customer.phone)) return null;
  const [firstName, ...lastParts] = customer.name.trim().split(/\s+/);
  const lastName = lastParts.join(' ');
  const phone = customer.phone.replace(/[\s()-]/g, '').replace(/^\+?57(?=3\d{9}$)/, '');
  if (firstName.length < 3 || !lastName || !/^3\d{9}$/.test(phone) ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customer.email)) return null;
  return {
    email: customer.email,
    phone,
    phone_country_code: '57',
    first_name: firstName,
    last_name: lastName,
  };
}

/** Live Colombia adapter. Instantiate only through verified operational configuration. */
export class RappiCargoProvider implements DispatchProvider {
  readonly id = PROVIDER_ID;
  readonly name = 'Rappi Cargo';
  readonly simulation = false;
  readonly capabilities = { quote: true, request: true, status: true, cancel: true, cashCollection: true };
  readonly #fetch: typeof fetch;
  readonly #now: () => number;
  readonly #quotas: Record<CargoEndpoint, ReturnType<typeof providerQuota>>;

  constructor(private readonly config: RappiCargoConfig) {
    this.#fetch = config.fetch ?? fetch;
    this.#now = config.now ?? Date.now;
    const booking = providerQuota('CARGO_BOOKING', config.env, this.#now);
    this.#quotas = {
      'order-validate': providerQuota('CARGO_QUOTE', config.env, this.#now),
      'order-create': booking,
      'order-cancel': booking,
      'order-status': providerQuota('CARGO_TRACKING', config.env, this.#now),
    };
  }

  supports(storeId: string, mode: string, cashCOP: number) {
    return Object.hasOwn(this.config.sites, storeId) &&
      ['TURBO', 'TURBO_DIVIDIDO'].includes(mode) &&
      positiveMoney(cashCOP) && cashCOP <= this.config.maxCashCOP;
  }

  vehicleFor(storeId: string, mode: string, cashCOP: number): TransportVehicle | undefined {
    return this.supports(storeId, mode, cashCOP) ? structuredClone(this.config.sites[storeId].vehicle) : undefined;
  }

  private async post(endpoint: CargoEndpoint, dispatchId: string, payload: Json, okStatus: number): Promise<Json> {
    let slot: ReturnType<ReturnType<typeof providerQuota>['take']>;
    try { slot = this.#quotas[endpoint].take([dispatchId]); }
    catch { throw new CargoRequestNotSent('Cupo de Cargo sin verificar.'); }
    if ('retryAfter' in slot) throw new CargoRequestNotSent('Cupo de Cargo agotado temporalmente.');
    try {
      const response = await this.#fetch(API_COLOMBIA + '/v3/' + endpoint + '/', {
        method: 'POST',
        headers: { 'user-token': this.config.token, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(TIMEOUT_MS),
        redirect: 'error',
      });
      if (response.status !== okStatus) throw Error('Cargo respondió HTTP ' + response.status);
      const body: unknown = await response.json().catch(() => null);
      if (!isJson(body)) throw Error('Cargo devolvió un formato inesperado.');
      return body;
    } finally {
      slot.release();
    }
  }

  private orderData(site: RappiCargoSite, cashCOP: number, shipment?: ProviderShipmentContext): Json | null {
    if (!positiveMoney(cashCOP) || cashCOP > this.config.maxCashCOP ||
        !shipment || shipment.hasRestrictedItems || !shipment.items.length ||
        shipment.items.some(item => !nonEmpty(item.productId) || !nonEmpty(item.name) ||
          !positiveMoney(item.quantity) || !positiveMoney(item.unitPriceCOP))) return null;
    const contact = contactForCargo(shipment.customer);
    const { destination } = shipment;
    const { lat, lng } = destination.coordinates;
    if (!contact || !nonEmpty(destination.address) || !nonEmpty(destination.city) ||
        !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
    const point = site.pickingPointId;
    return {
      total_value: cashCOP,
      user_tip: 0,
      vehicle_type: site.vehicleType,
      payment_method: 'CASH',
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
        ...contact, address: destination.address, city: destination.city, lat, lng,
        ...(destination.details && { complement: destination.details }),
      },
    };
  }

  async quote(input: Parameters<DispatchProvider['quote']>[0]): Promise<ProviderQuote | null> {
    if (!this.supports(input.storeId, input.mode, input.cashCOP)) return null;
    const site = this.config.sites[input.storeId];
    const payload = this.orderData(site, input.cashCOP, input.shipment);
    if (!payload) return null;
    const result = await this.post('order-validate', input.dispatchId, payload, 201);
    const minutes = result.eta_for_immediate_delivery;
    const distance = result.trip_distance;
    if (result.active !== true || result.service_delivery !== 'IMMEDIATE_DELIVERY' ||
        typeof minutes !== 'number' || !Number.isFinite(minutes) || minutes <= 0 ||
        typeof distance !== 'number' || !Number.isFinite(distance) || distance < 0 ||
        !positiveMoney(result.estimated_price) ||
        [result.rain_charge, result.raining_charge, result.high_demand_charge].some(hasSurcharge)) return null;
    const now = this.#now();
    return {
      id: draftHash(input.dispatchId, payload),
      providerId: this.id,
      expiresAt: now + QUOTE_TTL_MS,
      costCOP: result.estimated_price,
      // The provider returns distance and ETA to the destination, neither are pickup estimates.
      estimate: { kind: 'GEOGRAPHIC', meters: Math.round(distance * 1000), source: PROVIDER_ID, observedAt: now },
      deliveryEtaSeconds: Math.ceil(minutes * 60),
      vehicle: structuredClone(site.vehicle),
      canCollectCash: true,
      simulation: false,
    };
  }

  async request(input: Parameters<DispatchProvider['request']>[0]): Promise<ProviderResult> {
    const reference = input.idempotencyKey;
    if (!referenceValid(reference) || input.quote.providerId !== this.id ||
        input.quote.expiresAt <= this.#now()) return { status: 'REJECTED' };
    const [storeId, ...otherStores] = input.quote.vehicle.storeIds;
    const site = !otherStores.length && Object.hasOwn(this.config.sites, storeId) ? this.config.sites[storeId] : undefined;
    const payload = site && input.cashCOP !== undefined ? this.orderData(site, input.cashCOP, input.shipment) : null;
    if (!payload || draftHash(input.dispatchId, payload) !== input.quote.id) return { status: 'REJECTED' };
    try {
      const result = await this.post('order-create', reference, { ...payload, order_id: reference }, 201);
      if (result.external_order_id === reference &&
          (result.cargo_order_id != null || result.rappi_order_id != null)) return { status: 'ACCEPTED', reference };
    } catch (error) {
      if (error instanceof CargoRequestNotSent) return { status: 'REJECTED', reference };
      // After an ambiguous response, reconcile the same reference and do not attempt another creation.
    }
    return this.status(reference);
  }

  async status(reference: string): Promise<ProviderResult> {
    if (referenceValid(reference)) {
      try {
        const result = await this.post('order-status', reference, { external_order_id: reference }, 200);
        if (result.external_order_id === reference) return externalStatus(result, reference);
      } catch {
        // An HTTP failure is not evidence that this booking can be replaced.
      }
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
      const reply = await this.post('order-cancel', reference, {
        external_order_id: reference,
        partner_cancelation_reason: 'WILL_USE_OTHER_PROVIDER',
      }, 201);
      acknowledged = reply.successfull === true;
    } catch {
      // Prevent automatic reassignment when cancellation or custody cannot be established.
    }
    const after = await this.status(reference);
    if (after.stage || (acknowledged && after.status === 'CANCELLED')) return after;
    return unknown;
  }
}
