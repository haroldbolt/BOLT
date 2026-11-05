import type { GPSTelemetry, OrderTrackingSnapshot } from '../types';

export const GPS_QUEUE_LIMIT = 60;
export const GPS_MAX_AGE_MS = 5 * 60 * 1000;
export const GPS_FUTURE_TOLERANCE_MS = 30 * 1000;

export interface GpsFix {
  timestamp: number;
  coords: { latitude: number; longitude: number; accuracy: number; heading?: number | null; speed?: number | null; altitude?: number | null };
}

export interface GpsContext {
  orderId: string;
  shipmentId?: string;
  driverId: string;
  assignmentId: string;
  tripId: string;
  nextSequenceNumber: number;
}

export function gpsContextFromTracking(data: OrderTrackingSnapshot): GpsContext {
  if (data.status !== 'EN_CAMINO' || (data.isSplitOrder && !data.shipmentId) || !data.driver?.id || !data.assignmentId || !data.tripId ||
      !Number.isSafeInteger(data.nextSequenceNumber) || data.nextSequenceNumber < 1) {
    throw new Error('La entrega necesita estado EN_CAMINO, conductor y recorrido confirmados por el servidor.');
  }
  return {
    orderId: data.orderId, shipmentId: data.shipmentId, driverId: data.driver.id,
    assignmentId: data.assignmentId, tripId: data.tripId, nextSequenceNumber: data.nextSequenceNumber,
  };
}

export function gpsDisplayState(telemetry: (GPSTelemetry & { secondsAgo?: number }) | null | undefined, now = Date.now()) {
  if (!telemetry || !Number.isFinite(telemetry.latitude) || !Number.isFinite(telemetry.longitude) ||
      telemetry.latitude < 4.4 || telemetry.latitude > 4.9 || telemetry.longitude < -74.3 || telemetry.longitude > -73.9 ||
      !Number.isFinite(telemetry.accuracy) || telemetry.accuracy < 0 || telemetry.accuracy > 200 ||
      !Number.isFinite(telemetry.timestamp) || telemetry.timestamp <= 0 || telemetry.timestamp > now + GPS_FUTURE_TOLERANCE_MS) {
    return { state: 'pending' as const, coordinates: undefined, secondsAgo: null };
  }
  const secondsAgo = Math.max(0, Math.floor((now - telemetry.timestamp) / 1000));
  return {
    state: secondsAgo > 60 ? 'lost' as const : secondsAgo > 30 ? 'stale' as const : 'live' as const,
    coordinates: { lat: telemetry.latitude, lng: telemetry.longitude }, secondsAgo,
  };
}

/** One explicit foreground tracking session. Its queue is memory-only and is erased on stop. */
export class GpsTelemetrySession {
  readonly context: GpsContext;
  private queue: GPSTelemetry[] = [];
  private active = true;
  private flushing = false;
  private abortController: AbortController | null = null;
  private sequence: number;
  constructor(context: GpsContext, private options: {
    send: (point: GPSTelemetry, signal: AbortSignal) => Promise<unknown>;
    now?: () => number;
    pointId?: () => string;
    onSent?: (point: GPSTelemetry) => void;
    onError?: (message: string, point?: GPSTelemetry) => void;
    onFatal?: (message: string) => void;
  }) {
    this.context = { ...context };
    this.sequence = context.nextSequenceNumber;
  }
  get isActive() { return this.active; }
  get pendingCount() { return this.queue.length; }
  get nextSequenceNumber() { return this.sequence; }
  private now() { return (this.options.now || Date.now)(); }
  private prune() {
    const cutoff = this.now() - GPS_MAX_AGE_MS;
    this.queue = this.queue.filter(p => p.timestamp >= cutoff).slice(-GPS_QUEUE_LIMIT);
  }
  enqueue(fix: GpsFix, batteryLevel?: number | null): boolean {
    if (!this.active) return false;
    const { latitude, longitude, accuracy, heading, speed, altitude } = fix.coords;
    if (![latitude, longitude, accuracy, fix.timestamp].every(Number.isFinite) || accuracy < 0 || accuracy > 200 ||
        latitude < 4.4 || latitude > 4.9 || longitude < -74.3 || longitude > -73.9 ||
        fix.timestamp < this.now() - GPS_MAX_AGE_MS || fix.timestamp > this.now() + GPS_FUTURE_TOLERANCE_MS) {
      this.options.onError?.('Lectura GPS inválida, antigua o con precisión insuficiente.');
      return false;
    }
    const point: GPSTelemetry = {
      orderId: this.context.orderId, shipmentId: this.context.shipmentId,
      driverId: this.context.driverId, assignmentId: this.context.assignmentId, tripId: this.context.tripId,
      pointId: (this.options.pointId || (() => crypto.randomUUID()))(),
      latitude, longitude, accuracy, timestamp: fix.timestamp, sequenceNumber: this.sequence++,
    };
    if (typeof heading === 'number' && Number.isFinite(heading) && heading >= 0 && heading <= 360) point.heading = heading;
    if (typeof speed === 'number' && Number.isFinite(speed) && speed >= 0) point.speed = speed;
    if (typeof altitude === 'number' && Number.isFinite(altitude)) point.altitude = altitude;
    if (typeof batteryLevel === 'number' && Number.isFinite(batteryLevel) && batteryLevel >= 0 && batteryLevel <= 100) point.batteryLevel = batteryLevel;
    this.queue.push(point);
    this.prune();
    return true;
  }
  async flush(): Promise<void> {
    if (!this.active || this.flushing) return;
    this.flushing = true;
    let sequenceResynced = false;
    try {
      this.prune();
      while (this.active && this.queue.length) {
        const point = this.queue[0];
        this.abortController = new AbortController();
        try {
          await this.options.send(point, this.abortController.signal);
          if (!this.active) return;
          if (this.queue[0]?.pointId === point.pointId) this.queue.shift();
          this.options.onSent?.(point);
        } catch (error) {
          if (!this.active) return;
          const err = error as { status?: number; message?: string; nextSequenceNumber?: number };
          const message = !err.status ? 'Sin conexión: los puntos quedan pendientes mientras la entrega esté activa.' :
            err.message || 'No se pudo confirmar la lectura GPS con el servidor.';
          if (err.status === 409 && !sequenceResynced && Number.isSafeInteger(err.nextSequenceNumber) && err.nextSequenceNumber! > 0) {
            let next = err.nextSequenceNumber!;
            for (const pending of this.queue) pending.sequenceNumber = next++;
            this.sequence = next;
            sequenceResynced = true;
            continue;
          }
          this.options.onError?.(message, point);
          if (err.status && err.status >= 400 && err.status < 500 && ![408, 429].includes(err.status)) {
            this.stop();
            this.options.onFatal?.(message);
          }
          return; // Keep the same pointId for network/5xx retries, never duplicate an accepted point.
        } finally {
          this.abortController = null;
        }
        this.prune();
      }
    } finally {
      this.flushing = false;
    }
  }
  stop() {
    this.active = false;
    this.abortController?.abort();
    this.queue = [];
  }
}
