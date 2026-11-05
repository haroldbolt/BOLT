import { api, type GeocodingCandidate } from './api';
import type { LatLng } from './deliveryService';

export interface ResolvedAddress { address: string; coordinates: LatLng }
const LOOKUP_TIMEOUT_MS = 10000;
const ADDRESS_ERROR = 'No pudimos localizar esa dirección con suficiente precisión. Complétala o ajusta el pin en el mapa.';

function assertActive(signal: AbortSignal) { signal.throwIfAborted(); }
function validCoordinates(value: any): value is LatLng {
  return !!value && Number.isFinite(value.lat) && Number.isFinite(value.lng) && Math.abs(value.lat) <= 90 && Math.abs(value.lng) <= 180;
}
function cleanAddress(value: string) {
  return value.replace(/,\s*Bogotá,\s*D\.C\.,\s*Bogotá,\s*Bogotá,\s*D\.C\./gi, ', Bogotá')
    .replace(/,\s*Bogotá,\s*D\.C\./gi, ', Bogotá').replace(/,\s*Cundinamarca/gi, '').trim();
}

// SDK callbacks cannot be cancelled at Google; this wrapper settles locally and
// removes its listeners so a late callback can never change the selection.
async function withDeadline<T>(signal: AbortSignal, operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
  assertActive(signal);
  const controller = new AbortController();
  const cancel = () => controller.abort(signal.reason);
  signal.addEventListener('abort', cancel, { once: true });
  const timer = setTimeout(() => controller.abort(new Error('La búsqueda está tardando demasiado. Intenta nuevamente.')), LOOKUP_TIMEOUT_MS);
  try { return await operation(controller.signal); }
  finally { clearTimeout(timer); signal.removeEventListener('abort', cancel); }
}

async function sdkCandidates(request: Record<string, unknown>, signal: AbortSignal): Promise<GeocodingCandidate[]> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error?: unknown, results?: GeocodingCandidate[]) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', abort);
      if (error) reject(error); else resolve(results || []);
    };
    const abort = () => finish(signal.reason || new DOMException('Operación cancelada', 'AbortError'));
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) { abort(); return; }
    void (async () => {
      try {
        const maps = (globalThis as any).google?.maps;
        let Geocoder = maps?.Geocoder;
        if (!Geocoder && maps?.importLibrary) Geocoder = (await maps.importLibrary('geocoding'))?.Geocoder;
        if (settled) return;
        if (!Geocoder) throw new Error('El servicio de Google Maps todavía no está disponible.');
        const pending = new Geocoder().geocode(request, (results: any[], status: string) => {
          if (settled) return;
          if (status === 'ZERO_RESULTS') { finish(undefined, []); return; }
          if (status !== 'OK') { finish(new Error('Google Maps no pudo consultar esa dirección.')); return; }
          try {
            finish(undefined, (results || []).map(result => {
              const location = result.geometry?.location;
              const lat = typeof location?.lat === 'function' ? location.lat() : location?.lat;
              const lng = typeof location?.lng === 'function' ? location.lng() : location?.lng;
              return {
                address: result.formatted_address,
                coordinates: { lat, lng },
                partialMatch: result.partial_match === true,
                locationType: result.geometry?.location_type,
                types: result.types,
                placeId: result.place_id,
              };
            }));
          } catch (error) { finish(error); }
        });
        // Recent SDKs also return a Promise when a callback is supplied.
        // Consume its rejection; the settled guard still permits only one result.
        if (pending && typeof pending.catch === 'function') pending.catch((error: unknown) => finish(error));
      } catch (error) { finish(error); }
    })();
  });
}

function selectForward(candidates: GeocodingCandidate[]): ResolvedAddress {
  const first = candidates[0];
  if (!first || typeof first.address !== 'string' || !first.address.trim() || !validCoordinates(first.coordinates) || first.partialMatch) throw new Error(ADDRESS_ERROR);
  if (!['ROOFTOP', 'RANGE_INTERPOLATED'].includes(first.locationType || '') ||
      !first.types?.some(type => ['street_address', 'premise', 'subpremise', 'intersection', 'establishment', 'point_of_interest'].includes(type))) {
    throw new Error(ADDRESS_ERROR);
  }
  // Different addresses returned for one query require the customer to refine
  // the text/select the intended point. Duplicate candidates do not add ambiguity.
  if (candidates.some(candidate => {
    if (candidate === first) return false;
    if (candidate.placeId && first.placeId && candidate.placeId === first.placeId) return false;
    return cleanAddress(candidate.address || '').toLocaleLowerCase() !== cleanAddress(first.address).toLocaleLowerCase() ||
      !validCoordinates(candidate.coordinates) || Math.abs(candidate.coordinates.lat - first.coordinates!.lat) > 0.0001 || Math.abs(candidate.coordinates.lng - first.coordinates!.lng) > 0.0001;
  })) throw new Error('Encontramos varias ubicaciones posibles. Completa la dirección o selecciona el punto correcto en el mapa.');
  return { address: cleanAddress(first.address), coordinates: { ...first.coordinates } };
}

export async function resolveAddress(address: string, signal: AbortSignal): Promise<ResolvedAddress> {
  assertActive(signal);
  const input = address.trim();
  if (!input || input.length > 500) throw new Error(ADDRESS_ERROR);
  const searchTarget = /bogot/i.test(input) ? input : `${input}, Bogotá, Colombia`;
  let candidates: GeocodingCandidate[];
  try {
    candidates = await withDeadline(signal, current => sdkCandidates({ address: searchTarget, region: 'co', componentRestrictions: { country: 'CO' } }, current));
  } catch {
    assertActive(signal);
    const response = await withDeadline(signal, current => api.forwardGeocode(input, current));
    assertActive(signal);
    if (!response?.candidates) throw new Error('No pudimos consultar Google Maps. Reintenta la búsqueda o ajusta el pin.');
    candidates = response.candidates;
  }
  assertActive(signal);
  return selectForward(candidates);
}

export async function resolveCoordinates(coordinates: LatLng, signal: AbortSignal): Promise<ResolvedAddress> {
  assertActive(signal);
  if (!validCoordinates(coordinates)) throw new Error('Selecciona un punto válido en el mapa.');
  let candidates: GeocodingCandidate[];
  try {
    candidates = await withDeadline(signal, current => sdkCandidates({ location: { ...coordinates }, region: 'co' }, current));
  } catch {
    assertActive(signal);
    const response = await withDeadline(signal, current => api.reverseGeocode(coordinates.lat, coordinates.lng, current));
    assertActive(signal);
    if (!response?.candidates) throw new Error('No pudimos consultar la dirección del pin en Google Maps. Intenta nuevamente.');
    candidates = response.candidates;
  }
  assertActive(signal);
  // Reverse geocoding also returns political regions at different scales. Use
  // the closest actual address while preserving the point chosen by the user.
  const first = candidates.find(candidate => typeof candidate.address === 'string' && candidate.address.trim() && validCoordinates(candidate.coordinates) && !candidate.partialMatch &&
    candidate.types?.some(type => ['street_address', 'premise', 'subpremise', 'intersection', 'route'].includes(type)));
  if (!first) throw new Error('No identificamos una dirección de entrega en ese punto. Ajusta el pin hacia una vía o entrada reconocida.');
  return { address: cleanAddress(first.address), coordinates: { ...coordinates } };
}
