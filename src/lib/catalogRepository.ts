import fs from 'fs';
import path from 'path';
import { Product, ProductPresentation, Store, MainCategory, Species, StorageCondition } from '../types';
import {imageMetadataPatch, type CatalogImagePatch} from './catalogImagePatch';
import { localCatalogService } from './localCatalogService';

export interface CatalogAuditEntry {
  id: string;
  timestamp: string;
  actor: {
    email: string;
    name: string;
  };
  action: 'CREATE_PRODUCT' | 'UPDATE_PRODUCT' | 'TOGGLE_STATUS' | 'UPDATE_PRICE_STOCK' | 'SET_IMAGE';
  productId: string;
  productName: string;
  details: Record<string, any>;
}

export interface PersistedCatalogData {
  version: string;
  lastUpdated: string;
  customProducts: Product[];
  overrides: Record<string, Partial<Product>>;
  auditLog: CatalogAuditEntry[];
}

const CATALOG_OVERRIDE_PATH = path.join(process.cwd(), 'src', 'data', 'persisted-catalog-overrides.json');

export class CatalogRepository {
  private baselineProducts: Product[] = [];
  private customProducts: Map<string, Product> = new Map();
  private overrides: Map<string, Partial<Product>> = new Map();
  private auditLog: CatalogAuditEntry[] = [];
  private mergedProductsCache: Product[] = [];
  private isLoaded = false;

  constructor() {
    this.init();
  }

  public init(): void {
    // 1. Cargar catálogo base local estructurado
    this.baselineProducts = localCatalogService.getAllGroupedProducts();

    // 2. Cargar modificaciones persistidas
    this.loadOverridesFromDisk();

    // 3. Reconstruir caché fusionada
    this.rebuildMergedCache();
    this.isLoaded = true;
  }

  private loadOverridesFromDisk(): void {
    try {
      if (fs.existsSync(CATALOG_OVERRIDE_PATH)) {
        const raw = fs.readFileSync(CATALOG_OVERRIDE_PATH, 'utf-8');
        const data: PersistedCatalogData = JSON.parse(raw);

        this.customProducts.clear();
        if (Array.isArray(data.customProducts)) {
          data.customProducts.forEach(p => {
            this.customProducts.set(p.id, p);
          });
        }

        this.overrides.clear();
        if (data.overrides && typeof data.overrides === 'object') {
          Object.entries(data.overrides).forEach(([id, ovr]) => {
            this.overrides.set(id, ovr);
          });
        }

        this.auditLog = Array.isArray(data.auditLog) ? data.auditLog : [];
      }
    } catch (err) {
      console.warn('[CatalogRepository] Error reading catalog overrides file:', err);
    }
  }

  private saveToDisk(): void {
    try {
      const data: PersistedCatalogData = {
        version: '1.0.0',
        lastUpdated: new Date().toISOString(),
        customProducts: Array.from(this.customProducts.values()),
        overrides: Object.fromEntries(this.overrides.entries()),
        auditLog: this.auditLog.slice(-500), // conservar los últimos 500 registros de auditoría
      };

      const dir = path.dirname(CATALOG_OVERRIDE_PATH);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      const temp = `${CATALOG_OVERRIDE_PATH}.${process.pid}.tmp`;
      fs.writeFileSync(temp, JSON.stringify(data, null, 2), {encoding:'utf-8',mode:0o600});
      fs.renameSync(temp,CATALOG_OVERRIDE_PATH);
    } catch (err) {
      console.error('[CatalogRepository] Error saving catalog overrides file:', err);
      throw err;
    }
  }

  private rebuildMergedCache(): void {
    // Clonar base para aplicar overrides
    const baseMap = new Map<string, Product>();
    this.baselineProducts.forEach(p => {
      baseMap.set(p.id, JSON.parse(JSON.stringify(p)));
    });

    // Aplicar overrides sobre los existentes
    for (const [id, ovr] of this.overrides.entries()) {
      if (baseMap.has(id)) {
        const existing = baseMap.get(id)!;
        const merged: Product = {
          ...existing,
          ...ovr,
          stockByStore: {
            ...existing.stockByStore,
            ...(ovr.stockByStore || {}),
          },
          reservedStockByStore: {
            ...existing.reservedStockByStore,
            ...(ovr.reservedStockByStore || {}),
          },
          gallery: ovr.gallery || existing.gallery || (existing.image ? [existing.image] : []),
        };
        baseMap.set(id, merged);
      }
    }

    // Agregar productos creados a la medida
    const list: Product[] = Array.from(baseMap.values());
    for (const custom of this.customProducts.values()) {
      const ovr = this.overrides.get(custom.id);
      const mergedCustom = ovr ? { ...custom, ...ovr } : custom;
      list.unshift(mergedCustom);
    }

    this.mergedProductsCache = list.map(p => ({...p, presentaciones:p.presentaciones?.map(v =>
      Object.hasOwn(p.variantImages || {},v.varianteId) ? {...v,foto:p.variantImages![v.varianteId]} : v)}));
  }

  public getAllProducts(includeInactive = true): Product[] {
    if (!this.isLoaded) this.init();
    if (includeInactive) {
      return this.mergedProductsCache;
    }
    return this.mergedProductsCache.filter(p => !p.status || p.status === 'ACTIVE');
  }

  public getProductById(id: string): Product | undefined {
    if (!this.isLoaded) this.init();
    return this.mergedProductsCache.find(p => p.id === id || p.productoId === id || p.sku === id);
  }

  public createProduct(
    productData: Partial<Product>,
    actor: { email: string; name: string }
  ): { success: boolean; product?: Product; error?: string } {
    if (!this.isLoaded) this.init();

    if (!productData.name || !productData.name.trim()) {
      return { success: false, error: 'El nombre del producto es obligatorio.' };
    }
    if (!productData.price || productData.price <= 0) {
      return { success: false, error: 'El precio debe ser un valor positivo en COP.' };
    }

    const newId = `prod-custom-${Date.now().toString(36)}-${Math.floor(Math.random() * 1000)}`;
    const newSku = productData.sku?.trim() || `SKU-BOLT-${Date.now().toString().slice(-6)}`;

    // Si ya existe ese SKU, advertir
    const existingSku = this.mergedProductsCache.find(p => p.sku.toLowerCase() === newSku.toLowerCase());
    if (existingSku) {
      return { success: false, error: `Ya existe un producto con el SKU "${newSku}".` };
    }

    const defaultBodegaIds = ['HUB_KENNEDY', 'HUB_ALAMOS', 'HUB_SUBA'];

    const newProduct: Product = {
      id: newId,
      productoId: newId,
      sku: newSku,
      name: productData.name.trim(),
      brand: productData.brand?.trim() || 'Bolt Pets',
      species: productData.species || 'Perro',
      category: productData.category || 'Alimentos',
      pharmacySubcategory: productData.pharmacySubcategory,
      requiresPrescription: !!productData.requiresPrescription,
      icaRegistration: productData.icaRegistration?.trim(),
      storageCondition: productData.storageCondition || 'TEMPERATURA_AMBIENTE',
      temperatureColdChain: !!productData.temperatureColdChain,
      price: Math.round(productData.price),
      originalPrice: productData.originalPrice ? Math.round(productData.originalPrice) : undefined,
      presentation: productData.presentation?.trim() || 'Unidad',
      weightKg: productData.weightKg || 1,
      image: productData.image?.trim() || '',
      gallery: productData.gallery || (productData.image ? [productData.image] : []),
      description: productData.description?.trim() || '',
      stockByStore: productData.stockByStore || {
        HUB_KENNEDY: 10,
        HUB_ALAMOS: 10,
        HUB_SUBA: 10,
        HUB_CENTRO: 0,
        HUB_FONTIBON: 0,
      },
      reservedStockByStore: productData.reservedStockByStore || {
        HUB_KENNEDY: 0,
        HUB_ALAMOS: 0,
        HUB_SUBA: 0,
        HUB_CENTRO: 0,
        HUB_FONTIBON: 0,
      },
      rating: 5.0,
      reviewsCount: 1,
      tags: productData.tags || ['Nuevo', productData.brand || 'Bolt Pets'],
      status: productData.status || 'ACTIVE',
      bodegaIds: productData.bodegaIds || defaultBodegaIds,
      presentaciones: productData.presentaciones || [
        {
          varianteId: `var-${newId}-1`,
          nombre: productData.presentation?.trim() || 'Presentación Principal',
          sku: newSku,
          foto: productData.image?.trim() || '',
          bodegaIds: defaultBodegaIds,
        },
      ],
    };

    this.customProducts.set(newId, newProduct);

    // Registro de auditoría
    const auditEntry: CatalogAuditEntry = {
      id: `aud-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      timestamp: new Date().toISOString(),
      actor,
      action: 'CREATE_PRODUCT',
      productId: newId,
      productName: newProduct.name,
      details: {
        sku: newProduct.sku,
        priceCOP: newProduct.price,
        stockByStore: newProduct.stockByStore,
      },
    };
    this.auditLog.unshift(auditEntry);

    this.saveToDisk();
    this.rebuildMergedCache();

    return { success: true, product: newProduct };
  }

  public updateProduct(
    id: string,
    updates: Partial<Product>,
    actor: { email: string; name: string }
  ): { success: boolean; product?: Product; error?: string } {
    if (!this.isLoaded) this.init();

    const product = this.getProductById(id);
    if (!product) {
      return { success: false, error: 'Producto no encontrado.' };
    }

    const currentOverride = this.overrides.get(id) || {};
    const sanitizedUpdates: Partial<Product> = { ...updates };

    // Validar precio si viene
    if (sanitizedUpdates.price !== undefined) {
      if (sanitizedUpdates.price <= 0) {
        return { success: false, error: 'El precio debe ser un número positivo en COP.' };
      }
      sanitizedUpdates.price = Math.round(sanitizedUpdates.price);
    }

    if (sanitizedUpdates.originalPrice !== undefined && sanitizedUpdates.originalPrice !== null) {
      sanitizedUpdates.originalPrice = Math.round(sanitizedUpdates.originalPrice);
    }

    // Si es un producto personalizado, actualizarlo directamente
    if (this.customProducts.has(id)) {
      const custom = this.customProducts.get(id)!;
      const updatedCustom: Product = {
        ...custom,
        ...sanitizedUpdates,
        stockByStore: {
          ...custom.stockByStore,
          ...(sanitizedUpdates.stockByStore || {}),
        },
      };
      this.customProducts.set(id, updatedCustom);
    } else {
      // Producto baseline: guardar en overrides
      const newOverride: Partial<Product> = {
        ...currentOverride,
        ...sanitizedUpdates,
        stockByStore: {
          ...(currentOverride.stockByStore || {}),
          ...(sanitizedUpdates.stockByStore || {}),
        },
      };
      this.overrides.set(id, newOverride);
    }

    // Registro de auditoría
    const auditEntry: CatalogAuditEntry = {
      id: `aud-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      timestamp: new Date().toISOString(),
      actor,
      action: 'UPDATE_PRODUCT',
      productId: id,
      productName: updates.name || product.name,
      details: sanitizedUpdates,
    };
    this.auditLog.unshift(auditEntry);

    this.saveToDisk();
    this.rebuildMergedCache();

    return { success: true, product: this.getProductById(id) };
  }

  /** Single durable write; only image fields, optimistic conflict checks and audit. */
  public applyImagePatches(patches:CatalogImagePatch[], actor:{email:string;name:string}) {
    if(!Array.isArray(patches)||patches.length>10000||new Set(patches.map(p=>p.productId)).size!==patches.length)throw new Error('Lote de imágenes inválido.');
    const changes=patches.map(patch=>{
      const product=this.getProductById(patch.productId);
      if(!product)throw new Error(`Producto no encontrado: ${patch.productId}`);
      return {patch,product,metadata:imageMetadataPatch(product,patch)};
    }).filter(x=>Object.keys(x.metadata).length);
    if(!changes.length)return {changed:0};
    const previousOverrides=new Map(this.overrides),previousCustom=new Map(this.customProducts),previousAudit=[...this.auditLog];
    try {
      for(const {patch,product,metadata} of changes){
        if(this.customProducts.has(product.id))this.customProducts.set(product.id,{...this.customProducts.get(product.id)!,...metadata});
        else this.overrides.set(product.id,{...(this.overrides.get(product.id)||{}),...metadata});
        this.auditLog.unshift({id:`img-${Date.now()}-${product.id}`,timestamp:new Date().toISOString(),actor,action:'SET_IMAGE',productId:product.id,productName:product.name,details:{...patch}});
      }
      this.saveToDisk();this.rebuildMergedCache();return {changed:changes.length};
    }catch(error){this.overrides=previousOverrides;this.customProducts=previousCustom;this.auditLog=previousAudit;this.rebuildMergedCache();throw error;}
  }

  public toggleProductStatus(
    id: string,
    actor: { email: string; name: string }
  ): { success: boolean; product?: Product; newStatus?: string; error?: string } {
    if (!this.isLoaded) this.init();

    const product = this.getProductById(id);
    if (!product) {
      return { success: false, error: 'Producto no encontrado.' };
    }

    const currentStatus = product.status || 'ACTIVE';
    const newStatus = currentStatus === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';

    if (this.customProducts.has(id)) {
      const custom = this.customProducts.get(id)!;
      custom.status = newStatus;
      this.customProducts.set(id, custom);
    } else {
      const currentOverride = this.overrides.get(id) || {};
      this.overrides.set(id, {
        ...currentOverride,
        status: newStatus,
      });
    }

    const auditEntry: CatalogAuditEntry = {
      id: `aud-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      timestamp: new Date().toISOString(),
      actor,
      action: 'TOGGLE_STATUS',
      productId: id,
      productName: product.name,
      details: { previousStatus: currentStatus, newStatus },
    };
    this.auditLog.unshift(auditEntry);

    this.saveToDisk();
    this.rebuildMergedCache();

    return { success: true, product: this.getProductById(id), newStatus };
  }

  public updateVariantPriceAndStock(
    productId: string,
    params: {
      variantId?: string;
      priceCOP?: number;
      stockByStore?: Record<string, number>;
      presentationName?: string;
    },
    actor: { email: string; name: string }
  ): { success: boolean; product?: Product; error?: string } {
    if (!this.isLoaded) this.init();

    const product = this.getProductById(productId);
    if (!product) {
      return { success: false, error: 'Producto no encontrado.' };
    }

    const updates: Partial<Product> = {};

    // Actualizar precio
    if (params.priceCOP !== undefined) {
      if (params.priceCOP <= 0) {
        return { success: false, error: 'El precio debe ser un número positivo en COP.' };
      }
      updates.price = Math.round(params.priceCOP);
    }

    // Actualizar inventario por sede
    if (params.stockByStore) {
      const mergedStock: Record<string, number> = { ...(product.stockByStore || {}) };
      Object.entries(params.stockByStore).forEach(([storeId, qty]) => {
        mergedStock[storeId] = Math.max(0, Math.floor(qty));
      });
      updates.stockByStore = mergedStock;
    }

    // Actualizar presentaciones si se especificó una variante particular
    if (params.variantId && product.presentaciones) {
      const updatedPresentaciones = product.presentaciones.map(v => {
        if (v.varianteId === params.variantId) {
          return {
            ...v,
            nombre: params.presentationName || v.nombre,
          };
        }
        return v;
      });
      updates.presentaciones = updatedPresentaciones;
    }

    return this.updateProduct(productId, updates, actor);
  }

  public setProductImage(
    productId: string,
    imageUrl: string,
    isPrimary: boolean,
    actor: { email: string; name: string }
  ): { success: boolean; product?: Product; error?: string } {
    if (!this.isLoaded) this.init();

    const product = this.getProductById(productId);
    if (!product) {
      return { success: false, error: 'Producto no encontrado.' };
    }

    const updates: Partial<Product> = {};
    const currentGallery = [...(product.gallery || (product.image ? [product.image] : []))];

    if (!currentGallery.includes(imageUrl)) {
      currentGallery.push(imageUrl);
    }

    if (isPrimary) {
      updates.image = imageUrl;
      // Mover a primera posición en la galería
      const filtered = currentGallery.filter(url => url !== imageUrl);
      updates.gallery = [imageUrl, ...filtered];
    } else {
      updates.gallery = currentGallery;
    }

    const auditEntry: CatalogAuditEntry = {
      id: `aud-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      timestamp: new Date().toISOString(),
      actor,
      action: 'SET_IMAGE',
      productId,
      productName: product.name,
      details: { imageUrl, isPrimary },
    };
    this.auditLog.unshift(auditEntry);

    return this.updateProduct(productId, updates, actor);
  }

  public getAuditLog(productId?: string): CatalogAuditEntry[] {
    if (!this.isLoaded) this.init();
    if (productId) {
      return this.auditLog.filter(a => a.productId === productId);
    }
    return this.auditLog;
  }

  /**
   * Resetea el repositorio para pruebas unitarias limpias
   */
  public resetForTesting(): void {
    this.customProducts.clear();
    this.overrides.clear();
    this.auditLog = [];
    if (fs.existsSync(CATALOG_OVERRIDE_PATH)) {
      try {
        fs.unlinkSync(CATALOG_OVERRIDE_PATH);
      } catch {}
    }
    this.rebuildMergedCache();
  }
}

export const catalogRepository = new CatalogRepository();
