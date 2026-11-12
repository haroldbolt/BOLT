import type { Product } from '../types';
import {verifiedPresentationLabel} from './presentationDisplay';

export function validOriginalPrice(price: number, originalPrice?: number | null): number | undefined {
  return Number.isFinite(price) && price > 0 && typeof originalPrice === 'number' &&
    Number.isFinite(originalPrice) && originalPrice > price ? originalPrice : undefined;
}

export function presentationLabel(product: Product, id: string): string {
  const variants = product.presentaciones || [];
  const variant = variants.find(v => v.varianteId === id);
  if (!variant) return product.presentation || 'Presentación por confirmar';
  const labelFor = (option: typeof variant) => verifiedPresentationLabel(product, option) ?? option.nombre.trim();
  const rawTitle = labelFor(variant);
  const title = rawTitle || 'Presentación por confirmar';
  const duplicates = variants.filter(v => labelFor(v) === rawTitle);
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
  const price = variant.price ?? (isFirst ? product.price : 0);
  const reference = variant.originalPrice === undefined && isFirst ? product.originalPrice : variant.originalPrice;
  const originalPrice = validOriginalPrice(price, reference);
  return {
    ...product,
    id: isFirst ? product.id : variant.varianteId,
    parentProductId: product.id,
    variantId: variant.varianteId,
    sku: variant.sku || (isFirst ? product.sku : ''),
    presentation: presentationLabel(product,variant.varianteId),
    weightKg: variant.transport ? variant.transport.weightGrams / 1000 : weightKg,
    transport: variant.transport,
    image: Object.hasOwn(product.variantImages || {},variant.varianteId) ? product.variantImages![variant.varianteId] : (variant.foto || product.image),
    price,
    originalPrice,
    discountPercent: originalPrice ? Math.round((1 - price / originalPrice) * 100) : undefined,
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
