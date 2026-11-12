import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { getCameraCrop, ProductPhotoSearch } from '../components/customer/ProductPhotoSearch';
import { INITIAL_PRODUCTS } from '../data/seedData';
import { photoSearchAvailable, resolvePhotoMatches, searchCatalogPhoto } from '../lib/photoSearchClient';

const product = { ...INITIAL_PRODUCTS[0], id: 'test-photo-product', status: 'ACTIVE' };
const alternative = { ...product, id: 'test-photo-alternative' };
const archived = { ...product, id: 'test-photo-archived', status: 'INACTIVE' };
const products = [product, alternative, archived];
const matches = (ids: string[]) => ids.map(productId => ({ productId }));

const exact = resolvePhotoMatches({ matches: matches([product.id]), confident: true }, products);
assert.equal(exact.automatic, product);
assert.deepEqual(exact.candidates, [product]);

const ambiguous = resolvePhotoMatches({ matches: matches([alternative.id, product.id, alternative.id]), confident: false }, products);
assert.equal(ambiguous.automatic, undefined);
assert.deepEqual(ambiguous.candidates, [alternative, product]);
assert.equal(resolvePhotoMatches({ matches: matches([product.id, alternative.id]), confident: true }, products).automatic, undefined);

const stale = resolvePhotoMatches({ matches: matches([archived.id, product.id]), confident: true }, products);
assert.equal(stale.automatic, undefined);
assert.deepEqual(stale.candidates, [product]);
assert.deepEqual(resolvePhotoMatches({ matches: matches(['unknown']), confident: false }, products).candidates, []);

const markup = renderToStaticMarkup(<ProductPhotoSearch products={products} onClose={() => {}}
  onOpenProduct={() => {}} onSearchByText={() => {}} />);
assert.match(markup, /<dialog[^>]+aria-labelledby=/);
assert.match(markup, /Tomar foto/);
assert.match(markup, /capture="environment"/);
assert.match(markup, /Subir foto/);
assert.match(markup, /Buscar por nombre/);
assert.match(markup, /aria-label="Cerrar búsqueda por foto"/);

// The preview uses object-cover. The JPEG must use the same source pixels as
// the guide, including when the rear camera's aspect ratio differs.
const rect = (left: number, top: number, width: number, height: number) => ({ left, top, width, height });
const coordinates = (crop: ReturnType<typeof getCameraCrop>) => Object.values(crop).map(Math.round);
assert.deepEqual(coordinates(getCameraCrop(1920, 1080, rect(20, 40, 320, 400), rect(60, 90, 240, 300))),
  [636, 135, 648, 810]);
assert.deepEqual(coordinates(getCameraCrop(1080, 1920, rect(0, 0, 360, 360), rect(40, 60, 280, 240))),
  [120, 600, 840, 720]);

const originalFetch = globalThis.fetch;
const signal = new AbortController().signal;
try {
  globalThis.fetch = async (url, options) => {
    assert.equal(url, '/api/v1/catalog/photo-search/status');
    assert.equal(options?.signal, signal);
    return Response.json({ enabled: false });
  };
  assert.equal(await photoSearchAvailable(signal), false);

  const photo = new Blob([new Uint8Array([255, 216, 255])], { type: 'image/jpeg' });
  const answer = { matches: matches([product.id]), confident: true };
  globalThis.fetch = async (url, options) => {
    assert.equal(url, '/api/v1/catalog/photo-search');
    assert.equal(options?.method, 'POST');
    assert.equal(new Headers(options?.headers).get('Content-Type'), 'image/jpeg');
    assert.equal(options?.body, photo);
    assert.equal(options?.signal, signal);
    return Response.json(answer);
  };
  assert.deepEqual(await searchCatalogPhoto(photo, signal), answer);
  globalThis.fetch = async () => Response.json({ error: 'Espera un momento antes de volver a buscar.' }, { status: 429 });
  await assert.rejects(searchCatalogPhoto(photo, signal), /Espera un momento/);
  globalThis.fetch = async () => Response.json({ matches: [null], confident: true });
  await assert.rejects(searchCatalogPhoto(photo, signal), /No pudimos leer el resultado/);
} finally {
  globalThis.fetch = originalFetch;
}
console.log('PASS búsqueda por foto: cámara, galería, contrato HTTP, coincidencias válidas, ambiguas e inactivas y manejo de errores');
