import type { CartItem, Product } from '../types';

/** Catalog visibility is stock only; purchase quality guards remain separate. */
export function getCatalogAvailableQuantity(product: Product, storeId: string): number {
  const level = product.inventoryByStore?.[storeId];
  if (level?.available == null || !Number.isFinite(level.available)) return 0;
  const available = product.stockByStore[storeId];
  const reserved = product.reservedStockByStore[storeId] ?? 0;
  if (!Number.isFinite(available) || !Number.isFinite(reserved) || reserved < 0) return 0;
  return Math.max(0, Math.floor(available - reserved));
}

export function isCustomerCatalogProductVisible(product: Product, storeId: string): boolean {
  return (product.shopifyStatus || product.status) === 'ACTIVE'
    && getCatalogAvailableQuantity(product, storeId) > 0;
}

export function filterCustomerCatalog(products: Product[], storeId: string | null): Product[] {
  return storeId ? products.filter(product => isCustomerCatalogProductVisible(product, storeId)) : [];
}

export function reconcileCartForCatalog(cart: CartItem[], catalog: Product[], storeId: string | null): {
  items: CartItem[]; notices: string[]; changed: boolean;
} {
  if (!storeId) return { items: cart, notices: [], changed: false };
  const byId = new Map(catalog.map(product => [product.id, product]));
  const notices: string[] = [];
  let changed = false;
  const items = cart.flatMap(item => {
    const product = byId.get(item.product.id);
    if (!product || !isCustomerCatalogProductVisible(product, storeId)) {
      notices.push(`${item.product.name}: lo retiramos porque ya no está disponible para tu dirección.`);
      changed = true;
      return [];
    }
    const quantity = Math.min(item.quantity, getCatalogAvailableQuantity(product, storeId));
    if (quantity !== item.quantity) notices.push(`${product.name}: ajustamos la cantidad a ${quantity} por disponibilidad.`);
    if (quantity !== item.quantity || product !== item.product) changed = true;
    return [{ product, quantity }];
  });
  return { items: changed ? items : cart, notices, changed };
}
