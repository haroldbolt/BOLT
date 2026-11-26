import { resumeVerifiedDeletion } from "../customer/deletion";
/** Protocol tests with signed fixture identities. No Google/Apple credentials or network calls. */
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import {createDemoGateway} from "../../deployment/demo-gateway.mjs";
import {acceptsDemoOrigin} from "../lib/demoOrigin";
import express from "express";
import { sql } from "kysely";
import { generateKeyPair, exportJWK, SignJWT } from "jose";
import { createGoogleProviderFixture } from "./customer/googleProviderFixture";
import { fixtureConfig, fixtureDatabase } from "./customer/fixture";
import { mountCustomerAccounts } from "../customer/routes";
import { LEGAL_VERSION } from "../customer/legal";
const db = fixtureDatabase();
for (const file of ["001-auth.sql", "001-data.sql", "002-user-scope.sql"])
  await sql
    .raw(fs.readFileSync(`scripts/customer/${file}`, "utf8"))
    .execute(db);
const app = express(),
  server = app.listen(0, "127.0.0.1");
await new Promise<void>((r) => server.once("listening", r));
const hosted = process.argv.includes('--gateway');
const backendPort = (server.address() as any).port;
const origin = hosted ? 'https://demo.example' : `http://127.0.0.1:${backendPort}`;
let gateway: ReturnType<typeof createDemoGateway> | undefined;
let gatewayPort = 0;
const gatePassword = 'ISOLATED-DEMO-PASSWORD-ONLY';
if (hosted) {
  app.use((req,res,next)=>acceptsDemoOrigin({host:req.get('Host'),origin:req.get('Origin'),path:req.path,method:req.method,remoteAddress:req.socket.remoteAddress},backendPort,{BOLT_DEMO_CUSTOMER_ACCOUNTS:'1',BOLT_CUSTOMER_ORIGIN:origin,BOLT_APPLE_SERVICE_ID:'fixture',BOLT_APPLE_CLIENT_SECRET:'fixture'}) ? next() : res.sendStatus(403));
  gateway = createDemoGateway({origin, password:gatePassword, sessionKey:'ISOLATED-KEY'.repeat(6), upstreamPort:backendPort,customerAuth:{enabled:true,google:true,apple:true}});
  gateway.listen(0,'127.0.0.1');await new Promise<void>(r=>gateway!.once('listening',r));gatewayPort=(gateway.address() as any).port;
}
function throughGateway(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const u=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url);
  return new Promise((resolve,reject)=>{
    const headers=Object.fromEntries(new Headers(init?.headers));
    const req=http.request({hostname:'127.0.0.1',port:gatewayPort,path:u.pathname+u.search,method:init?.method||'GET',headers:{...headers,Host:'demo.example'}},res=>{
      const chunks:Buffer[]=[];res.on('data',b=>chunks.push(b));res.on('end',()=>{const h=new Headers();for(const [k,v]of Object.entries(res.headers))for(const x of Array.isArray(v)?v:[v])if(x!==undefined)h.append(k,x);resolve(new Response(res.statusCode===204?null:Buffer.concat(chunks),{status:res.statusCode,headers:h}));});
    });req.on('error',reject);req.end(init?.body?.toString());
  });
}
const config = {
  ...fixtureConfig(origin),
  google: { clientId: "ISOLATED-GOOGLE", clientSecret: "ISOLATED-SECRET" },
  apple: { clientId: "ISOLATED-APPLE", clientSecret: "ISOLATED-SECRET" },
};
const localGoogle = await createGoogleProviderFixture(config.google);
const { instance } = await mountCustomerAccounts(
  app,
  { list: () => [], authorizeGuest: () => false, present: (o) => o },
  { config, db, sendMail: async () => {} },
);
const { publicKey, privateKey } = await generateKeyPair("RS256");
const jwk = {
  ...(await exportJWK(publicKey)),
  kid: "fixture-key",
  alg: "RS256",
  use: "sig",
};
const realFetch = globalThis.fetch;
let email = "google-fixture@example.invalid",
  subject = "GOOGLE-FIXTURE",
  provider: "google" | "apple" = "google",
  revocation = "ok";
globalThis.fetch = async (input, init) => {
  const url = new URL(
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.href
        : input.url,
  );
  if (url.origin === origin) return hosted ? throughGateway(input, init) : realFetch(input, init);
  const googleResponse = await localGoogle.fetch(input, init);
  if (googleResponse) return googleResponse;
  if (url.href === "https://appleid.apple.com/auth/keys")
    return Response.json({ keys: [jwk] });
  if (url.href === "https://appleid.apple.com/auth/token") {
    const idToken = await new SignJWT({
      email,
      email_verified: true,
    })
      .setProtectedHeader({ alg: "RS256", kid: "fixture-key" })
      .setIssuer("https://appleid.apple.com")
      .setAudience(config.apple.clientId)
      .setSubject(subject)
      .setIssuedAt()
      .setExpirationTime("10m")
      .sign(privateKey);
    return Response.json({
      access_token: "ISOLATED-ACCESS",
      refresh_token: "ISOLATED-REFRESH",
      id_token: idToken,
      token_type: "Bearer",
      expires_in: 3600,
      scope: "openid email profile",
    });
  }
  if (url.href === "https://appleid.apple.com/auth/revoke")
    return new Response(null, { status: revocation === "ok" ? 200 : 503 });
  throw Error("Unexpected external request in isolated OAuth test");
};
const jar = new Map<string, string>();
const cookieAttributes = new Map<string,string>();
async function request(
  route: string,
  body?: any,
  method = body === undefined ? "GET" : "POST",
  form = false,
) {
  const response = await fetch(origin + route, {
    method,
    redirect: "manual",
    headers: {
      Origin: form ? "https://appleid.apple.com" : origin,
      Cookie: [...jar].filter(([k])=>!hosted || !form || /SameSite=None/i.test(cookieAttributes.get(k)||'')).map(([k, v]) => `${k}=${v}`).join("; "),
      ...(body === undefined
        ? {}
        : {
            "Content-Type": form
              ? "application/x-www-form-urlencoded"
              : "application/json",
          }),
    },
    ...(body === undefined
      ? {}
      : { body: form ? new URLSearchParams(body) : JSON.stringify(body) }),
  });
  for (const cookie of response.headers.getSetCookie()) {
    const p = cookie.split(";")[0],
      i = p.indexOf("=");
    jar.set(p.slice(0, i), p.slice(i + 1));
    cookieAttributes.set(p.slice(0,i),cookie);
  }
  return {
    status: response.status,
    headers: response.headers,
    data: await response.json().catch(() => null),
  };
}
const consent = {
  version: LEGAL_VERSION,
  terms: true,
  privacy: true,
  marketing: false,
};
async function begin(register = true, legal: any = consent) {
  await db.deleteFrom("customer_rate_limit").execute();
  return request("/api/customer-auth/sign-in/social", {
    provider,
    requestSignUp: register,
    callbackURL: "/cuenta",
    errorCallbackURL: "/cuenta?error=oauth",
    disableRedirect: true,
    ...(legal ? { additionalData: { legalConsent: legal } } : {}),
  });
}
async function identityTotals() {
  const snapshot = await sql<{users:number,accounts:number,sessions:number}>`
    select (select count(*)::int from customer_user) as users,
           (select count(*)::int from customer_account) as accounts,
           (select count(*)::int from customer_session) as sessions`.execute(db);
  return snapshot.rows[0];
}

try {
  if (hosted) {
    const login=await throughGateway(origin+'/__demo/login',{method:'POST',headers:{Origin:origin},body:new URLSearchParams({password:gatePassword})});
    for(const cookie of login.headers.getSetCookie()){const pair=cookie.split(';')[0],i=pair.indexOf('=');jar.set(pair.slice(0,i),pair.slice(i+1));cookieAttributes.set(pair.slice(0,i),cookie);}
    assert.equal(login.status,303);
  }
  assert.equal((await begin(true, null)).status, 400);
  const nativeInput = { provider:"google", idToken:{ token:"fixture-browser-input" } };
  assert.equal((await request('/api/customer-auth/sign-in/social', nativeInput)).status,400);
  assert.deepEqual(await identityTotals(),{users:0,accounts:0,sessions:0});
  assert.equal(localGoogle.stats.exchanges,0);
  console.log(
    "PASS OAuth registration requires server-validated legal consent",
  );
  let start = await begin();
  assert.equal(start.status, 200, start.data?.message);
  let authorize = new URL(start.data.url);
  assert.equal(authorize.searchParams.get("code_challenge_method"), "S256");
  assert.ok(authorize.searchParams.get("state"));
  const {state, code} = localGoogle.authorize(authorize, "valid", {email, subject});
  let callback = await request(
    `/api/customer-auth/callback/google?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`,
  );
  assert.equal(callback.status, 302);
  assert.equal(callback.headers.get("location"), "/cuenta");
  assert.equal(localGoogle.stats.keyRequests, 1);
  let me = (await request("/api/customer/me")).data;
  assert.equal(me.user.name, "Nombre Google fixture");
  const googleUser = me.user.id;
  const googleProfile = await db.selectFrom('customer_user').select('legalReceipt').where('id','=',googleUser).executeTakeFirstOrThrow();
  assert.equal(JSON.parse(googleProfile.legalReceipt).version,LEGAL_VERSION);
  assert.equal(JSON.parse(googleProfile.legalReceipt).marketing,false);
  const googleIdentity = await db.selectFrom('customer_account').select(['providerId','accountId']).where('userId','=',googleUser).executeTakeFirstOrThrow();
  assert.deepEqual(googleIdentity,{providerId:'google', accountId:subject});
  console.log(
    "PASS Google authorization code, PKCE, signed ID token and real DB session (fixture provider)",
  );
  await request("/api/customer-auth/sign-out", {});
  const before = localGoogle.stats.exchanges;
  await request(
    `/api/customer-auth/callback/google?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`,
  );
  assert.equal(localGoogle.stats.exchanges, before);
  assert.equal((await request("/api/customer/me")).data.user, null);
  console.log("PASS consumed state cannot be replayed");
  start = await begin(false);
  authorize = new URL(start.data.url);
  const nextGoogle = localGoogle.authorize(authorize, "valid", {email, subject});
  await request(
    `/api/customer-auth/callback/google?code=${nextGoogle.code}&state=${encodeURIComponent(authorize.searchParams.get("state")!)}`,
  );
  assert.equal((await request("/api/customer/me")).data.user.id, googleUser);
  await request("/api/customer-auth/sign-out", {});
  console.log(
    "PASS existing Google identity logs in without creating another account",
  );
  start = await begin();
  assert.equal(start.status, 200);
  const rejected = localGoogle.authorize(start.data.url, "wrong-audience", {email, subject});
  callback = await request('/api/customer-auth/callback/google?' + new URLSearchParams(rejected));
  assert.equal(callback.status, 302);
  assert.ok(callback.headers.get('location')?.includes('error='));
  assert.equal((await request('/api/customer/me')).data.user,null);
  assert.deepEqual(await identityTotals(),{users:1,accounts:1,sessions:0});
  console.log("PASS wrong audience refused before creating a session for an existing customer");
  provider = "apple";
  subject = "APPLE-SAME-EMAIL";
  start = await begin();
  assert.equal(start.status, 200, start.data?.code);
  authorize = new URL(start.data.url);
  callback = await request(
    `/api/customer-auth/callback/apple?code=fixture-apple&state=${encodeURIComponent(authorize.searchParams.get("state")!)}`,
  );
  assert.ok(callback.headers.get("location")?.includes("account_not_linked"));
  assert.equal((await request("/api/customer/me")).data.user, null);
  assert.equal(
    (await db.selectFrom("customer_user").select("id").execute()).length,
    1,
  );
  console.log(
    "PASS same verified email from another provider does not merge identities",
  );
  email = "relay-fixture@privaterelay.appleid.com";
  subject = "APPLE-FIXTURE";
  start = await begin();
  assert.equal(start.status, 200, start.data?.code);
  authorize = new URL(start.data.url);
  assert.equal(authorize.searchParams.get("response_mode"), "form_post");
  const posted = await request(
    "/api/customer-auth/callback/apple",
    {
      code: "fixture-apple-new",
      state: authorize.searchParams.get("state"),
      user: JSON.stringify({
        name: { firstName: "Nombre", lastName: "Apple" },
      }),
    },
    "POST",
    true,
  );
  assert.equal(posted.status, 302);
  const next = new URL(posted.headers.get("location")!, origin);
  callback = await request(next.pathname + next.search);
  assert.equal(callback.headers.get("location"), "/cuenta");
  me = (await request("/api/customer/me")).data;
  assert.equal(me.user.email, email);
  assert.equal(me.user.name, "Nombre Apple");
  const appleUser = me.user.id;
  console.log(
    "PASS Apple form_post, private relay email and first-authorization name retained",
  );
  await request("/api/customer-auth/sign-out", {});
  start = await begin(false);
  authorize = new URL(start.data.url);
  await request(
    `/api/customer-auth/callback/apple?code=fixture-apple-again&state=${encodeURIComponent(authorize.searchParams.get("state")!)}`,
  );
  assert.equal(
    (await request("/api/customer/me")).data.user.name,
    "Nombre Apple",
  );
  console.log("PASS later Apple login without name does not erase first name");
  const stored = await db
    .selectFrom("customer_account")
    .selectAll()
    .where("userId", "=", appleUser)
    .executeTakeFirstOrThrow();
  assert.notEqual(stored.refreshToken, "ISOLATED-REFRESH");
  assert.ok(stored.refreshToken);
  console.log("PASS provider tokens encrypted at rest");
  revocation = "fail";
  await assert.rejects(() => instance!.beforeDelete({ id: appleUser }));
  assert.equal((await request("/api/customer/me")).data.user, null);
  assert.equal(
    (
      await db
        .selectFrom("customer_deletions")
        .select("status")
        .where("user_id", "=", appleUser)
        .executeTakeFirstOrThrow()
    ).status,
    "PENDING_PROVIDER",
  );
  await request("/api/customer-auth/sign-out", {});
  start = await begin(false);
  authorize = new URL(start.data.url);
  await request(
    `/api/customer-auth/callback/apple?code=fixture-retry&state=${encodeURIComponent(authorize.searchParams.get("state")!)}`,
  );
  assert.equal((await request("/api/customer/me")).data.user, null);
  console.log(
    "PASS failed Apple revocation remains pending and blocks new sessions",
  );
  revocation = "ok";
  await resumeVerifiedDeletion(instance!, db, appleUser);
  await resumeVerifiedDeletion(instance!, db, appleUser);
  assert.equal(
    (
      await db
        .selectFrom("customer_deletions")
        .select("status")
        .where("user_id", "=", appleUser)
        .executeTakeFirstOrThrow()
    ).status,
    "COMPLETED",
  );
  console.log("PASS pending Apple deletion can resume without recreating user");
  console.log(
    "Google and Apple callback contracts passed with isolated signed fixtures.",
  );
} finally {
  globalThis.fetch = realFetch;
  if(gateway){gateway.closeAllConnections();await new Promise<void>(r=>gateway!.close(()=>r()));}
  server.closeAllConnections();
  await new Promise<void>((r) => server.close(() => r()));
  await db.destroy();
}
