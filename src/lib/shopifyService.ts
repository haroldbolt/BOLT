/** Local, read-only Shopify snapshot state. This module performs no network or filesystem requests. */
import type { ShopifySyncState, ShopifyInventoryItemMapping } from '../types';
import type { ShopifyMappedProduct, normalizeShopifySnapshot } from './shopifyMapper';

type SnapshotInventory = ReturnType<typeof normalizeShopifySnapshot>;

export const SHOPIFY_CONFIG = {
  storeName: 'Agrocentro Pets',
  canonicalDomain: '1c76bc-08.myshopify.com',
  publicDomain: 'cultivacenter.com',
  apiVersion: '2026-10',
  readOnlyScopes: ['read_products', 'read_inventory', 'read_locations'],
  reconciliationIntervalMinutes: 0,
  locations: {
    HUB_KENNEDY: { gid: 'gid://shopify/Location/115617857816', name: 'Bolt Pets Kennedy', officialAddress: 'Carrera 79A #2-05, Bogotá, Colombia' },
    HUB_ALAMOS: { gid: 'gid://shopify/Location/115617890584', name: 'Bolt Pets Álamos', officialAddress: 'Calle 72 #97A-18, Bogotá, Colombia' },
    HUB_SUBA: { gid: 'gid://shopify/Location/115617923352', name: 'Bolt Pets Suba', officialAddress: 'Carrera 107 #143-31, Bogotá, Colombia' },
    HUB_CENTRO: { gid: 'gid://shopify/Location/115676021016', name: 'Agrocentro Pets - Centro', officialAddress: 'Calle 11 #15-53, Bogotá, Colombia' },
  },
};

export class ShopifyService {
  private syncState: ShopifySyncState = {
    status: 'SIN_CONFIGURAR',
    storeDomain: SHOPIFY_CONFIG.canonicalDomain,
    publicDomain: SHOPIFY_CONFIG.publicDomain,
    apiVersion: SHOPIFY_CONFIG.apiVersion,
    readOnlyScopes: [...SHOPIFY_CONFIG.readOnlyScopes],
    reconciliationIntervalMinutes: 0,
    activeWarehousesCount: 0,
    totalMappedSkus: 0,
    unmappedSkusCount: 0,
    discrepanciesCount: 0,
    locations: [],
    inventoryItems: [],
    automaticSync: false,
  };
  private imported = false;
  private productsById = new Map<string, ShopifyMappedProduct>();

  configureSnapshot({ products, stores, status }: SnapshotInventory): ShopifySyncState {
    if (!status.complete) throw new Error('No se puede instalar una instantánea incompleta de Shopify.');
    for (const item of this.syncState.inventoryItems) this.refreshItem(item);
    const previousReservations = new Map(this.syncState.inventoryItems.map(item => [item.shopifyVariantGid, item.quantitiesByLocation]));
    for (const product of products) {
      for (const storeId of Object.keys(product.inventoryByStore)) {
        product.reservedStockByStore[storeId] = previousReservations.get(product.shopifyVariantGid)?.[storeId]?.reservedBolt
          ?? product.reservedStockByStore[storeId] ?? 0;
      }
    }
    this.productsById = new Map(products.map(product => [product.id, product]));
    const inventoryItems: ShopifyInventoryItemMapping[] = products.map(product => ({
      productId: product.id,
      sku: product.sku,
      productName: `${product.name} · ${product.presentation}`,
      shopifyProductGid: product.shopifyProductGid,
      shopifyVariantGid: product.shopifyVariantGid,
      shopifyInventoryItemGid: product.shopifyInventoryItemGid,
      quantitiesByLocation: Object.fromEntries(Object.entries(product.inventoryByStore).map(([storeId, level]) => {
        const reservedBolt = previousReservations.get(product.shopifyVariantGid)?.[storeId]?.reservedBolt
          ?? product.reservedStockByStore[storeId] ?? 0;
        return [storeId, {
          available: level.available,
          onHand: level.onHand,
          committed: level.committed,
          reservedBolt,
          safetyStock: level.quantities.safety_stock ?? 0,
          // Shopify available already accounts for its committed/reserved inventory.
          sellable: level.available === null ? null : Math.max(0, level.available - reservedBolt),
        }];
      })),
      lastUpdated: status.fetchedAt,
    }));
    this.syncState = {
      ...status,
      mode: 'READ_ONLY_SNAPSHOT',
      status: 'SNAPSHOT_IMPORTADO',
      storeDomain: status.shop.myshopifyDomain,
      publicDomain: SHOPIFY_CONFIG.publicDomain,
      apiVersion: status.apiVersion || '',
      readOnlyScopes: [...SHOPIFY_CONFIG.readOnlyScopes],
      lastSuccessfulSync: status.fetchedAt,
      lastAttemptedSync: status.fetchedAt,
      automaticSync: false,
      reconciliationIntervalMinutes: 0,
      activeWarehousesCount: stores.filter(store => store.isActive).length,
      totalMappedSkus: products.length,
      importedProductCount: status.productsCount,
      importedVariantCount: status.variantCount,
      unmappedSkusCount: 0,
      discrepanciesCount: 0,
      locations: status.locations.map(location => ({
        ...location,
        storeId: location.storeId,
        storeName: location.name,
        shopifyLocationGid: location.id,
        shopifyLocationName: location.name,
        isActiveInBolt: location.isActive,
        lastSyncAt: status.fetchedAt,
        syncedProductsCount: products.filter(product => product.inventoryByStore[location.storeId]).length,
        discrepanciesCount: 0,
      })),
      inventoryItems,
    };
    this.imported = true;
    return this.getState();
  }

  getState(): ShopifySyncState {
    for (const item of this.syncState.inventoryItems) this.refreshItem(item);
    return structuredClone(this.syncState);
  }

  /** Observe the server's shared local inventory without changing the original Shopify quantities or read date. */
  private refreshItem(item: ShopifyInventoryItemMapping): void {
    const product = this.productsById.get(item.productId);
    if (!product) return;
    for (const [storeId, level] of Object.entries(item.quantitiesByLocation)) {
      const original = product.inventoryByStore[storeId];
      const stock = product.stockByStore[storeId];
      const available = original?.available == null || !Number.isFinite(stock) ? null : stock;
      const reservedBolt = product.reservedStockByStore[storeId] ?? 0;
      level.available = available;
      level.onHand = original?.onHand ?? null;
      level.committed = original?.committed ?? null;
      level.reservedBolt = reservedBolt;
      level.safetyStock = original?.quantities.safety_stock ?? 0;
      level.sellable = available === null ? null : Math.max(0, available - reservedBolt);
    }
  }

  /** No token is configured here: a local refresh never invents a Shopify read or new timestamp. */
  async triggerReconciliation(): Promise<ShopifySyncState> {
    return this.getState();
  }

  private findItem(productIdOrVariantGid: string): ShopifyInventoryItemMapping | undefined {
    if (!productIdOrVariantGid) return undefined;
    const item = this.syncState.inventoryItems.find(item => item.productId === productIdOrVariantGid || item.shopifyVariantGid === productIdOrVariantGid);
    if (item) this.refreshItem(item);
    return item;
  }

  getSellableStock(productIdOrVariantGid: string, storeId: string): number {
    return this.findItem(productIdOrVariantGid)?.quantitiesByLocation[storeId]?.sellable ?? 0;
  }

  /** A Bolt reservation affects this process only and never writes to Shopify. */
  reserveStockLocally(storeId: string, productIdOrVariantGid: string, quantity: number): boolean {
    if (!Number.isSafeInteger(quantity) || quantity <= 0) return false;
    const item = this.findItem(productIdOrVariantGid);
    const level = item?.quantitiesByLocation[storeId];
    if (!level || level.sellable == null || level.sellable < quantity || level.available == null) return false;
    const product = this.productsById.get(item.productId);
    if (!product) return false;
    product.reservedStockByStore[storeId] = level.reservedBolt + quantity;
    this.refreshItem(item);
    return true;
  }

  updateLocationStock(_storeId: string, _productId: string, _newOnHand: number, _committed = 0): { success: boolean; error?: string; item?: ShopifyInventoryItemMapping } {
    return {
      success: false,
      error: this.imported
        ? 'La instantánea Shopify es de solo lectura. El simulador no puede alterar las existencias importadas.'
        : 'Falta importar un inventario autorizado de Shopify.',
    };
  }
}

export const shopifyService = new ShopifyService();
