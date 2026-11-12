import assert from 'node:assert/strict';
import { once } from 'node:events';
import { test } from 'node:test';
import express from 'express';
import sharp from 'sharp';
import { INITIAL_PRODUCTS } from '../data/seedData';
import {
  openAIProductPhotoRecognizer,
  parseProductPhotoEvidence,
  rankProductPhoto,
  type ProductPhotoEvidence,
} from '../lib/productPhotoSearch';
import { mountProductPhotoSearch } from '../lib/productPhotoSearchRoutes';
import type { Product } from '../types';

const evidence: ProductPhotoEvidence = {
  readable: true, brand: 'Ágility Gold', name: 'Adulto Razas Grandes 15 kg', species: 'Perro',
};
const exact: Product = {
  ...INITIAL_PRODUCTS[0], id: 'agility-adulto', name: 'Agility Gold - Adulto Raza Grande',
  brand: 'Agility Gold', category: 'Alimentos', species: 'Perro', requiresPrescription: false,
  pharmacySubcategory: undefined, status: 'ACTIVE',
};

const response = (data: unknown) => ({
  status: 'completed',
  output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(data) }] }],
});

test('matches only live catalog products with visible brand, name and species evidence', () => {
  const catalog: Product[] = [
    exact,
    { ...exact, id: 'minor', name: 'Agility Gold - Cachorro Raza Grande' },
    { ...exact, id: 'cats', species: 'Gato' },
    { ...exact, id: 'wrong-brand', brand: 'Otra marca' },
    { ...exact, id: 'inactive', status: 'INACTIVE' },
    { ...exact, id: 'medicine', category: 'Farmacia' },
    { ...exact, id: 'rx', requiresPrescription: true },
  ];
  assert.deepEqual(rankProductPhoto(evidence, catalog), { matches: [{ productId: exact.id }], confident: true });
  assert.deepEqual(rankProductPhoto({ ...evidence, brand: '' }, catalog), { matches: [], confident: false });
  assert.deepEqual(rankProductPhoto({ ...evidence, readable: false }, catalog), { matches: [], confident: false });
  assert.deepEqual(rankProductPhoto({ ...evidence, name: '15 kg' }, catalog), { matches: [], confident: false });
  assert.deepEqual(rankProductPhoto({ ...evidence, name: 'Adulto Raza Pequeña' }, catalog), { matches: [], confident: false });
});

test('returns ordered suggestions without claiming a match for partial or ambiguous evidence', () => {
  const catalog = [
    { ...exact, id: 'b', name: 'Agility Gold - Adulto Raza Grande Cordero' },
    exact,
    { ...exact, id: 'a', name: 'Agility Gold - Adulto Raza Grande Pollo' },
    { ...exact, id: 'c', name: 'Agility Gold - Adulto Raza Grande Salmón' },
  ];
  assert.deepEqual(rankProductPhoto(evidence, catalog), {
    matches: [{ productId: exact.id }, { productId: 'a' }, { productId: 'b' }], confident: false,
  });
  assert.deepEqual(rankProductPhoto(evidence, [catalog[0]]), { matches: [{ productId: 'b' }], confident: false });
});

test('can identify a prescription food without treating pharmacy items as catalog suggestions', () => {
  const diet: Product = {
    ...exact, id: 'derm', brand: 'Hills', name: "Hill's - Perro Adulto Derm Complete",
    category: 'Perros', requiresPrescription: true, tags: ['Alimento de prescripción'],
  };
  const pharmacy: Product = { ...diet, id: 'pharmacy', category: 'Farmacia' };
  const tickTreatment: Product = { ...diet, id: 'antipulgas', category: 'Antipulgas' };
  const observed = { ...evidence, brand: "Hill's", name: 'Derm Complete' };
  assert.deepEqual(rankProductPhoto(observed, [diet, pharmacy, tickTreatment]), {
    matches: [{ productId: 'derm' }], confident: false,
  });
});

test('validates Responses payloads and treats model refusals as abstention', () => {
  assert.deepEqual(parseProductPhotoEvidence(response(evidence)), evidence);
  assert.throws(() => parseProductPhotoEvidence(response({ ...evidence, species: 'Caballo' })));
  assert.throws(() => parseProductPhotoEvidence(response({ ...evidence, name: ['x'] })));
  assert.throws(() => parseProductPhotoEvidence({ ...response(evidence), status: 'incomplete' }));
  const refusal = { status: 'completed', output: [{ type: 'message', content: [{ type: 'refusal' }] }] };
  assert.equal(parseProductPhotoEvidence(refusal).readable, false);
});

test('sends a bounded request to the provider and disables response storage', async () => {
  const jpeg = Buffer.from('fixture');
  const signal = new AbortController().signal;
  const recognize = openAIProductPhotoRecognizer('test-key', 'fixture-model', async (url, init) => {
    assert.equal(url, 'https://api.openai.com/v1/responses');
    assert(init);
    assert.equal(init.signal, signal);
    assert.equal(init.redirect, 'error');
    assert.equal(new Headers(init.headers).get('Authorization'), 'Bearer test-key');
    const body = JSON.parse(String(init.body));
    assert.equal(body.model, 'fixture-model');
    assert.equal(body.store, false);
    assert.equal(body.max_output_tokens, 256);
    assert.equal(body.text.format.strict, true);
    assert.equal(body.input[0].content[0].image_url, `data:image/jpeg;base64,${jpeg.toString('base64')}`);
    return Response.json(response(evidence));
  });
  assert.deepEqual(await recognize(jpeg, signal), evidence);
});

async function serve(options: Parameters<typeof mountProductPhotoSearch>[1]) {
  const app = express();
  mountProductPhotoSearch(app, options);
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert(address && typeof address === 'object');
  const url = `http://127.0.0.1:${address.port}/api/v1/catalog/photo-search`;
  return { url, close: () => server.close() };
}

test('HTTP opt-in stays off when the feature flag or server key is missing', async () => {
  for (const env of [{ BOLT_PHOTO_SEARCH_ENABLED: 'true' }, { BOLT_PHOTO_SEARCH_OPENAI_API_KEY: 'fixture' }]) {
    const service = await serve({ catalog: () => [exact], env });
    try {
      assert.deepEqual(await (await fetch(`${service.url}/status`)).json(), { enabled: false });
      const result = await fetch(service.url, { method: 'POST' });
      assert.equal(result.status, 503);
      assert.equal(typeof (await result.json()).error, 'string');
    } finally {
      service.close();
    }
  }
});

test('HTTP accepts validated JPEG, uses live catalog and enforces quota without storing metadata', async () => {
  const image = await sharp({ create: { width: 1500, height: 2, channels: 3, background: 'white' } })
    .jpeg().withMetadata({ orientation: 1 }).toBuffer();
  let catalog = [exact];
  let calls = 0;
  const service = await serve({
    catalog: () => catalog,
    env: { BOLT_PHOTO_SEARCH_DAILY_LIMIT: '2', BOLT_PHOTO_SEARCH_REQUESTS_PER_MINUTE: '10' },
    recognizer: async jpeg => {
      calls++;
      const metadata = await sharp(jpeg).metadata();
      assert.equal(metadata.format, 'jpeg');
      assert.equal(metadata.width, 1280);
      assert.equal(metadata.exif, undefined);
      return evidence;
    },
  });
  const post = (body: Uint8Array, extra = {}) => fetch(service.url, {
    method: 'POST', headers: { 'Content-Type': 'image/jpeg', ...extra }, body: Uint8Array.from(body),
  });
  try {
    assert.deepEqual(await (await fetch(`${service.url}/status`)).json(), { enabled: true });
    assert.equal((await post(image, { Origin: 'https://cross-site.example' })).status, 403);
    assert.equal((await post(image, { 'Content-Type': 'image/png' })).status, 415);
    assert.equal((await post(new Uint8Array(1024 * 1024 + 1))).status, 413);
    assert.equal((await post(Buffer.from('not a jpeg'))).status, 400);
    assert.equal(calls, 0);

    const matched = await post(image);
    assert.equal(matched.headers.get('Cache-Control'), 'no-store');
    assert.deepEqual(await matched.json(), { matches: [{ productId: exact.id }], confident: true });
    catalog = [{ ...exact, status: 'INACTIVE' }];
    assert.deepEqual(await (await post(image)).json(), { matches: [], confident: false });
    assert.equal((await post(image)).status, 429);
    assert.equal(calls, 2);
  } finally {
    service.close();
  }
});

test('HTTP provider failure returns a generic error and per-IP limit blocks another call', async () => {
  const image = await sharp({ create: { width: 4, height: 4, channels: 3, background: 'white' } }).jpeg().toBuffer();
  const service = await serve({
    catalog: () => [exact],
    env: { BOLT_PHOTO_SEARCH_REQUESTS_PER_MINUTE: '1' },
    recognizer: async () => { throw new Error('private provider detail'); },
  });
  const post = () => fetch(service.url, {
    method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body: Uint8Array.from(image),
  });
  try {
    const unavailable = await post();
    assert.equal(unavailable.status, 503);
    assert.doesNotMatch(await unavailable.text(), /private provider detail/);
    const limited = await post();
    assert.equal(limited.status, 429);
    assert.equal(limited.headers.get('Retry-After'), '60');
  } finally {
    service.close();
  }
});
