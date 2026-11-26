/** Local identity authority for BOLT's callback contract. Its keys exist only in this process. */
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { exportJWK, generateKeyPair, SignJWT, type JWTPayload } from 'jose';

export type GoogleScenario = 'valid' | 'untrusted-signature' | 'wrong-issuer' | 'wrong-audience' |
  'expired' | 'missing-subject' | 'blank-subject' | 'missing-expiration' | 'email-unverified' |
  'email-verification-string' | 'missing-party' | 'invalid-party' | 'valid-party' |
  'invalid-single-party' | 'missing-token' | 'token-unavailable' | 'keys-unavailable' |
  'wrong-nonce' | 'missing-nonce' | 'wrong-algorithm';
type Profile = {email?: string; subject?: string; name?: string};

async function signingKey() {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const jwk = { ...await exportJWK(publicKey), kid: randomUUID(), alg: 'RS256', use: 'sig' };
  return { privateKey, jwk };
}

export async function createGoogleProviderFixture(config: {clientId: string; clientSecret: string}) {
  let key = await signingKey();
  const otherKey = await signingKey();
  const ecKey = await generateKeyPair('ES256');
  const stats = { exchanges: 0, keyRequests: 0 };
  let keysAvailable = true;
  const codes = new Map<string, { authorizeURL: URL; scenario: GoogleScenario; profile: Profile }>();

  function authorize(url: string | URL, scenario: GoogleScenario = 'valid', profile: Profile = {}) {
    const authorizeURL = new URL(url);
    assert.equal(authorizeURL.origin + authorizeURL.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
    const params = authorizeURL.searchParams;
    assert.equal(params.get('client_id'), config.clientId);
    assert.equal(params.get('code_challenge_method'), 'S256');
    assert.ok(params.get('code_challenge') && params.get('redirect_uri') && params.get('state'));
    const code = randomUUID();
    codes.set(code, { authorizeURL, scenario, profile });
    return { code, state: params.get('state')! };
  }

  async function exchange(form: URLSearchParams) {
    stats.exchanges++;
    const code = form.get('code') || '';
    const transaction = codes.get(code);
    codes.delete(code);
    if (!transaction) return Response.json({error:'invalid_grant'}, {status:400});
    const { authorizeURL, scenario, profile } = transaction;
    const request = authorizeURL.searchParams;
    const challenge = createHash('sha256').update(form.get('code_verifier') || '').digest('base64url');
    assert.equal(challenge, request.get('code_challenge'));
    assert.equal(form.get('redirect_uri'), request.get('redirect_uri'));
    assert.equal(form.get('grant_type'), 'authorization_code');
    assert.equal(form.get('client_id'), config.clientId);
    assert.ok(form.get('client_secret') === config.clientSecret, 'Missing fixture OAuth client authentication');
    if (scenario === 'token-unavailable') return Response.json({error:'temporarily_unavailable'}, {status:503});
    const now = Math.floor(Date.now()/1000);
    const claims: JWTPayload = {
      iss: 'https://accounts.google.com', aud: config.clientId, sub: profile.subject || 'fixture-google-subject',
      iat: now, exp: now + 600, email_verified: true,
      email: profile.email || 'google@example.invalid', name: profile.name || 'Nombre Google fixture',
    };
    if (request.has('nonce')) claims.nonce = request.get('nonce');
    switch (scenario) {
      case 'wrong-issuer': claims.iss = 'https://other.example.invalid'; break;
      case 'wrong-audience': claims.aud = 'other-fixture'; break;
      case 'expired': claims.exp = now - 120; break;
      case 'missing-subject': delete claims.sub; break;
      case 'blank-subject': claims.sub = ' '; break;
      case 'missing-expiration': delete claims.exp; break;
      case 'email-unverified': claims.email_verified = false; break;
      case 'email-verification-string': claims.email_verified = 'false'; break;
      case 'missing-party': claims.aud = [config.clientId,'other-fixture']; break;
      case 'invalid-party': claims.aud = [config.clientId,'other-fixture']; claims.azp = 'other-fixture'; break;
      case 'valid-party': claims.aud = [config.clientId,'other-fixture']; claims.azp = config.clientId; break;
      case 'invalid-single-party': claims.azp = 'other-fixture'; break;
      case 'wrong-nonce': claims.nonce = randomUUID(); break;
      case 'missing-nonce': delete claims.nonce; break;
    }
    const algorithm = scenario === 'wrong-algorithm' ? 'ES256' : 'RS256';
    const signing = scenario === 'wrong-algorithm' ? ecKey.privateKey :
      scenario === 'untrusted-signature' ? otherKey.privateKey : key.privateKey;
    const idToken = await new SignJWT(claims).setProtectedHeader({kid:key.jwk.kid,alg:algorithm}).sign(signing);
    return Response.json({ token_type: 'Bearer', access_token: randomUUID(), expires_in:3600,
      ...(scenario !== 'missing-token' && {id_token:idToken}), scope: 'email openid profile' });
  }

  return {
    authorize, stats,
    async rotateKeys() { key = await signingKey(); },
    setKeysAvailable(value: boolean) { keysAvailable = value; },
    async fetch(input: RequestInfo | URL, init?: RequestInit) {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.href === 'https://www.googleapis.com/oauth2/v3/certs') {
        stats.keyRequests++;
        if (!keysAvailable) return Response.json({ error:'temporarily_unavailable' }, {status:503});
        return Response.json({keys:[key.jwk]}, {headers:{'Cache-Control':'public, max-age=300'}});
      }
      if (url.href === 'https://oauth2.googleapis.com/token') {
        const raw = init?.body ?? (input instanceof Request ? await input.text() : '');
        return exchange(new URLSearchParams(String(raw)));
      }
      return undefined;
    },
  };
}
