import { validDestinationCoordinates } from './addressGeography';

export interface DeviceLocation {
  coordinates: { lat: number; lng: number };
  accuracyMeters: number;
}

export const DEVICE_LOCATION_OPTIONS: PositionOptions = {
  enableHighAccuracy: true,
  maximumAge: 0,
  timeout: 12000,
};

export type DeviceLocationFailure = 'permission' | 'timeout' | 'unavailable' | 'insecure' | 'unsupported' | 'invalid';
export class DeviceLocationError extends Error {
  constructor(public readonly kind: DeviceLocationFailure, message: string) { super(message); this.name = 'DeviceLocationError'; }
}

export function deviceLocationError(error: unknown): string {
  const code = (error as { code?: number })?.code;
  // Code 1 does not tell us whether the user, OS or browser policy denied access.
  if (code === 1) return 'No tenemos permiso para consultar tu ubicación. Revisa el permiso de BOLT y la localización del dispositivo.';
  if (code === 3) return 'La ubicación tardó demasiado. Comprueba que la ubicación del dispositivo esté activa e intenta de nuevo, o escribe la dirección.';
  return 'No pudimos obtener tu ubicación actual. Comprueba la ubicación del dispositivo e intenta de nuevo, o escribe la dirección.';
}

function nativeFailure(error: unknown) {
  const code = (error as { code?: number })?.code;
  return new DeviceLocationError(code === 1 ? 'permission' : code === 3 ? 'timeout' : 'unavailable', deviceLocationError(error));
}

export interface DeviceLocationAttempt {
  result: Promise<DeviceLocation | null>;
  cancel: () => void;
}

/** Call inside the click handler, before rendering/navigating or awaiting anything.
 * The next screen consumes this SAME result; rendering must never request location.
 */
export function beginDeviceLocation(reader = new DeviceLocationRequest()): DeviceLocationAttempt {
  const result = reader.request();
  // A synchronous browser rejection may precede the next screen's subscription.
  void result.catch(() => undefined);
  return { result, cancel: () => reader.cancel() };
}

/** One-shot device lookup. Never watches movement, persists a location or confirms a destination. */
export class DeviceLocationRequest {
  private pending: Promise<DeviceLocation | null> | null = null;
  private cancelPending?: () => void;

  constructor(private environment = () => ({
    secure: typeof window !== 'undefined' && window.isSecureContext,
    geolocation: typeof navigator !== 'undefined' ? navigator.geolocation : undefined,
  }), private now = () => Date.now(), private deadlineMs = 60000) {}

  cancel() { this.cancelPending?.(); }

  request(): Promise<DeviceLocation | null> {
    if (this.pending) return this.pending;
    const { secure, geolocation } = this.environment();
    if (!secure) return Promise.reject(new DeviceLocationError('insecure', 'Para usar tu ubicación, abre BOLT con una conexión segura HTTPS. También puedes escribir la dirección.'));
    if (!geolocation) return Promise.reject(new DeviceLocationError('unsupported', 'La ubicación no está disponible en esta ventana. Abre el enlace directamente en Safari o Chrome, o escribe la dirección.'));

    let resolve!: (value: DeviceLocation | null) => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<DeviceLocation | null>((yes, no) => { resolve = yes; reject = no; });
    this.pending = promise;
    const startedAt = this.now();
    let settled = false;
    const finish = (value: DeviceLocation | null, error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      this.pending = null;
      this.cancelPending = undefined;
      if (error) reject(error); else resolve(value);
    };
    // Also bounds time spent waiting for an unanswered browser permission prompt.
    const timer = setTimeout(() => finish(null, nativeFailure({ code: 3 })), this.deadlineMs);
    this.cancelPending = () => finish(null);
    try {
      geolocation.getCurrentPosition(position => {
        if (settled) return;
        const coordinates = { lat: position.coords.latitude, lng: position.coords.longitude };
        const accuracyMeters = position.coords.accuracy;
        if (!validDestinationCoordinates(coordinates) || !Number.isFinite(accuracyMeters) || accuracyMeters < 0 ||
            !Number.isFinite(position.timestamp) || position.timestamp < startedAt - 5000 || position.timestamp > this.now() + 5000) {
          finish(null, new DeviceLocationError('invalid', 'El dispositivo no devolvió una ubicación actual válida. Intenta de nuevo o escribe la dirección.'));
          return;
        }
        finish({ coordinates, accuracyMeters });
      }, error => finish(null, nativeFailure(error)), DEVICE_LOCATION_OPTIONS);
    } catch (error) { finish(null, nativeFailure(error)); }
    return promise;
  }
}
