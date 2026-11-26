import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import net from "node:net";
import { spawn } from "node:child_process";
import assert from "node:assert/strict";
const root = path.join(
  fs.mkdtempSync(path.join(os.tmpdir(), "bolt-customer-order-")),
  "bolt-dispatch-simulation-account",
);
const probe = net.createServer();
await new Promise<void>((r) => probe.listen(0, "127.0.0.1", r));
const port = (probe.address() as any).port;
await new Promise<void>((r) => probe.close(() => r()));
const origin = `http://127.0.0.1:${port}`;
const child = spawn(
  process.execPath,
  ["--import", "tsx", "scripts/customer/browser-review.ts", root],
  {
    env: { ...process.env, BOLT_CUSTOMER_REVIEW_PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  },
);
let logs = "";
child.stdout.on("data", (b) => (logs += b));
child.stderr.on("data", (b) => (logs += b));
const jar = new Map<string, string>();
let accountId = "";
async function request(
  route: string,
  body?: any,
  headers: any = {},
  cookies = true,
) {
  const response = await fetch(origin + route, {
    method: body === undefined ? "GET" : "POST",
    redirect: "manual",
    headers: {
      Origin: origin,
      ...(cookies
        ? { Cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; ") }
        : {}),
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (cookies)
    for (const raw of response.headers.getSetCookie()) {
      const p = raw.split(";")[0],
        i = p.indexOf("=");
      jar.set(p.slice(0, i), p.slice(i + 1));
    }
  return {
    status: response.status,
    data: await response.json().catch(() => null),
  };
}
try {
  for (let i = 0; i < 200; i++) {
    if (child.exitCode !== null)
      throw Error(
        "Fixture failed: " + logs.replace(/Sim-[a-z0-9]+/g, "[redacted]"),
      );
    try {
      if ((await fetch(origin + "/api/customer/config")).ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  const info = (await request("/api/v1/simulation")).data;
  const admin = (await request("/api/v1/auth/login", info.admin)).data.token;
  assert.equal(
    (
      await request(
        "/api/v1/admin/simulation/fleet",
        { count: 2 },
        { Authorization: "Bearer " + admin },
      )
    ).status,
    200,
  );
  const email = "order-fixture@example.invalid",
    password = "Isolated-Order-Fixture-2026!";
  assert.equal(
    (
      await request("/api/customer-auth/sign-up/email", {
        email,
        password,
        name: "Fixture cuenta pedido",
        legalConsent: {
          version: "2026-11-10-draft-1",
          terms: true,
          privacy: true,
          marketing: false,
        },
        callbackURL: "/cuenta",
      })
    ).status,
    200,
  );
  const mail = JSON.parse(
    fs.readFileSync(
      path.join(root, ".bolt-private/customer-mail.json"),
      "utf8",
    ),
  ).find((m: any) => m.to === email);
  const url = new URL(mail.url);
  assert.equal((await request(url.pathname + url.search)).status, 302);
  assert.equal(
    (await request("/api/customer-auth/sign-in/email", { email, password }))
      .status,
    200,
  );
  accountId = (await request("/api/customer/me")).data.user.id;
  const destination = {
    address: "Carrera 107 #143-31, Bogotá — prueba aislada",
    municipality: "Bogotá",
    locality: "Suba",
    coordinates: { lat: 4.747154, lng: -74.098137 },
  };
  const items = [{ productId: "SIM-FOOD-20KG", quantity: 1, price: 10000 }];
  const quote = (
    await request("/api/v1/delivery/quote", {
      destination,
      items,
      requestedMode: "TURBO",
    })
  ).data;
  assert.ok(quote.confirmationToken, quote.reasonCode);
  assert.equal(quote.transportPlan.feasible, true, quote.reasonCode);
  const payload = {
    items,
    deliveryAddress: destination,
    deliveryMode: "TURBO",
    storeId: "HUB_SUBA",
    customer: { name: "Fixture compra", email, phone: "0000000000" },
    paymentMethod: "CASH_ON_DELIVERY",
    confirmationToken: quote.confirmationToken,
    customerAccountId: "forged-owner",
  };
  const key = crypto.randomUUID(),
    headers = { "Idempotency-Key": key };
  const simultaneous = await Promise.all([request("/api/v1/orders", payload, headers), request("/api/v1/orders", payload, headers)]);
  assert.deepEqual(simultaneous.map(r => r.status).sort(), [200, 201]);
  const first = simultaneous.find(r => r.status === 201)!;
  assert.equal(simultaneous.find(r => r.status === 200)!.data.id, first.data.id);
  assert.equal(first.status, 201, first.data?.code || first.data?.error);
  assert.equal(first.data.customerAccountId, undefined);
  assert.equal(first.data.guestAccessToken, undefined);
  assert.equal(first.data.storeId, "HUB_SUBA");
  const again = await request("/api/v1/orders", payload, headers);
  assert.equal(again.status, 200);
  assert.equal(again.data.id, first.data.id);
  console.log(
    "PASS real order endpoint assigns verified owner, ignores forged owner and preserves idempotency",
  );
  assert.equal(
    (await request("/api/customer/orders")).data.filter(
      (o: any) => o.id === first.data.id,
    ).length,
    1,
  );
  assert.equal(
    (await request("/api/v1/orders/" + first.data.id + "/tracking")).status,
    200,
  );
  assert.equal(
    (
      await request(
        "/api/v1/orders/" + first.data.id + "/tracking",
        undefined,
        {},
        false,
      )
    ).status,
    403,
  );
  assert.equal(
    (await request("/api/v1/orders", payload, headers, false)).status,
    409,
  );
  console.log(
    "PASS account can track its purchase; guest and changed-session retry denied",
  );
  const demoSku = "RDI-EFECTIVO-1KG";
  const review = (await request("/api/v1/simulation/cash-review")).data;
  const reviewDestination = review.stores.find((store: any) => store.id === "HUB_SUBA").destination;
  const reviewItems = [{ productId: demoSku, quantity: 1, price: 59_000 }];
  const reviewQuote = (await request("/api/v1/delivery/quote", {
    items: reviewItems, destination: reviewDestination, requestedMode: "TURBO",
  })).data;
  assert.ok(reviewQuote.confirmationToken, reviewQuote.reasonCode);
  const reviewPayload = { ...payload, customerAccountId: accountId, items: reviewItems, deliveryAddress: reviewDestination,
    confirmationToken: reviewQuote.confirmationToken };
  const reviewKey = { "Idempotency-Key": crypto.randomUUID() };
  assert.equal((await request("/api/v1/checkout/attempt", {})).status, 204);
  const created = await request("/api/v1/orders", reviewPayload, reviewKey);
  assert.equal(created.status, 201, created.data?.code || created.data?.error);
  assert.equal(created.data.demoCustomerCheckout, true);
  assert.equal(created.data.payment.cashToCollect, 0);
  assert.equal(created.data.customerAccountId, undefined);
  assert.equal((await request("/api/v1/orders", reviewPayload, reviewKey)).data.id, created.data.id);
  assert.equal((await request("/api/customer/orders")).data.some((o: any) => o.id === created.data.id), false);
  assert.equal((await request("/api/v1/orders/" + created.data.id + "/tracking")).status, 403);
  const privateAccess = {"X-Order-Token": created.data.guestAccessToken};
  const linkUrl = "/api/customer/orders/" + created.data.id + "/link";
  const missingAccount = await request(linkUrl, {}, privateAccess);
  assert.equal(missingAccount.status, 409);
  assert.equal(missingAccount.data.code, "CUSTOMER_CHANGED");
  const refused = await request(linkUrl, {}, {...privateAccess, "X-Customer-Id": accountId});
  assert.equal(refused.status, 403, refused.data?.error);
  assert.equal((await request("/api/customer/orders")).data.some((o: any) => o.id === created.data.id), false);
  assert.equal((await request("/api/v1/orders/" + created.data.id + "/tracking", undefined, privateAccess, false)).status, 200);
  console.log("PASS authenticated demo checkout and its retry stay private to the test receipt, outside the customer account");

  const catalog = (await request("/api/v1/catalog")).data;
  const p = catalog.find((x: any) => x.id === "SIM-FOOD-20KG");
  assert.equal(p.reservedStockByStore.HUB_SUBA, 1);
  assert.equal(p.price, 10000);
  const historical = (
    await request("/api/v1/orders", undefined, {
      Authorization: "Bearer " + admin,
    })
  ).data;
  assert.equal(
    historical.find((o: any) => o.id === "HIST-CLOSED").fulfillmentStatus,
    "ENTREGADO",
  );
  console.log(
    "PASS stock reserved once; price and closed historical order unchanged",
  );

  // Use the same read-only SSE request across the normal sign-out flow.
  const stream = await fetch(origin + "/api/v1/orders/" + first.data.id + "/events", {
    headers: { Cookie: [...jar].map(([key, value]) => key + "=" + value).join("; "), Accept: "text/event-stream" },
    signal: AbortSignal.timeout(20_000),
  });
  assert.equal(stream.status, 200);
  const reader = stream.body!.getReader();
  try {
    assert.match(new TextDecoder().decode((await reader.read()).value), /: connected/);
    assert.equal((await request("/api/customer-auth/sign-out", {})).status, 200);
    const signedOut = Date.now();
    while (!(await reader.read()).done) { /* Consume any in-flight heartbeat. */ }
    assert.ok(Date.now() - signedOut <= 15_000, "El canal de una sesión cerrada debe terminar en 15 segundos");
    assert.equal((await request("/api/customer/me")).data.user, null);
    console.log("PASS sign-out closes the existing order subscription while the order is idle");
  } finally { await reader.cancel().catch(() => {}); }
} finally {
  child.kill("SIGTERM");
  if (child.exitCode === null) await new Promise((r) => child.once("exit", r));
  fs.rmSync(path.dirname(root), { recursive: true, force: true });
}
