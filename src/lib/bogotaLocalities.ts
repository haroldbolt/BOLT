import localityData from '../data/geography/bogota-localities.json';

/** Official locality boundaries: SDP / IDECA, EPSG:4326; see data/geography/README.md. */
export const BOGOTA_LOCALITY_NAMES = {
  USAQUEN: 'Usaquén', CHAPINERO: 'Chapinero', SANTA_FE: 'Santa Fe',
  SAN_CRISTOBAL: 'San Cristóbal', USME: 'Usme', TUNJUELITO: 'Tunjuelito',
  BOSA: 'Bosa', KENNEDY: 'Kennedy', FONTIBON: 'Fontibón', ENGATIVA: 'Engativá',
  SUBA: 'Suba', BARRIOS_UNIDOS: 'Barrios Unidos', TEUSAQUILLO: 'Teusaquillo',
  LOS_MARTIRES: 'Los Mártires', ANTONIO_NARINO: 'Antonio Nariño',
  PUENTE_ARANDA: 'Puente Aranda', LA_CANDELARIA: 'La Candelaria',
  RAFAEL_URIBE_URIBE: 'Rafael Uribe Uribe', CIUDAD_BOLIVAR: 'Ciudad Bolívar',
  SUMAPAZ: 'Sumapaz',
} as const;

export type BogotaLocalityCode = keyof typeof BOGOTA_LOCALITY_NAMES;
export interface BogotaLocality { code: BogotaLocalityCode; name: string }

const CODE_BY_OFFICIAL: Record<string, BogotaLocalityCode> = {
  '01': 'USAQUEN', '02': 'CHAPINERO', '03': 'SANTA_FE', '04': 'SAN_CRISTOBAL',
  '05': 'USME', '06': 'TUNJUELITO', '07': 'BOSA', '08': 'KENNEDY', '09': 'FONTIBON',
  '10': 'ENGATIVA', '11': 'SUBA', '12': 'BARRIOS_UNIDOS', '13': 'TEUSAQUILLO',
  '14': 'LOS_MARTIRES', '15': 'ANTONIO_NARINO', '16': 'PUENTE_ARANDA',
  '17': 'LA_CANDELARIA', '18': 'RAFAEL_URIBE_URIBE', '19': 'CIUDAD_BOLIVAR', '20': 'SUMAPAZ',
};

type Position = number[];
type Polygon = Position[][];
interface Geometry { type: 'Polygon' | 'MultiPolygon'; coordinates: Polygon | Polygon[] }
type Bounds = [number, number, number, number];
interface IndexedLocality extends BogotaLocality { polygons: Array<{ rings: Polygon; bounds: Bounds }> }
// About one centimetre. Boundary-adjacent fixes require clarification, not an
// arbitrary choice dependent on feature ordering or a submitted address label.
const BOUNDARY_EPSILON = 1e-7;

const indexedLocalities: IndexedLocality[] = localityData.features.map(feature => {
  const code = CODE_BY_OFFICIAL[feature.properties.LOCCODIGO];
  if (!code) throw new Error('El conjunto oficial incluye un código de localidad desconocido.');
  const geometry = feature.geometry as Geometry;
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates as Polygon] : geometry.coordinates as Polygon[];
  return {
    code, name: BOGOTA_LOCALITY_NAMES[code],
    polygons: polygons.map(rings => {
      const bounds: Bounds = [Infinity, Infinity, -Infinity, -Infinity];
      for (const point of rings[0]) {
        bounds[0] = Math.min(bounds[0], point[0]); bounds[1] = Math.min(bounds[1], point[1]);
        bounds[2] = Math.max(bounds[2], point[0]); bounds[3] = Math.max(bounds[3], point[1]);
      }
      return { rings, bounds };
    }),
  };
});
if (indexedLocalities.length !== 20 || new Set(indexedLocalities.map(locality => locality.code)).size !== 20) {
  throw new Error('El conjunto oficial de localidades de Bogotá está incompleto.');
}

function onSegment(x: number, y: number, a: Position, b: Position): boolean {
  if (x < Math.min(a[0], b[0]) - BOUNDARY_EPSILON || x > Math.max(a[0], b[0]) + BOUNDARY_EPSILON ||
      y < Math.min(a[1], b[1]) - BOUNDARY_EPSILON || y > Math.max(a[1], b[1]) + BOUNDARY_EPSILON) return false;
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const length = Math.hypot(dx, dy);
  if (!length) return Math.hypot(x - a[0], y - a[1]) <= BOUNDARY_EPSILON;
  return Math.abs((x - a[0]) * dy - (y - a[1]) * dx) / length <= BOUNDARY_EPSILON;
}

/** 1 inside, 0 outside, -1 on/very close to a boundary. */
function inRing(x: number, y: number, ring: Position[]): -1 | 0 | 1 {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[j], b = ring[i];
    if (onSegment(x, y, a, b)) return -1;
    if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside ? 1 : 0;
}

/** Coordinate-only classification; address text is deliberately not an input. */
export function resolveBogotaLocality(coords?: { lat: number; lng: number } | null): BogotaLocality | null {
  if (!coords || !Number.isFinite(coords.lat) || !Number.isFinite(coords.lng) || Math.abs(coords.lat) > 90 || Math.abs(coords.lng) > 180) return null;
  const x = coords.lng, y = coords.lat;
  let found: BogotaLocality | null = null;
  for (const locality of indexedLocalities) {
    let contains = false;
    for (const { rings, bounds } of locality.polygons) {
      if (x < bounds[0] - BOUNDARY_EPSILON || x > bounds[2] + BOUNDARY_EPSILON || y < bounds[1] - BOUNDARY_EPSILON || y > bounds[3] + BOUNDARY_EPSILON) continue;
      const shell = inRing(x, y, rings[0]);
      if (shell === -1) return null;
      if (shell === 0) continue;
      let inHole = false;
      for (const hole of rings.slice(1)) {
        const result = inRing(x, y, hole);
        if (result === -1) return null;
        if (result === 1) { inHole = true; break; }
      }
      if (!inHole) contains = true;
    }
    if (!contains) continue;
    if (found) return null;
    found = { code: locality.code, name: locality.name };
  }
  return found;
}
