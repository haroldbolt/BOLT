import type { Product } from '../types';

/** A saved Shopify record can be browsed before all shipping data is ready. */
export function getProductPurchaseBlock(product: Product): string | null {
  if (product.source !== 'SHOPIFY') return null;
  if (product.shopifyStatus !== 'ACTIVE') return 'Producto no disponible';
  if (product.pricePending) return 'Precio por confirmar';
  if (product.inventoryPending) return 'Inventario por confirmar';
  if (product.weightVerified !== true) return 'Peso de envío por confirmar';
  if (product.compliancePending) return 'Información veterinaria por revisar';
  if (product.requiresShipping === false || product.logisticsBlocked) return 'Disponibilidad por confirmar';
  return null;
}

export function getProductSellableQuantity(product: Product, storeId: string): number {
  if (getProductPurchaseBlock(product)) return 0;
  if (product.source === 'SHOPIFY' && product.inventoryByStore?.[storeId]?.available == null) return 0;
  const available = product.stockByStore[storeId];
  if (typeof available !== 'number' || !Number.isFinite(available)) return 0;
  return Math.max(0, available - (product.reservedStockByStore[storeId] || 0));
}
