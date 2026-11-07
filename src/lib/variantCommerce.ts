import type { Product } from '../types';

export function presentationLabel(product: Product, id: string): string {
  const variants = product.presentaciones || [];
  const variant = variants.find(v => v.varianteId === id);
  if (!variant) return product.presentation || 'Presentación por confirmar';
  const title = variant.nombre.trim() || 'Presentación por confirmar';
  const duplicates = variants.filter(v => v.nombre.trim() === variant.nombre.trim());
  if (duplicates.length < 2) return title;
  const uniqueSku = variant.sku && duplicates.filter(v => v.sku === variant.sku).length === 1;
  return `${title} · ${uniqueSku ? `SKU ${variant.sku}` : `Ref. ${id.split('/').pop()}`}`;
}

// Keep the original product ID for the default presentation and historical orders.
export function saleVariant(product: Product, variantId?: string): Product {
  const variants = product.presentaciones || [];
  const variant = variants.find(v => v.varianteId === variantId) || variants[0];
  if (!variant) return product;
  const isFirst = variant === variants[0];
  const exactWeight = variant.nombre.trim().match(/^(\d+(?:[.,]\d+)?)\s*(kg|g)$/i);
  const weightKg = exactWeight ? Number(exactWeight[1].replace(',','.')) / (exactWeight[2].toLowerCase()==='g'?1000:1) : product.weightKg;
  return {
    ...product,
    id: isFirst ? product.id : variant.varianteId,
    parentProductId: product.id,
    variantId: variant.varianteId,
    sku: variant.sku || (isFirst ? product.sku : ''),
    presentation: presentationLabel(product,variant.varianteId),
    weightKg: variant.transport ? variant.transport.weightGrams / 1000 : weightKg,
    transport: variant.transport,
    image: variant.foto || product.image,
    price: variant.price ?? (isFirst ? product.price : 0),
    originalPrice: isFirst ? product.originalPrice : undefined,
    discountPercent: isFirst && product.originalPrice && product.originalPrice>(variant.price ?? product.price) ? Math.round((1-(variant.price ?? product.price)/product.originalPrice)*100) : undefined,
    unitPriceText: isFirst && variant.price===undefined ? product.unitPriceText : undefined,
    stockByStore: variant.stockByStore ?? (isFirst ? product.stockByStore : {}),
    reservedStockByStore: variant.reservedStockByStore ?? (isFirst ? product.reservedStockByStore : {}),
    bodegaIds: variant.bodegaIds,
    commerceRevision: variant.commerceRevision,
  };
}

export function salesCatalog(products: Product[]): Product[] {
  return products.flatMap(p => p.presentaciones?.length ? p.presentaciones.map(v => saleVariant(p, v.varianteId)) : [p]);
}
