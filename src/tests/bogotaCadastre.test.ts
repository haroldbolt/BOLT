import assert from 'node:assert/strict';
import { test } from 'node:test';
import { findBogotaCadastreAddress } from '../lib/bogotaCadastre';

// Public primary-plate records, UAECD/IDECA, Datos Abiertos Bogotá (CC BY 4.0), 2026-11-24.
// https://datosabiertos.bogota.gov.co/dataset/placa-domiciliaria
const cade = {
  attributes: { PDOCODIGO: 'AAA0172TDWFPD01', PDONVIAL: 'AK 86', PDOTEXTO: '43 55 S', PDOTIPO: 1 },
  geometry: { x: -74.172594099, y: 4.627981784 },
};
const alcaldia = {
  attributes: { PDOCODIGO: 'AAA0043APAFPD01', PDONVIAL: 'TV 78K', PDOTEXTO: '41A 04 S', PDOTIPO: 1 },
  geometry: { x: -74.157444939, y: 4.619522184 },
};

const snapshot = (...features: unknown[]) => ({ spatialReference: { wkid: 4326 }, features });
const reply = (body: unknown, status = 200): typeof fetch => async () => Response.json(body, { status });
const street = 'Carrera 86 # 43-55 Sur';
const town = 'Bogotá D.C.';

test('lookup sends just a validated primary plate and offers its official coordinates for explicit selection', async () => {
  for (const [text, expected] of [
    [street, cade], ['Avenida-carrera 86 #43-55 Sur', cade],
    ['Transversal 78K No. 41 A - 04 Sur', alcaldia], ['Tv 78 K #41A Sur–4, Bogotá, Colombia', alcaldia],
  ] as const) {
    let calls = 0;
    const result = await findBogotaCadastreAddress(text, town, async (input, init) => {
      calls++;
      const url = new URL(String(input));
      assert.equal(url.origin + url.pathname, 'https://serviciosgis.catastrobogota.gov.co/arcgis/rest/services/catastro/placadomiciliaria/MapServer/0/query');
      assert.match(url.searchParams.get('where')!, /^PDOTIPO=1 AND PDONVIAL IN \('[A-Z0-9 ',]+'\) AND PDOTEXTO IN \('[A-Z0-9 ',]+'\)$/);
      assert.ok(url.searchParams.get('where')!.includes(expected.attributes.PDOTEXTO));
      assert.ok(url.searchParams.get('where')!.includes(expected.attributes.PDONVIAL));
      assert.equal(url.searchParams.get('outFields'), 'PDOCODIGO,PDONVIAL,PDOTEXTO,PDOTIPO');
      assert.equal(url.searchParams.get('resultRecordCount'), '2');
      assert.equal(url.searchParams.get('outSR'), '4326');
      assert.equal(init?.redirect, 'error');
      assert.equal(init?.credentials, 'omit');
      assert.ok(init?.signal);
      return Response.json(snapshot(expected));
    });
    assert.equal(calls, 1);
    assert.equal(result?.status, 'SELECT_ADDRESS');
    assert.equal(result.candidates.length, 1);
    const candidate = result.candidates[0];
    assert.equal(candidate.placeId, 'catastro-bogota:' + expected.attributes.PDOCODIGO);
    assert.equal(candidate.source, 'BOGOTA_CADASTRE');
    assert.match(result.message, /Catastro Bogotá/);
    assert.equal(candidate.locality, 'Kennedy');
    assert.deepEqual(candidate.coordinates, { lat: expected.geometry.y, lng: expected.geometry.x });
  }
});

test('unsupported inputs and municipalities never initiate a provider request', async () => {
  let calls = 0;
  const noRequest: typeof fetch = async () => { calls++; throw Error('unexpected remote request'); };
  for (const text of ['Carrera 86', 'Cra 86 #43', 'Carrera 86 #43-55 piso 4', street + ' apto 201', street + ' correo@test.invalid',
    street + ' / 4.628216,-74.173136', street + "' OR 1=1", street + ' URB', 'Tv 78K #41A Sur-04 Norte']) {
    assert.equal(await findBogotaCadastreAddress(text, town, noRequest), null);
  }
  for (const city of ['', 'Cota', 'Chía', 'Bogotá Norte', 'Soacha']) {
    assert.equal(await findBogotaCadastreAddress(street, city, noRequest), null);
  }
  assert.equal(calls, 0);
});

test('reuse requires one primary plate matching street, crossing, door number and cardinal inside Bogotá', async () => {
  const change = (attributes: Partial<typeof cade.attributes>) => ({ ...cade, attributes: { ...cade.attributes, ...attributes } });
  for (const body of [
    snapshot(), snapshot(cade, cade), { ...snapshot(cade), exceededTransferLimit: true }, { error: { code: 500 } },
    snapshot(change({ PDONVIAL: 'KR 85' })), snapshot(change({ PDOTEXTO: '43 55' })),
    snapshot(change({ PDOTEXTO: '43 55 E' })), snapshot(change({ PDOTEXTO: '43 56 S' })),
    snapshot(change({ PDOTEXTO: '43A 55 S' })), snapshot(change({ PDOTIPO: 2 })),
    snapshot(change({ PDOCODIGO: '' })), snapshot({ ...cade, geometry: { x: -74.101627, y: 4.809501 } }),
    { ...snapshot(cade), spatialReference: { wkid: 3857 } },
  ]) {
    assert.equal(await findBogotaCadastreAddress(street, town, reply(body)), null);
  }
  assert.equal(await findBogotaCadastreAddress('AK 86 #43-55', town, reply(snapshot(cade))), null);
  assert.equal(await findBogotaCadastreAddress(street, town, reply({}, 503)), null);
  assert.equal(await findBogotaCadastreAddress(street, town, async () => { throw Error('timeout'); }), null);
});
