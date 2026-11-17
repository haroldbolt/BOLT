import assert from 'node:assert/strict';
import { test } from 'node:test';
import { backendAuthorization, createBoltBackend, parseBoltApiOrigin } from '../lib/backendRequest';

const appOrigin = 'https://bolt-cliente.example';
const apiOrigin = 'https://bolt-backend.example';

test('el origen configurado solo acepta HTTPS y carece de rutas, credenciales y fragmentos', () => {
  assert.equal(parseBoltApiOrigin(apiOrigin), apiOrigin);
  assert.equal(parseBoltApiOrigin(apiOrigin + '/'), apiOrigin);
  assert.equal(parseBoltApiOrigin(undefined), undefined);
  for (const invalid of [
    'http://bolt-backend.example',
    '//bolt-backend.example',
    'https://user:pass@bolt-backend.example',
    'https://bolt-backend.example/api/v1',
    'https://bolt-backend.example/?x=1',
    'https://bolt-backend.example/#fragment',
    ' https://bolt-backend.example',
  ]) assert.throws(() => parseBoltApiOrigin(invalid), /origen HTTPS/);
});

test('la API separada admite solo rutas BOLT y no sigue redirecciones ni envía cookies', async () => {
  const backend = createBoltBackend(() => appOrigin, apiOrigin);
  const original = globalThis.fetch;
  const requests: Array<{ url: string; options?: RequestInit }> = [];
  try {
    globalThis.fetch = async (url, options) => {
      requests.push({ url: String(url), options });
      return new Response('{}');
    };
    assert.equal(backend.split(), true);
    const options: RequestInit = { credentials: 'include', headers: { Authorization: 'Bearer fixture' } };
    for (const invalid of [
      'https://elsewhere.example/api/v1/orders',
      '//elsewhere.example/api/v1/orders',
      'https://user@bolt-backend.example/api/v1/orders',
      '/api/v1/../customer/me',
      '/api/customer-auth/get-session',
      '/api/v1/orders#fragment',
    ]) assert.throws(() => backend.fetch(invalid, options), /Ruta de API/);

    const url = backend.url('/api/v1/catalog');
    url.searchParams.set('q', 'mango & coco');
    await backend.fetch(url);
    await backend.fetch('/api/v1/driver/profile', options);
    assert.deepEqual(requests, [
      { url: apiOrigin + '/api/v1/catalog?q=mango+%26+coco', options: { credentials: 'omit', redirect: 'error' } },
      { url: apiOrigin + '/api/v1/driver/profile', options: { ...options, credentials: 'omit', redirect: 'error' } },
    ]);
    assert.equal(backendAuthorization('/api/v1/admin/orders', 'fixture', apiOrigin).get('Authorization'), 'Bearer fixture');
    assert.equal(backendAuthorization(appOrigin + '/api/v1/admin/orders', 'fixture', apiOrigin).get('Authorization'), null);
  } finally {
    globalThis.fetch = original;
  }
});

test('el despliegue unido conserva la URL relativa y los assets locales', async () => {
  const backend = createBoltBackend(() => appOrigin);
  const original = globalThis.fetch;
  try {
    const options = { credentials: 'same-origin' as const };
    globalThis.fetch = async (path, args) => {
      assert.equal(path, '/api/v1/stores');
      assert.equal(args, options);
      return new Response('{}');
    };
    assert.equal(backend.split(), false);
    await backend.fetch('/api/v1/stores', options);
    assert.equal(backend.catalogImage('/uploads/catalog/producto.jpg'), '/uploads/catalog/producto.jpg');
  } finally {
    globalThis.fetch = original;
  }
  const splitBackend = createBoltBackend(() => appOrigin, apiOrigin);
  assert.equal(splitBackend.catalogImage('/uploads/catalog/producto.jpg'), apiOrigin + '/uploads/catalog/producto.jpg');
  assert.equal(splitBackend.catalogImage('/uploads/catalog/../../api/v1/stores'), undefined);
  assert.equal(splitBackend.catalogImage('/assets/catalog/producto.jpg'), '/assets/catalog/producto.jpg');
});
