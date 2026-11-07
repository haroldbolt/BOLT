import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CustomerDispatches } from "../components/dispatch/CustomerDispatches";
import { DriverPanel } from "../components/dispatch/DriverPanel";
import { DispatchManager } from "../components/dispatch/DispatchManager";
import { PushNotificationService } from "../lib/notifications";
import { INITIAL_ORDERS } from "../data/seedData";
import { api } from "../lib/api";
import { dispatchClient, driverSession } from "../lib/dispatchClient";
const map = new Map();
globalThis.localStorage = {
  getItem: (k: string) => map.get(k) || null,
  setItem: (k: string, v: string) => map.set(k, v),
  removeItem: (k: string) => map.delete(k),
} as any;
globalThis.sessionStorage = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
} as any;
const calls: any[] = [];
globalThis.fetch = (async (url: any, options: any) => {
  calls.push({ url, options });
  return { ok: true, json: async () => ({}) };
}) as any;
api.setStoredAdminToken("admin-test");
api.saveOrderAccess("o", "guest-test");
driverSession.set("driver-test");
await dispatchClient.driver("profile");
assert.equal(calls.at(-1).options.headers.Authorization, "Bearer driver-test");
await api.getOrder("o", true);
assert(!new Headers(calls.at(-1).options.headers).get("Authorization"));
assert.equal(
  new Headers(calls.at(-1).options.headers).get("X-Order-Token"),
  "guest-test",
);
await dispatchClient.admin();
assert.equal(calls.at(-1).options.headers.Authorization, "Bearer admin-test");
driverSession.set("");
assert.match(renderToStaticMarkup(<DriverPanel />), /Ingresar como conductor/);
assert(!renderToStaticMarkup(<DriverPanel />).includes("Carlos"));
assert.match(
  renderToStaticMarkup(
    <DispatchManager authenticated={false} onAuthenticate={() => {}} />,
  ),
  /Inicia una sesión administrativa/,
);
const order: any = {
  ...structuredClone(INITIAL_ORDERS[0]),
  id: "o",
  dispatches: [
    {
      id: "d1",
      code: "BP-000001-E01",
      status: "DELIVERED",
      driverConfirmed: true,
      provider: "Flota propia BOLT",
      events: [],
    },
    {
      id: "d2",
      code: "BP-000001-E02",
      status: "BUSCANDO_REPARTIDOR",
      driverConfirmed: false,
      events: [{ id: "evt", at: Date.now(), type: "DISPATCH_ASSIGNED" }],
    },
  ],
};
const html = renderToStaticMarkup(
  <CustomerDispatches order={order} onSelect={() => {}} />,
);
assert.match(html, /1 de 2 entregas completadas/);
assert.match(html, /Repartidor pendiente de confirmar/);
assert(!html.includes(order.secretDeliveryCode));
const storage = {
  getItem: (k: string) => map.get(k) || null,
  setItem: (k: string, v: string) => map.set(k, v),
};
const n = new PushNotificationService(storage);
n.notifyDispatchEvents(order);
n.notifyDispatchEvents(order);
assert.equal(n.getNotifications().length, 1);
const restarted = new PushNotificationService(storage);
restarted.notifyDispatchEvents(order);
assert.equal(restarted.getNotifications().length, 1);
console.log(
  "PASS panels: role-specific tokens, private guest access, login gates, grouped partial status and persistent notification deduplication",
);
