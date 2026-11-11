import assert from "node:assert/strict";
import { AccountStorage, guestStorage } from "../customer/client";
import {
  GuestCartStore,
  GUEST_CART_KEY,
  resolveGuestCart,
} from "../lib/guestCart";
import { mergeGuestData } from "../customer/data";
import { PushNotificationService } from "../lib/notifications";
import { WAREHOUSES } from "../data/warehouseConfig";
import { makeWarehouseAssignment } from "../lib/warehouseAssignment";
import { saleVariant } from "../lib/variantCommerce";
const product: any = {
  id: "fixture",
  name: "Fixture",
  price: 10,
  presentaciones: [
    { varianteId: "a", nombre: "1 kg", price: 10 },
    { varianteId: "b", nombre: "2 kg", price: 20 },
  ],
};
const originalFetch = globalThis.fetch;
let revision = 0,
  serverPayload: any = {},
  allow = false,
  lastAccount = "";
globalThis.fetch = async (_url, init) => {
  lastAccount = new Headers(init?.headers).get("X-Customer-Id") || "";
  const body = JSON.parse(String(init?.body));
  if (!allow || body.revision !== revision)
    return new Response(JSON.stringify({ error: "Concurrent update" }), {
      status: 409,
    });
  serverPayload = body.payload;
  return Response.json({ revision: ++revision });
};
try {
  const guest = new Map<string, string>(),
    disk = {
      getItem: (key: string) => guest.get(key) ?? null,
      setItem: (key: string, value: string) => {
        guest.set(key, value);
      },
    };
  const cart = new GuestCartStore(disk);
  cart.add(saleVariant(product, "a"));
  cart.add(saleVariant(product, "b"));
  const before = disk.getItem(GUEST_CART_KEY)!;
  const account = new AccountStorage("account-a", {}, 0);
  const accountCart = new GuestCartStore(account);
  assert.equal(accountCart.getSnapshot().references.length, 0);
  assert.equal(disk.getItem(GUEST_CART_KEY), before);
  console.log("PASS guest cart unchanged while account starts separately");
  const merged = mergeGuestData({}, { [GUEST_CART_KEY]: before });
  account.setItem(GUEST_CART_KEY, merged[GUEST_CART_KEY]);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.ok(account.hasUnsaved());
  assert.ok(account.getSnapshot().error);
  assert.equal(
    JSON.parse(account.exportPending()).payload[GUEST_CART_KEY],
    before,
  );
  assert.equal(disk.getItem(GUEST_CART_KEY), before);
  console.log(
    "PASS failed save retains recoverable selections without touching guest or other account",
  );
  allow = true;
  await account.flush();
  assert.equal(lastAccount, "account-a");
  assert.equal(account.hasUnsaved(), false);
  assert.equal(
    resolveGuestCart(new GuestCartStore(account).getSnapshot().references, [
      product,
    ]).items.length,
    2,
  );
  const second = new AccountStorage("account-b", {}, 0);
  assert.equal(second.getItem(GUEST_CART_KEY), null);
  assert.equal(disk.getItem(GUEST_CART_KEY), before);
  console.log(
    "PASS retry persists two variants with account-bound request; second account remains empty",
  );
  const alerts = new PushNotificationService(disk);
  alerts.setCustomerScope("account-a");
  const order: any = {
    id: "OWN-ORDER",
    orderNumber: "FIXTURE",
    storeId: "HUB_SUBA",
    warehouseAssignment: makeWarehouseAssignment("OWN-ORDER", WAREHOUSES[2]),
  };
  assert.ok(alerts.notifyWarehouseAssignment(order));
  assert.ok(
    !disk
      .getItem("bolt_customer_notification_receipts_v1_account-a")!
      .includes("preparado"),
  );
  alerts.setCustomerScope("account-b");
  assert.equal(alerts.getNotifications().length, 0);
  const resumedAlerts = new PushNotificationService(disk);
  resumedAlerts.setCustomerScope("account-a");
  assert.equal(resumedAlerts.notifyWarehouseAssignment(order), null);
  console.log(
    "PASS notification receipts prevent duplicates after reload without sharing private notification content",
  );
  const restored = new AccountStorage("account-a", serverPayload, revision);
  assert.equal(new GuestCartStore(restored).getSnapshot().references.length, 2);
  assert.equal(guestStorage(), undefined);
  console.log(
    "PASS account restored from server and unavailable browser storage is safe",
  );
} finally {
  globalThis.fetch = originalFetch;
}
