import fs from 'fs';
import path from 'path';
import { Product, Store, MainCategory, Species, PharmacySubcategory, ProductPresentation } from '../types';
import { INITIAL_STORES, INITIAL_PRODUCTS } from '../data/seedData';

export interface LocalCatalogSummary {
  totalProductosAgrupados: number;
  totalVariantes: number;
  totalBodegas: number;
  productosActivos: number;
  bodegas: Array<{
    id: string;
    boltId: string;
    name: string;
    isActive: boolean;
  }>;
}

export interface RawLocalVariant {
  varianteId: string;
  nombre: string;
  sku: string;
  foto: string;
  bodegaIds: string[];
}

export interface RawLocalProduct {
  productoId: string;
  nombre: string;
  handle: string;
  status: string;
  vendor: string;
  productType: string;
  tags: string[];
  descripcion: string;
  foto: string;
  bodegaIds: string[];
  presentaciones: RawLocalVariant[];
}

export interface RawLocalBodega {
  id: string;
  boltId: string;
  name: string;
  isActive: boolean;
  fulfillsOnlineOrders: boolean;
  address: any;
}

class LocalCatalogService {
  private rawProducts: RawLocalProduct[] = [];
  private rawBodegas: RawLocalBodega[] = [];
  private summary: LocalCatalogSummary | null = null;
  private productsCache: Product[] = [];
  private storesCache: Store[] = [];
  private isLoaded: boolean = false;

  constructor() {
    this.loadCatalog();
  }

  public loadCatalog(): void {
    const basePath = path.join(process.cwd(), 'src', 'data', 'catalogo-local');
    const productosPath = path.join(basePath, 'productos.json');
    const bodegasPath = path.join(basePath, 'bodegas.json');
    const resumenPath = path.join(basePath, 'resumen.json');

    if (!fs.existsSync(productosPath) || !fs.existsSync(bodegasPath)) {
      console.warn('[Catálogo Local] Archivos de catálogo local no encontrados en:', basePath);
      return;
    }

    try {
      this.rawProducts = JSON.parse(fs.readFileSync(productosPath, 'utf8'));
      this.rawBodegas = JSON.parse(fs.readFileSync(bodegasPath, 'utf8'));
      if (fs.existsSync(resumenPath)) {
        this.summary = JSON.parse(fs.readFileSync(resumenPath, 'utf8'));
      }

      this.buildStoresCache();
      this.buildProductsCache();
      this.isLoaded = true;

      console.log(
        `[Catálogo Local] Cargado exitosamente: ${this.rawProducts.length} productos agrupados, ` +
        `${this.getTotalVariantsCount()} variantes y ${this.storesCache.length} ubicaciones.`
      );
    } catch (e: any) {
      console.error('[Catálogo Local] Error al cargar catálogo local:', e.message);
    }
  }

  private buildStoresCache(): void {
    // Mantener las coordenadas, direcciones y reglas existentes al asociar las bodegas por ID
    this.storesCache = INITIAL_STORES.map(baseStore => {
      const match = this.rawBodegas.find(
        b => b.boltId === baseStore.id || b.id === baseStore.shopifyLocationGid
      );

      return {
        ...baseStore,
        // Conservar deshabilitada la ubicación inactiva
        isActive: baseStore.isActive && (match ? match.isActive : true),
        shopifyLocationGid: match ? match.id : baseStore.shopifyLocationGid,
        name: match ? (baseStore.id === 'HUB_FONTIBON' ? 'Carrera 73a #2-27 (Inactiva)' : baseStore.name) : baseStore.name,
      };
    });
  }

  private buildProductsCache(): void {
    // 1. Productos operacionales semilla con inventario real, precios verificados en COP y fichas técnicas
    const storeGids = [
      'HUB_KENNEDY',
      'HUB_ALAMOS',
      'HUB_SUBA',
      'HUB_CENTRO',
      'gid://shopify/Location/115617857816',
      'gid://shopify/Location/115617890584',
      'gid://shopify/Location/115617923352',
      'gid://shopify/Location/115676021016',
    ];

    const operationalProducts: Product[] = INITIAL_PRODUCTS.map(op => ({
      ...op,
      status: op.status || 'ACTIVE',
      bodegaIds: op.bodegaIds && op.bodegaIds.length > 0 ? op.bodegaIds : storeGids,
      presentaciones: op.presentaciones && op.presentaciones.length > 0 ? op.presentaciones : [
        {
          varianteId: `var-${op.id}`,
          nombre: op.presentation || 'Unidad estándar',
          sku: op.sku,
          foto: op.image,
          bodegaIds: storeGids,
        },
      ],
    }));

    // 2. Mapeo de los productos del catálogo local estructurado (3.830 agrupados)
    const rawCatalogProducts: Product[] = this.rawProducts.map(p => {
      const tags = p.tags || [];
      const tagsLower = tags.map(t => t.toLowerCase());
      const typeLower = (p.productType || '').toLowerCase();

      // Categoría
      let category: MainCategory = 'Alimentos';
      let pharmacySubcategory: PharmacySubcategory | undefined = undefined;

      const isPharmacy =
        typeLower.includes('farmacia') ||
        tagsLower.some(t => t.includes('farmacia') || t.includes('medicamento') || t.includes('antipulgas') || t.includes('salud'));

      if (isPharmacy) {
        category = 'Farmacia';
        if (tagsLower.some(t => t.includes('antipulgas') || t.includes('garrapata'))) {
          pharmacySubcategory = 'Antipulgas y garrapatas';
        } else if (tagsLower.some(t => t.includes('desparasit'))) {
          pharmacySubcategory = 'Desparasitación';
        } else if (tagsLower.some(t => t.includes('dermato') || t.includes('piel'))) {
          pharmacySubcategory = 'Dermatología';
        } else if (tagsLower.some(t => t.includes('digestiv') || t.includes('estomago'))) {
          pharmacySubcategory = 'Cuidado digestivo';
        } else if (tagsLower.some(t => t.includes('vitamina') || t.includes('suplemento'))) {
          pharmacySubcategory = 'Vitaminas y suplementos';
        } else {
          pharmacySubcategory = 'Medicamentos veterinarios';
        }
      } else if (tagsLower.some(t => t.includes('arena') || t.includes('arenero'))) {
        category = 'Arenas';
      } else if (tagsLower.some(t => t.includes('snack') || t.includes('premio') || t.includes('galleta'))) {
        category = 'Snacks';
      } else if (tagsLower.some(t => t.includes('higiene') || t.includes('shampoo') || t.includes('toall'))) {
        category = 'Higiene';
      } else if (tagsLower.some(t => t.includes('accesorio') || t.includes('arnes') || t.includes('collar') || t.includes('juguete'))) {
        category = 'Accesorios';
      } else if (tagsLower.some(t => t.includes('perro') || t.includes('canino'))) {
        category = 'Perros';
      } else if (tagsLower.some(t => t.includes('gato') || t.includes('felino'))) {
        category = 'Gatos';
      }

      // Especie
      let species: Species = 'Ambos';
      const hasDog = tagsLower.some(t => t.includes('perro') || t.includes('canino') || t.includes('cachorro'));
      const hasCat = tagsLower.some(t => t.includes('gato') || t.includes('felino') || t.includes('gatito'));
      if (hasDog && !hasCat) species = 'Perro';
      else if (hasCat && !hasDog) species = 'Gato';

      const requiresPrescription = tagsLower.some(
        t => t.includes('receta') || t.includes('formula') || t.includes('prescrip')
      );

      // Presentaciones (variantes)
      const presentaciones: ProductPresentation[] = (p.presentaciones || []).map(v => ({
        varianteId: v.varianteId,
        nombre: v.nombre,
        sku: v.sku,
        foto: v.foto,
        bodegaIds: v.bodegaIds || [],
      }));

      // Foto principal: producto o primera variante
      const primaryPhoto = p.foto || presentaciones[0]?.foto || '';

      // Stock por bodega: productos de catálogo sin inventario asignado se marcan en 0
      const stockByStore: Record<string, number> = {
        HUB_KENNEDY: 0,
        HUB_ALAMOS: 0,
        HUB_SUBA: 0,
        HUB_CENTRO: 0,
        HUB_FONTIBON: 0,
      };
      const reservedStockByStore: Record<string, number> = {
        HUB_KENNEDY: 0,
        HUB_ALAMOS: 0,
        HUB_SUBA: 0,
        HUB_CENTRO: 0,
        HUB_FONTIBON: 0,
      };

      const primaryPresentationName = presentaciones[0]?.nombre || 'Unidad';

      return {
        id: p.productoId,
        productoId: p.productoId,
        sku: presentaciones[0]?.sku || `SKU-${p.productoId.slice(-8)}`,
        name: p.nombre, // Conserva nombres originales
        brand: p.vendor || 'Bolt Pets',
        species,
        category,
        pharmacySubcategory,
        requiresPrescription,
        storageCondition: 'LUGAR_FRESCO_Y_SECO',
        temperatureColdChain: false,
        price: 0, // No inventa precios para catálogo referencial
        presentation: primaryPresentationName,
        weightKg: 0,
        image: primaryPhoto,
        gallery: [...new Set(presentaciones.map(pr => pr.foto).filter(Boolean))],
        description: p.descripcion || '',
        stockByStore,
        reservedStockByStore,
        rating: 4.8,
        reviewsCount: 14,
        tags,
        status: p.status, // ACTIVE / ARCHIVED / DRAFT
        bodegaIds: p.bodegaIds || [], // Ubicaciones donde existe
        presentaciones, // Variantes agrupadas
      };
    });

    // Combinar: productos operacionales primero para posibilitar compras reales en sedes habilitadas
    this.productsCache = [...operationalProducts, ...rawCatalogProducts];
  }

  public getProductById(id: string): Product | undefined {
    if (!id) return undefined;
    return this.productsCache.find(p =>
      p.id === id ||
      p.productoId === id ||
      p.sku === id ||
      (p.presentaciones && p.presentaciones.some(v => v.varianteId === id || v.sku === id))
    );
  }

  public getSummary(): LocalCatalogSummary {
    if (this.summary) return this.summary;
    return {
      totalProductosAgrupados: this.rawProducts.length,
      totalVariantes: this.getTotalVariantsCount(),
      totalBodegas: this.storesCache.length,
      productosActivos: this.rawProducts.filter(p => p.status === 'ACTIVE').length,
      bodegas: this.storesCache.map(s => ({
        id: s.shopifyLocationGid || s.id,
        boltId: s.id,
        name: s.name,
        isActive: s.isActive,
      })),
    };
  }

  public getTotalVariantsCount(): number {
    return this.rawProducts.reduce((acc, p) => acc + (p.presentaciones?.length || 0), 0);
  }

  public getStores(): Store[] {
    return this.storesCache;
  }

  /**
   * Obtiene el catálogo filtrado según reglas de negocio:
   * - Para clientes: solo productos ACTIVE.
   * - Por sede: Organiza los productos según bodegaIds. Una lista vacía NO significa disponibilidad en todas las bodegas.
   * - Búsqueda y categoría.
   */
  public getCatalog(options?: {
    storeId?: string;
    category?: string;
    species?: string;
    q?: string;
    onlyActiveForCustomer?: boolean;
    page?: number;
    limit?: number;
  }): { products: Product[]; totalCount: number; activeCount: number } {
    const {
      storeId,
      category,
      species,
      q,
      onlyActiveForCustomer = true,
      page = 1,
      limit = 100,
    } = options || {};

    let list = [...this.productsCache];

    // 4. Para clientes muestra productos ACTIVE
    if (onlyActiveForCustomer) {
      list = list.filter(p => p.status === 'ACTIVE');
    }

    // 3. Organiza los productos según bodegaIds. Una lista vacía no significa disponibilidad en todas las bodegas.
    if (storeId) {
      const targetGid = this.storesCache.find(store=>store.id===storeId)?.shopifyLocationGid || storeId;
      list = list.filter(p => {
        const bIds = p.bodegaIds || [];
        if (bIds.length === 0) return false; // Lista vacía NO significa disponibilidad en todas las bodegas
        return bIds.includes(targetGid) || bIds.includes(storeId);
      });
    }

    // Filtros de categoría y especie
    if (category && category !== 'Todo') {
      list = list.filter(p => p.category === category || p.pharmacySubcategory === category);
    }
    if (species && species !== 'Todos') {
      list = list.filter(p => p.species === species || p.species === 'Ambos');
    }

    // Búsqueda por texto
    if (q) {
      const queryStr = String(q).toLowerCase();
      list = list.filter(p =>
        p.name.toLowerCase().includes(queryStr) ||
        p.brand.toLowerCase().includes(queryStr) ||
        p.sku.toLowerCase().includes(queryStr) ||
        p.tags.some(t => t.toLowerCase().includes(queryStr))
      );
    }

    const totalCount = list.length;
    const activeCount = list.filter(p => p.status === 'ACTIVE').length;

    // Paginación si se especifica
    if (limit && limit > 0) {
      const startIndex = (page - 1) * limit;
      list = list.slice(startIndex, startIndex + limit);
    }

    return { products: list, totalCount, activeCount };
  }

  public getAllGroupedProducts(): Product[] {
    return this.productsCache;
  }
}

export const localCatalogService = new LocalCatalogService();
