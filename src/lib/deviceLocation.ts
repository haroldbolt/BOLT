import { validDestinationCoordinates } from './addressGeography';

export interface DeviceLocation {
  coordinates: { lat: number; lng: number };
  accuracyMeters: number;
  ageSeconds: number;
}

export const DEVICE_LOCATION_OPTIONS: PositionOptions = {
  enableHighAccuracy: true,
  maximumAge: 0,
  timeout: 12000,
};

export type DeviceLocationFailure = 'permission' | 'timeout' | 'unavailable' | 'insecure' | 'unsupported' | 'invalid' | 'stale' | 'clock';
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

/** One-shot lookup with a bounded fresh-fix retry. Never persists or confirms a destination. */
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

    let settled = false;
    let watchId:number|undefined;
    let refreshing=false;
    let readingError:DeviceLocationError|undefined;
    const finish = (value: DeviceLocation | null, error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if(watchId!==undefined) geolocation.clearWatch(watchId);
      this.pending = null;
      this.cancelPending = undefined;
      if (error) reject(error); else resolve(value);
    };
    // Also bounds time spent waiting for an unanswered browser permission prompt.
    const timer = setTimeout(() => finish(null, readingError || nativeFailure({ code: 3 })), this.deadlineMs);
    this.cancelPending = () => finish(null);
    try {
      const receive:PositionCallback = position => {
        if (settled) return;
        const coordinates = { lat: position.coords.latitude, lng: position.coords.longitude };
        const accuracyMeters = position.coords.accuracy;
        if (!validDestinationCoordinates(coordinates) || !Number.isFinite(accuracyMeters) || accuracyMeters < 0) {
          finish(null, new DeviceLocationError('invalid', 'El teléfono envió coordenadas o precisión incompletas. Vuelve a intentarlo o escribe la dirección y elige el municipio.'));
          return;
        }
        // The acquisition timestamp may precede the callback. Five seconds rejected recent
        // mobile readings; allow a bounded one-minute reading, explicitly shown as approximate.
        const ageMs=this.now()-position.timestamp;
        if (!Number.isFinite(position.timestamp) || position.timestamp<=0 || ageMs < -5000) {
          finish(null, new DeviceLocationError('clock', 'No pudimos comprobar la hora de la ubicación. Revisa que la fecha y hora del teléfono sean automáticas o escribe la dirección.'));
          return;
        }
        if(ageMs > 60000) {
          readingError=new DeviceLocationError('stale', 'El teléfono devolvió una ubicación antigua. Activa la ubicación precisa, vuelve a intentarlo o escribe la dirección y elige el municipio.');
          // Some mobile providers first deliver their last fix. Wait briefly for a fresh
          // fix under the already-granted permission, then stop watching on every exit.
          if(!refreshing && typeof geolocation.watchPosition==='function') {
            refreshing=true;
            watchId=geolocation.watchPosition(receive,error=>finish(null,error.code===3 ? readingError || nativeFailure(error) : nativeFailure(error)),DEVICE_LOCATION_OPTIONS);
            if(settled) geolocation.clearWatch(watchId);
          } else if(!refreshing) finish(null,readingError);
          return;
        }
        finish({ coordinates, accuracyMeters, ageSeconds: Math.max(0,Math.round(ageMs/1000)) });
      };
      geolocation.getCurrentPosition(receive, error => finish(null, nativeFailure(error)), DEVICE_LOCATION_OPTIONS);
    } catch (error) { finish(null, nativeFailure(error)); }
    return promise;
  }
}
