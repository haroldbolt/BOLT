import { saleVariant } from '../../lib/variantCommerce';
import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Search, Plus, Filter, Edit3, Image as ImageIcon, CheckCircle2,
  XCircle, AlertCircle, Upload, Save, RefreshCw, Eye, EyeOff,
  Layers, Package, ShieldCheck, DollarSign, Archive, History,
  Building2, Sparkles, Check, Trash2, Camera, ExternalLink
} from 'lucide-react';
import { Product, Store, MainCategory, Species, StorageCondition } from '../../types';
import { api } from '../../lib/api';
import { formatCOP } from '../../lib/formatters';

interface CatalogManagerTabProps {
  currentAdminUser: any;
  onOpenAuthModal: () => void;
  onRefreshCatalog?: () => void;
}

export const CatalogManagerTab: React.FC<CatalogManagerTabProps> = ({
  currentAdminUser,
  onOpenAuthModal,
  onRefreshCatalog,
}) => {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('Todo');
  const [selectedStatus, setSelectedStatus] = useState<string>('TODOS');
  const [selectedStoreStock, setSelectedStoreStock] = useState<string>('ALL');

  // Modals
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [isNewProduct, setIsNewProduct] = useState(false);

  // Quick Price & Stock Modal
  const [isQuickPricingOpen, setIsQuickPricingOpen] = useState(false);
  const [quickProduct, setQuickProduct] = useState<Product | null>(null);
  const [configuredStores,setConfiguredStores]=useState<Store[]>([]);
  const [quickVariantId,setQuickVariantId]=useState('');
  const [quickPrice, setQuickPrice] = useState<number>(0);
  const [quickStock, setQuickStock] = useState<Record<string, number>>({});

  // Image Upload Modal
  const [isImageModalOpen, setIsImageModalOpen] = useState(false);
  const [imageTargetProduct, setImageTargetProduct] = useState<Product | null>(null);
  const [uploadPreview, setUploadPreview] = useState<string | null>(null);
  const [uploadFilename, setUploadFilename] = useState<string>('');
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Audit Logs
  const [isAuditOpen, setIsAuditOpen] = useState(false);
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [loadingAudit, setLoadingAudit] = useState(false);

  const loadCatalog = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.getAdminCatalog();
      setProducts(data);
      setConfiguredStores(await api.getStores());
    } catch (err: any) {
      if (err.message?.includes('token') || err.message?.includes('denegado') || err.message?.includes('autorizado')) {
        onOpenAuthModal();
      } else {
        setError(err.message || 'Error al cargar catálogo');
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (currentAdminUser) {
      loadCatalog();
    }
  }, [currentAdminUser]);

  const showNotification = (msg: string) => {
    setSuccessMessage(msg);
    setTimeout(() => setSuccessMessage(null), 4000);
  };

  // Status toggle (Active <-> Inactive)
  const handleToggleStatus = async (product: Product) => {
    try {
      const res = await api.toggleProductStatus(product.id);
      setProducts(prev => prev.map(p => p.id === product.id ? res.product : p));
      showNotification(`Estado de "${product.name}" actualizado a ${res.newStatus === 'ACTIVE' ? 'ACTIVO' : 'INACTIVO'}.`);
      onRefreshCatalog?.();
    } catch (err: any) {
      setError(err.message || 'Error al cambiar estado');
    }
  };

  // Open Quick Price & Stock Modal
  const handleOpenQuickPricing = (product: Product) => {
    setQuickProduct(product);
    setQuickVariantId(product.presentaciones?.[0]?.varianteId||product.id);
    setQuickPrice(product.price);
    setQuickStock({ ...(product.stockByStore || {}) });
    setIsQuickPricingOpen(true);
  };

  const handleSaveQuickPricing = async () => {
    if (!quickProduct) return;
    try {
      const updated = await api.updateVariantPriceStock(quickProduct.id, {
        variantId:quickVariantId,
        expectedRevision:saleVariant(quickProduct,quickVariantId).commerceRevision,
        priceCOP: quickPrice,
        stockByStore:Object.fromEntries(Object.entries(quickStock).filter(([id])=>configuredStores.some(s=>s.id===id&&s.isActive&&(saleVariant(quickProduct,quickVariantId).bodegaIds||[]).some(b=>b===s.id||b===s.shopifyLocationGid)))),
      });
      setProducts(prev => prev.map(p => p.id === quickProduct.id ? updated : p));
      setIsQuickPricingOpen(false);
      showNotification(`Precio e inventario actualizados para "${quickProduct.name}".`);
      onRefreshCatalog?.();
    } catch (err: any) {
      setError(err.message || 'Error al actualizar precio/inventario');
    }
  };

  // Open Image Upload Modal
  const handleOpenImageModal = (product: Product) => {
    setImageTargetProduct(product);
    setUploadPreview(null);
    setUploadFilename('');
    setIsImageModalOpen(true);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 5 * 1024 * 1024) {
      setError('La imagen supera el límite máximo permitido de 5 MB.');
      return;
    }

    setUploadFilename(file.name);
    const reader = new FileReader();
    reader.onload = () => {
      setUploadPreview(reader.result as string);
    };
    reader.readAsDataURL(file);
  };

  const handleUploadImageSubmit = async (makePrimary: boolean) => {
    if (!uploadPreview || !imageTargetProduct) return;
    setIsUploading(true);
    setError(null);
    try {
      const uploadRes = await api.uploadCatalogImage(uploadPreview, uploadFilename);
      const currentGallery = [...(imageTargetProduct.gallery || (imageTargetProduct.image ? [imageTargetProduct.image] : []))];
      if (!currentGallery.includes(uploadRes.url)) {
        currentGallery.push(uploadRes.url);
      }

      const updates: Partial<Product> = {
        gallery: currentGallery,
      };
      if (makePrimary) {
        updates.image = uploadRes.url;
      }

      const updatedProd = await api.updateAdminProduct(imageTargetProduct.id, updates);
      setProducts(prev => prev.map(p => p.id === imageTargetProduct.id ? updatedProd : p));
      setIsImageModalOpen(false);
      showNotification(`Imagen guardada exitosamente para "${imageTargetProduct.name}".`);
      onRefreshCatalog?.();
    } catch (err: any) {
      setError(err.message || 'Error al subir la imagen.');
    } finally {
      setIsUploading(false);
    }
  };

  // Open Full Product Editor
  const handleOpenCreateModal = () => {
    setEditingProduct({
      id: '',
      sku: '',
      name: '',
      brand: '',
      species: 'Perro',
      category: 'Alimentos',
      price: 50000,
      originalPrice: undefined,
      presentation: 'Unidad',
      weightKg: 1,
      image: 'https://images.unsplash.com/photo-1589924691995-400dc9ecc119?w=800',
      description: '',
      requiresPrescription: false,
      storageCondition: 'TEMPERATURA_AMBIENTE',
      temperatureColdChain: false,
      stockByStore: {
        HUB_KENNEDY: 10,
        HUB_ALAMOS: 10,
        HUB_SUBA: 10,
        HUB_CENTRO: 0,
        HUB_FONTIBON: 0,
      },
      reservedStockByStore: {
        HUB_KENNEDY: 0,
        HUB_ALAMOS: 0,
        HUB_SUBA: 0,
        HUB_CENTRO: 0,
        HUB_FONTIBON: 0,
      },
      rating: 5,
      reviewsCount: 1,
      tags: ['Nuevo'],
      status: 'ACTIVE',
    });
    setIsNewProduct(true);
    setIsEditorOpen(true);
  };

  const handleOpenEditModal = (product: Product) => {
    setEditingProduct(JSON.parse(JSON.stringify(product)));
    setIsNewProduct(false);
    setIsEditorOpen(true);
  };

  const handleSaveProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingProduct) return;
    setError(null);

    try {
      if (isNewProduct) {
        const created = await api.createAdminProduct(editingProduct);
        setProducts(prev => [created, ...prev]);
        showNotification(`Producto "${created.name}" creado con éxito.`);
      } else {
        const updated = await api.updateAdminProduct(editingProduct.id, editingProduct);
        setProducts(prev => prev.map(p => p.id === editingProduct.id ? updated : p));
        showNotification(`Producto "${updated.name}" actualizado con éxito.`);
      }
      setIsEditorOpen(false);
      onRefreshCatalog?.();
    } catch (err: any) {
      setError(err.message || 'Error al guardar el producto');
    }
  };

  // Open Audit Log
  const handleOpenAudit = async () => {
    setIsAuditOpen(true);
    setLoadingAudit(true);
    try {
      const logs = await api.getCatalogAuditLog();
      setAuditLogs(logs);
    } catch (err: any) {
      console.warn('Error loading audit logs:', err);
    } finally {
      setLoadingAudit(false);
    }
  };

  // Filtered Products
  const filteredProducts = useMemo(() => {
    return products.filter(p => {
      // Status
      if (selectedStatus !== 'TODOS') {
        const pStatus = p.status || 'ACTIVE';
        if (pStatus !== selectedStatus) return false;
      }
      // Category
      if (selectedCategory !== 'Todo') {
        if (p.category !== selectedCategory && p.pharmacySubcategory !== selectedCategory) {
          return false;
        }
      }
      // Warehouse stock filter
      if (selectedStoreStock !== 'ALL') {
        const stock = p.stockByStore?.[selectedStoreStock] || 0;
        if (stock <= 0) return false;
      }
      // Search
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesName = p.name.toLowerCase().includes(q);
        const matchesSku = p.sku.toLowerCase().includes(q);
        const matchesBrand = p.brand.toLowerCase().includes(q);
        const matchesTag = p.tags?.some(t => t.toLowerCase().includes(q));
        if (!matchesName && !matchesSku && !matchesBrand && !matchesTag) return false;
      }
      return true;
    });
  }, [products, selectedStatus, selectedCategory, selectedStoreStock, searchQuery]);

  // Statistics
  const stats = useMemo(() => {
    const total = products.length;
    const active = products.filter(p => (p.status || 'ACTIVE') === 'ACTIVE').length;
    const inactive = total - active;
    const withPrescription = products.filter(p => p.requiresPrescription).length;
    return { total, active, inactive, withPrescription };
  }, [products]);

  if (!currentAdminUser) {
    return (
      <div className="bg-white rounded-3xl border border-slate-200 p-12 text-center shadow-xs max-w-xl mx-auto my-8">
        <div className="w-16 h-16 bg-red-50 text-red-600 rounded-3xl flex items-center justify-center mx-auto mb-4 border border-red-100">
          <ShieldCheck className="w-8 h-8" />
        </div>
        <h3 className="text-xl font-black text-slate-900 mb-2">Autenticación Requerida</h3>
        <p className="text-xs text-slate-500 mb-6 leading-relaxed">
          Para modificar precios, crear productos, editar inventario por bodega y subir imágenes, debes iniciar sesión con una cuenta de administrador verificada por el servidor.
        </p>
        <button
          onClick={onOpenAuthModal}
          className="px-6 py-3 bg-red-600 hover:bg-red-700 text-white font-bold text-xs rounded-2xl shadow-md transition cursor-pointer"
        >
          Iniciar Sesión como Administrador
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Top Banner & Stats */}
      <div className="bg-slate-900 text-white p-6 rounded-3xl border border-slate-800 shadow-md flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5 mb-1">
            <span className="bg-red-600 text-white text-[10px] font-black uppercase px-2.5 py-0.5 rounded-full tracking-wider">
              Control Maestro
            </span>
            <div className="flex items-center gap-1 text-xs text-emerald-400 font-bold">
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>Sesión activa: {currentAdminUser.email}</span>
            </div>
          </div>
          <h2 className="text-2xl font-black tracking-tight">Administración de Catálogo & Precios</h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Creación, edición de productos, control de precios en COP por variante, inventario por bodega y carga de imágenes.
          </p>
        </div>

        <div className="flex items-center gap-2.5 self-stretch md:self-auto">
          <button
            onClick={handleOpenAudit}
            className="px-3.5 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold rounded-2xl border border-slate-700 flex items-center gap-1.5 transition cursor-pointer"
            title="Ver auditoría de cambios"
          >
            <History className="w-4 h-4 text-slate-400" />
            <span>Auditoría</span>
          </button>
          <button
            onClick={loadCatalog}
            className="px-3.5 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold rounded-2xl border border-slate-700 flex items-center gap-1.5 transition cursor-pointer"
            title="Recargar catálogo"
          >
            <RefreshCw className={`w-4 h-4 text-slate-400 ${loading ? 'animate-spin' : ''}`} />
            <span>Actualizar</span>
          </button>
          <button
            onClick={handleOpenCreateModal}
            className="px-4 py-2.5 bg-red-600 hover:bg-red-700 text-white text-xs font-bold rounded-2xl shadow-md flex items-center gap-1.5 transition cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Nuevo Producto</span>
          </button>
        </div>
      </div>

      {/* Notifications */}
      {successMessage && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 px-4 py-3 rounded-2xl flex items-center gap-2 text-xs font-semibold shadow-xs animate-in fade-in">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          <span>{successMessage}</span>
        </div>
      )}
      {error && (
        <div className="bg-rose-50 border border-rose-200 text-rose-800 px-4 py-3 rounded-2xl flex items-center gap-2 text-xs font-semibold shadow-xs animate-in fade-in">
          <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-2xs">
          <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Total Productos</span>
          <p className="text-2xl font-black text-slate-900 mt-1 font-mono">{stats.total.toLocaleString('es-CO')}</p>
          <span className="text-[10px] text-slate-400">Catálogo estructurado + personalizados</span>
        </div>
        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-2xs">
          <span className="text-[11px] font-bold text-emerald-600 uppercase tracking-wider">Activos en Tienda</span>
          <p className="text-2xl font-black text-emerald-700 mt-1 font-mono">{stats.active.toLocaleString('es-CO')}</p>
          <span className="text-[10px] text-slate-400">Visibles para compra online</span>
        </div>
        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-2xs">
          <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Inactivos / Pausados</span>
          <p className="text-2xl font-black text-slate-700 mt-1 font-mono">{stats.inactive.toLocaleString('es-CO')}</p>
          <span className="text-[10px] text-slate-400">Ocultos sin perder historial</span>
        </div>
        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-2xs">
          <span className="text-[11px] font-bold text-blue-600 uppercase tracking-wider">Línea Veterinaria</span>
          <p className="text-2xl font-black text-blue-700 mt-1 font-mono">{stats.withPrescription.toLocaleString('es-CO')}</p>
          <span className="text-[10px] text-slate-400">Medicamentos con Reg. ICA</span>
        </div>
      </div>

      {/* Filter & Search Bar */}
      <div className="bg-white p-4 rounded-3xl border border-slate-200 shadow-xs space-y-3">
        <div className="flex flex-col md:flex-row items-center gap-3">
          <div className="relative flex-1 w-full">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Buscar por nombre, SKU, marca o ingrediente activo..."
              className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium focus:outline-none focus:ring-2 focus:ring-red-600 focus:bg-white"
            />
          </div>

          <div className="flex items-center gap-2 w-full md:w-auto overflow-x-auto">
            {/* Category */}
            <select
              value={selectedCategory}
              onChange={e => setSelectedCategory(e.target.value)}
              className="bg-slate-50 border border-slate-200 text-slate-700 text-xs font-semibold px-3 py-2.5 rounded-xl focus:outline-none focus:ring-2 focus:ring-red-600 cursor-pointer"
            >
              <option value="Todo">Todas las Categorías</option>
              <option value="Alimentos">Alimentos</option>
              <option value="Farmacia">Farmacia</option>
              <option value="Antipulgas">Antipulgas</option>
              <option value="Arenas">Arenas</option>
              <option value="Snacks">Snacks</option>
              <option value="Higiene">Higiene</option>
              <option value="Accesorios">Accesorios</option>
            </select>

            {/* Status */}
            <select
              value={selectedStatus}
              onChange={e => setSelectedStatus(e.target.value)}
              className="bg-slate-50 border border-slate-200 text-slate-700 text-xs font-semibold px-3 py-2.5 rounded-xl focus:outline-none focus:ring-2 focus:ring-red-600 cursor-pointer"
            >
              <option value="TODOS">Todos los Estados</option>
              <option value="ACTIVE">Solo Activos</option>
              <option value="INACTIVE">Solo Inactivos</option>
            </select>

            {/* Store stock */}
            <select
              value={selectedStoreStock}
              onChange={e => setSelectedStoreStock(e.target.value)}
              className="bg-slate-50 border border-slate-200 text-slate-700 text-xs font-semibold px-3 py-2.5 rounded-xl focus:outline-none focus:ring-2 focus:ring-red-600 cursor-pointer"
            >
              <option value="ALL">Stock: Cualquier Sede</option>
              {configuredStores.filter(s=>s.isActive).map(s=><option key={s.id} value={s.id}>Con stock en {s.customerName||s.name}</option>)}
            </select>
          </div>
        </div>

        <div className="flex items-center justify-between text-[11px] text-slate-500 font-medium px-1">
          <span>Mostrando <strong>{filteredProducts.length}</strong> de {products.length} productos</span>
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="text-red-600 hover:underline font-bold"
            >
              Limpiar búsqueda
            </button>
          )}
        </div>
      </div>

      {/* Products Table */}
      <div className="bg-white rounded-3xl border border-slate-200 shadow-xs overflow-hidden">
        {loading ? (
          <div className="py-20 flex flex-col items-center justify-center gap-3 text-slate-400">
            <div className="w-8 h-8 border-3 border-red-600 border-t-transparent rounded-full animate-spin"></div>
            <p className="text-xs font-semibold">Cargando catálogo maestro...</p>
          </div>
        ) : filteredProducts.length === 0 ? (
          <div className="py-16 text-center text-slate-400">
            <Package className="w-12 h-12 mx-auto mb-2 opacity-30" />
            <p className="font-bold text-slate-700 text-sm">No se encontraron productos con estos filtros</p>
            <p className="text-xs mt-1">Prueba cambiando los términos de búsqueda o el estado.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 uppercase tracking-wider font-extrabold text-[10px]">
                <tr>
                  <th className="p-3.5">Producto / Imagen</th>
                  <th className="p-3.5">SKU & Registro</th>
                  <th className="p-3.5">Categoría</th>
                  <th className="p-3.5">Precio COP</th>
                  <th className="p-3.5">Stock por sede · presentación principal</th>
                  <th className="p-3.5">Estado</th>
                  <th className="p-3.5 text-right">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-medium text-slate-700">
                {filteredProducts.slice(0, 50).map(product => {
                  const isActive = (product.status || 'ACTIVE') === 'ACTIVE';
                  const associatedStores=configuredStores.filter(s=>s.isActive&&(product.presentaciones?.[0]?.bodegaIds||product.bodegaIds||[]).some(b=>b===s.id||b===s.shopifyLocationGid));
                  const totalStock=associatedStores.reduce((n,s)=>n+(product.stockByStore[s.id]||0),0);

                  return (
                    <tr key={product.id} className="hover:bg-slate-50/80 transition">
                      {/* Product Thumbnail & Name */}
                      <td className="p-3.5">
                        <div className="flex items-center gap-3">
                          <div className="relative group shrink-0">
                            <img
                              src={product.image}
                              alt=""
                              className="w-11 h-11 rounded-xl object-cover border border-slate-200 bg-slate-100 shadow-2xs"
                            />
                            <button
                              onClick={() => handleOpenImageModal(product)}
                              className="absolute inset-0 bg-slate-900/60 text-white rounded-xl flex items-center justify-center opacity-0 group-hover:opacity-100 transition cursor-pointer"
                              title="Cambiar imagen"
                            >
                              <Camera className="w-4 h-4" />
                            </button>
                          </div>
                          <div className="min-w-0 max-w-xs">
                            <p className="font-bold text-slate-900 text-xs truncate leading-snug">{product.name}</p>
                            <div className="flex items-center gap-2 mt-0.5 text-[11px] text-slate-400">
                              <span>{product.brand}</span>
                              <span>•</span>
                              <span>{product.presentation}</span>
                              {product.weightKg ? <span>• {product.weightKg} kg</span> : null}
                            </div>
                          </div>
                        </div>
                      </td>

                      {/* SKU & ICA */}
                      <td className="p-3.5 font-mono text-[11px]">
                        <span className="bg-slate-100 text-slate-800 px-2 py-0.5 rounded font-bold">
                          {product.sku}
                        </span>
                        {product.icaRegistration && (
                          <div className="flex items-center gap-1 text-[10px] text-emerald-700 font-bold mt-1">
                            <ShieldCheck className="w-3 h-3" />
                            <span>ICA: {product.icaRegistration}</span>
                          </div>
                        )}
                      </td>

                      {/* Category */}
                      <td className="p-3.5">
                        <span className="bg-slate-100 text-slate-700 px-2 py-0.5 rounded-full text-[11px] font-semibold">
                          {product.category}
                        </span>
                        {product.species && (
                          <span className="block text-[10px] text-slate-400 mt-1">
                            {product.species}
                          </span>
                        )}
                      </td>

                      {/* Price in COP */}
                      <td className="p-3.5 font-mono">
                        <div
                          onClick={() => handleOpenQuickPricing(product)}
                          className="cursor-pointer group flex items-center gap-1.5"
                          title="Haga clic para editar precio"
                        >
                          <span className="font-bold text-slate-900 text-sm group-hover:text-red-600 transition">
                            {formatCOP(product.price)}
                          </span>
                          <Edit3 className="w-3 h-3 text-slate-400 opacity-0 group-hover:opacity-100 transition" />
                        </div>
                        {product.originalPrice && product.originalPrice > product.price && (
                          <span className="text-[10px] text-slate-400 line-through">
                            {formatCOP(product.originalPrice)}
                          </span>
                        )}
                      </td>

                      {/* Stock by store */}
                      <td className="p-3.5">
                        <div className="flex flex-wrap items-center gap-1.5 font-mono text-[11px]">
                          {associatedStores.map(store=><span key={store.id} className="px-1.5 py-0.5 rounded bg-slate-50" title={store.name}>{store.customerName||store.name}: {product.stockByStore[store.id]||0}</span>)}
                        </div>
                        <span className="text-[10px] text-slate-400 block mt-0.5">
                          Total: <strong>{totalStock}</strong> un.
                        </span>
                      </td>

                      {/* Status */}
                      <td className="p-3.5">
                        <button
                          onClick={() => handleToggleStatus(product)}
                          className={`px-2.5 py-1 rounded-full text-[10px] font-black tracking-wide flex items-center gap-1.5 transition cursor-pointer ${
                            isActive
                              ? 'bg-emerald-100 text-emerald-800 hover:bg-emerald-200'
                              : 'bg-slate-200 text-slate-700 hover:bg-slate-300'
                          }`}
                          title="Haga clic para cambiar estado"
                        >
                          {isActive ? (
                            <>
                              <Eye className="w-3 h-3 text-emerald-600" />
                              <span>ACTIVO</span>
                            </>
                          ) : (
                            <>
                              <EyeOff className="w-3 h-3 text-slate-500" />
                              <span>INACTIVO</span>
                            </>
                          )}
                        </button>
                      </td>

                      {/* Actions */}
                      <td className="p-3.5 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            onClick={() => handleOpenQuickPricing(product)}
                            className="p-1.5 hover:bg-slate-100 text-slate-600 hover:text-slate-900 rounded-lg transition"
                            title="Ajustar precio y stock"
                          >
                            <DollarSign className="w-4 h-4 text-emerald-600" />
                          </button>
                          <button
                            onClick={() => handleOpenImageModal(product)}
                            className="p-1.5 hover:bg-slate-100 text-slate-600 hover:text-slate-900 rounded-lg transition"
                            title="Subir / cambiar foto"
                          >
                            <ImageIcon className="w-4 h-4 text-blue-600" />
                          </button>
                          <button
                            onClick={() => handleOpenEditModal(product)}
                            className="p-1.5 hover:bg-slate-100 text-slate-600 hover:text-slate-900 rounded-lg transition"
                            title="Editar ficha completa"
                          >
                            <Edit3 className="w-4 h-4 text-slate-700" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* QUICK PRICE & STOCK MODAL */}
      {isQuickPricingOpen && quickProduct && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-sm p-4">
          <div className="bg-white rounded-3xl shadow-2xl border border-slate-200 w-full max-w-md overflow-hidden animate-in fade-in zoom-in-95">
            <div className="bg-slate-900 p-5 text-white flex items-center justify-between">
              <div>
                <h3 className="text-base font-black">Ajuste Rápido de Precio & Stock</h3>
                <p className="text-xs text-slate-400 truncate max-w-xs">{quickProduct.name}</p>
              </div>
              <button
                onClick={() => setIsQuickPricingOpen(false)}
                className="text-slate-400 hover:text-white p-1 rounded-full hover:bg-slate-800"
              >
                ✕
              </button>
            </div>

            <div className="p-6 space-y-4">
              <label className="block text-xs font-bold text-slate-700">Presentación
                <select aria-label="Presentación a editar" className="mt-2 w-full p-2 border rounded-xl" value={quickVariantId} onChange={e=>{setQuickVariantId(e.target.value);const v=saleVariant(quickProduct,e.target.value);setQuickPrice(v.price);setQuickStock({...v.stockByStore});}}>
                  {quickProduct.presentaciones?.map(v=><option key={v.varianteId} value={v.varianteId}>{v.nombre} — {v.sku||'Sin SKU'}</option>)}
                </select>
              </label>
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Precio de Venta en COP
                </label>
                <div className="relative">
                  <span className="absolute left-3.5 top-2.5 text-slate-400 font-bold text-sm">$</span>
                  <input
                    type="number"
                    value={quickPrice}
                    onChange={e => setQuickPrice(Math.max(0, parseInt(e.target.value) || 0))}
                    className="w-full pl-8 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold font-mono focus:outline-none focus:ring-2 focus:ring-red-600 focus:bg-white"
                  />
                </div>
                <p className="text-[11px] text-slate-400 mt-1">Formateado: {formatCOP(quickPrice)}</p>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-2">
                  Existencias por bodega (incluyen reservas)
                </label>
                <div className="grid grid-cols-2 gap-2.5">
                  {configuredStores.filter(s=>s.isActive&&(saleVariant(quickProduct,quickVariantId).bodegaIds||[]).some(b=>b===s.id||b===s.shopifyLocationGid)).map(store=><label key={store.id} className="text-xs text-slate-600">{store.customerName||store.name}
                    <input aria-label={'Existencia '+store.name} type="number" className="w-full px-3 py-2 border rounded-xl" value={quickStock[store.id]??0} onChange={e=>setQuickStock({...quickStock,[store.id]:Number(e.target.value)})}/>
                    <span>Reservadas: {saleVariant(quickProduct,quickVariantId).reservedStockByStore[store.id]||0} · Disponibles: {(quickStock[store.id]||0)-(saleVariant(quickProduct,quickVariantId).reservedStockByStore[store.id]||0)}</span>
                  </label>)}
                </div>
              </div>

              <div className="pt-2 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsQuickPricingOpen(false)}
                  className="px-4 py-2.5 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-xl"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={handleSaveQuickPricing}
                  className="px-5 py-2.5 bg-red-600 hover:bg-red-700 text-white text-xs font-bold rounded-xl shadow-md cursor-pointer"
                >
                  Guardar Cambios
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* IMAGE UPLOADER MODAL */}
      {isImageModalOpen && imageTargetProduct && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-sm p-4">
          <div className="bg-white rounded-3xl shadow-2xl border border-slate-200 w-full max-w-lg overflow-hidden animate-in fade-in zoom-in-95">
            <div className="bg-slate-900 p-5 text-white flex items-center justify-between">
              <div>
                <h3 className="text-base font-black">Carga de Imagen para Producto</h3>
                <p className="text-xs text-slate-400 truncate max-w-sm">{imageTargetProduct.name}</p>
              </div>
              <button
                onClick={() => setIsImageModalOpen(false)}
                className="text-slate-400 hover:text-white p-1 rounded-full hover:bg-slate-800"
              >
                ✕
              </button>
            </div>

            <div className="p-6 space-y-4">
              {/* Dropzone */}
              <div
                onClick={() => fileInputRef.current?.click()}
                className="border-2 border-dashed border-slate-300 hover:border-red-500 rounded-3xl p-6 text-center cursor-pointer bg-slate-50 hover:bg-red-50/20 transition flex flex-col items-center justify-center gap-2"
              >
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleFileChange}
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  className="hidden"
                />
                <div className="w-12 h-12 bg-white rounded-2xl border border-slate-200 shadow-2xs flex items-center justify-center text-red-600">
                  <Upload className="w-6 h-6" />
                </div>
                <div>
                  <p className="text-xs font-bold text-slate-800">
                    Seleccionar imagen desde computador o celular
                  </p>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    Formatos: PNG, JPG, WEBP, GIF. Máximo 5 MB.
                  </p>
                </div>
              </div>

              {/* Preview */}
              {uploadPreview ? (
                <div className="bg-slate-50 p-3 rounded-2xl border border-slate-200 flex items-center gap-3">
                  <img
                    src={uploadPreview}
                    alt="Preview"
                    className="w-16 h-16 rounded-xl object-cover border border-slate-300 shadow-2xs"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-bold text-slate-900 truncate">{uploadFilename || 'Imagen seleccionada'}</p>
                    <p className="text-[10px] text-emerald-600 font-bold mt-0.5">✓ Lista para cargar y validar</p>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-2xl border border-slate-100">
                  <img
                    src={imageTargetProduct.image}
                    alt="Actual"
                    className="w-14 h-14 rounded-xl object-cover border border-slate-200"
                  />
                  <div>
                    <span className="text-[10px] font-bold text-slate-400 uppercase">Fotografía actual</span>
                    <p className="text-xs text-slate-600 truncate max-w-xs">{imageTargetProduct.image}</p>
                  </div>
                </div>
              )}

              {/* Existing gallery thumbnails */}
              {imageTargetProduct.gallery && imageTargetProduct.gallery.length > 1 && (
                <div>
                  <span className="block text-[11px] font-bold text-slate-600 mb-1.5">Galería del producto</span>
                  <div className="flex items-center gap-2 overflow-x-auto pb-1">
                    {imageTargetProduct.gallery.map((imgUrl, idx) => (
                      <div key={idx} className="relative group shrink-0">
                        <img
                          src={imgUrl}
                          alt=""
                          className={`w-12 h-12 rounded-lg object-cover border ${imgUrl === imageTargetProduct.image ? 'border-red-600 ring-2 ring-red-600/30' : 'border-slate-200'}`}
                        />
                        {imgUrl !== imageTargetProduct.image && (
                          <button
                            type="button"
                            onClick={async () => {
                              const updated = await api.updateAdminProduct(imageTargetProduct.id, { image: imgUrl });
                              setProducts(prev => prev.map(p => p.id === imageTargetProduct.id ? updated : p));
                              setImageTargetProduct(updated);
                              showNotification('Foto principal actualizada.');
                            }}
                            className="absolute inset-0 bg-slate-900/70 text-white rounded-lg flex items-center justify-center text-[9px] font-bold opacity-0 group-hover:opacity-100 transition"
                          >
                            Hacer Principal
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Actions */}
              <div className="pt-2 flex items-center justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setIsImageModalOpen(false)}
                  className="px-4 py-2.5 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-xl"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  disabled={!uploadPreview || isUploading}
                  onClick={() => handleUploadImageSubmit(true)}
                  className="px-5 py-2.5 bg-red-600 hover:bg-red-700 text-white text-xs font-bold rounded-xl shadow-md transition disabled:opacity-50 flex items-center gap-2 cursor-pointer"
                >
                  {isUploading && (
                    <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                  )}
                  <span>Establecer como Foto Principal</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* FULL PRODUCT CREATE / EDIT MODAL */}
      {isEditorOpen && editingProduct && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-sm p-4 overflow-y-auto">
          <div className="bg-white rounded-3xl shadow-2xl border border-slate-200 w-full max-w-2xl my-8 overflow-hidden animate-in fade-in zoom-in-95">
            <div className="bg-slate-900 p-5 text-white flex items-center justify-between sticky top-0 z-10">
              <div className="flex items-center gap-2.5">
                <Package className="w-5 h-5 text-red-500" />
                <div>
                  <h3 className="text-base font-black">
                    {isNewProduct ? 'Crear Nuevo Producto en Catálogo' : 'Editar Ficha de Producto'}
                  </h3>
                  <p className="text-xs text-slate-400">
                    {isNewProduct ? 'Ingresa los datos para registrar un producto' : `Editando SKU: ${editingProduct.sku}`}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsEditorOpen(false)}
                className="text-slate-400 hover:text-white p-1 rounded-full hover:bg-slate-800"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveProduct} className="p-6 space-y-4 max-h-[80vh] overflow-y-auto">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Name */}
                <div className="md:col-span-2">
                  <label className="block text-xs font-bold text-slate-700 mb-1">Nombre Comercial *</label>
                  <input
                    type="text"
                    value={editingProduct.name}
                    onChange={e => setEditingProduct({ ...editingProduct, name: e.target.value })}
                    placeholder="Ej. Royal Canin Maxi Adult 15 kg"
                    required
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold focus:outline-none focus:ring-2 focus:ring-red-600 focus:bg-white"
                  />
                </div>

                {/* Brand */}
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Marca *</label>
                  <input
                    type="text"
                    value={editingProduct.brand}
                    onChange={e => setEditingProduct({ ...editingProduct, brand: e.target.value })}
                    placeholder="Ej. Royal Canin"
                    required
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium focus:outline-none focus:ring-2 focus:ring-red-600 focus:bg-white"
                  />
                </div>

                {/* SKU */}
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">SKU *</label>
                  <input
                    type="text"
                    value={editingProduct.sku}
                    onChange={e => setEditingProduct({ ...editingProduct, sku: e.target.value })}
                    placeholder="Ej. SKU-RC-MAXI-15K"
                    required
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono font-bold focus:outline-none focus:ring-2 focus:ring-red-600 focus:bg-white"
                  />
                </div>

                {/* Category */}
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Categoría Principal *</label>
                  <select
                    value={editingProduct.category}
                    onChange={e => setEditingProduct({ ...editingProduct, category: e.target.value as MainCategory })}
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-red-600"
                  >
                    <option value="Alimentos">Alimentos</option>
                    <option value="Farmacia">Farmacia</option>
                    <option value="Antipulgas">Antipulgas</option>
                    <option value="Arenas">Arenas</option>
                    <option value="Snacks">Snacks</option>
                    <option value="Higiene">Higiene</option>
                    <option value="Accesorios">Accesorios</option>
                  </select>
                </div>

                {/* Species */}
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Especie Destino *</label>
                  <select
                    value={editingProduct.species}
                    onChange={e => setEditingProduct({ ...editingProduct, species: e.target.value as Species })}
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-red-600"
                  >
                    <option value="Perro">Perro</option>
                    <option value="Gato">Gato</option>
                    <option value="Ambos">Ambos (Perro & Gato)</option>
                    <option value="Otros">Otros</option>
                  </select>
                </div>

                {/* Price COP */}
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Precio en COP *</label>
                  <input
                    type="number"
                    value={editingProduct.price}
                    onChange={e => setEditingProduct({ ...editingProduct, price: Math.max(0, parseInt(e.target.value) || 0) })}
                    required
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono font-bold focus:outline-none focus:ring-2 focus:ring-red-600 focus:bg-white"
                  />
                  <span className="text-[10px] text-slate-400 mt-0.5 block">{formatCOP(editingProduct.price)}</span>
                </div>

                {/* Original Price COP */}
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Precio Original (Tachado)</label>
                  <input
                    type="number"
                    value={editingProduct.originalPrice || ''}
                    onChange={e => setEditingProduct({ ...editingProduct, originalPrice: e.target.value ? parseInt(e.target.value) : undefined })}
                    placeholder="Opcional para mostrar descuento"
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono focus:outline-none focus:ring-2 focus:ring-red-600 focus:bg-white"
                  />
                </div>

                {/* Presentation */}
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Presentación *</label>
                  <input
                    type="text"
                    value={editingProduct.presentation}
                    onChange={e => setEditingProduct({ ...editingProduct, presentation: e.target.value })}
                    placeholder="Ej. Bulto 15 kg, Caja 20 tab"
                    required
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium focus:outline-none focus:ring-2 focus:ring-red-600 focus:bg-white"
                  />
                </div>

                {/* Weight in kg */}
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Peso en Kilogramos (kg) *</label>
                  <input
                    type="number"
                    step="0.01"
                    value={editingProduct.weightKg}
                    onChange={e => setEditingProduct({ ...editingProduct, weightKg: parseFloat(e.target.value) || 0 })}
                    required
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono focus:outline-none focus:ring-2 focus:ring-red-600 focus:bg-white"
                  />
                </div>

                {/* Image URL */}
                <div className="md:col-span-2">
                  <label className="block text-xs font-bold text-slate-700 mb-1">URL de Fotografía Principal</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={editingProduct.image}
                      onChange={e => setEditingProduct({ ...editingProduct, image: e.target.value })}
                      placeholder="https://images.unsplash.com/..."
                      required
                      className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono focus:outline-none focus:ring-2 focus:ring-red-600 focus:bg-white"
                    />
                    {editingProduct.image && (
                      <img
                        src={editingProduct.image}
                        alt="Preview"
                        className="w-10 h-10 rounded-lg object-cover border border-slate-200 shrink-0"
                      />
                    )}
                  </div>
                </div>

                {/* Description */}
                <div className="md:col-span-2">
                  <label className="block text-xs font-bold text-slate-700 mb-1">Descripción</label>
                  <textarea
                    rows={3}
                    value={editingProduct.description}
                    onChange={e => setEditingProduct({ ...editingProduct, description: e.target.value })}
                    placeholder="Descripción detallada de la fórmula, beneficios o posología..."
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-red-600 focus:bg-white"
                  />
                </div>

                {/* ICA Registration */}
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Registro ICA (Opcional)</label>
                  <input
                    type="text"
                    value={editingProduct.icaRegistration || ''}
                    onChange={e => setEditingProduct({ ...editingProduct, icaRegistration: e.target.value })}
                    placeholder="Ej. Reg. ICA 10842-MV"
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono focus:outline-none focus:ring-2 focus:ring-red-600 focus:bg-white"
                  />
                </div>

                {/* Status */}
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Estado de Venta *</label>
                  <select
                    value={editingProduct.status || 'ACTIVE'}
                    onChange={e => setEditingProduct({ ...editingProduct, status: e.target.value })}
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold focus:outline-none focus:ring-2 focus:ring-red-600"
                  >
                    <option value="ACTIVE">Activo (Visible en tienda)</option>
                    <option value="INACTIVE">Inactivo (Pausado / Oculto)</option>
                  </select>
                </div>
              </div>

              {/* Warehouse Inventory Section */}
              <div className="pt-2 border-t border-slate-100">
                <label className="block text-xs font-bold text-slate-800 mb-2">
                  Inventario por Bodega (Unidades Disponibles)
                </label>
                <div className="grid grid-cols-3 sm:grid-cols-5 gap-2.5">
                  {['HUB_KENNEDY', 'HUB_ALAMOS', 'HUB_SUBA', 'HUB_CENTRO', 'HUB_FONTIBON'].map(storeKey => {
                    const label = storeKey.replace('HUB_', '');
                    return (
                      <div key={storeKey} className="bg-slate-50 p-2.5 rounded-xl border border-slate-200">
                        <span className="block text-[10px] font-bold text-slate-500 uppercase">{label}</span>
                        <input
                          type="number"
                          value={editingProduct.stockByStore?.[storeKey] ?? 0}
                          onChange={e => {
                            const newStock = { ...(editingProduct.stockByStore || {}) };
                            newStock[storeKey] = Math.max(0, parseInt(e.target.value) || 0);
                            setEditingProduct({ ...editingProduct, stockByStore: newStock });
                          }}
                          className="w-full mt-1 bg-white border border-slate-200 rounded-lg px-2 py-1 text-xs font-mono font-bold text-center focus:outline-none focus:ring-2 focus:ring-red-600"
                        />
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Modal footer */}
              <div className="pt-4 border-t border-slate-100 flex items-center justify-end gap-2.5 sticky bottom-0 bg-white">
                <button
                  type="button"
                  onClick={() => setIsEditorOpen(false)}
                  className="px-4 py-2.5 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-xl transition"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-6 py-2.5 bg-red-600 hover:bg-red-700 text-white text-xs font-bold rounded-xl shadow-md transition cursor-pointer flex items-center gap-2"
                >
                  <Save className="w-4 h-4" />
                  <span>{isNewProduct ? 'Crear Producto' : 'Guardar Ficha'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* AUDIT LOG MODAL */}
      {isAuditOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-sm p-4">
          <div className="bg-white rounded-3xl shadow-2xl border border-slate-200 w-full max-w-2xl max-h-[85vh] overflow-hidden flex flex-col animate-in fade-in zoom-in-95">
            <div className="bg-slate-900 p-5 text-white flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2.5">
                <History className="w-5 h-5 text-red-500" />
                <div>
                  <h3 className="text-base font-black">Historial Inmutable de Auditoría</h3>
                  <p className="text-xs text-slate-400">Registro cronológico de modificaciones al catálogo</p>
                </div>
              </div>
              <button
                onClick={() => setIsAuditOpen(false)}
                className="text-slate-400 hover:text-white p-1 rounded-full hover:bg-slate-800"
              >
                ✕
              </button>
            </div>

            <div className="p-6 overflow-y-auto flex-1">
              {loadingAudit ? (
                <div className="py-12 text-center text-slate-400">
                  <div className="w-8 h-8 border-3 border-red-600 border-t-transparent rounded-full animate-spin mx-auto mb-2"></div>
                  <p className="text-xs">Cargando registros de auditoría...</p>
                </div>
              ) : auditLogs.length === 0 ? (
                <p className="text-center text-slate-400 text-xs py-10">No hay modificaciones registradas todavía.</p>
              ) : (
                <div className="space-y-3">
                  {auditLogs.map(log => (
                    <div key={log.id} className="bg-slate-50 border border-slate-200 rounded-2xl p-3.5 text-xs">
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-bold text-slate-900">{log.action}</span>
                        <span className="text-[10px] text-slate-400 font-mono">{log.timestamp}</span>
                      </div>
                      <p className="text-slate-600 font-semibold">{log.productName} <span className="font-mono text-[11px] text-slate-400">({log.productId})</span></p>
                      <p className="text-[11px] text-slate-500 mt-1">Por: <strong>{log.actor?.name || log.actor?.email}</strong></p>
                      {log.details && (
                        <pre className="mt-2 p-2 bg-slate-900 text-slate-200 rounded-lg text-[10px] font-mono overflow-x-auto">
                          {JSON.stringify(log.details, null, 2)}
                        </pre>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
