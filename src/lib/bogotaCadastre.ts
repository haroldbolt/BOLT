import { coverageMunicipality } from '../data/coverageConfig';
import { validDestinationCoordinates } from './addressGeography';
import type { AddressSearchResult } from './addressSearch';
import { enrichDestination } from './serverGeography';

const service = 'https://serviciosgis.catastrobogota.gov.co/arcgis/rest/services/catastro/placadomiciliaria/MapServer/0/query';
const roadTypes: Record<string, string> = {
  CALLE: 'CL', CL: 'CL', CLL: 'CL', CARRERA: 'KR', KR: 'KR', CRA: 'KR', CR: 'KR',
  TRANSVERSAL: 'TV', TRV: 'TV', TV: 'TV', DIAGONAL: 'DG', DG: 'DG',
  'AVENIDA CARRERA': 'AK', 'AV CARRERA': 'AK', 'AV CRA': 'AK', AK: 'AK',
  'AVENIDA CALLE': 'AC', 'AV CALLE': 'AC', 'AV CL': 'AC', AC: 'AC',
};
const roadLabels: Record<string, string> = {
  CL: 'Calle', KR: 'Carrera', TV: 'Transversal', DG: 'Diagonal', AK: 'Avenida Carrera', AC: 'Avenida Calle',
};
const cardinalLabels: Record<string, string> = { S: 'Sur', N: 'Norte', E: 'Este', O: 'Oeste' };

// Accept only a complete, unambiguous Colombian street + plate. Notes belong to a separate
// field. Unknown formats, including BIS and street quadrants not modelled here, stay on the manual flow.
const addressPattern = /^(AVENIDA CARRERA|AVENIDA CALLE|AV CARRERA|AV CALLE|AV CRA|AV CL|CALLE|CARRERA|TRANSVERSAL|DIAGONAL|CLL|CRA|TRV|CL|KR|CR|TV|DG|AK|AC)\.?\s*(\d{1,3})(?:\s*([A-Z]))?\s*(?:#|NRO\.?\s+|NO\.?\s+|N[°º]\s*|NUMERO\s+)(\s*\d{1,3})(?:\s*([A-Z]))?\s*(?:(SUR|NORTE|ESTE|OESTE)\s*)?-\s*(\d{1,3})\s*(SUR|NORTE|ESTE|OESTE)?$/;

function parseQuery(address: string) {
  if (address.length > 160) return null;
  const text = address.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase()
    .replace(/[‐‑‒–—−]/g, '-').replace(/AVENIDA-(CALLE|CARRERA)/g, 'AVENIDA $1')
    .trim().replace(/,\s*BOGOTA(?:\s+D\.?\s*C\.?)?(?:,\s*COLOMBIA)?$/, '').replace(/\s+/g, ' ');
  const match = addressPattern.exec(text);
  if (!match || (match[6] && match[8])) return null;
  const [, kind, way, suffix, cross, crossSuffix, before, number, after] = match;
  const road = roadTypes[kind] + ' ' + Number(way) + (suffix || '');
  const cardinal = (before || after || '').slice(0, 1);
  const crossing = String(Number(cross)) + (crossSuffix || '');
  const house = String(Number(number)).padStart(2, '0');
  const plate = [crossing, house, cardinal].filter(Boolean).join(' ');

  // Catastro publishes the Kennedy corridor as AK 86, while the public SuperCADE directory
  // calls the same road Carrera 86. Query both designations in one request to catch ambiguity.
  const roads = road === 'KR 86' ? ['KR 86', 'AK 86'] : [road];
  return { road, roads, crossing, house, cardinal, plate };
}

export async function findBogotaCadastreAddress(
  address: string, municipality: string, fetcher: typeof fetch = fetch,
): Promise<AddressSearchResult | null> {
  if (coverageMunicipality(municipality)?.code !== '11001') return null;
  const query = parseQuery(address);
  if (!query) return null;

  const url = new URL(service);
  // These literals are constructed exclusively from the enums and numeric grammar above.
  const roads = query.roads.map(road => `'${road}'`).join(',');
  const plates = [query.plate, query.plate + ' '].map(plate => `'${plate}'`).join(',');
  url.search = new URLSearchParams({
    where: `PDOTIPO=1 AND PDONVIAL IN (${roads}) AND PDOTEXTO IN (${plates})`,
    outFields: 'PDOCODIGO,PDONVIAL,PDOTEXTO,PDOTIPO', resultRecordCount: '2',
    returnGeometry: 'true', outSR: '4326', f: 'json',
  }).toString();

  try {
    const response = await fetcher(url, {
      redirect: 'error', credentials: 'omit', signal: AbortSignal.timeout(3500),
    });
    if (!response.ok) return null;
    const data = await response.json();
    if (data?.error || data?.exceededTransferLimit || data?.spatialReference?.wkid !== 4326 ||
        !Array.isArray(data.features) || data.features.length !== 1) return null;

    const feature = data.features[0];
    const attrs = feature?.attributes;
    if (!attrs || attrs.PDOTIPO !== 1 || !query.roads.includes(attrs.PDONVIAL) ||
        typeof attrs.PDOTEXTO !== 'string' || attrs.PDOTEXTO.trim() !== query.plate ||
        typeof attrs.PDOCODIGO !== 'string' || !/^[A-Z0-9]{1,40}$/.test(attrs.PDOCODIGO)) return null;

    const coordinates = { lat: feature.geometry?.y, lng: feature.geometry?.x };
    if (!validDestinationCoordinates(coordinates)) return null;
    const territory = enrichDestination({ coordinates });
    if (territory.municipalityCode !== '11001') return null;
    if (attrs.PDONVIAL !== query.road && territory.locality !== 'Kennedy') return null;

    const [kind, number] = attrs.PDONVIAL.split(' ');
    const direction = query.cardinal ? ' ' + cardinalLabels[query.cardinal] : '';
    const formattedAddress = `${roadLabels[kind]} ${number} # ${query.crossing}-${query.house}${direction}, Bogotá D.C.`;
    return {
      status: 'SELECT_ADDRESS',
      candidates: [{
        placeId: 'catastro-bogota:' + attrs.PDOCODIGO, coordinates, formattedAddress, source: 'BOGOTA_CADASTRE',
        countryCode: 'CO', municipality: territory.municipality, locality: territory.locality,
      }],
      message: 'Catastro Bogotá encontró la placa. Selecciona la dirección y revisa el punto de entrega.',
    };
  } catch {
    return null;
  }
}
