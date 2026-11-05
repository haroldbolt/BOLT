import assert from 'node:assert/strict';
import { GpsTelemetrySession, gpsContextFromTracking, gpsDisplayState, GPS_QUEUE_LIMIT, GPS_MAX_AGE_MS } from '../lib/gpsTelemetry';
import type { GPSTelemetry, OrderTrackingSnapshot } from '../types';
import { api, ApiRequestError } from '../lib/api';

let passed = 0;
function check(condition: unknown, message: string) { assert.ok(condition, message); passed++; }
const now = 1800000000000;
const snapshot: OrderTrackingSnapshot = {
  orderId: 'FIXTURE-ORDER', shipmentId: 'CHILD-A', assignmentId: 'ASSIGN-CHILD', tripId: 'TRIP-CHILD',
  status: 'EN_CAMINO', nextSequenceNumber: 8, serverTimestamp: now, driver: { id: 'FIXTURE-DRIVER', name: 'Conductor de prueba' },
  telemetry: null, hubCoordinates: { lat: 4.65, lng: -74.1 }, customerCoordinates: { lat: 4.66, lng: -74.11 },
};
const context = gpsContextFromTracking(snapshot);
const fix = { timestamp: now - 1000, coords: { latitude: 4.65, longitude: -74.1, accuracy: 8, heading: null, speed: null, altitude: null } };
let counter = 0;
const options = { now: () => now, pointId: () => 'POINT-' + ++counter };

check(gpsDisplayState(null, now).state === 'pending', 'Sin telemetría se muestra pendiente');
check(gpsDisplayState(null, now).coordinates === undefined, 'Sin telemetría no existe marcador de conductor');
const basic: GPSTelemetry = { ...context, ...fix.coords, heading: undefined, speed: undefined, altitude: undefined, timestamp: now, sequenceNumber: 8 };
check(gpsDisplayState(basic, now).state === 'live', 'Punto real reciente puede mostrarse en vivo');
check(gpsDisplayState({ ...basic, timestamp: now - 45000 }, now).state === 'stale', 'La edad sigue avanzando sin nuevas respuestas');
check(gpsDisplayState({ ...basic, timestamp: now - 90000 }, now).state === 'lost', 'Un punto antiguo no se marca en vivo');
check(gpsDisplayState({ ...basic, timestamp: now + 60000 }, now).state === 'pending', 'Fecha futura inválida no se presenta como actual');
assert.throws(() => gpsContextFromTracking({ ...snapshot, status: 'REPARTIDOR_ASIGNADO' })); passed++;
assert.throws(() => gpsContextFromTracking({ ...snapshot, tripId: undefined })); passed++;
assert.throws(() => gpsContextFromTracking({ ...snapshot, nextSequenceNumber: 0 })); passed++;
assert.throws(() => gpsContextFromTracking({ ...snapshot, isSplitOrder: true, shipmentId: undefined })); passed++;

{
  const sent: GPSTelemetry[] = [];
  const session = new GpsTelemetrySession(context, { ...options, send: async p => { sent.push(structuredClone(p)); } });
  check(session.enqueue(fix), 'Se acepta una lectura del sensor real');
  await session.flush();
  const point = sent[0];
  check(point.sequenceNumber === 8, 'Se reanuda con la siguiente secuencia del servidor');
  check(point.shipmentId === 'CHILD-A' && point.assignmentId === 'ASSIGN-CHILD' && point.tripId === 'TRIP-CHILD', 'El hijo conserva sus propios IDs');
  check(point.timestamp === fix.timestamp, 'Se preserva la fecha del sensor');
  check(point.accuracy === 8, 'Se preserva la precisión del sensor');
  check(point.batteryLevel === undefined && point.speed === undefined && point.heading === undefined, 'No se inventan batería, velocidad ni orientación');
  check(!!point.pointId && session.pendingCount === 0, 'Cada lectura tiene ID estable y sale de la cola al confirmarse');
}
{
  let online = false;
  const attempts: GPSTelemetry[] = [];
  const session = new GpsTelemetrySession(context, { ...options, send: async p => {
    attempts.push(structuredClone(p)); if (!online) throw new TypeError('Sin Internet');
  } });
  session.enqueue(fix);
  await session.flush();
  check(session.pendingCount === 1 && session.isActive, 'Sin Internet se conserva la lectura pendiente');
  online = true;
  await session.flush();
  check(attempts[0].pointId === attempts[1].pointId && attempts[0].sequenceNumber === attempts[1].sequenceNumber, 'Un reintento conserva ID y secuencia para evitar duplicados');
  check(session.pendingCount === 0, 'Reconectar permite confirmar la cola');
}
{
  let time = now;
  let sent = 0;
  const session = new GpsTelemetrySession(context, { ...options, now: () => time, send: async () => { sent++; } });
  for (let i = 0; i < 90; i++) session.enqueue(fix);
  check(session.pendingCount === GPS_QUEUE_LIMIT, 'La cola queda limitada a 60 puntos');
  time += GPS_MAX_AGE_MS + 1;
  await session.flush();
  check(sent === 0 && session.pendingCount === 0, 'La cola no reenvía puntos vencidos');
}
{
  let sent = 0;
  const session = new GpsTelemetrySession(context, { ...options, send: async () => { sent++; } });
  check(!session.enqueue({ ...fix, timestamp: now - GPS_MAX_AGE_MS - 1 }), 'Se rechaza una lectura demasiado antigua');
  check(!session.enqueue({ ...fix, timestamp: now + 31000 }), 'Se rechaza una fecha futura');
  check(!session.enqueue({ ...fix, coords: { ...fix.coords, accuracy: NaN } }), 'No se inventa precisión cuando falta');
  check(!session.enqueue({ ...fix, coords: { ...fix.coords, latitude: 0 } }), 'Se rechazan coordenadas fuera de cobertura');
  session.stop();
  check(!session.enqueue(fix), 'Un callback de GPS tardío no agrega lecturas después de detener');
  await session.flush();
  check(sent === 0, 'No hay transmisiones fuera de una sesión activa');
}
{
  let release!: () => void;
  let signal: AbortSignal | undefined;
  let acknowledgments = 0;
  const session = new GpsTelemetrySession(context, { ...options,
    send: async (_p, s) => { signal = s; await new Promise<void>(resolve => { release = resolve; }); },
    onSent: () => { acknowledgments++; },
  });
  session.enqueue(fix);
  const flushing = session.flush();
  session.stop();
  check(signal?.aborted, 'Detener cancela la petición HTTP pendiente');
  release(); await flushing;
  check(acknowledgments === 0 && session.pendingCount === 0, 'Una respuesta tardía no reactiva el seguimiento ni la cola');
}
{
  let calls = 0;
  const attempts: GPSTelemetry[] = [];
  const session = new GpsTelemetrySession(context, { ...options, send: async p => {
    attempts.push(structuredClone(p));
    if (++calls === 1) throw Object.assign(new Error('Secuencia de otro dispositivo'), { status: 409, nextSequenceNumber: 20 });
  } });
  session.enqueue(fix);
  await session.flush();
  check(calls === 2 && attempts[1].sequenceNumber === 20, 'Se puede sincronizar la secuencia tras un 409 del servidor');
  check(attempts[0].pointId === attempts[1].pointId && session.nextSequenceNumber === 21, 'Reanudar conserva la identidad de la lectura');
}
{
  let stopped = false;
  const session = new GpsTelemetrySession(context, { ...options,
    send: async () => { throw Object.assign(new Error('Conductor sin autorización'), { status: 403 }); },
    onFatal: () => { stopped = true; },
  });
  session.enqueue(fix); await session.flush();
  check(stopped && !session.isActive && session.pendingCount === 0, 'Un rechazo de permisos detiene la captura y descarta la cola');
}
{
  // Stub fetch only in this process; never contact the real backend or a maps provider.
  const originalFetch = globalThis.fetch;
  let request: { url: string; options?: RequestInit } | undefined;
  try {
    globalThis.fetch = (async (input, options) => {
      request = { url: String(input), options };
      return new Response(JSON.stringify(snapshot), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as typeof fetch;
    const abort = new AbortController();
    await api.getTracking('ORDER/#1', 'CHILD/?A', abort.signal);
    check(request?.url.includes('ORDER%2F%231/tracking?shipmentId=CHILD%2F%3FA'), 'La consulta usa el hijo seleccionado y codifica sus IDs');
    check(request?.options?.signal === abort.signal, 'La consulta permite cancelar respuestas cruzadas');
    await api.confirmPhysicalReturn('FIXTURE', 'Inspector de prueba', undefined, 'CHILD-A');
    check(JSON.parse(request!.options!.body as string).shipmentId === 'CHILD-A', 'Confirmar retorno envía únicamente el hijo inspeccionado');
    globalThis.fetch = (async () => new Response(JSON.stringify({ error: 'Secuencia repetida', nextSequenceNumber: 42 }), { status: 409 })) as typeof fetch;
    try { await api.sendGpsTelemetry(basic, context.driverId); assert.fail('Se esperaba error de secuencia'); }
    catch (error) {
      check(error instanceof ApiRequestError && error.status === 409 && error.nextSequenceNumber === 42, 'El cliente conserva status y secuencia esperada del servidor');
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
}
console.log('GPS de navegador: ' + passed + ' comprobaciones aprobadas; fixtures aislados, sin GPS ni servicios reales.');
