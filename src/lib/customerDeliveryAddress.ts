import type { LatLng } from './deliveryService';

export const CUSTOMER_DELIVERY_ADDRESS_KEY = 'bolt_pets_delivery_address_v1';

/** A destination explicitly chosen by this browser, never a cached delivery quote. */
export interface ConfirmedDeliveryAddress {
  version: 1;
  address: string;
  details: string;
  coordinates: LatLng;
  confirmedAt: string;
}

type AddressReader = Pick<Storage, 'getItem'>;
type AddressWriter = Pick<Storage, 'setItem' | 'removeItem'>;
const FUTURE_TOLERANCE_MS = 5 * 60 * 1000;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

function plainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function text(value: unknown, maximum: number, required = false): value is string {
  return typeof value === 'string' && value.length <= maximum && !CONTROL_CHARACTERS.test(value) &&
    (!required || value.trim().length > 0);
}

function destination(value: unknown, now: number): ConfirmedDeliveryAddress | null {
  if (!plainRecord(value) || !['version', 'address', 'details', 'coordinates', 'confirmedAt'].every(key => Object.hasOwn(value, key)) ||
    value.version !== 1 || !text(value.address, 500, true) || !text(value.details, 1000) || !plainRecord(value.coordinates)) return null;
  const point = value.coordinates;
  if (!Object.hasOwn(point, 'lat') || !Object.hasOwn(point, 'lng') ||
    typeof point.lat !== 'number' || typeof point.lng !== 'number' || !Number.isFinite(point.lat) || !Number.isFinite(point.lng) ||
    point.lat < -90 || point.lat > 90 || point.lng < -180 || point.lng > 180) return null;
  if (typeof value.confirmedAt !== 'string') return null;
  const confirmedTime = Date.parse(value.confirmedAt);
  // The writer always produces this canonical ISO shape. Reject rolled-over dates,
  // local-time strings and dates too far ahead of the receiving device's clock.
  if (!Number.isFinite(confirmedTime) || confirmedTime <= 0 || confirmedTime > now + FUTURE_TOLERANCE_MS ||
    new Date(confirmedTime).toISOString() !== value.confirmedAt) return null;
  return {
    version: 1,
    address: value.address.trim(),
    details: value.details.trim(),
    coordinates: { lat: point.lat, lng: point.lng },
    confirmedAt: value.confirmedAt,
  };
}

export function createConfirmedDeliveryAddress(address: string, details: string, coordinates: LatLng, now = new Date()): ConfirmedDeliveryAddress {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new Error('La fecha de confirmación no es válida.');
  const result = destination({ version: 1, address, details, coordinates, confirmedAt: now.toISOString() }, Date.now());
  if (!result) throw new Error('Confirma una dirección y un punto de entrega válidos antes de guardarlos.');
  return result;
}

/** Restoring a saved choice does not authorize purchase: coverage and stock must be queried again. */
export function readCustomerDeliveryAddress(storage?: AddressReader): ConfirmedDeliveryAddress | null {
  try {
    const target = storage ?? (typeof window !== 'undefined' ? window.localStorage : undefined);
    if (!target) return null;
    const raw = target.getItem(CUSTOMER_DELIVERY_ADDRESS_KEY);
    if (!raw || raw.length > 10000) return null;
    return destination(JSON.parse(raw), Date.now());
  } catch {
    return null;
  }
}

/** Only approved destination fields are stored; quotes, credentials and tokens are excluded. */
export function saveCustomerDeliveryAddress(value: ConfirmedDeliveryAddress | null, storage?: AddressWriter): boolean {
  try {
    const target = storage ?? (typeof window !== 'undefined' ? window.localStorage : undefined);
    if (!target) return false;
    if (value === null) {
      target.removeItem(CUSTOMER_DELIVERY_ADDRESS_KEY);
      return true;
    }
    const safe = destination(value, Date.now());
    if (!safe) return false;
    target.setItem(CUSTOMER_DELIVERY_ADDRESS_KEY, JSON.stringify(safe));
    return true;
  } catch {
    return false;
  }
}
