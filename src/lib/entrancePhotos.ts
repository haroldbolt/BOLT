import {
  ENTRANCE_PHOTO_MAX_BYTES,
  photoDestinationKey,
} from "./entrancePhotoShared";
import { api } from "./api";
export interface EntrancePhoto {
  id: string;
  blob: Blob;
  createdAt: number;
}
export interface PhotoUpload {
  orderId: string;
  photo: EntrancePhoto;
  destinationKey: string;
  createdAt: number;
}
const databaseName = "bolt_guest_entrance_photos_v1";
const memory = {
  photos: new Map<string, EntrancePhoto>(),
  uploads: new Map<string, PhotoUpload>(),
};
export const photoStorageNotice =
  "No pudimos guardar la foto en este dispositivo. Se conservará solo mientras esta página siga abierta.";
async function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") return reject(Error("Unavailable"));
    const r = indexedDB.open(databaseName, 1);
    r.onupgradeneeded = () => {
      r.result.createObjectStore("photos", { keyPath: "id" });
      r.result.createObjectStore("uploads", { keyPath: "orderId" });
    };
    r.onerror = () => reject(r.error);
    r.onblocked = () => reject(Error("Blocked"));
    r.onsuccess = () => resolve(r.result);
  });
}
async function operation<T>(
  store: "photos" | "uploads",
  mode: IDBTransactionMode,
  run: (s: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await database();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(store, mode),
        r = run(tx.objectStore(store));
      let result: T;
      r.onsuccess = () => {
        result = r.result;
      };
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || Error("Aborted"));
    });
  } finally {
    db.close();
  }
}
export async function saveEntrancePhoto(
  blob: Blob,
): Promise<{ photo: EntrancePhoto; warning: string }> {
  if (
    blob.type !== "image/jpeg" ||
    !blob.size ||
    blob.size > ENTRANCE_PHOTO_MAX_BYTES
  )
    throw Error("La foto no tiene un formato o tamaño válido.");
  const photo = { id: crypto.randomUUID(), blob, createdAt: Date.now() };
  memory.photos.set(photo.id, photo);
  try {
    await operation("photos", "readwrite", (s) => s.put(photo));
    return { photo, warning: "" };
  } catch {
    return { photo, warning: photoStorageNotice };
  }
}
export async function getEntrancePhoto(
  id: string,
): Promise<EntrancePhoto | undefined> {
  try {
    return (
      (await operation<EntrancePhoto | undefined>("photos", "readonly", (s) =>
        s.get(id),
      )) || memory.photos.get(id)
    );
  } catch {
    return memory.photos.get(id);
  }
}
export async function deleteEntrancePhoto(id: string) {
  memory.photos.delete(id);
  try {
    await operation("photos", "readwrite", (s) => s.delete(id));
  } catch {}
}
export async function queueEntrancePhoto(
  orderId: string,
  photo: EntrancePhoto,
  destination: any,
): Promise<boolean> {
  const upload = {
    orderId,
    photo,
    destinationKey: photoDestinationKey(destination),
    createdAt: Date.now(),
  };
  memory.uploads.set(orderId, upload);
  try {
    await operation("uploads", "readwrite", (s) => s.put(upload));
    return true;
  } catch {
    return false;
  }
}
export async function pendingEntrancePhoto(
  orderId: string,
): Promise<PhotoUpload | undefined> {
  try {
    return (
      (await operation<PhotoUpload | undefined>("uploads", "readonly", (s) =>
        s.get(orderId),
      )) || memory.uploads.get(orderId)
    );
  } catch {
    return memory.uploads.get(orderId);
  }
}
const inFlight = new Map<string, Promise<boolean>>();
export function sendPendingEntrancePhoto(orderId: string): Promise<boolean> {
  const existing = inFlight.get(orderId);
  if (existing) return existing;
  const task = (async () => {
    const pending = await pendingEntrancePhoto(orderId);
    if (!pending) return false;
    await api.uploadEntrancePhoto(
      orderId,
      pending.photo.id,
      pending.photo.blob,
      pending.destinationKey,
    );
    // Deleting a completed queue item never removes the photo linked to a saved address.
    memory.uploads.delete(orderId);
    await operation("uploads", "readwrite", (s) => s.delete(orderId)).catch(
      () => {},
    );
    return true;
  })().finally(() => inFlight.delete(orderId));
  inFlight.set(orderId, task);
  return task;
}
/** Decode and redraw: removes EXIF/GPS and the original filename before persistence. */
export async function prepareEntrancePhoto(file: File): Promise<Blob> {
  if (
    !/^image\/(jpeg|png|webp|heic|heif)$/i.test(file.type) ||
    !file.size ||
    file.size > 20 * 1024 * 1024
  )
    throw Error("Elige una foto JPG, PNG o WebP de hasta 20 MB.");
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () =>
        reject(Error("No pudimos abrir esta foto. Prueba con JPG o PNG."));
      i.src = url;
    });
    if (
      !img.naturalWidth ||
      !img.naturalHeight ||
      img.naturalWidth * img.naturalHeight > 50_000_000
    )
      throw Error("La foto es demasiado grande. Elige otra.");
    const scale = Math.min(
      1,
      1280 / Math.max(img.naturalWidth, img.naturalHeight),
    );
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw Error("No pudimos preparar la foto.");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(Error("No pudimos preparar la foto."))),
        "image/jpeg",
        0.8,
      ),
    );
    if (blob.size > ENTRANCE_PHOTO_MAX_BYTES)
      throw Error("La foto sigue siendo demasiado grande. Elige otra.");
    return blob;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Remove abandoned drafts after 24 h; saved addresses and queued order snapshots remain separate. */
export async function cleanAbandonedEntrancePhotos(
  referenced: string[],
  now = Date.now(),
) {
  const keep = new Set(referenced);
  let photos: EntrancePhoto[] = [];
  try {
    photos = await operation<EntrancePhoto[]>("photos", "readonly", (s) =>
      s.getAll(),
    );
  } catch {
    photos = [...memory.photos.values()];
  }
  for (const photo of photos)
    if (!keep.has(photo.id) && now - photo.createdAt > 24 * 3600_000)
      await deleteEntrancePhoto(photo.id);
}
