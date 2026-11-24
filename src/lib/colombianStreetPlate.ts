import type { AddressComponent } from './addressGeography';

export interface StreetPlate {
  crossStreet: string;
  houseNumber: string;
  direction: string;
}

const plateMarker = /#|\b(?:NRO\.?|NUMERO|NO\.?|N\.?[º°])\s*(?=\d)/i;
// Colombian nomenclature separates the crossing street from the distance to the entrance.
// A direction can follow either number. It cannot be inferred from city or neighborhood labels.
const numeral = String.raw`(\d+(?:\s*[A-Z](?![A-Z]))?(?:\s*BIS(?:\s*[A-Z](?![A-Z]))?)?)`;
const cardinal = String.raw`(SUR|NORTE|ESTE|OESTE|ORIENTE|OCCIDENTE)\b`;
const platePattern = new RegExp(`^\\s*${numeral}\\s*(?:${cardinal})?\\s*[-‐‑‒–—−]\\s*${numeral}(?![A-Z0-9])\\s*(?:${cardinal})?`, 'i');

function parsePlate(value: string): StreetPlate | null {
  const match = platePattern.exec(value.toUpperCase());
  if (!match) return null;
  const number = (text: string) => text.replace(/\s/g, '').replace(/^0+(?=\d)/, '');
  const direction = (match[2] || match[4] || '').replace('ORIENTE','ESTE').replace('OCCIDENTE','OESTE');
  return {crossStreet:number(match[1]), houseNumber:number(match[3]), direction};
}

export function readStreetPlate(address: string): StreetPlate | null {
  const normalized = address.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const marker = plateMarker.exec(normalized);
  return marker ? parsePlate(normalized.slice(marker.index + marker[0].length)) : null;
}

/** A recognized, complete plate in the request must have independent evidence in the provider result. */
export function matchesStreetPlate(address: string, formattedAddress: string, components: readonly AddressComponent[] = []): boolean {
  const expected = readStreetPlate(address);
  if (!expected) return true;
  const shown = readStreetPlate(formattedAddress);
  const component = components.find(part => part.types?.includes('street_number'))?.long_name;
  const structured = component ? parsePlate(component.replace(/^\s*#/, '')) : null;
  // A visible, truncated plate must never be offered to the customer as a full match.
  if (!shown && plateMarker.test(formattedAddress)) return false;
  const available = [shown, structured].filter((item): item is StreetPlate => item !== null);
  if (!available.length || available.some(item => item.crossStreet !== expected.crossStreet || item.houseNumber !== expected.houseNumber)) return false;
  if (!expected.direction) return true;
  const directions = available.map(item => item.direction).filter(Boolean);
  return directions.length > 0 && directions.every(value => value === expected.direction);
}
