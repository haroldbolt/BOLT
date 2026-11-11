import assert from "node:assert/strict";
import { indexedDB } from "fake-indexeddb";
import {
  GuestAddressStore,
  GUEST_ADDRESSES_KEY,
  readGuestAddresses,
} from "../lib/guestAddresses";
import {
  saveEntrancePhoto,
  getEntrancePhoto,
  deleteEntrancePhoto,
  queueEntrancePhoto,
  pendingEntrancePhoto,
  sendPendingEntrancePhoto,
} from "../lib/entrancePhotos";
import { api } from "../lib/api";
Object.assign(globalThis, { indexedDB });
const storage = new Map<string, string>();
const local = {
  getItem: (k: string) => storage.get(k) ?? null,
  setItem: (k: string, v: string) => storage.set(k, v),
};
const address = {
  address: "FIXTURE puerta de prueba",
  details: "Portería de prueba",
  coordinates: { lat: 4.7, lng: -74.06 },
};
const photo = await saveEntrancePhoto(
  new Blob(["synthetic JPEG; server validates actual decoding"], {
    type: "image/jpeg",
  }),
);
assert.equal(photo.warning, "");
const book = new GuestAddressStore(local);
book.confirm({ ...address, referencePhotoId: photo.photo.id });
book.saveCurrent("Fixture", true);
assert.equal(
  readGuestAddresses(local).current?.referencePhotoId,
  photo.photo.id,
);
assert.ok(!storage.get(GUEST_ADDRESSES_KEY)!.includes("synthetic JPEG"));
assert.equal((await getEntrancePhoto(photo.photo.id))?.blob.type, "image/jpeg");
const id = book.getSnapshot().addresses[0].id;
const photo2 = await saveEntrancePhoto(
  new Blob(["other"], { type: "image/jpeg" }),
);
await queueEntrancePhoto("TEST-ORDER", photo.photo, address);
book.update(
  id,
  { ...address, referencePhotoId: photo2.photo.id },
  "Fixture",
  true,
);
assert.equal(
  (await pendingEntrancePhoto("TEST-ORDER"))!.photo.id,
  photo.photo.id,
);
await deleteEntrancePhoto(photo.photo.id);
assert.equal(
  (await pendingEntrancePhoto("TEST-ORDER"))!.photo.blob.size,
  photo.photo.blob.size,
);
let calls = 0;
api.uploadEntrancePhoto = async () => {
  calls++;
  throw Error("offline");
};
await assert.rejects(sendPendingEntrancePhoto("TEST-ORDER"));
assert.ok(await pendingEntrancePhoto("TEST-ORDER"));
api.uploadEntrancePhoto = async () => {
  calls++;
  await new Promise((r) => setTimeout(r, 20));
};
const both = await Promise.all([
  sendPendingEntrancePhoto("TEST-ORDER"),
  sendPendingEntrancePhoto("TEST-ORDER"),
]);
assert.deepEqual(both, [true, true]);
assert.equal(calls, 2);
assert.equal(await pendingEntrancePhoto("TEST-ORDER"), undefined);
book.update(id, address, "Fixture", true);
assert.equal(readGuestAddresses(local).current?.referencePhotoId, undefined);
assert.equal(readGuestAddresses(local).addresses.length, 1);
Object.assign(globalThis, { indexedDB: undefined });
const memory = await saveEntrancePhoto(
  new Blob(["memory"], { type: "image/jpeg" }),
);
assert.ok(memory.warning);
assert.ok(await getEntrancePhoto(memory.photo.id));
assert.equal(await queueEntrancePhoto("MEMORY", memory.photo, address), false);
assert.ok(await pendingEntrancePhoto("MEMORY"));
await assert.rejects(
  saveEntrancePhoto(new Blob(["<svg/>"], { type: "image/svg+xml" })),
);
console.log(
  "PASS entrance photos: IndexedDB persistence, address reload/edit/remove, binary separation, immutable queued snapshot, offline/retry/dedup, unavailable storage and format rejection.",
);
