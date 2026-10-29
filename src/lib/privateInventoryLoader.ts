import fs from 'fs';
import path from 'path';
import { Product } from '../types';

export interface PrivateInventoryResult {
  fileFound: boolean;
  filePath: string;
  message: string;
  products?: Product[];
}

const LOCATION_GID_TO_STORE_ID: Record<string, string> = {
  'gid://shopify/Location/115617857816': 'HUB_KENNEDY',
  'gid://shopify/Location/115617890584': 'HUB_ALAMOS',
  'gid://shopify/Location/115617923352': 'HUB_SUBA',
  'gid://shopify/Location/115676021016': 'HUB_CENTRO',
  'gid://shopify/Location/115617999999': 'HUB_CENTRO',
};

function parseWeightKg(variantTitle: string, measurementWeight?: { value: number; unit: string }): number {
  if (measurementWeight && measurementWeight.value > 0) {
    if (measurementWeight.unit === 'KILOGRAMS') return measurementWeight.value;
    if (measurementWeight.unit === 'GRAMS') return measurementWeight.value / 1000;
  }

  // Parse from title like "15 kg", "7.5 kg", "3 KG", "2 kg"
  const match = variantTitle.match(/([0-9]+(?:[\.,][0-9]+)?)\s*(?:kg|kilos?|g|gramos?)/i);
  if (match) {
    const val = parseFloat(match[1].replace(',', '.'));
    if (variantTitle.toLowerCase().includes('g') && !variantTitle.toLowerCase().includes('kg')) {
      return val / 1000;
    }
    return val;
  }
  return 1.0;
}

export function loadPrivateInventorySnapshot(): PrivateInventoryResult {
  const relativePath = '.bolt-private/shopify/snapshot.json';
  const fullPath = path.join(process.cwd(), relativePath);

  if (!fs.existsSync(fullPath)) {
    return {
      fileFound: false,
      filePath: relativePath,
      message: 'El archivo .bolt-private/shopify/snapshot.json no se encuentra en el repositorio. Se conserva el catálogo base autorizado sin publicar inventario privado ni sustituir productos reales por ejemplos.',
    };
  }

  try {
    const rawData = fs.readFileSync(fullPath, 'utf-8');
    const parsed = JSON.parse(rawData);

    if (!parsed || !Array.isArray(parsed.variants)) {
      return {
        fileFound: true,
        filePath: relativePath,
        message: 'Archivo .bolt-private/shopify/snapshot.json encontrado pero con estructura no válida (falta arreglo variants).',
      };
    }

    const products: Product[] = [];

    for (const v of parsed.variants) {
      const productObj = v.product || {};
      const inventoryItem = v.inventoryItem || {};
      const levels = inventoryItem.inventoryLevels?.nodes || [];

      // Existencias independientes por bodega
      const stockByStore: Record<string, number> = {
        HUB_KENNEDY: 0,
        HUB_ALAMOS: 0,
        HUB_SUBA: 0,
        HUB_CENTRO: 0,
      };
      const reservedStockByStore: Record<string, number> = {
        HUB_KENNEDY: 0,
        HUB_ALAMOS: 0,
        HUB_SUBA: 0,
        HUB_CENTRO: 0,
      };

      for (const level of levels) {
        const storeId = LOCATION_GID_TO_STORE_ID[level.location?.id];
        if (storeId) {
          const onHandQty = level.quantities?.find((q: any) => q.name === 'on_hand' || q.name === 'available')?.quantity || 0;
          stockByStore[storeId] = Math.max(0, onHandQty);
        }
      }

      const weightKg = parseWeightKg(v.title || '', inventoryItem.measurement?.weight);
      const priceNum = Math.round(parseFloat(v.price || '0'));
      const originalPriceNum = v.compareAtPrice ? Math.round(parseFloat(v.compareAtPrice)) : undefined;

      const imageUrl =
        v.media?.nodes?.[0]?.image?.url ||
        productObj.media?.nodes?.[0]?.image?.url ||
        'https://images.unsplash.com/photo-1589924691995-400dc9ecc119?w=800';

      const requiresPrescription = (productObj.tags || []).some(
        (t: string) => t.toLowerCase().includes('receta') || t.toLowerCase().includes('prescrip') || t.toLowerCase().includes('farmacia')
      );

      const species = (productObj.tags || []).some((t: string) => t.toLowerCase().includes('gato'))
        ? 'Gato'
        : (productObj.tags || []).some((t: string) => t.toLowerCase().includes('perro'))
        ? 'Perro'
        : 'Ambos';

      const isPharmacy = (productObj.productType || '').toLowerCase().includes('farmacia') ||
        (productObj.tags || []).some((t: string) => t.toLowerCase().includes('farmacia'));

      const cleanId = String(v.id || '').replace('gid://shopify/ProductVariant/', 'var-') || `prod-${products.length + 1}`;

      products.push({
        id: cleanId,
        sku: v.sku || `SKU-${cleanId}`,
        name: productObj.title || 'Producto Bolt Pets',
        brand: productObj.vendor || 'Bolt Pets',
        species,
        category: isPharmacy ? 'Farmacia' : 'Alimentos',
        pharmacySubcategory: isPharmacy ? 'Medicamentos veterinarios' : undefined,
        requiresPrescription,
        storageCondition: 'LUGAR_FRESCO_Y_SECO',
        temperatureColdChain: false,
        price: priceNum,
        originalPrice: originalPriceNum,
        discountPercent: originalPriceNum && originalPriceNum > priceNum ? Math.round(((originalPriceNum - priceNum) / originalPriceNum) * 100) : undefined,
        presentation: v.title || `${weightKg} kg`,
        weightKg,
        unitPriceText: weightKg > 0 ? `$${Math.round(priceNum / weightKg).toLocaleString('es-CO')}/Kg` : undefined,
        image: imageUrl,
        description: productObj.description || '',
        stockByStore,
        reservedStockByStore,
        tags: productObj.tags || [],
        rating: 4.8,
        reviewsCount: 12,
      });
    }

    return {
      fileFound: true,
      filePath: relativePath,
      message: `Inventario privado cargado exitosamente: ${products.length} productos y variantes importados con existencias independientes por bodega.`,
      products,
    };
  } catch (err: any) {
    return {
      fileFound: true,
      filePath: relativePath,
      message: `Error al leer o analizar .bolt-private/shopify/snapshot.json: ${err.message}`,
    };
  }
}
