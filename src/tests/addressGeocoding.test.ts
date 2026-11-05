import assert from 'node:assert/strict';
import { api, type GeocodingCandidate } from '../lib/api';
import { resolveAddress, resolveCoordinates } from '../lib/addressGeocoding';

let passed = 0;
function check(value: unknown, message: string) { assert.ok(value, message); passed++; }
async function rejects(operation: Promise<unknown>, pattern: RegExp) { await assert.rejects(operation, pattern); passed++; }
const point = { lat: 4.63651, lng: -74.14481 };
const fixture = (overrides: Record<string, unknown> = {}) => ({
  formatted_address: 'Carrera 79A #2-05, Bogotá, Colombia', place_id: 'FIXTURE-ADDRESS', partial_match: false,
  types: ['street_address'], geometry: { location: { lat: () => point.lat, lng: () => point.lng }, location_type: 'ROOFTOP' }, ...overrides,
});
const candidate: GeocodingCandidate = { address: fixture().formatted_address, coordinates: point, partialMatch: false, types: ['street_address'], locationType: 'ROOFTOP', placeId: 'FIXTURE-ADDRESS' };
const originalGoogle = (globalThis as any).google;
const originalFetch = globalThis.fetch;
const originalForward = api.forwardGeocode;
const originalReverse = api.reverseGeocode;
let requests: any[] = [];
let calls = 0;
const active = () => new AbortController().signal;
function sdk(results: any[], status = 'OK') {
  (globalThis as any).google = { maps: { Geocoder: class { geocode(request: any, callback: any) { requests.push(request); callback(results, status); } } } };
}
try {
  sdk([fixture()]);
  const resolved = await resolveAddress('Carrera 79A #2-05', active());
  check(resolved.address === candidate.address && resolved.coordinates.lat === point.lat, 'La dirección real y el punto del SDK se devuelven juntos');
  check(requests[0].address.endsWith(', Bogotá, Colombia') && requests[0].componentRestrictions.country === 'CO', 'La búsqueda conserva el contexto de Bogotá/Colombia');
  requests = [];
  await resolveAddress('Carrera 79A #2-05, Bogotá', active());
  check(requests[0].address === 'Carrera 79A #2-05, Bogotá', 'Una dirección con ciudad no duplica el sufijo');

  sdk([fixture({ partial_match: true })]);
  await rejects(resolveAddress('Dirección incompleta', active()), /suficiente precisión/);
  sdk([fixture({ geometry: { location: point, location_type: 'APPROXIMATE' } })]);
  await rejects(resolveAddress('Kennedy', active()), /suficiente precisión/);
  sdk([fixture({ types: ['locality', 'political'] })]);
  await rejects(resolveAddress('Bogotá', active()), /suficiente precisión/);
  sdk([fixture({ geometry: { location: { lat: Infinity, lng: -74.1 }, location_type: 'ROOFTOP' } })]);
  await rejects(resolveAddress('Dirección inválida', active()), /suficiente precisión/);

  sdk([fixture(), fixture({ formatted_address: 'Otra calle, Bogotá', place_id: 'FIXTURE-OTHER' })]);
  await rejects(resolveAddress('Calle ambigua', active()), /varias ubicaciones/);
  sdk([fixture(), fixture()]);
  check((await resolveAddress('Dirección repetida', active())).coordinates.lng === point.lng, 'Resultados duplicados del mismo lugar no crean una falsa ambigüedad');
  sdk([], 'ZERO_RESULTS');
  await rejects(resolveAddress('No existe', active()), /suficiente precisión/);

  sdk([fixture({ types: ['locality', 'political'] }), fixture()]);
  const chosen = { lat: 4.636533, lng: -74.144833 };
  const reverse = await resolveCoordinates(chosen, active());
  check(reverse.coordinates.lat === chosen.lat && reverse.coordinates.lng === chosen.lng, 'La dirección inversa conserva el punto exacto elegido, sin desplazar el pin');
  check(reverse.address === candidate.address, 'La dirección inversa omite regiones políticas y usa una vía/dirección reconocida');
  sdk([fixture({ types: ['political', 'locality'] })]);
  await rejects(resolveCoordinates(point, active()), /No identificamos una dirección/);
  await rejects(resolveCoordinates({ lat: 95, lng: 1 }, active()), /punto válido/);
  await rejects(resolveAddress(' ', active()), /suficiente precisión/);

  delete (globalThis as any).google;
  api.forwardGeocode = async (_address, signal) => { check(!!signal, 'El proxy directo recibe cancelación'); return { formattedAddress: candidate.address, coordinates: point, candidates: [candidate] }; };
  check((await resolveAddress('Carrera 79A #2-05', active())).address === candidate.address, 'Si el SDK no está disponible se acepta el resultado verificado del proxy');
  api.forwardGeocode = async () => ({ formattedAddress: candidate.address, coordinates: point, candidates: [{ ...candidate, partialMatch: true }] });
  await rejects(resolveAddress('Parcial del proxy', active()), /suficiente precisión/);
  api.forwardGeocode = async () => ({ formattedAddress: candidate.address, coordinates: point });
  await rejects(resolveAddress('Proxy antiguo sin calidad', active()), /No pudimos consultar Google Maps/);
  api.reverseGeocode = async () => ({ address: candidate.address, candidates: [candidate] });
  check((await resolveCoordinates(chosen, active())).coordinates.lat === chosen.lat, 'El proxy inverso también conserva la selección del cliente');

  let lateCallback: any;
  (globalThis as any).google = { maps: { Geocoder: class { geocode(_request: any, callback: any) { lateCallback = callback; } } } };
  api.forwardGeocode = async () => { calls++; return null; };
  const controller = new AbortController();
  const pending = resolveAddress('Carrera 79A #2-05', controller.signal);
  controller.abort();
  await rejects(pending, /abort/i);
  lateCallback([fixture()], 'OK');
  check(calls === 0, 'Cancelar el SDK no provoca una nueva búsqueda de respaldo ni acepta callbacks tardíos');

  // Verify the real API wrappers forward AbortSignal and never turn cancellation
  // into a local delivery quote or an apparently successful null lookup.
  api.forwardGeocode = originalForward;
  api.reverseGeocode = originalReverse;
  let receivedSignal: AbortSignal | null = null;
  globalThis.fetch = async (_input, init) => {
    receivedSignal = init?.signal as AbortSignal;
    throw new DOMException('Operación cancelada', 'AbortError');
  };
  const quoteSignal = active();
  await rejects(api.getDeliveryQuote({ destination: { address: candidate.address, coordinates: point }, items: [] }, [], [], quoteSignal), /cancelada/);
  check(receivedSignal === quoteSignal, 'La cotización transmite la señal hasta fetch');
  await rejects(api.forwardGeocode('Prueba', quoteSignal), /cancelada/);
  await rejects(api.reverseGeocode(point.lat, point.lng, quoteSignal), /cancelada/);
  const cancelled = new AbortController(); cancelled.abort();
  globalThis.fetch = async () => { throw new Error('Fallo al cancelar'); };
  await rejects(api.getDeliveryQuote({ destination: { address: candidate.address, coordinates: point }, items: [] }, [], [], cancelled.signal), /abort/i);
} finally {
  (globalThis as any).google = originalGoogle;
  globalThis.fetch = originalFetch;
  api.forwardGeocode = originalForward;
  api.reverseGeocode = originalReverse;
}
console.log(`Geocodificación: ${passed} comprobaciones aprobadas.`);
