import type { Product, Store, MainCategory, Species, PharmacySubcategory } from '../types';

/** Read-only input contract. No Shopify requests or writes occur in this module. */
export interface ShopifySnapshot {
  shop: { name: string; myshopifyDomain: string; currencyCode: string };
  locations: ShopifySnapshotLocation[];
  variants: ShopifySnapshotVariant[];
  fetchedAt: string;
  complete: boolean;
  source?: string;
  apiVersion?: string;
  mediaComplete?: boolean;
  galleryLimitNotice?: string;
}

export interface ShopifySnapshotLocation {
  id: string;
  name: string;
  isActive: boolean;
  fulfillsOnlineOrders?: boolean;
  address?: {
    address1?: string | null; address2?: string | null; city?: string | null;
    country?: string | null; latitude?: number | null; longitude?: number | null;
  } | null;
}

export interface ShopifySnapshotMedia {
  nodes?: { image?: { url?: string | null; altText?: string | null } | null }[];
  pageInfo?: { hasNextPage?: boolean };
}

export interface ShopifySnapshotVariant {
  id: string;
  title: string;
  sku?: string | null;
  price?: string | number | null;
  compareAtPrice?: string | number | null;
  selectedOptions?: { name: string; value: string }[];
  media?: ShopifySnapshotMedia | null;
  product: {
    id: string; title: string; handle: string; status: string; vendor?: string;
    productType?: string; tags?: string[]; description?: string;
    media?: ShopifySnapshotMedia | null;
  };
  inventoryItem?: {
    id: string;
    tracked?: boolean;
    requiresShipping?: boolean;
    measurement?: { weight?: { value?: number | null; unit?: string | null } | null } | null;
    inventoryLevels?: {
      nodes?: { location: { id: string }; quantities?: { name: string; quantity: number }[] }[];
      pageInfo?: { hasNextPage?: boolean };
    } | null;
  } | null;
}

export interface ShopifyInventoryByStore {
  locationGid: string;
  available: number | null;
  onHand: number | null;
  committed: number | null;
  quantities: Record<string, number>;
}

export type ShopifyMappedProduct = Product & {
  source: 'SHOPIFY';
  shopifyProductGid: string;
  shopifyVariantGid: string;
  shopifyInventoryItemGid: string | null;
  inventoryItemGid: string | null;
  shopifyHandle: string;
  shopifyStatus: string;
  status: string;
  sizeTitle: string;
  selectedOptions: { name: string; value: string }[];
  shippingWeightKg: number | null;
  weightVerified: boolean;
  weightSource: 'SHOPIFY_INVENTORY_MEASUREMENT' | 'UNKNOWN';
  pricePending: boolean;
  inventoryPending: boolean;
  requiresShipping: boolean | null;
  requiresPrescriptionKnown: boolean;
  prescriptionDataStatus: 'PENDING_REVIEW' | 'NOT_APPLICABLE';
  compliancePending: boolean;
  logisticsBlocked: boolean;
  qualityIssues: string[];
  inventoryByStore: Record<string, ShopifyInventoryByStore>;
  ratingVerified: false;
  shopifyUpdatedAt?: string;
};

export type ShopifyMappedStore = Store & {
  source: 'SHOPIFY';
  coordinatesSource: 'SHOPIFY_ADDRESS';
  hasCoordinates: true;
  fulfillsOnlineOrders: boolean | null;
};

const KNOWN_LOCATIONS: Record<string, string> = {
  '115617857816': 'HUB_KENNEDY',
  '115617890584': 'HUB_ALAMOS',
  '115617923352': 'HUB_SUBA',
  '115676021016': 'HUB_CENTRO',
};
const TURBO_STORES = new Set(['HUB_KENNEDY', 'HUB_ALAMOS', 'HUB_SUBA']);

function numericGid(id: string, entity: string): string {
  const match = new RegExp('^gid://shopify/' + entity + '/([0-9]+)$').exec(String(id || ''));
  if (!match) throw new Error('Identificador Shopify inválido para ' + entity + '.');
  return match[1];
}

function storeId(id: string): string {
  const number = numericGid(id, 'Location');
  return KNOWN_LOCATIONS[number] || 'SHOPIFY_LOCATION_' + number;
}

function coordinates(location: ShopifySnapshotLocation): { lat: number; lng: number } | null {
  const lat = location.address?.latitude, lng = location.address?.longitude;
  if (typeof lat !== 'number' || typeof lng !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

function clean(value: unknown): string {
  return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function categoryFor(product: ShopifySnapshotVariant['product']): { category: MainCategory; pharmacySubcategory?: PharmacySubcategory; species: Species } {
  const values = [product.productType || '', ...(product.tags || [])].map(clean);
  const labels = values.join(' ');
  const has = (needle: string) => labels.includes(needle);
  const dogs = has('perro') || has('canino'), cats = has('gato') || has('felino');
  const species: Species = dogs && cats ? 'Ambos' : dogs ? 'Perro' : cats ? 'Gato' : 'Otros';
  if (has('farmacia') || has('medicamento') || has('antiparasit') || has('suplement') || has('dermatolog') || has('veterinari')) {
    const pharmacySubcategory: PharmacySubcategory = has('antipulga') || has('garrapata') ? 'Antipulgas y garrapatas'
      : has('desparasit') || has('antiparasit') ? 'Desparasitación'
        : has('dermatolog') ? 'Dermatología'
          : has('vitamina') || has('suplement') ? 'Vitaminas y suplementos'
            : 'Medicamentos veterinarios';
    return { category: 'Farmacia', pharmacySubcategory, species };
  }
  if (has('arena')) return { category: 'Arenas', species };
  if (has('snack') || has('premio') || has('golosina')) return { category: 'Snacks', species };
  if (has('higiene') || has('shampoo') || has('toallita') || has('limpieza')) return { category: 'Higiene', species };
  if (has('accesorio') || has('juguete') || has('collar') || has('arnes') || has('correa') || has('cama')) return { category: 'Accesorios', species };
  if (has('alimento') || has('comida') || has('concentrado')) return { category: 'Alimentos', species };
  return { category: 'Todo', species };
}

function imageUrls(media?: ShopifySnapshotMedia | null): string[] {
  return (media?.nodes || []).flatMap(node => {
    const url = node.image?.url;
    if (!url) return [];
    try { return new URL(url).protocol === 'https:' ? [url] : []; }
    catch { return []; }
  });
}

function amount(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

/** Physical shipping weight only. Presentation text and pet weight ranges are never parsed. */
export function shopifyShippingWeightKg(variant: ShopifySnapshotVariant): number | null {
  const measurement = variant.inventoryItem?.measurement?.weight;
  const value = measurement?.value;
  const scale: Record<string, number> = { KILOGRAMS: 1, GRAMS: 0.001, POUNDS: 0.45359237, OUNCES: 0.028349523125 };
  const multiplier = scale[String(measurement?.unit || '').toUpperCase()];
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || !multiplier) return null;
  return Number((value * multiplier).toFixed(9));
}

export function normalizeShopifySnapshot(snapshot: ShopifySnapshot) {
  if (!snapshot || !Array.isArray(snapshot.locations) || !Array.isArray(snapshot.variants)) throw new Error('La instantánea Shopify no contiene ubicaciones y variantes válidas.');
  if (!snapshot.fetchedAt || !Number.isFinite(Date.parse(snapshot.fetchedAt))) throw new Error('La instantánea Shopify necesita una fecha de lectura válida.');
  const seenLocations = new Set<string>();
  const locationStatus = snapshot.locations.map(location => {
    if (seenLocations.has(location.id)) throw new Error('La instantánea repite una ubicación Shopify.');
    seenLocations.add(location.id);
    const id = storeId(location.id), coords = coordinates(location);
    const postalAddress = [location.address?.address1, location.address?.address2, location.address?.city, location.address?.country].filter(Boolean).join(', ');
    return {
      id: location.id, storeId: id, name: location.name, isActive: !!location.isActive,
      fulfillsOnlineOrders: typeof location.fulfillsOnlineOrders === 'boolean' ? location.fulfillsOnlineOrders : null,
      hasCoordinates: !!coords, coordinates: coords, address: postalAddress,
      turboEnabled: !!coords && !!location.isActive && location.fulfillsOnlineOrders !== false && TURBO_STORES.has(id),
    };
  });
  // Locations without coordinates remain visible in status; they are not dispatch candidates.
  const stores: ShopifyMappedStore[] = locationStatus.flatMap((location): ShopifyMappedStore[] => {
    if (!location.coordinates) return [];
    const coords = { ...location.coordinates };
    return [{
      id: location.storeId, name: location.name, address: location.address, postalAddress: location.address,
      coordinates: coords, shopifyCoordinates: { ...coords }, verificationStatus: 'UNVERIFIED',
      shopifyLocationGid: location.id, turboEnabled: location.turboEnabled, isActive: location.isActive,
      schedule: 'Horario pendiente de confirmar', maxDeliveryRadiusKm: 6, vehicleMaxWeightKg: 25,
      safetyStockDefault: 0, source: 'SHOPIFY', coordinatesSource: 'SHOPIFY_ADDRESS', hasCoordinates: true,
      fulfillsOnlineOrders: location.fulfillsOnlineOrders,
    }];
  });
  const seenVariants = new Set<string>();
  const products: ShopifyMappedProduct[] = snapshot.variants.map((variant): ShopifyMappedProduct => {
    const variantNumber = numericGid(variant.id, 'ProductVariant');
    numericGid(variant.product.id, 'Product');
    if (seenVariants.has(variant.id)) throw new Error('La instantánea repite una variante Shopify.');
    seenVariants.add(variant.id);
    const product = variant.product, tags = (product.tags || []).map(String);
    const normalizedTags = tags.map(clean);
    const classification = categoryFor(product);
    const priceValue = amount(variant.price), price = priceValue ?? 0;
    const compareAt = amount(variant.compareAtPrice);
    const pricePending = priceValue === null || price <= 1 || normalizedTags.includes('precio-pendiente');
    const shippingWeightKg = shopifyShippingWeightKg(variant);
    const weightVerified = shippingWeightKg !== null;
    const gallery = [...new Set([...imageUrls(variant.media), ...imageUrls(product.media)])];
    const selectedOptions = (variant.selectedOptions || []).map(option => ({ name: String(option.name), value: String(option.value) }));
    const optionsTitle = selectedOptions.filter(option => clean(option.name) !== 'title' && clean(option.value) !== 'default title').map(option => option.value).join(' / ');
    const sizeTitle = clean(variant.title) === 'default title' ? optionsTitle : String(variant.title || optionsTitle);
    const presentation = sizeTitle || optionsTitle || 'Presentación no especificada';
    const inventoryByStore: Record<string, ShopifyInventoryByStore> = {};
    const stockByStore: Record<string, number> = {}, reservedStockByStore: Record<string, number> = {};
    for (const location of locationStatus) {
      stockByStore[location.storeId] = 0;
      reservedStockByStore[location.storeId] = 0;
    }
    let quantityMissing = false;
    for (const level of variant.inventoryItem?.inventoryLevels?.nodes || []) {
      const id = storeId(level.location.id);
      const quantities: Record<string, number> = {};
      for (const q of level.quantities || []) if (typeof q.quantity === 'number' && Number.isFinite(q.quantity)) quantities[q.name] = q.quantity;
      const available = quantities.available ?? null;
      if (available === null) quantityMissing = true;
      inventoryByStore[id] = { locationGid: level.location.id, available, onHand: quantities.on_hand ?? null, committed: quantities.committed ?? null, quantities };
      stockByStore[id] = available ?? 0;
      reservedStockByStore[id] = 0;
    }
    const inventoryPending = normalizedTags.includes('inventario-pendiente') || !variant.inventoryItem?.tracked || quantityMissing
      || !(variant.inventoryItem?.inventoryLevels?.nodes?.length);
    const requiresShipping = typeof variant.inventoryItem?.requiresShipping === 'boolean' ? variant.inventoryItem.requiresShipping : null;
    const compliancePending = classification.category === 'Farmacia';
    const qualityIssues = [
      ...(!weightVerified ? ['MISSING_SHIPPING_WEIGHT'] : []),
      ...(pricePending ? ['PENDING_PRICE'] : []),
      ...(inventoryPending ? ['PENDING_INVENTORY'] : []),
      ...(compliancePending ? ['PHARMACY_DATA_REVIEW'] : []),
      ...(requiresShipping === false ? ['NON_SHIPPING_VARIANT'] : []),
      ...(!gallery.length ? ['MISSING_IMAGE'] : []),
    ];
    const originalPrice = !pricePending && compareAt !== null && compareAt > price ? compareAt : undefined;
    return {
      id: 'shopify-' + variantNumber, sku: variant.sku || '', name: product.title, brand: product.vendor || '',
      ...classification, requiresPrescription: false, requiresPrescriptionKnown: !compliancePending,
      prescriptionDataStatus: compliancePending ? 'PENDING_REVIEW' : 'NOT_APPLICABLE', compliancePending,
      storageCondition: 'TEMPERATURA_AMBIENTE', temperatureColdChain: false,
      price, originalPrice, discountPercent: originalPrice ? Math.round((1 - price / originalPrice) * 100) : undefined,
      presentation, sizeTitle: sizeTitle || presentation, selectedOptions, weightKg: shippingWeightKg ?? 0, shippingWeightKg, weightVerified,
      weightSource: weightVerified ? 'SHOPIFY_INVENTORY_MEASUREMENT' : 'UNKNOWN', unitPriceText: undefined,
      image: gallery[0] || '', gallery, description: product.description || '',
      stockByStore, reservedStockByStore, inventoryByStore, rating: 0, reviewsCount: 0, ratingVerified: false,
      tags, source: 'SHOPIFY', shopifyProductGid: product.id, shopifyVariantGid: variant.id,
      shopifyInventoryItemGid: variant.inventoryItem?.id || null, inventoryItemGid: variant.inventoryItem?.id || null,
      shopifyHandle: product.handle, shopifyStatus: product.status, status: product.status,
      pricePending, inventoryPending, requiresShipping,
      logisticsBlocked: !weightVerified || pricePending || inventoryPending || compliancePending || requiresShipping === false,
      qualityIssues,
    };
  });
  const parents = new Set(products.map(product => product.shopifyProductGid));
  const activeParents = new Set(products.filter(product => product.shopifyStatus === 'ACTIVE').map(product => product.shopifyProductGid));
  const complete = snapshot.complete === true && !snapshot.variants.some(variant => variant.inventoryItem?.inventoryLevels?.pageInfo?.hasNextPage);
  const status = {
    mode: 'READ_ONLY_SNAPSHOT' as const, source: 'SHOPIFY' as const,
    shop: { ...snapshot.shop }, fetchedAt: snapshot.fetchedAt, complete, automaticSync: false,
    apiVersion: snapshot.apiVersion || '',
    productCount: parents.size, productsCount: parents.size, activeProductsCount: activeParents.size,
    variantCount: products.length, locationsCount: locationStatus.length, locations: locationStatus,
    missingWeights: products.filter(product => !product.weightVerified).length,
    missingImages: products.filter(product => !product.image).length,
    pendingPrices: products.filter(product => product.pricePending).length,
    pendingInventory: products.filter(product => product.inventoryPending).length,
    pendingPharmacyReview: products.filter(product => product.compliancePending).length,
    activeVariantsCount: products.filter(product => product.shopifyStatus === 'ACTIVE').length,
  };
  return { products, stores, status };
}
