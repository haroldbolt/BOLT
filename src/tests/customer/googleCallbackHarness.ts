/** Isolated server-side Google sign-in for the regression suite and the local review page. */
import assert from 'node:assert/strict';
import { once } from 'node:events';
import fs from 'node:fs';
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import express from 'express';
import { sql } from 'kysely';
import type { CustomerMail } from '../../customer/auth';
import { LEGAL_VERSION } from '../../customer/legal';
import { mountCustomerAccounts } from '../../customer/routes';
import { fixtureDatabase, fixtureConfig } from './fixture';
import { createGoogleProviderFixture, type GoogleScenario } from './googleProviderFixture';

export async function createGoogleCallbackHarness() {
  const google = { clientId: 'bolt-review-google', clientSecret: randomUUID() };
  const provider = await createGoogleProviderFixture(google);
  const db = fixtureDatabase();
  for (const file of ['001-auth.sql','001-data.sql','002-user-scope.sql'])
    await sql.raw(fs.readFileSync('scripts/customer/'+file,'utf8')).execute(db);
  const app = express();
  const server = app.listen(0, '127.0.0.1');
  const originalFetch = globalThis.fetch;
  async function close() {
    globalThis.fetch = originalFetch;
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    await db.destroy();
  }
  try {
    await once(server, 'listening');
    const origin = 'http://127.0.0.1:' + (server.address() as AddressInfo).port;
    const sentMail: URL[] = [];
    await mountCustomerAccounts(app, { list: () => [], authorizeGuest: () => false, present: order => order }, {
      db, config: { ...fixtureConfig(origin), google }, sendMail: async (message: CustomerMail) => { sentMail.push(new URL(message.url)); },
    });
    globalThis.fetch = async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.origin === origin) return originalFetch(input, init);
      const local = await provider.fetch(input, init);
      if (!local) throw Error('El ensayo sólo admite su servidor local y la autoridad ficticia.');
      return local;
    };
    const consent = {version:LEGAL_VERSION,terms:true,privacy:true,marketing:false};
    const cookies = new Map<string,string>();
    async function call(route: string, body?: Record<string,unknown>) {
      const response = await fetch(origin+route, { method: body ? 'POST':'GET', redirect:'manual',
        headers: {Origin:origin, Cookie:[...cookies.values()].join('; '), ...(body && {'Content-Type':'application/json'})},
        body: body && JSON.stringify(body), signal:AbortSignal.timeout(10000),
      });
      for (const raw of response.headers.getSetCookie()) {
        const pair = raw.split(';')[0]; cookies.set(pair.split('=')[0], pair);
      }
      return {response, data:await response.json().catch(()=>null)};
    }
    async function run(scenario: GoogleScenario) {
      // Each scenario represents its own review run in this process-local test database.
      await db.deleteFrom('customer_rate_limit').execute();
      if (scenario === 'keys-unavailable') provider.setKeysAvailable(false);
      const started = await call('/api/customer-auth/sign-in/social', {
        provider:'google', requestSignUp:true, callbackURL:'/cuenta',
        errorCallbackURL:'/cuenta?proveedor=google', disableRedirect:true,
        additionalData:{legalConsent:consent},
      });
      assert.equal(started.response.status,200);
      const {code,state} = provider.authorize(started.data.url,scenario);
      const query = new URLSearchParams({code,state});
      const {response} = await call('/api/customer-auth/callback/google?'+query);
      assert.equal(response.status,302);
      const destination = new URL(response.headers.get('location')!,origin);
      assert.equal(destination.origin,origin);
      const me = await call('/api/customer/me');
      assert.equal(me.response.status,200);
      const [counts] = (await sql<{cuentas:number;vinculos:number;sesiones:number}>`
        select (select count(*)::int from customer_user) as cuentas,
               (select count(*)::int from customer_account) as vinculos,
               (select count(*)::int from customer_session) as sesiones`.execute(db)).rows;
      return {...counts, sesionActiva: !!me.data.user,
        retornoAutorizado: destination.pathname === '/cuenta' && !destination.search};
    }
    async function provisionBrowserEmail() {
      const email = 'review-email@example.invalid', password = randomUUID();
      assert.ok((await call('/api/customer-auth/sign-up/email', {name:'Cliente de revisión',email,password,legalConsent:consent,callbackURL:'/cuenta'})).response.ok);
      const verification = sentMail.at(-1);
      assert.equal(verification?.origin, origin);
      assert.equal((await call(verification.pathname+verification.search)).response.status,302);
      return {email, password};
    }
    async function verifyEmailFallback() {
      const {email,password} = await provisionBrowserEmail();
      assert.ok((await call('/api/customer-auth/sign-in/email',{email,password})).response.ok);
      const original = (await call('/api/customer/me')).data.user;
      assert.equal(original.email,email);
      const registered = () => db.selectFrom('customer_account').select(['id','providerId'])
        .where('userId','=',original.id).orderBy('id').execute();
      const links = await registered();
      assert.deepEqual(links.map(row=>row.providerId),['credential']);
      const sessions = () => db.selectFrom('customer_session').select('id')
        .where('userId','=',original.id).orderBy('id').execute();
      const before = await sessions();
      assert.equal(before.length,1);
      const keyReads = provider.stats.keyRequests;
      const nativeLink = await call('/api/customer-auth/link-social', {
        provider:'google', idToken:{token:'fixture-native-input'},
      });
      assert.equal(nativeLink.response.status,404);
      assert.equal(nativeLink.data.code,'ID_TOKEN_NOT_SUPPORTED');
      assert.equal(provider.stats.keyRequests,keyReads);
      assert.deepEqual(await registered(),links);
      assert.deepEqual(await sessions(),before);
      provider.setKeysAvailable(true);
      const start = await call('/api/customer-auth/link-social',{
        provider:'google',callbackURL:'/cuenta',errorCallbackURL:'/cuenta?proveedor=google',disableRedirect:true,
      });
      assert.equal(start.response.status,200);
      const authorization = provider.authorize(start.data.url,'untrusted-signature',{email,subject:'email-link-fixture'});
      const link = await call('/api/customer-auth/callback/google?' + new URLSearchParams(authorization));
      assert.equal(link.response.status,302);
      assert.ok(new URL(link.response.headers.get('location')!,origin).searchParams.has('error'));
      assert.equal((await call('/api/customer/me')).data.user.id,original.id);
      assert.deepEqual(await registered(),links);
      assert.deepEqual(await sessions(),before);
    }
    async function signOut() {
      assert.ok((await call('/api/customer-auth/sign-out',{})).response.ok);
      assert.equal((await call('/api/customer/me')).data.user,null);
    }
    return { origin, provider, run, signOut, provisionBrowserEmail, verifyEmailFallback, close };
  } catch (error) { await close(); throw error; }
}
