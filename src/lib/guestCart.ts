import type { CartItem, Product } from '../types';
import { saleVariant } from './variantCommerce';

export const GUEST_CART_KEY = 'bolt_pets_guest_cart_v1';
export type CartReference = { productId: string; variantId?: string; quantity: number };
export type CartStorage = Pick<Storage, 'getItem' | 'setItem'>;
type Snapshot = { references: CartReference[]; warning: string };
const storageWarning = 'No se pudo guardar el carrito en este navegador. Tus selecciones se conservarán solo mientras esta página siga abierta.';
const validId = (id: unknown): id is string => typeof id === 'string' && id.trim().length > 0 && id.length <= 256;
const validQuantity = (q: unknown): q is number => Number.isSafeInteger(q) && Number(q) > 0;
export const cartReferenceKey = (ref: Pick<CartReference, 'productId' | 'variantId'>) => JSON.stringify([ref.productId, ref.variantId || null]);
export const productReference = (product: Product, quantity: number): CartReference => ({
  productId: product.parentProductId || product.id,
  ...(product.variantId ? { variantId: product.variantId } : {}), quantity,
});

export function readGuestCart(storage?: CartStorage): Snapshot {
  if (!storage) return { references: [], warning: storageWarning };
  try {
    const raw = storage.getItem(GUEST_CART_KEY);
    if (raw === null) return { references: [], warning: '' };
    const data = JSON.parse(raw);
    if (data?.version !== 1 || !Array.isArray(data.items) || data.items.length > 1000) throw new Error('Invalid cart');
    const entries = new Map<string, CartReference>();
    let invalid = false;
    for (const item of data.items) {
      if (!item || !validId(item.productId) || (item.variantId !== undefined && !validId(item.variantId)) || !validQuantity(item.quantity)) {
        invalid = true; continue;
      }
      // Whitelist identifiers and quantity. Never restore browser-supplied commercial data.
      const ref: CartReference = { productId: item.productId, ...(item.variantId ? { variantId: item.variantId } : {}), quantity: item.quantity };
      const key = cartReferenceKey(ref), previous = entries.get(key);
      if (previous) { invalid = true; ref.quantity = Math.max(previous.quantity, ref.quantity); }
      entries.set(key, ref);
    }
    return { references: [...entries.values()], warning: invalid ? 'Algunos datos guardados del carrito no eran válidos. Revisa las selecciones recuperadas.' : '' };
  } catch {
    // Leave the original storage untouched; only an explicit cart edit writes a new snapshot.
    return { references: [], warning: 'No se pudo recuperar el carrito guardado. Puedes volver a seleccionar tus productos.' };
  }
}

export function resolveGuestCart(references: CartReference[], catalog: Product[] | null) {
  const items: CartItem[] = [], unavailable: CartReference[] = [];
  if (catalog === null) return { items, unavailable };
  const byId = new Map(catalog.map(product => [product.id, product]));
  for (const ref of references) {
    const product = byId.get(ref.productId);
    const variants = product?.presentaciones || [];
    const exact = product && (!product.status || product.status === 'ACTIVE') &&
      (ref.variantId ? variants.some(v => v.varianteId === ref.variantId) : variants.length === 0);
    if (!exact) { unavailable.push(ref); continue; }
    items.push({ product: ref.variantId ? saleVariant(product!, ref.variantId) : product!, quantity: ref.quantity });
  }
  return { items, unavailable };
}

// No writes during construction, hydration or render. Mutations persist synchronously before
// notifying React, including successful checkout, so a navigation cannot race an effect.
export class GuestCartStore {
  private snapshot: Snapshot;
  private listeners = new Set<() => void>();
  constructor(private storage?: CartStorage) { this.snapshot = readGuestCart(storage); }
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private commit(references: CartReference[]) {
    let warning = '';
    try {
      if (!this.storage) throw new Error('Storage unavailable');
      this.storage.setItem(GUEST_CART_KEY, JSON.stringify({ version: 1, items: references }));
    } catch { warning = storageWarning; }
    this.snapshot = { references, warning };
    this.listeners.forEach(listener => listener());
  }
  add(product: Product, quantity = 1) {
    if (!validQuantity(quantity)) return;
    const ref = productReference(product, quantity), key = cartReferenceKey(ref);
    const previous = this.snapshot.references.find(item => cartReferenceKey(item) === key);
    if (previous && !validQuantity(previous.quantity + quantity)) return;
    this.commit(previous ? this.snapshot.references.map(item => cartReferenceKey(item) === key ? { ...item, quantity: item.quantity + quantity } : item) : [...this.snapshot.references, ref]);
  }
  setQuantity(ref: CartReference, quantity: number) {
    if (quantity !== 0 && !validQuantity(quantity)) return;
    const key = cartReferenceKey(ref);
    this.commit(this.snapshot.references.flatMap(item => cartReferenceKey(item) !== key ? [item] : quantity === 0 ? [] : [{ ...item, quantity }]));
  }
  clear = () => this.commit([]);
}
