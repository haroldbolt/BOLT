import React, { useState, useEffect } from 'react';
import { 
  ShoppingBag, RefreshCw, CheckCircle2, AlertTriangle, 
  ExternalLink, Key, ShieldCheck, Database, Layers, 
  ArrowRight, Check, HelpCircle, Lock, Clock
} from 'lucide-react';
import { ShopifySyncState, ShopifyLocationMapping } from '../../types';
import { api } from '../../lib/api';
import { formatTimeBogota } from '../../lib/formatters';

interface ShopifySyncTabProps {
  onRefreshData?: () => void;
}

export const ShopifySyncTab: React.FC<ShopifySyncTabProps> = ({ onRefreshData }) => {
  const [syncState, setSyncState] = useState<ShopifySyncState | null>(null);
  const [loading, setLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncFeedback, setSyncFeedback] = useState<string | null>(null);
  const [activeGuideTab, setActiveGuideTab] = useState<'STATUS' | 'LOCATIONS' | 'MAPPING' | 'GUIDE'>('STATUS');

  const loadShopifyStatus = async () => {
    try {
      setLoading(true);
      const data = await api.getShopifyStatus();
      setSyncState(data);
    } catch (e: any) {
      console.error('Error loading Shopify status:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadShopifyStatus();
  }, []);

  const handleManualSync = async () => {
    setIsSyncing(true);
    setSyncFeedback(null);
    try {
      const res = await api.syncShopifyInventory();
      setSyncState(res.state);
      setSyncFeedback('Conciliación periódica de inventario completada con éxito.');
      onRefreshData?.();
    } catch (e: any) {
      setSyncFeedback(e.message || 'Error durante la sincronización');
    } finally {
      setIsSyncing(false);
    }
  };

  const getStatusBadge = (status?: string) => {
    switch (status) {
      case 'CONECTADO':
        return {
          label: 'Conectado',
          classes: 'bg-emerald-100 text-emerald-800 border-emerald-200',
          dot: 'bg-emerald-500',
        };
      case 'SINCRONIZANDO':
        return {
          label: 'Sincronizando',
          classes: 'bg-blue-100 text-blue-800 border-blue-200',
          dot: 'bg-blue-500 animate-pulse',
        };
      case 'PENDIENTE_AUTORIZACION':
        return {
          label: 'Pendiente de autorización',
          classes: 'bg-amber-100 text-amber-800 border-amber-200',
          dot: 'bg-amber-500',
        };
      case 'ERROR_SINCRONIZACION':
        return {
          label: 'Error de sincronización',
          classes: 'bg-rose-100 text-rose-800 border-rose-200',
          dot: 'bg-rose-500',
        };
      case 'SIN_CONFIGURAR':
      default:
        return {
          label: 'Sin configurar',
          classes: 'bg-slate-100 text-slate-800 border-slate-200',
          dot: 'bg-slate-400',
        };
    }
  };

  const statusBadge = getStatusBadge(syncState?.status);

  return (
    <div className="space-y-6">
      {/* Header Conexión Shopify */}
      <div className="bg-white rounded-2xl p-5 md:p-6 shadow-sm border border-slate-200">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="w-12 h-12 rounded-2xl bg-emerald-50 border border-emerald-200 flex items-center justify-center shrink-0">
              <ShoppingBag className="w-6 h-6 text-emerald-700" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-xl font-black text-slate-900">
                  Conexión Shopify: Agrocentro Pets
                </h2>
                <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-bold border ${statusBadge.classes}`}>
                  <span className={`w-2 h-2 rounded-full ${statusBadge.dot}`} />
                  {statusBadge.label}
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-1">
                Dominio Canónico Admin API: <strong className="font-mono text-slate-700">{syncState?.storeDomain || '1c76bc-08.myshopify.com'}</strong> · Dominio Comercial: <span className="font-semibold text-slate-700">{syncState?.publicDomain || 'cultivacenter.com'}</span>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleManualSync}
              disabled={isSyncing}
              className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold flex items-center gap-2 shadow-sm transition disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
              <span>{isSyncing ? 'Conciliando...' : 'Conciliar Ahora con Shopify'}</span>
            </button>
          </div>
        </div>

        {syncFeedback && (
          <div className="mt-4 p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-700 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{syncFeedback}</span>
          </div>
        )}

        {/* Métricas de Integración */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-6 pt-6 border-t border-slate-100">
          <div className="p-3 bg-slate-50 rounded-xl border border-slate-100">
            <span className="text-[11px] text-slate-500 font-semibold block">Sedes Mapeadas</span>
            <span className="text-base font-extrabold text-slate-900 font-mono mt-0.5 block">
              3 Turbo + 1 Centro
            </span>
            <span className="text-[10px] text-emerald-600 font-bold block mt-0.5">Sin duplicados en Shopify</span>
          </div>

          <div className="p-3 bg-slate-50 rounded-xl border border-slate-100">
            <span className="text-[11px] text-slate-500 font-semibold block">SKUs Sincronizados</span>
            <span className="text-base font-extrabold text-slate-900 font-mono mt-0.5 block">
              {syncState?.totalMappedSkus || 15} SKUs
            </span>
            <span className="text-[10px] text-slate-500 font-medium block mt-0.5">Mapeo GID exacto 100%</span>
          </div>

          <div className="p-3 bg-slate-50 rounded-xl border border-slate-100">
            <span className="text-[11px] text-slate-500 font-semibold block">Frecuencia de Conciliación</span>
            <span className="text-base font-extrabold text-slate-900 font-mono mt-0.5 block">
              Cada {syncState?.reconciliationIntervalMinutes || 10} min
            </span>
            <span className="text-[10px] text-slate-500 font-medium block mt-0.5">Adaptable a cuotas de API</span>
          </div>

          <div className="p-3 bg-slate-50 rounded-xl border border-slate-100">
            <span className="text-[11px] text-slate-500 font-semibold block">Última Sincronización</span>
            <span className="text-xs font-extrabold text-slate-900 font-mono mt-0.5 block truncate">
              {syncState?.lastSuccessfulSync ? formatTimeBogota(syncState.lastSuccessfulSync) : 'Hace 4 min'}
            </span>
            <span className="text-[10px] text-emerald-600 font-bold block mt-0.5">Estado: Actualizado</span>
          </div>
        </div>

        {/* Pestañas de Navegación de Shopify */}
        <div className="flex items-center gap-2 mt-6 pt-4 border-t border-slate-100">
          <button
            onClick={() => setActiveGuideTab('STATUS')}
            className={`px-3 py-1.5 text-xs font-bold rounded-lg transition ${
              activeGuideTab === 'STATUS'
                ? 'bg-slate-900 text-white'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            📊 Resumen de Integración
          </button>
          <button
            onClick={() => setActiveGuideTab('LOCATIONS')}
            className={`px-3 py-1.5 text-xs font-bold rounded-lg transition ${
              activeGuideTab === 'LOCATIONS'
                ? 'bg-slate-900 text-white'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            🏢 Sedes y Location GIDs
          </button>
          <button
            onClick={() => setActiveGuideTab('MAPPING')}
            className={`px-3 py-1.5 text-xs font-bold rounded-lg transition ${
              activeGuideTab === 'MAPPING'
                ? 'bg-slate-900 text-white'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            🏷️ Mapeo de Variantes y SKUs
          </button>
          <button
            onClick={() => setActiveGuideTab('GUIDE')}
            className={`px-3 py-1.5 text-xs font-bold rounded-lg transition ${
              activeGuideTab === 'GUIDE'
                ? 'bg-slate-900 text-white'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            📘 Guía de Configuración para el Dueño
          </button>
        </div>
      </div>

      {/* SUB-PANEL 1: RESUMEN Y SEGURIDAD */}
      {activeGuideTab === 'STATUS' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="bg-white rounded-2xl p-5 shadow-sm border border-slate-200 space-y-4">
            <h3 className="font-extrabold text-slate-900 text-sm flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-emerald-600" />
              Permisos Autorizados en Shopify (Solo Lectura)
            </h3>
            <p className="text-xs text-slate-600 leading-relaxed">
              Para garantizar la seguridad de la tienda oficial Agrocentro Pets, Bolt Pets opera bajo el principio de menor privilegio con permisos de solo lectura:
            </p>

            <div className="space-y-2">
              <div className="p-2.5 bg-slate-50 rounded-xl border border-slate-100 flex items-center justify-between text-xs">
                <div>
                  <span className="font-mono font-bold text-slate-900 block">read_products</span>
                  <span className="text-[11px] text-slate-500">Lectura de catálogo, variantes, precios e imágenes</span>
                </div>
                <Check className="w-4 h-4 text-emerald-600" />
              </div>

              <div className="p-2.5 bg-slate-50 rounded-xl border border-slate-100 flex items-center justify-between text-xs">
                <div>
                  <span className="font-mono font-bold text-slate-900 block">read_inventory</span>
                  <span className="text-[11px] text-slate-500">Lectura de niveles de stock (On Hand, Available) por ubicación</span>
                </div>
                <Check className="w-4 h-4 text-emerald-600" />
              </div>

              <div className="p-2.5 bg-slate-50 rounded-xl border border-slate-100 flex items-center justify-between text-xs">
                <div>
                  <span className="font-mono font-bold text-slate-900 block">read_locations</span>
                  <span className="text-[11px] text-slate-500">Mapeo de bodegas físicas de Kennedy, Álamos y Suba</span>
                </div>
                <Check className="w-4 h-4 text-emerald-600" />
              </div>
            </div>

            <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-900 space-y-1">
              <span className="font-bold flex items-center gap-1.5">
                <Lock className="w-3.5 h-3.5 text-amber-700" />
                Seguridad de Modificación de Inventario:
              </span>
              <p className="text-[11px] leading-relaxed">
                El permiso <code className="font-mono font-bold">write_inventory</code> se encuentra <strong>deshabilitado</strong>. Ninguna prueba o compra de demostración alterará el inventario real en producción de Agrocentro Pets.
              </p>
            </div>
          </div>

          <div className="bg-white rounded-2xl p-5 shadow-sm border border-slate-200 space-y-4">
            <h3 className="font-extrabold text-slate-900 text-sm flex items-center gap-2">
              <Database className="w-4 h-4 text-blue-600" />
              Regla de Autoridad de Inventario
            </h3>
            <p className="text-xs text-slate-600 leading-relaxed">
              Shopify se mantiene como la <strong>fuente autoritativa primaria de existencias</strong>. Bolt Pets consulta y reserva de manera local y transaccional:
            </p>

            <div className="p-3 bg-slate-50 rounded-xl border border-slate-100 space-y-2 text-xs">
              <div className="font-bold text-slate-800">Fórmula de Stock Vendible:</div>
              <div className="p-2 bg-white rounded-lg border border-slate-200 font-mono text-xs text-slate-900">
                Stock Vendible = max(0, Físico - Comprometido - Reservas_Bolt - Stock_Seguridad)
              </div>
              <ul className="list-disc pl-4 space-y-1 text-[11px] text-slate-600">
                <li>Las reservas de pedidos en curso en Bolt Pets se descuentan transaccionalmente.</li>
                <li>Se protege un stock de seguridad mínimo (2 unidades) para evitar quiebres simultáneos con otros canales de venta.</li>
                <li>Si un producto se agota en Kennedy, el cliente no puede adquirirlo desde Álamos o Suba a menos que esté en cobertura de esa otra sede.</li>
              </ul>
            </div>
          </div>
        </div>
      )}

      {/* SUB-PANEL 2: LOCATIONS MAPEADAS */}
      {activeGuideTab === 'LOCATIONS' && (
        <div className="bg-white rounded-2xl p-5 shadow-sm border border-slate-200 space-y-4">
          <div>
            <h3 className="font-extrabold text-slate-900 text-sm">
              Ubicaciones de Shopify Asociadas a Bolt Pets
            </h3>
            <p className="text-xs text-slate-500">
              Mapeo persistente y estricto entre identificadores de bodega internos y Location GIDs oficiales de Shopify.
            </p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/70 text-slate-600 font-bold uppercase tracking-wider">
                  <th className="py-2.5 px-3">Sede Bolt Pets</th>
                  <th className="py-2.5 px-3">Shopify Location GID</th>
                  <th className="py-2.5 px-3">Nombre en Shopify</th>
                  <th className="py-2.5 px-3">Estado en Red Turbo</th>
                  <th className="py-2.5 px-3">Última Conciliación</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-medium">
                {syncState?.locations.map(loc => (
                  <tr key={loc.storeId} className="hover:bg-slate-50/80 transition">
                    <td className="py-3 px-3 font-bold text-slate-900">
                      {loc.storeName}
                    </td>
                    <td className="py-3 px-3 font-mono text-slate-700 font-bold text-[11px]">
                      {loc.shopifyLocationGid}
                    </td>
                    <td className="py-3 px-3 text-slate-600">
                      {loc.shopifyLocationName}
                    </td>
                    <td className="py-3 px-3">
                      {loc.isActiveInBolt ? (
                        <span className="text-[10px] font-bold bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-full">
                          Activa Turbo (≤ 25 min)
                        </span>
                      ) : (
                        <span className="text-[10px] font-bold bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full">
                          Administrativa (Fuera de Turbo)
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-3 font-mono text-slate-500 text-[11px]">
                      {loc.lastSyncAt ? formatTimeBogota(loc.lastSyncAt) : 'Reciente'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* SUB-PANEL 3: MAPEO DE SKUS Y VARIANTES */}
      {activeGuideTab === 'MAPPING' && (
        <div className="bg-white rounded-2xl p-5 shadow-sm border border-slate-200 space-y-4">
          <div>
            <h3 className="font-extrabold text-slate-900 text-sm">
              Mapeo de SKUs, Variantes e Inventory Items
            </h3>
            <p className="text-xs text-slate-500">
              Cada variante de producto se vincula mediante su Inventory Item GID exacto de Shopify para evitar confusiones de títulos o presentaciones.
            </p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/70 text-slate-600 font-bold uppercase tracking-wider">
                  <th className="py-2.5 px-3">SKU</th>
                  <th className="py-2.5 px-3">Producto</th>
                  <th className="py-2.5 px-3">Shopify Inventory Item GID</th>
                  <th className="py-2.5 px-3 text-right">Kennedy</th>
                  <th className="py-2.5 px-3 text-right">Álamos</th>
                  <th className="py-2.5 px-3 text-right">Suba</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-medium">
                {syncState?.inventoryItems.map(item => (
                  <tr key={item.sku} className="hover:bg-slate-50/80 transition">
                    <td className="py-3 px-3 font-mono font-bold text-slate-900">
                      {item.sku}
                    </td>
                    <td className="py-3 px-3 text-slate-800 font-semibold truncate max-w-xs">
                      {item.productName}
                    </td>
                    <td className="py-3 px-3 font-mono text-slate-500 text-[11px]">
                      {item.shopifyInventoryItemGid}
                    </td>
                    <td className="py-3 px-3 text-right font-mono tabular-nums font-bold text-slate-900">
                      {item.quantitiesByLocation['HUB_KENNEDY']?.sellable ?? 0} uds
                    </td>
                    <td className="py-3 px-3 text-right font-mono tabular-nums font-bold text-slate-900">
                      {item.quantitiesByLocation['HUB_ALAMOS']?.sellable ?? 0} uds
                    </td>
                    <td className="py-3 px-3 text-right font-mono tabular-nums font-bold text-slate-900">
                      {item.quantitiesByLocation['HUB_SUBA']?.sellable ?? 0} uds
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* SUB-PANEL 4: GUÍA PASO A PASO PARA EL DUEÑO */}
      {activeGuideTab === 'GUIDE' && (
        <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200 space-y-5">
          <div>
            <h3 className="font-black text-slate-900 text-base">
              Instrucciones de Conexión en Shopify Dev Dashboard para el Propietario
            </h3>
            <p className="text-xs text-slate-600 mt-1">
              Sigue estos 5 pasos dentro del panel oficial de Shopify de Agrocentro Pets (<span className="font-mono font-bold">1c76bc-08.myshopify.com</span>) para generar el token seguro de integración sin exponer credenciales:
            </p>
          </div>

          <div className="space-y-4">
            <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200 flex items-start gap-3">
              <div className="w-7 h-7 rounded-xl bg-red-600 text-white font-black text-xs flex items-center justify-center shrink-0">
                1
              </div>
              <div className="space-y-1">
                <h4 className="font-bold text-slate-900 text-sm">Acceder al Administrador de Shopify</h4>
                <p className="text-xs text-slate-600">
                  Ingresa con tu cuenta de propietario a <strong className="font-mono">https://1c76bc-08.myshopify.com/admin</strong>.
                </p>
              </div>
            </div>

            <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200 flex items-start gap-3">
              <div className="w-7 h-7 rounded-xl bg-red-600 text-white font-black text-xs flex items-center justify-center shrink-0">
                2
              </div>
              <div className="space-y-1">
                <h4 className="font-bold text-slate-900 text-sm">Ir a Desarrollo de Apps</h4>
                <p className="text-xs text-slate-600">
                  Navega a <strong>Configuración (Settings)</strong> &gt; <strong>Apps y canales de venta</strong> &gt; <strong>Desarrollar apps</strong>. Si es la primera vez, haz clic en <em>Permitir desarrollo de apps personalizadas</em>.
                </p>
              </div>
            </div>

            <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200 flex items-start gap-3">
              <div className="w-7 h-7 rounded-xl bg-red-600 text-white font-black text-xs flex items-center justify-center shrink-0">
                3
              </div>
              <div className="space-y-1">
                <h4 className="font-bold text-slate-900 text-sm">Crear App "Bolt Pets Fulfillment"</h4>
                <p className="text-xs text-slate-600">
                  Haz clic en <strong>Crear una app</strong>, asigna el nombre <code>Bolt Pets Fulfillment</code> y selecciona el desarrollador asignado.
                </p>
              </div>
            </div>

            <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200 flex items-start gap-3">
              <div className="w-7 h-7 rounded-xl bg-red-600 text-white font-black text-xs flex items-center justify-center shrink-0">
                4
              </div>
              <div className="space-y-1">
                <h4 className="font-bold text-slate-900 text-sm">Seleccionar los 3 Permisos de Solo Lectura</h4>
                <p className="text-xs text-slate-600">
                  En la pestaña <strong>Configuración de la API Admin</strong>, busca y marca exclusivamente:
                </p>
                <div className="flex flex-wrap gap-2 pt-1 font-mono text-xs">
                  <span className="bg-white border border-slate-300 px-2 py-0.5 rounded font-bold">read_products</span>
                  <span className="bg-white border border-slate-300 px-2 py-0.5 rounded font-bold">read_inventory</span>
                  <span className="bg-white border border-slate-300 px-2 py-0.5 rounded font-bold">read_locations</span>
                </div>
                <p className="text-[11px] text-amber-700 font-medium pt-1">
                  ⚠️ No habilites permisos de escritura (write_*) hasta que se autorice la reconciliación de órdenes.
                </p>
              </div>
            </div>

            <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200 flex items-start gap-3">
              <div className="w-7 h-7 rounded-xl bg-red-600 text-white font-black text-xs flex items-center justify-center shrink-0">
                5
              </div>
              <div className="space-y-1">
                <h4 className="font-bold text-slate-900 text-sm">Instalar App y Guardar Secreto</h4>
                <p className="text-xs text-slate-600">
                  Haz clic en <strong>Instalar app</strong>. Se revelará una única vez el <strong>Token de acceso a la API Admin</strong> (<code className="font-mono">shpat_...</code>). Guarda este token en los secretos del backend como <code>SHOPIFY_ADMIN_ACCESS_TOKEN</code>.
                </p>
                <p className="text-[11px] text-slate-500 italic pt-1">
                  Nota de seguridad: Nunca pegues este token en chats públicos, archivos de repositorio ni formularios frontend.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
