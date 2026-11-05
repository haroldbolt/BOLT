import type { Product, ProductPresentation } from '../types';

type OperationalPresentation = ProductPresentation & {
  price?: number;
  weightKg?: number;
  stockByStore?: Record<string, number>;
  reservedStockByStore?: Record<string, number>;
  inventoryVerifiedByStore?: Record<string, boolean>;
};
export type OperationalProduct = Product & {
  parentProductId?: string;
  variantId?: string;
  inventoryVerifiedByStore?: Record<string, boolean>;
};

/**
 * Cada presentación es una unidad de venta independiente. La principal conserva
 * el objeto original para que las reservas existentes sigan escribiendo en él.
 * Las secundarias comparten sus mapas con la presentación, nunca con el padre.
 */
export function getOperationalCatalog(products: Product[]): OperationalProduct[] {
  const catalog: OperationalProduct[] = [];
  for (const source of products) {
    const primary = source as OperationalProduct;
    const presentations = source.presentaciones as OperationalPresentation[] | undefined;
    primary.parentProductId = source.id;
    if (presentations?.[0]) primary.variantId = presentations[0].varianteId;
    catalog.push(primary);
    for (const variant of presentations?.slice(1) || []) {
      // Una presentación importada sin cantidades/precio/peso queda pendiente.
      variant.stockByStore ||= {};
      variant.reservedStockByStore ||= {};
      const price = Number.isFinite(variant.price) && Number(variant.price) >= 0 ? Number(variant.price) : 0;
      const weightKg = Number.isFinite(variant.weightKg) && Number(variant.weightKg) >= 0 ? Number(variant.weightKg) : 0;
      catalog.push({
        ...source,
        id: variant.varianteId,
        parentProductId: source.id,
        variantId: variant.varianteId,
        sku: variant.sku || '',
        presentation: variant.nombre,
        price,
        weightKg,
        originalPrice: undefined,
        discountPercent: undefined,
        isLightningDeal: false,
        image: variant.foto || source.image,
        stockByStore: variant.stockByStore,
        reservedStockByStore: variant.reservedStockByStore,
        inventoryVerifiedByStore: variant.inventoryVerifiedByStore,
        bodegaIds: variant.bodegaIds || [],
      });
    }
  }
  return catalog;
}

/** Rechaza IDs de variante que no pertenecen al producto enviado. */
export function resolveCatalogProduct(products: Product[], submittedId: string, variantId?: string): OperationalProduct | undefined {
  if (typeof submittedId !== 'string' || !submittedId || (variantId !== undefined && typeof variantId !== 'string')) return undefined;
  const parent = products.find(product => product.id === submittedId);
  if (parent) {
    if (!variantId) return getOperationalCatalog([parent])[0];
    const index = parent.presentaciones?.findIndex(variant => variant.varianteId === variantId) ?? -1;
    if (index < 0) return undefined;
    return getOperationalCatalog([parent])[index];
  }
  const owner = products.find(product => product.presentaciones?.some(variant => variant.varianteId === submittedId));
  if (!owner || (variantId && variantId !== submittedId)) return undefined;
  const index = owner.presentaciones!.findIndex(variant => variant.varianteId === submittedId);
  return getOperationalCatalog([owner])[index];
}
