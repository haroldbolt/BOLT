import {
  readGuestCart,
  GUEST_CART_KEY,
  cartReferenceKey,
} from "../lib/guestCart";
import {
  readGuestAddresses,
  GUEST_ADDRESSES_KEY,
  addressIdentity,
} from "../lib/guestAddresses";
export const WISHLIST_KEY = "bolt_pets_wishlist_collections";
export const FAVORITES_KEY = "bolt_customer_favorites_v1";
export const ACCOUNT_KEYS = [
  GUEST_CART_KEY,
  GUEST_ADDRESSES_KEY,
  WISHLIST_KEY,
  FAVORITES_KEY,
] as const;
export type CustomerData = Record<string, string>;
export function sanitizeCustomerData(input: unknown): CustomerData {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw Error("Datos de cuenta inválidos");
  if (JSON.stringify(input).length > 300000)
    throw Error("Los datos exceden el tamaño permitido");
  const source = input as Record<string, unknown>,
    out: CustomerData = {};
  for (const key of ACCOUNT_KEYS) {
    if (source[key] === undefined) continue;
    if (typeof source[key] !== "string")
      throw Error("Formato de datos inválido");
    const raw = source[key] as string,
      parsed = JSON.parse(raw);
    if (key === GUEST_CART_KEY) {
      const result = readGuestCart({ getItem: () => raw, setItem: () => {} });
      if (result.warning || result.references.some((r) => r.quantity > 10000))
        throw Error("Carrito inválido");
      out[key] = JSON.stringify({ version: 1, items: result.references });
    } else if (key === GUEST_ADDRESSES_KEY) {
      const result = readGuestAddresses({
        getItem: () => raw,
        setItem: () => {},
      });
      if (result.warning || result.addresses.length > 100)
        throw Error("Direcciones inválidas");
      out[key] = JSON.stringify({
        version: 1,
        addresses: result.addresses,
        current: result.current,
      });
    } else if (key === FAVORITES_KEY) {
      if (
        !parsed ||
        typeof parsed !== "object" ||
        Array.isArray(parsed) ||
        Object.keys(parsed).length > 2000
      )
        throw Error("Favoritos inválidos");
      out[key] = JSON.stringify(
        Object.fromEntries(
          Object.entries(parsed).filter(
            ([id, value]) => id.length <= 256 && value === true,
          ),
        ),
      );
    } else {
      if (!Array.isArray(parsed) || parsed.length > 100)
        throw Error("Listas inválidas");
      const lists = parsed.map((v: any) => {
        if (
          !v ||
          typeof v.id !== "string" ||
          v.id.length > 128 ||
          typeof v.name !== "string" ||
          v.name.length > 100 ||
          !Array.isArray(v.items) ||
          v.items.length > 2000
        )
          throw Error("Lista inválida");
        const text = (value: any, max: number) =>
          typeof value === "string" ? value.slice(0, max) : "";
        return {
          id: v.id,
          name: v.name,
          description: text(v.description, 1000),
          icon: text(v.icon, 30),
          createdAt: text(v.createdAt, 40),
          updatedAt: text(v.updatedAt, 40),
          items: v.items.map((item: any) => {
            if (
              typeof item.productId !== "string" ||
              item.productId.length > 256
            )
              throw Error("Producto de lista inválido");
            return {
              productId: item.productId,
              addedAt: text(item.addedAt, 40),
              notes: text(item.notes, 1000),
            };
          }),
        };
      });
      out[key] = JSON.stringify(lists);
    }
  }
  return out;
}
export function mergeGuestData(
  current: CustomerData,
  guest: CustomerData,
): CustomerData {
  const result = { ...current },
    incoming = sanitizeCustomerData(guest);
  for (const key of ACCOUNT_KEYS) {
    if (!incoming[key]) continue;
    if (!current[key]) {
      result[key] = incoming[key];
      continue;
    }
    if (key === GUEST_CART_KEY) {
      const existing = JSON.parse(current[key]).items,
        added = JSON.parse(incoming[key]).items;
      const map = new Map(existing.map((v: any) => [cartReferenceKey(v), v]));
      for (const item of added) {
        const previous: any = map.get(cartReferenceKey(item));
        map.set(cartReferenceKey(item), {
          ...item,
          quantity: Math.max(item.quantity, previous?.quantity || 0),
        });
      }
      result[key] = JSON.stringify({ version: 1, items: [...map.values()] });
    } else if (key === GUEST_ADDRESSES_KEY) {
      const a = JSON.parse(current[key]),
        b = JSON.parse(incoming[key]);
      const ids = new Set(a.addresses.map((v: any) => v.id)),
        identities = new Set(a.addresses.map(addressIdentity));
      for (const row of b.addresses)
        if (!ids.has(row.id) && !identities.has(addressIdentity(row))) {
          a.addresses.push({
            ...row,
            isDefault:
              row.isDefault && !a.addresses.some((x: any) => x.isDefault),
          });
          ids.add(row.id);
          identities.add(addressIdentity(row));
        }
      a.current = a.current || b.current;
      result[key] = JSON.stringify(a);
    } else if (key === FAVORITES_KEY)
      result[key] = JSON.stringify({
        ...JSON.parse(current[key]),
        ...JSON.parse(incoming[key]),
      });
    else {
      const a = JSON.parse(current[key]),
        b = JSON.parse(incoming[key]);
      result[key] = JSON.stringify([
        ...a,
        ...b.filter((v: any) => !a.some((x: any) => x.id === v.id)),
      ]);
    }
  }
  return sanitizeCustomerData(result);
}
