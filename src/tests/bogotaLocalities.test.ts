import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolveBogotaLocality, BOGOTA_LOCALITY_NAMES, type BogotaLocalityCode } from '../lib/bogotaLocalities';

let passed = 0;
function check(value: unknown, label: string) { assert.ok(value, label); passed++; }

// Public geographic fixtures inside the original SDP polygons (lat, lng).
const interiors: Record<BogotaLocalityCode, readonly [number, number]> = {
  USAQUEN: [4.744, -74.026], CHAPINERO: [4.651, -74.058], SANTA_FE: [4.604, -74.066],
  SAN_CRISTOBAL: [4.558, -74.075], USME: [4.488, -74.119], TUNJUELITO: [4.574, -74.135],
  BOSA: [4.611, -74.198], KENNEDY: [4.631, -74.151], FONTIBON: [4.682, -74.145],
  ENGATIVA: [4.7026, -74.1149], SUBA: [4.747, -74.098], BARRIOS_UNIDOS: [4.671, -74.07],
  TEUSAQUILLO: [4.64, -74.088], LOS_MARTIRES: [4.604, -74.09], ANTONIO_NARINO: [4.588, -74.099],
  PUENTE_ARANDA: [4.615, -74.114], LA_CANDELARIA: [4.596, -74.072],
  RAFAEL_URIBE_URIBE: [4.566, -74.113], CIUDAD_BOLIVAR: [4.54, -74.16], SUMAPAZ: [4.265, -74.2],
};

const originalFetch = globalThis.fetch;
globalThis.fetch = async () => { throw new Error('La clasificación offline no puede consultar servicios externos'); };
try {
  for (const [code, [lat, lng]] of Object.entries(interiors)) {
    const actual = resolveBogotaLocality({ lat, lng });
    check(actual?.code === code && actual.name === BOGOTA_LOCALITY_NAMES[code], `Punto interior real identificado: ${code}`);
  }
  const hubs = [
    { lat: 4.6320297, lng: -74.1516306, code: 'KENNEDY' },
    { lat: 4.7026365, lng: -74.1149105, code: 'ENGATIVA' },
    { lat: 4.747154, lng: -74.098137, code: 'SUBA' },
  ];
  for (const hub of hubs) check(resolveBogotaLocality(hub)?.code === hub.code, `Entrada de bodega en su localidad: ${hub.code}`);

  for (const coords of [undefined, null, {}, { lat: 4.6 }, { lng: -74.1 },
    { lat: NaN, lng: -74.1 }, { lat: 4.6, lng: NaN }, { lat: Infinity, lng: -74.1 },
    { lat: 4.6, lng: -Infinity }, { lat: 91, lng: -74.1 }, { lat: 4.6, lng: 181 },
    { lat: '4.6', lng: -74.1 }, { lat: 4.6, lng: '-74.1' }]) {
    check(resolveBogotaLocality(coords as any) === null, 'Entrada inválida no obtiene localidad por defecto');
  }
  for (const coords of [{ lat: 0, lng: 0 }, { lat: -74.1, lng: 4.6 },
    { lat: 6.24, lng: -75.58 }, { lat: 4.8097, lng: -74.1027 }, { lat: 4.578, lng: -74.216 }]) {
    check(resolveBogotaLocality(coords) === null, 'Fuera del Distrito Capital no se inventa una localidad');
  }

  // Labels supplied by a client cannot change the locality: a barrio or street
  // called Sumapaz inside Ciudad Bolívar remains Ciudad Bolívar, and vice versa.
  check(resolveBogotaLocality({ lat: 4.54, lng: -74.16, address: 'Barrio Sumapaz, Kennedy' } as any)?.code === 'CIUDAD_BOLIVAR', 'Un nombre de barrio no sustituye la clasificación geográfica');
  check(resolveBogotaLocality({ lat: 4.265, lng: -74.2, address: 'Kennedy, Bogotá' } as any)?.code === 'SUMAPAZ', 'Un texto falso no oculta una coordenada de Sumapaz');

  const dataPath = new URL('../data/geography/bogota-localities.json', import.meta.url);
  const raw = readFileSync(dataPath);
  const data = JSON.parse(raw.toString());
  check(data.type === 'FeatureCollection' && data.features.length === 20 && new Set(data.features.map((feature: any) => feature.properties.LOCCODIGO)).size === 20, 'Copia oficial contiene las 20 localidades únicas');
  check(createHash('sha256').update(raw).digest('hex') === '86de5ec6069dbb4356775b2612d33513791b090f1c076e11033f474d2af4220f', 'Hash de la copia oficial normalizada coincide con la atribución');
  const allPositions: number[][] = [];
  for (const feature of data.features) {
    const polygons = feature.geometry.type === 'Polygon' ? [feature.geometry.coordinates] : feature.geometry.coordinates;
    for (const polygon of polygons) {
      for (const ring of polygon) allPositions.push(...ring);
      const [lng, lat] = polygon[0][0];
      check(resolveBogotaLocality({ lat, lng }) === null, `Límite de ${feature.properties.LOCNOMBRE} requiere aclaración`);
    }
  }
  check(allPositions.every(([lng, lat]) => Number.isFinite(lat) && Number.isFinite(lng) && lat >= 3.73 && lat <= 4.84 && lng >= -74.46 && lng <= -73.98), 'Proyección EPSG4326 y orden longitud/latitud consistentes con la extensión oficial');
  const santaFe = data.features.find((feature: any) => feature.properties.LOCCODIGO === '03');
  check(santaFe.geometry.coordinates.length > 1, 'Santa Fe conserva su anillo interior oficial');
  check(resolveBogotaLocality({ lat: 4.596, lng: -74.072 })?.code === 'LA_CANDELARIA', 'El anillo interior evita confundir La Candelaria con Santa Fe');
  const [holeLng, holeLat] = santaFe.geometry.coordinates[1][0];
  check(resolveBogotaLocality({ lat: holeLat, lng: holeLng }) === null, 'El límite del anillo interior también requiere aclaración');
  const next = santaFe.geometry.coordinates[1][1];
  check(resolveBogotaLocality({ lat: (holeLat + next[1]) / 2, lng: (holeLng + next[0]) / 2 }) === null, 'El segmento entre vértices de una frontera compartida es ambiguo');
} finally { globalThis.fetch = originalFetch; }

console.log(`GEOGRAFÍA OFICIAL: ${passed} comprobaciones aprobadas.`);
