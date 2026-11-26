/** Exercises BOLT's ordinary OAuth callback with local provider responses and isolated storage. */
import assert from 'node:assert/strict';
import { mock } from 'node:test';
import { createGoogleCallbackHarness } from './customer/googleCallbackHarness';
import type { GoogleScenario } from './customer/googleProviderFixture';

const refused = {cuentas:0,vinculos:0,sesiones:0,sesionActiva:false,retornoAutorizado:false};
const accepted = {cuentas:1,vinculos:1,sesiones:1,sesionActiva:true,retornoAutorizado:true};
const app = await createGoogleCallbackHarness();
try {
  const cases: GoogleScenario[] = [
    'keys-unavailable','token-unavailable','missing-token','untrusted-signature','wrong-algorithm',
    'wrong-issuer','wrong-audience','expired','missing-expiration','missing-subject','blank-subject',
    'email-unverified','email-verification-string','missing-party','invalid-party','invalid-single-party','wrong-nonce',
  ];
  for (const scenario of cases) {
    const result = await app.run(scenario);
    assert.deepEqual(result,refused,scenario);
    if (scenario === 'keys-unavailable') {
      assert.equal(app.provider.stats.keyRequests,1);
      app.provider.setKeysAvailable(true);
    }
    console.log('PASS refused callback before account, link or session:',scenario);
  }
  assert.deepEqual(await app.run('valid'),accepted);
  await app.signOut();
  assert.deepEqual(await app.run('untrusted-signature'),{...refused,cuentas:1,vinculos:1},'existing Google customer gets no new session after failed verification');
  assert.deepEqual(await app.run('valid'),accepted);
  const verifiedRequests = app.provider.stats.keyRequests;
  await app.signOut();
  assert.deepEqual(await app.run('valid-party'),accepted);
  assert.equal(app.provider.stats.keyRequests,verifiedRequests,'reuse fresh trusted keys');
  await app.signOut();

  await app.provider.rotateKeys();
  mock.timers.enable({apis:['Date'],now:Date.now()});
  try {
    mock.timers.setTime(Date.now()+31000);
    assert.deepEqual(await app.run('valid'),accepted);
    assert.equal(app.provider.stats.keyRequests,verifiedRequests+1,'load rotated keys');
    await app.signOut();
    mock.timers.setTime(Date.now()+301000);
    app.provider.setKeysAvailable(false);
    assert.deepEqual(await app.run('valid'),{...refused,cuentas:1,vinculos:1},'fail closed when trusted keys expire');
    assert.equal(app.provider.stats.keyRequests,verifiedRequests+2,'try refreshing expired keys');
  } finally { mock.timers.reset(); }
  console.log('PASS verified subject, authorized multi-audience, cached keys, rotation and expired cache');
  await app.verifyEmailFallback();
  console.log('PASS verified email login during Google outage and rejected Google linking with original account/session intact');
} finally { await app.close(); }
