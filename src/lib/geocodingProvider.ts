import type { AddressComponent } from './addressGeography';

export type GeocodingFailure = 'NOT_CONFIGURED' | 'DENIED' | 'QUOTA' | 'DAILY_LIMIT_OR_BILLING' | 'TIMEOUT' | 'UNAVAILABLE';
export type GeocodingOutcome = GeocodingFailure | 'OK' | 'NO_RESULTS' | 'NO_EXACT_MATCH' | 'MUNICIPALITY_MISMATCH';
export type GeocodingDirection = 'forward' | 'reverse';

interface ProviderAddress {
  address_components?: AddressComponent[];
  formatted_address?: string;
  place_id?: string;
  geometry?: { location?: { lat: number; lng: number } };
  types?: string[];
  partial_match?: boolean;
}
type Reply = { outcome: 'OK'; results: ProviderAddress[] } | { outcome: GeocodingFailure | 'NO_RESULTS' };

/** Only allowlisted outcomes leave this server-side boundary; Google messages can contain private details. */
export async function consultGeocoding(params: URLSearchParams, apiKey: string, timeoutMs: number, request: typeof fetch): Promise<Reply> {
  if (!apiKey.trim()) return {outcome:'NOT_CONFIGURED'};
  const url = new URL('https://maps.googleapis.com/maps/api/geocode/json');
  url.search = params.toString();
  url.searchParams.set('key', apiKey.trim());
  url.searchParams.set('region', 'co');
  url.searchParams.set('language', 'es');
  const signal = AbortSignal.timeout(timeoutMs);
  try {
    const response = await request(url, {signal, redirect:'error'});
    if (!response.ok) {
      await response.body?.cancel();
      if (response.status === 403 || response.status === 401) return {outcome:'DENIED'};
      if (response.status === 429) return {outcome:'QUOTA'};
      return {outcome:'UNAVAILABLE'};
    }
    const data = await response.json();
    switch (data?.status) {
      case 'OK':
        if (!Array.isArray(data.results) || !data.results.length) return {outcome:'UNAVAILABLE'};
        return {outcome:'OK', results:data.results};
      case 'ZERO_RESULTS': return {outcome:'NO_RESULTS'};
      case 'REQUEST_DENIED': return {outcome:'DENIED'};
      case 'OVER_QUERY_LIMIT': return {outcome:'QUOTA'};
      case 'OVER_DAILY_LIMIT': return {outcome:'DAILY_LIMIT_OR_BILLING'};
      default: return {outcome:'UNAVAILABLE'};
    }
  } catch {
    return {outcome:signal.aborted ? 'TIMEOUT' : 'UNAVAILABLE'};
  }
}
