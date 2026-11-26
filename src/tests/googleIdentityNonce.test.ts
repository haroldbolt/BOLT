import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { googleUserInfo } from '../customer/googleIdentity';

test('la identidad de Google usa el nonce de su transacción y la vigencia de sus claves públicas', async t => {
  const clientId = 'bolt-nonce-fixture';
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const jwk = { ...await exportJWK(publicKey), kid: randomUUID(), alg: 'RS256', use: 'sig' };
  const headers = new Headers({ 'Cache-Control': 'public, max-age=300' });
  const requests = t.mock.method(globalThis, 'fetch', async (url: string) => {
    assert.equal(url, 'https://www.googleapis.com/oauth2/v3/certs');
    return Response.json({ keys: [jwk] }, { headers });
  });
  const sign = (nonce?: string) => new SignJWT({ email: 'nonce@example.invalid', email_verified: true, nonce })
    .setProtectedHeader({ kid: jwk.kid, alg: 'RS256' })
    .setIssuer('https://accounts.google.com').setAudience(clientId).setSubject('fixture-customer')
    .setIssuedAt().setExpirationTime('10m').sign(privateKey);
  const expectedIdTokenNonce = randomUUID();
  const idToken = await sign(expectedIdTokenNonce);
  const unboundToken = await sign();
  const verify = googleUserInfo(clientId);
  assert.equal((await verify({ idToken, expectedIdTokenNonce }))?.data.sub, 'fixture-customer');
  assert.equal(await verify({ idToken, expectedIdTokenNonce: randomUUID() }), null);
  assert.equal(await verify({ idToken: unboundToken, expectedIdTokenNonce }), null);
  assert.equal(await verify({ idToken }), null);
  assert.equal((await verify({ idToken: unboundToken }))?.data.sub, 'fixture-customer');
  assert.equal(requests.mock.callCount(), 1);

  for (const policy of [{ cacheControl: 'no-store', age: '0' }, { cacheControl: 'max-age=300', age: '300' }]) {
    headers.set('Cache-Control', policy.cacheControl);
    headers.set('Age', policy.age);
    const freshVerifier = googleUserInfo(clientId);
    const before = requests.mock.callCount();
    for (let i = 0; i < 2; i++) assert.ok(await freshVerifier({ idToken, expectedIdTokenNonce }));
    assert.equal(requests.mock.callCount() - before, 2);
  }
});
