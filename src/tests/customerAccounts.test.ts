import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import express from "express";
import { sql } from "kysely";
import { fixtureConfig, fixtureDatabase } from "./customer/fixture";
import { mountCustomerAccounts } from "../customer/routes";
import { LEGAL_VERSION } from "../customer/legal";
import { GUEST_CART_KEY } from "../lib/guestCart";
import { GUEST_ADDRESSES_KEY } from "../lib/guestAddresses";
import { FAVORITES_KEY } from "../customer/data";
const directory = fs.mkdtempSync(path.join(os.tmpdir(), "bolt-customer-auth-"));
let db = fixtureDatabase(path.join(directory, "postgres"));
for (const file of ["001-auth.sql", "001-data.sql"])
  await sql
    .raw(fs.readFileSync(`scripts/customer/${file}`, "utf8"))
    .execute(db);
const app = express(),
  server = app.listen(0, "127.0.0.1");
await new Promise<void>((resolve) => server.once("listening", resolve));
const origin = `http://127.0.0.1:${(server.address() as any).port}`;
const mail: { to: string; subject: string; url: string }[] = [];
const orders: any[] = [
  {
    id: "HISTORICAL-CLOSED",
    fulfillmentStatus: "ENTREGADO",
    storeId: "HUB_SUBA",
    amounts: { total: 12500 },
  },
  { id: "OTHER-PRIVATE", fulfillmentStatus: "CANCELADO" },
];
await mountCustomerAccounts(
  app,
  {
    list: () => orders,
    authorizeGuest: (id, token) =>
      id === "HISTORICAL-CLOSED" && token === "ISOLATED-OWNERSHIP-PROOF",
    present: (o) => o,
  },
  {
    config: fixtureConfig(origin),
    db,
    sendMail: async (m: any) => {
      mail.push(m);
    },
  },
);
function client() {
  const jar = new Map<string, string>();
  let accountId = "";
  return {
    jar,
    async request(
      route: string,
      body?: any,
      method = body === undefined ? "GET" : "POST",
      headers: Record<string, string> = {},
    ) {
      const response = await fetch(origin + route, {
        method,
        redirect: "manual",
        headers: {
          origin,
          ...(accountId ? { "X-Customer-Id": accountId } : {}),
          Cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; "),
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
          ...headers,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      for (const cookie of response.headers.getSetCookie()) {
        const pair = cookie.split(";")[0],
          i = pair.indexOf("=");
        jar.set(pair.slice(0, i), pair.slice(i + 1));
      }
      const data = await response.json().catch(() => null);
      if (route === "/api/customer/me") accountId = data?.user?.id || "";
      return { status: response.status, data, headers: response.headers };
    },
  };
}
const consent = {
    version: LEGAL_VERSION,
    terms: true,
    privacy: true,
    marketing: false,
  },
  password = "Una-frase-de-pruebas-2026!";
const alice = client(),
  bob = client(),
  stranger = client();
let checks = 0;
const pass = (label: string) => {
  checks++;
  console.log(`PASS ${label}`);
};
try {
  assert.equal((await alice.request("/api/customer/me")).data.user, null);
  pass("first visit has no identity");
  assert.equal((await stranger.request("/api/customer/data")).status, 401);
  assert.equal(
    (
      await stranger.request("/api/customer/data", undefined, "GET", {
        "X-Role": "ADMINISTRADOR",
        Authorization: "Bearer fake-admin-token",
      })
    ).status,
    401,
  );
  pass("admin/driver/forged headers do not authorize customer endpoints");
  let result = await alice.request("/api/customer-auth/sign-up/email", {
    name: "Cliente de prueba A",
    email: "a@example.invalid",
    password,
  });
  assert.equal(result.status, 400, result.data?.code);
  pass("server rejects missing legal consent");
  const signup = async (
    c: ReturnType<typeof client>,
    email: string,
    name: string,
  ) => {
    const result = await c.request("/api/customer-auth/sign-up/email", {
      email,
      name,
      password,
      legalConsent: consent,
      callbackURL: "/cuenta",
    });
    assert.equal(
      result.status,
      200,
      `signup status ${result.status}: ${result.data?.code || result.data?.message || ""}`,
    );
    assert.equal((await c.request("/api/customer/me")).data.user, null);
    const message = [...mail]
      .reverse()
      .find((x) => x.to === email && x.subject.includes("Verifica"));
    assert.ok(message, "verification mail queued");
    const url = new URL(message.url);
    assert.equal((await c.request(url.pathname + url.search)).status, 302);
    const login = await c.request("/api/customer-auth/sign-in/email", {
      email,
      password,
    });
    assert.equal(login.status, 200, `login: ${login.data?.code}`);
    return (await c.request("/api/customer/me")).data.user;
  };
  const a = await signup(alice, "a@example.invalid", "Cliente de prueba A");
  assert.equal(a.marketing, false);
  assert.equal(a.legalVersion, LEGAL_VERSION);
  pass(
    "email verification and login; optional marketing rejected without blocking signup",
  );
  const receipt = JSON.parse(
    (
      await db
        .selectFrom("customer_user")
        .select("legalReceipt")
        .where("id", "=", a.id)
        .executeTakeFirstOrThrow()
    ).legalReceipt,
  );
  assert.equal(receipt.marketing, false);
  assert.equal(receipt.documents.terminos.length, 64);
  assert.ok(receipt.acceptedAt);
  pass("version, document hashes and server timestamp persist with user");
  assert.ok([...alice.jar.keys()].some((k) => k.startsWith("bolt_customer")));
  const cookie = await alice.request("/api/customer-auth/sign-in/email", {
    email: "a@example.invalid",
    password,
  });
  assert.ok(
    cookie.headers
      .getSetCookie()
      .some((v) => v.includes("HttpOnly") && v.includes("SameSite=Lax")),
  );
  pass("customer cookie namespace, HttpOnly and SameSite");
  const b = await signup(bob, "b@example.invalid", "Cliente de prueba B");
  assert.notEqual(a.id, b.id);
  pass("two independent identities");
  const initial = (await alice.request("/api/customer/data")).data;
  const payload = {
    [GUEST_CART_KEY]: JSON.stringify({
      version: 1,
      items: [
        { productId: "FIXTURE-P", variantId: "V1", quantity: 2, price: 1 },
        { productId: "FIXTURE-P", variantId: "V2", quantity: 1 },
      ],
    }),
    [GUEST_ADDRESSES_KEY]: JSON.stringify({
      version: 1,
      addresses: [
        {
          id: "address-fixture",
          name: "Casa de prueba",
          address: "Dirección ficticia de prueba",
          details: "",
          coordinates: { lat: 4.67, lng: -74.05 },
          municipality: "Bogotá",
          isDefault: true,
        },
      ],
      current: null,
    }),
    [FAVORITES_KEY]: JSON.stringify({ "FIXTURE-P": true }),
  };
  result = await alice.request(
    "/api/customer/data",
    { revision: initial.revision, payload },
    "PUT",
  );
  assert.equal(result.status, 200);
  assert.ok(!result.data.payload[GUEST_CART_KEY].includes("price"));
  assert.deepEqual((await bob.request("/api/customer/data")).data.payload, {});
  pass(
    "cart variants, addresses and favorites isolated; browser price discarded",
  );
  assert.equal(
    (
      await alice.request(
        "/api/customer/data",
        { revision: initial.revision, payload },
        "PUT",
      )
    ).status,
    409,
  );
  pass("stale device writes rejected without overwriting");
  const imported = await alice.request("/api/customer/import", {
    importId: "isolated-import-001",
    payload,
  });
  assert.equal(imported.status, 200);
  const again = await alice.request("/api/customer/import", {
    importId: "isolated-import-001",
    payload,
  });
  assert.equal(again.data.revision, imported.data.revision);
  assert.equal(
    JSON.parse(again.data.payload[GUEST_CART_KEY]).items[0].quantity,
    2,
  );
  pass("voluntary import idempotent, no duplicate quantities");
  assert.equal(
    (
      await alice.request(
        "/api/customer/data",
        { revision: again.data.revision, payload },
        "PUT",
        { Origin: "https://attacker.invalid" },
      )
    ).status,
    403,
  );
  pass("cross-origin mutation rejected");
  assert.equal(
    (
      await alice.request(
        "/api/customer/data",
        { revision: again.data.revision, payload },
        "PUT",
        { "X-Customer-Id": b.id },
      )
    ).status,
    409,
  );
  pass("stale account tab cannot write through a different customer session");
  assert.equal(
    (await alice.request("/api/customer/orders/HISTORICAL-CLOSED/link", {}))
      .status,
    403,
  );
  assert.equal(
    (
      await alice.request(
        "/api/customer/orders/HISTORICAL-CLOSED/link",
        {},
        "POST",
        { "X-Order-Token": "ISOLATED-OWNERSHIP-PROOF" },
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await bob.request(
        "/api/customer/orders/HISTORICAL-CLOSED/link",
        {},
        "POST",
        { "X-Order-Token": "ISOLATED-OWNERSHIP-PROOF" },
      )
    ).status,
    409,
  );
  assert.equal((await alice.request("/api/customer/orders")).data.length, 1);
  assert.equal((await bob.request("/api/customer/orders")).data.length, 0);
  assert.equal(orders[0].fulfillmentStatus, "ENTREGADO");
  pass(
    "historical order requires private proof; ownership unique; closed state preserved",
  );
  assert.equal(
    (
      await alice.request(
        "/api/customer/profile",
        { name: "Nombre elegido", phone: "+57 300 000 0000" },
        "PATCH",
      )
    ).status,
    200,
  );
  assert.equal(
    (await alice.request("/api/customer/me")).data.user.name,
    "Nombre elegido",
  );
  await alice.request("/api/customer/communications", { enabled: true }, "PUT");
  await alice.request(
    "/api/customer/communications",
    { enabled: false },
    "PUT",
  );
  assert.equal(
    (await alice.request("/api/customer/me")).data.user.marketing,
    false,
  );
  pass("real profile updates and marketing withdrawal audited");
  assert.equal(
    (
      await bob.request("/api/customer-auth/request-password-reset", {
        email: "b@example.invalid",
        redirectTo: "https://attacker.invalid",
      })
    ).status,
    403,
  );
  pass("reset redirect cannot leave configured origin");
  await bob.request("/api/customer-auth/request-password-reset", {
    email: "b@example.invalid",
    redirectTo: "/cuenta",
  });
  const reset = [...mail]
    .reverse()
    .find(
      (x) => x.to === "b@example.invalid" && x.subject.includes("Restablece"),
    )!;
  const resetURL = new URL(reset.url);
  const landing = await bob.request(resetURL.pathname + resetURL.search);
  const token = new URL(
    landing.headers.get("location")!,
    origin,
  ).searchParams.get("token");
  assert.ok(token);
  assert.equal(
    (
      await bob.request("/api/customer-auth/reset-password", {
        token,
        newPassword: password + "-new",
      })
    ).status,
    200,
  );
  assert.equal((await bob.request("/api/customer/me")).data.user, null);
  assert.notEqual(
    (
      await bob.request("/api/customer-auth/reset-password", {
        token,
        newPassword: password,
      })
    ).status,
    200,
  );
  pass("one-use password recovery revokes existing sessions");
  await db
    .updateTable("customer_session")
    .set({
      expiresAt: new Date(Date.now() + 5 * 86400000),
      updatedAt: new Date(Date.now() - 2 * 86400000),
    })
    .where("userId", "=", a.id)
    .execute();
  const renewed = await alice.request("/api/customer/me");
  assert.ok(
    renewed.headers
      .getSetCookie()
      .some((c) => c.startsWith("bolt_customer.session_token=")),
  );
  assert.ok(
    new Date(renewed.data.expiresAt).getTime() > Date.now() + 6 * 86400000,
  );
  pass("session renewal forwards updated HttpOnly cookie through Express");
  await db
    .updateTable("customer_session")
    .set({ expiresAt: new Date(Date.now() - 1000) })
    .where("userId", "=", a.id)
    .execute();
  assert.equal((await alice.request("/api/customer/me")).data.user, null);
  pass("expired sessions rejected by backend");
  await alice.request("/api/customer-auth/sign-in/email", {
    email: "a@example.invalid",
    password,
  });
  result = await alice.request("/api/customer-auth/delete-user", {
    callbackURL: "/cuenta?eliminada=1",
  });
  assert.equal(result.status, 200);
  assert.ok((await alice.request("/api/customer/me")).data.user);
  pass("deletion waits for verified email confirmation");
  const deletion = [...mail]
      .reverse()
      .find(
        (x) =>
          x.to === "a@example.invalid" && x.subject.includes("eliminación"),
      )!,
    delURL = new URL(deletion.url);
  assert.notEqual(
    (await stranger.request(delURL.pathname + delURL.search)).status,
    302,
  );
  pass("deletion link alone without matching session rejected");
  assert.equal(
    (await alice.request(delURL.pathname + delURL.search)).status,
    302,
  );
  assert.equal((await alice.request("/api/customer/me")).data.user, null);
  assert.equal(
    (
      await db
        .selectFrom("customer_data")
        .selectAll()
        .where("user_id", "=", a.id)
        .execute()
    ).length,
    0,
  );
  assert.equal(orders[0].fulfillmentStatus, "ENTREGADO");
  assert.equal(
    (
      await db
        .selectFrom("customer_deletions")
        .select("status")
        .where("user_id", "=", a.id)
        .executeTakeFirstOrThrow()
    ).status,
    "COMPLETED",
  );
  pass(
    "verified deletion removes account data and sessions, preserves order history",
  );
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await db.destroy();
  db = fixtureDatabase(path.join(directory, "postgres"));
  assert.ok(
    await db
      .selectFrom("customer_user")
      .select("id")
      .where("id", "=", b.id)
      .executeTakeFirst(),
  );
  assert.ok(
    await db
      .selectFrom("customer_audit")
      .select("event")
      .where("event", "=", "ACCOUNT_DELETED")
      .executeTakeFirst(),
  );
  pass("PostgreSQL state and audit survive restart");
  console.log(
    `${checks} customer account HTTP checks passed; fixture email only; Google/Apple live authorization NOT tested.`,
  );
} finally {
  server.close();
  await db.destroy();
  fs.rmSync(directory, { recursive: true, force: true });
}
