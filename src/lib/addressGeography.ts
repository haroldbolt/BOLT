import { canonicalizeBogotaLocality, normalizeTerritoryString } from './territoryConfig';

export interface AddressComponent { long_name: string; short_name?: string; types: string[] }
export interface AddressTerritory { municipality?: string; locality?: string; neighborhood?: string }

// Google locality means city, whereas Bogotá's localities are sublocalities.
// Match by component type, never by component order or words in the street.
export function parseAddressComponents(components: AddressComponent[] = []): AddressTerritory {
  const named = (type: string) => components.find(c => c.types?.includes(type))?.long_name;
  const cities = components.filter(c => c.types?.includes('locality') || c.types?.includes('administrative_area_level_2'));
  const city = cities.find(c => ['bogota', 'bogota d c', 'soacha'].includes(normalizeTerritoryString(c.long_name)))?.long_name
    || named('locality') || named('administrative_area_level_2');
  const candidates = components.filter(c => c.types?.some(t => /^sublocality(?:_level_\d)?$/.test(t)));
  const locality = candidates.map(c => canonicalizeBogotaLocality(c.long_name)).find(Boolean) || undefined;
  return { municipality: city, locality, neighborhood: named('neighborhood') || named('sublocality_level_2') };
}

export function validDestinationCoordinates(coords: any): coords is {lat:number;lng:number} {
  return !!coords && Number.isFinite(coords.lat) && Number.isFinite(coords.lng)
    && Math.abs(coords.lat) <= 90 && Math.abs(coords.lng) <= 180
    // Detect transposed Colombia coordinates; do not silently swap them.
    && !(coords.lat < -60 && coords.lng > -15 && coords.lng < 15);
}
