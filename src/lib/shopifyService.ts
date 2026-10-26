/**
 * BOLT PETS — SERVICIO DE INTEGRACIÓN Y SINCRONIZACIÓN CON SHOPIFY
 * Tienda Oficial: Agrocentro Pets
 * Dominio Admin API Canónico: 1c76bc-08.myshopify.com
 * Dominio Comercial Público: cultivacenter.com
 * Versión API GraphQL Soportada: 2025-01
 * Permisos Iniciales de Solo Lectura: read_products, read_inventory, read_locations
 */

import { ShopifySyncState, ShopifyLocationMapping, ShopifyInventoryItemMapping } from '../types';
import { INITIAL_PRODUCTS, INITIAL_STORES } from '../data/seedData';

export const SHOPIFY_CONFIG = {
  storeName: 'Agrocentro Pets',
  canonicalDomain: '1c76bc-08.myshopify.com',
  publicDomain: 'cultivacenter.com',
  apiVersion: '2025-01',
  readOnlyScopes: ['read_products', 'read_inventory', 'read_locations'],
  reconciliationIntervalMinutes: 10,
  locations: {
    HUB_KENNEDY: {
      gid: 'gid://shopify/Location/115617857816',
      name: 'Bolt Pets Kennedy',
      officialAddress: 'Carrera 79A #2-05, Bogotá, Colombia',
    },
    HUB_ALAMOS: {
      gid: 'gid://shopify/Location/115617890584',
      name: 'Bolt Pets Álamos',
      officialAddress: 'Calle 72 #97A-18, Bogotá, Colombia',
    },
    HUB_SUBA: {
      gid: 'gid://shopify/Location/115617923352',
      name: 'Bolt Pets Suba',
      officialAddress: 'Carrera 107 #143-31, Bogotá, Colombia',
    },
    HUB_CENTRO: {
      gid: 'gid://shopify/Location/115617999999',
      name: 'Sede Centro Histórico',
      officialAddress: 'Calle 11 #15-53, La Candelaria / Centro, Bogotá',
    },
  },
};

// Generar mapeos de inventario detallados a partir del catálogo semilla
function buildInitialInventoryMappings(): ShopifyInventoryItemMapping[] {
  return INITIAL_PRODUCTS.map((prod, index) => {
    const paddedIndex = String(index + 1).padStart(3, '0');
    const productGid = `gid://shopify/Product/98412850${paddedIndex}`;
    const variantGid = `gid://shopify/ProductVariant/49213840${paddedIndex}`;
    const inventoryItemGid = `gid://shopify/InventoryItem/51029481${paddedIndex}`;

    const quantitiesByLocation: Record<string, {
      onHand: number;
      committed: number;
      reservedBolt: number;
      safetyStock: number;
      sellable: number;
    }> = {};

    for (const store of INITIAL_STORES) {
      const onHand = prod.stockByStore[store.id] || 0;
      const reservedBolt = prod.reservedStockByStore[store.id] || 0;
      const committed = Math.min(2, Math.floor(onHand * 0.1));
      const safetyStock = store.safetyStockDefault || 2;
      const sellable = Math.max(0, onHand - committed - reservedBolt - safetyStock);

      quantitiesByLocation[store.id] = {
        onHand,
        committed,
        reservedBolt,
        safetyStock,
        sellable,
      };
    }

    return {
      sku: prod.sku,
      productName: prod.name,
      shopifyProductGid: productGid,
      shopifyVariantGid: variantGid,
      shopifyInventoryItemGid: inventoryItemGid,
      quantitiesByLocation,
      lastUpdated: new Date().toISOString(),
    };
  });
}

const initialLocations: ShopifyLocationMapping[] = [
  {
    storeId: 'HUB_KENNEDY',
    storeName: 'Bolt Pets Kennedy',
    shopifyLocationGid: 'gid://shopify/Location/115617857816',
    shopifyLocationName: 'Agrocentro Kennedy Hub',
    isActiveInBolt: true,
    lastSyncAt: new Date(Date.now() - 4 * 60 * 1000).toISOString(),
    syncedProductsCount: INITIAL_PRODUCTS.length,
    discrepanciesCount: 0,
  },
  {
    storeId: 'HUB_ALAMOS',
    storeName: 'Bolt Pets Álamos',
    shopifyLocationGid: 'gid://shopify/Location/115617890584',
    shopifyLocationName: 'Agrocentro Álamos Hub',
    isActiveInBolt: true,
    lastSyncAt: new Date(Date.now() - 4 * 60 * 1000).toISOString(),
    syncedProductsCount: INITIAL_PRODUCTS.length,
    discrepanciesCount: 0,
  },
  {
    storeId: 'HUB_SUBA',
    storeName: 'Bolt Pets Suba',
    shopifyLocationGid: 'gid://shopify/Location/115617923352',
    shopifyLocationName: 'Agrocentro Suba Hub',
    isActiveInBolt: true,
    lastSyncAt: new Date(Date.now() - 4 * 60 * 1000).toISOString(),
    syncedProductsCount: INITIAL_PRODUCTS.length,
    discrepanciesCount: 0,
  },
  {
    storeId: 'HUB_CENTRO',
    storeName: 'Sede Centro Histórico',
    shopifyLocationGid: 'gid://shopify/Location/115617999999',
    shopifyLocationName: 'Agrocentro Centro Bogotá',
    isActiveInBolt: false, // Fuera de la red Turbo de Bolt Pets
    lastSyncAt: new Date(Date.now() - 15 * 60 * 1000).toISOString(),
    syncedProductsCount: INITIAL_PRODUCTS.length,
    discrepanciesCount: 0,
  },
];

let syncState: ShopifySyncState = {
  status: 'PENDIENTE_AUTORIZACION',
  storeDomain: SHOPIFY_CONFIG.canonicalDomain,
  publicDomain: SHOPIFY_CONFIG.publicDomain,
  apiVersion: SHOPIFY_CONFIG.apiVersion,
  readOnlyScopes: SHOPIFY_CONFIG.readOnlyScopes,
  lastSuccessfulSync: new Date(Date.now() - 4 * 60 * 1000).toISOString(),
  lastAttemptedSync: new Date(Date.now() - 4 * 60 * 1000).toISOString(),
  reconciliationIntervalMinutes: SHOPIFY_CONFIG.reconciliationIntervalMinutes,
  activeWarehousesCount: 3,
  totalMappedSkus: INITIAL_PRODUCTS.length,
  unmappedSkusCount: 0,
  discrepanciesCount: 0,
  locations: initialLocations,
  inventoryItems: buildInitialInventoryMappings(),
};

class ShopifyService {
  getState(): ShopifySyncState {
    return { ...syncState };
  }

  async triggerReconciliation(): Promise<ShopifySyncState> {
    syncState.status = 'SINCRONIZANDO';
    syncState.lastAttemptedSync = new Date().toISOString();

    // Simular consulta segura GraphQL Admin API de Shopify (read_inventory)
    await new Promise(r => setTimeout(r, 600));

    const now = new Date().toISOString();
    syncState.lastSuccessfulSync = now;
    syncState.status = 'CONECTADO';

    // Actualizar timestamps de las sedes
    syncState.locations = syncState.locations.map(loc => ({
      ...loc,
      lastSyncAt: now,
    }));

    return { ...syncState };
  }

  /**
   * Obtiene las existencias vendibles para un producto y sede específicos.
   * Regla de negocio:
   * Stock vendible = max(0, onHand - committed - reservedBolt - safetyStock)
   */
  getSellableStock(sku: string, storeId: string): number {
    const item = syncState.inventoryItems.find(i => i.sku === sku);
    if (!item || !item.quantitiesByLocation[storeId]) return 0;
    return item.quantitiesByLocation[storeId].sellable;
  }

  /**
   * Aplica una reserva local atómica para un pedido confirmado en Bolt Pets
   * sin modificar inventario en Shopify (modo seguro de solo lectura).
   */
  reserveStockLocally(storeId: string, sku: string, quantity: number): boolean {
    const item = syncState.inventoryItems.find(i => i.sku === sku);
    if (!item || !item.quantitiesByLocation[storeId]) return false;

    const locData = item.quantitiesByLocation[storeId];
    if (locData.sellable < quantity) return false;

    locData.reservedBolt += quantity;
    locData.sellable = Math.max(0, locData.onHand - locData.committed - locData.reservedBolt - locData.safetyStock);
    item.lastUpdated = new Date().toISOString();
    return true;
  }

  /**
   * Actualiza el inventario físico (onHand) y comprometido para una sede y SKU específicos.
   * Utilizado para procesar webhooks de inventario o simulaciones operativas.
   */
  updateLocationStock(
    storeId: string,
    sku: string,
    newOnHand: number,
    committed: number = 0
  ): { success: boolean; error?: string; item?: ShopifyInventoryItemMapping } {
    const item = syncState.inventoryItems.find(i => i.sku === sku);
    if (!item) return { success: false, error: `SKU ${sku} no encontrado en mapeo de Shopify` };

    if (!item.quantitiesByLocation[storeId]) {
      item.quantitiesByLocation[storeId] = {
        onHand: newOnHand,
        committed,
        reservedBolt: 0,
        safetyStock: 2,
        sellable: Math.max(0, newOnHand - committed - 2),
      };
    } else {
      const loc = item.quantitiesByLocation[storeId];
      loc.onHand = newOnHand;
      loc.committed = committed;
      loc.sellable = Math.max(0, loc.onHand - loc.committed - loc.reservedBolt - loc.safetyStock);
    }

    item.lastUpdated = new Date().toISOString();
    syncState.lastSuccessfulSync = item.lastUpdated;
    return { success: true, item };
  }
}

export const shopifyService = new ShopifyService();
