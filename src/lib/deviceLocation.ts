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

export function deviceLocationError(error: unknown): string {
  const code = (error as { code?: number })?.code;
  if (code === 1) return 'El permiso de ubicación está desactivado. Puedes habilitarlo para BOLT en tu navegador y dispositivo, o escribir la dirección.';
  if (code === 3) return 'La ubicación tardó demasiado. Comprueba que la ubicación del dispositivo esté activa e intenta de nuevo, o escribe la dirección.';
  return 'No pudimos obtener tu ubicación actual. Comprueba la ubicación del dispositivo e intenta de nuevo, o escribe la dirección.';
}

/** One-shot device lookup. Never watches movement, persists a location or confirms a destination. */
export class DeviceLocationRequest {
  private pending: Promise<DeviceLocation | null> | null = null;
  private cancelPending?: () => void;

  constructor(private environment = () => ({
    secure: typeof window !== 'undefined' && window.isSecureContext,
    geolocation: typeof navigator !== 'undefined' ? navigator.geolocation : undefined,
  }), private now = () => Date.now(), private deadlineMs = 20000) {}

  cancel() { this.cancelPending?.(); }

  request(): Promise<DeviceLocation | null> {
    if (this.pending) return this.pending;
    const { secure, geolocation } = this.environment();
    if (!secure) return Promise.reject(new Error('Para usar tu ubicación, abre BOLT con una conexión segura HTTPS. También puedes escribir la dirección.'));
    if (!geolocation) return Promise.reject(new Error('Este navegador no permite consultar la ubicación. Abre BOLT en el navegador de tu celular o escribe la dirección.'));

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
    const timer = setTimeout(() => finish(null, new Error(deviceLocationError({ code: 3 }))), this.deadlineMs);
    this.cancelPending = () => finish(null);
    try {
      geolocation.getCurrentPosition(position => {
        if (settled) return;
        const coordinates = { lat: position.coords.latitude, lng: position.coords.longitude };
        const accuracyMeters = position.coords.accuracy;
        if (!validDestinationCoordinates(coordinates) || !Number.isFinite(accuracyMeters) || accuracyMeters < 0 ||
            !Number.isFinite(position.timestamp) || position.timestamp < startedAt - 5000 || position.timestamp > this.now() + 5000) {
          finish(null, new Error('El dispositivo no devolvió una ubicación actual válida. Intenta de nuevo o escribe la dirección.'));
          return;
        }
        finish({ coordinates, accuracyMeters });
      }, error => finish(null, new Error(deviceLocationError(error))), DEVICE_LOCATION_OPTIONS);
    } catch (error) { finish(null, new Error(deviceLocationError(error))); }
    return promise;
  }
}
