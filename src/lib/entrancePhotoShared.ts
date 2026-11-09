/** Photo evidence never grants coverage or changes the delivery destination. */
export const ENTRANCE_PHOTO_MAX_BYTES = 1024 * 1024;
export const validPhotoId = (id: unknown): id is string =>
  typeof id === "string" && /^[a-f0-9-]{36}$/i.test(id);
export function photoDestinationKey(destination: {
  address?: string;
  details?: string;
  coordinates?: { lat: number; lng: number };
}) {
  return JSON.stringify([
    destination.address?.trim() || "",
    destination.details?.trim() || "",
    destination.coordinates?.lat ?? null,
    destination.coordinates?.lng ?? null,
  ]);
}
