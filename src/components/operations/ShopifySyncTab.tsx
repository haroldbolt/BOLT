import React, { useState, useEffect, useMemo, useRef } from 'react';
import { 
  ShoppingBag, RefreshCw, CheckCircle2, AlertTriangle, 
  ExternalLink, Key, ShieldCheck, Database, Layers, 
  ArrowRight, Check, HelpCircle, Lock, Clock, Zap, Radio, Send, Play
} from 'lucide-react';
import { ShopifySyncState, ShopifyLocationMapping } from '../../types';
import { api } from '../../lib/api';
import { formatTimeBogota } from '../../lib/formatters';

interface ShopifySyncTabProps {
  onRefreshData?: () => void;
}

type ShopifyRuntimeState = Omit<ShopifySyncState, 'mode'> & {
  mode?: string; liveVerified?: boolean; isStale?: boolean; credentialsConfigured?: boolean;
  nextSyncAt?: string; version?: string;
};

interface SimulatedWebhookEvent {
  id: string;
  timestamp: string;
  topic: string;
  storeId: string;
  storeName: string;
  locationGid: string;
  sku: string;
  productName: string;
  onHand: number;
  committed: number;
  sellable: number;
  success: boolean;
}

export const ShopifySyncTab: React.FC<ShopifySyncTabProps> = ({ onRefreshData }) => {
  const [syncState, setSyncState] = useState<ShopifyRuntimeState | null>(null);
  const [loading, setLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncFeedback, setSyncFeedback] = useState<string | null>(null);
  const [activeGuideTab, setActiveGuideTab] = useState<'STATUS' | 'LOCATIONS' | 'MAPPING' | 'WEBHOOKS' | 'GUIDE'>('STATUS');
  const [mappingSearch, setMappingSearch] = useState('');
  const [visibleMappingCount, setVisibleMappingCount] = useState(100);

  // Simulator states
  const [simStoreId, setSimStoreId] = useState<string>('HUB_KENNEDY');
  const [simSku, setSimSku] = useState<string>('SKU-PROPLAN-AD-MED-15KG');
  const [simOnHand, setSimOnHand] = useState<number>(18);
  const [simCommitted, setSimCommitted] = useState<number>(1);
  const [isSimulating, setIsSimulating] = useState(false);
  const [simResult, setSimResult] = useState<{ success: boolean; message: string } | null>(null);
  const [simHistory, setSimHistory] = useState<SimulatedWebhookEvent[]>([]);
  const isSnapshot = syncState?.mode === 'READ_ONLY_SNAPSHOT';
  const liveVerified = syncState?.mode === 'SHOPIFY_LIVE_READ_ONLY' && syncState.liveVerified === true;
  const versionRef = useRef('');
  const statusRequestSequence = useRef(0);
  const simulatorDisabled = true;
  const mappingItems = useMemo(() => {
    const query = mappingSearch.trim().toLocaleLowerCase('es-CO');
    return (syncState?.inventoryItems || []).filter(item => !query || `${item.sku} ${item.productName}`.toLocaleLowerCase('es-CO').includes(query));
  }, [syncState?.inventoryItems, mappingSearch]);
  useEffect(() => { setVisibleMappingCount(100); }, [mappingSearch]);
  const importedDate = syncState?.fetchedAt || syncState?.lastSuccessfulSync;
  const importedDateLabel = importedDate && Number.isFinite(Date.parse(importedDate)) ? new Intl.DateTimeFormat('es-CO', { timeZone: 'America/Bogota', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(importedDate)) : 'Sin lectura confirmada';
  const turboLocations = new Set(['HUB_KENNEDY', 'HUB_ALAMOS', 'HUB_SUBA']);

  const loadShopifyStatus = async () => {
    const sequence = ++statusRequestSequence.current;
    try {
      setLoading(true);
      const data = await api.getShopifyStatus();
      if (sequence !== statusRequestSequence.current) return;
      versionRef.current = String(data.version ?? data.fetchedAt ?? data.lastSuccessfulSync ?? '');
      setSyncState(data);
      return true;
    } catch (e: any) {
      if (sequence === statusRequestSequence.current) {
        setSyncFeedback(e.message || 'No se pudo consultar el estado de Shopify.');
        setSyncState(previous => previous ? { ...previous, isStale: true, errorMessage: 'No pudimos verificar una lectura nueva de Shopify.' } : null);
      }
      console.error('Error loading Shopify status:', e);
      return false;
    } finally {
      if (sequence === statusRequestSequence.current) setLoading(false);
    }
  };

  useEffect(() => {
    loadShopifyStatus();
    let active = true;
    let inFlight = false;
    const interval = window.setInterval(async () => {
      if (inFlight) return;
      inFlight = true;
      const sequence = ++statusRequestSequence.current;
      try {
        const metadata = await api.getInventoryStatus();
        if (!active || sequence !== statusRequestSequence.current) return;
        const version = String(metadata.version ?? metadata.fetchedAt ?? metadata.lastSuccessfulSync ?? '');
        if (version !== versionRef.current) {
          const data = await api.getShopifyStatus();
          if (!active || sequence !== statusRequestSequence.current) return;
          versionRef.current = version;
          setSyncState(data);
          onRefreshData?.();
        } else {
          setSyncState(previous => previous ? { ...previous, ...metadata } : null);
        }
      } catch {
        if (active && sequence === statusRequestSequence.current) setSyncState(previous => previous ? { ...previous, isStale: true, errorMessage: 'No pudimos revisar una nueva lectura. Conservamos los datos anteriores.' } : null);
      } finally { inFlight = false; }
    }, 20000);
    return () => { active = false; statusRequestSequence.current++; window.clearInterval(interval); };
  }, []);

  const handleManualSync = async () => {
    setIsSyncing(true);
    setSyncFeedback(null);
    try {
      const reviewed = await loadShopifyStatus();
      if (!reviewed) return;
      setSyncFeedback('Estado consultado. Esta acción no inicia una sincronización ni cambia la fecha de lectura. La sincronización manual requiere autorización administrativa en el servidor.');
      onRefreshData?.();
    } catch (e: any) {
      setSyncFeedback(e.message || 'Error durante la sincronización');
    } finally {
      setIsSyncing(false);
    }
  };

  const handleRunSimulation = async () => {
    if (simulatorDisabled) {
      setSimResult({ success: false, message: 'La importación conserva las existencias de Shopify. El simulador está deshabilitado para estos datos.' });
      return;
    }
    setIsSimulating(true);
    setSimResult(null);
    try {
      await api.simulateShopifyWebhook(simStoreId, simSku, simOnHand, simCommitted);
      const storeObj = syncState?.locations.find(l => l.storeId === simStoreId);
      const itemObj = syncState?.inventoryItems.find(i => i.sku === simSku);
      const sellable = Math.max(0, simOnHand - simCommitted - 2);

      const newEvent: SimulatedWebhookEvent = {
        id: `WH-SIM-${Date.now().toString().slice(-4)}`,
        timestamp: new Date().toISOString(),
        topic: 'inventory_levels/update',
        storeId: simStoreId,
        storeName: storeObj?.storeName || simStoreId,
        locationGid: storeObj?.shopifyLocationGid || '',
        sku: simSku,
        productName: itemObj?.productName || simSku,
        onHand: simOnHand,
        committed: simCommitted,
        sellable,
        success: true,
      };

      setSimHistory(prev => [newEvent, ...prev]);
      setSimResult({
        success: true,
        message: `Webhook procesado: ${storeObj?.storeName || simStoreId} ahora cuenta con ${sellable} uds vendibles de ${itemObj?.productName || simSku}. Álamos y Suba no fueron alteradas.`,
      });
      await loadShopifyStatus();
      onRefreshData?.();
    } catch (e: any) {
      setSimResult({
        success: false,
        message: e.message || 'Error al ejecutar webhook simulado',
      });
    } finally {
      setIsSimulating(false);
    }
  };

  const getStatusBadge = (status?: string) => {
    switch (status) {
      case 'SNAPSHOT_IMPORTADO':
        return {
          label: 'Inventario importado',
          classes: 'bg-blue-100 text-blue-800 border-blue-200',
          dot: 'bg-blue-500',
        };
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

  const statusBadge = syncState?.isStale ? {
    label: 'Lectura desactualizada', classes: 'bg-amber-100 text-amber-800 border-amber-200', dot: 'bg-amber-500',
  } : getStatusBadge(syncState?.status === 'CONECTADO' && !liveVerified ? 'PENDIENTE_AUTORIZACION' : syncState?.status);

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
              disabled={isSyncing || loading}
              className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold flex items-center gap-2 shadow-sm transition disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
              <span>{isSyncing ? 'Consultando...' : 'Revisar estado'}</span>
            </button>
          </div>
        </div>

        {syncFeedback && (
          <div className="mt-4 p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-700 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{syncFeedback}</span>
          </div>
        )}
        {syncState?.errorMessage && <p role="status" className="mt-4 text-xs text-amber-800">{syncState.errorMessage}</p>}

        {/* Métricas de Integración */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-6 pt-6 border-t border-slate-100">
          <div className="p-3 bg-slate-50 rounded-xl border border-slate-100">
            <span className="text-[11px] text-slate-500 font-semibold block">Sedes Mapeadas</span>
            <span className="text-base font-extrabold text-slate-900 font-mono mt-0.5 block">
              {syncState?.locations.length ?? 0} sedes
            </span>
            <span className="text-[10px] text-emerald-600 font-bold block mt-0.5">{syncState?.locations.filter(location => location.isActiveInBolt && turboLocations.has(location.storeId)).length ?? 0} bodegas Turbo</span>
          </div>

          <div className="p-3 bg-slate-50 rounded-xl border border-slate-100">
            <span className="text-[11px] text-slate-500 font-semibold block">Variantes importadas</span>
            <span className="text-base font-extrabold text-slate-900 font-mono mt-0.5 block">
              {syncState?.importedVariantCount ?? syncState?.totalMappedSkus ?? 0} variantes
            </span>
            <span className="text-[10px] text-slate-500 font-medium block mt-0.5">{syncState?.importedProductCount ?? 0} productos · IDs de Shopify</span>
          </div>

          <div className="p-3 bg-slate-50 rounded-xl border border-slate-100">
            <span className="text-[11px] text-slate-500 font-semibold block">Frecuencia de Conciliación</span>
            <span className="text-base font-extrabold text-slate-900 font-mono mt-0.5 block">
              {syncState?.automaticSync ? `Cada ${syncState.reconciliationIntervalMinutes} min` : 'Pendiente de autorización'}
            </span>
            <span className="text-[10px] text-slate-500 font-medium block mt-0.5">{syncState?.automaticSync ? (liveVerified ? 'Lectura automática verificada' : 'Esperando primera lectura válida') : 'Sin actualización automática'}</span>
            {syncState?.nextSyncAt && Number.isFinite(Date.parse(syncState.nextSyncAt)) && <span className="text-[10px] text-slate-500 font-medium block mt-0.5">Próxima revisión: {formatTimeBogota(syncState.nextSyncAt)}</span>}
          </div>

          <div className="p-3 bg-slate-50 rounded-xl border border-slate-100">
            <span className="text-[11px] text-slate-500 font-semibold block">Fecha del inventario</span>
            <span className="text-xs font-extrabold text-slate-900 font-mono mt-0.5 block truncate">
              {importedDateLabel}
            </span>
            <span className="text-[10px] text-emerald-600 font-bold block mt-0.5">{isSnapshot ? 'Copia guardada · Solo lectura' : liveVerified ? 'Shopify · Solo lectura' : statusBadge.label}</span>
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
            onClick={() => setActiveGuideTab('WEBHOOKS')}
            className={`px-3 py-1.5 text-xs font-bold rounded-lg transition ${
              activeGuideTab === 'WEBHOOKS'
                ? 'bg-slate-900 text-white'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            ⚡ Webhooks y Simulador
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
              Permisos para conexión automática (Solo Lectura)
            </h3>
            <p className="text-xs text-slate-600 leading-relaxed">
              La actualización automática utiliza una app propia autorizada con estos permisos de solo lectura. El estado superior confirma si ya existe una lectura real:
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
                Stock Vendible = max(0, Disponible_Shopify - Reservas_Bolt)
              </div>
              <ul className="list-disc pl-4 space-y-1 text-[11px] text-slate-600">
                <li>Las reservas de pedidos en curso en Bolt Pets se descuentan transaccionalmente.</li>
                <li>Los valores físicos y comprometidos se muestran solo cuando Shopify los suministra. Un dato pendiente no se inventa.</li>
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
                      {loc.isActiveInBolt && turboLocations.has(loc.storeId) ? (
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
                      {loc.lastSyncAt ? formatTimeBogota(loc.lastSyncAt) : 'Pendiente'}
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
            <input type="search" value={mappingSearch} onChange={event => setMappingSearch(event.target.value)} placeholder="Buscar por SKU o producto..." className="mt-3 w-full sm:w-80 px-3 py-1.5 text-xs rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-red-600 font-medium" />
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
                {mappingItems.slice(0, visibleMappingCount).map(item => (
                  <tr key={item.shopifyVariantGid} className="hover:bg-slate-50/80 transition">
                    <td className="py-3 px-3 font-mono font-bold text-slate-900">
                      {item.sku || 'Sin SKU'}
                    </td>
                    <td className="py-3 px-3 text-slate-800 font-semibold truncate max-w-xs">
                      {item.productName}
                    </td>
                    <td className="py-3 px-3 font-mono text-slate-500 text-[11px]">
                      {item.shopifyInventoryItemGid || 'Pendiente'}
                    </td>
                    <td className="py-3 px-3 text-right font-mono tabular-nums font-bold text-slate-900">
                      {item.quantitiesByLocation['HUB_KENNEDY']?.sellable ?? 'Pendiente'}
                    </td>
                    <td className="py-3 px-3 text-right font-mono tabular-nums font-bold text-slate-900">
                      {item.quantitiesByLocation['HUB_ALAMOS']?.sellable ?? 'Pendiente'}
                    </td>
                    <td className="py-3 px-3 text-right font-mono tabular-nums font-bold text-slate-900">
                      {item.quantitiesByLocation['HUB_SUBA']?.sellable ?? 'Pendiente'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {mappingItems.length > visibleMappingCount && (
            <button type="button" onClick={() => setVisibleMappingCount(count => count + 100)} className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold transition">
              Ver más variantes ({visibleMappingCount} de {mappingItems.length})
            </button>
          )}
        </div>
      )}

      {/* SUB-PANEL: WEBHOOKS Y SIMULADOR DE INVENTARIO */}
      {activeGuideTab === 'WEBHOOKS' && (
        <div className="space-y-6">
          {/* Tarjeta de Especificación y Seguridad del Webhook */}
          <div className="bg-white rounded-2xl p-5 shadow-sm border border-slate-200 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-3">
              <div>
                <h3 className="font-extrabold text-slate-900 text-sm flex items-center gap-2">
                  <Zap className="w-4 h-4 text-amber-500" />
                  Configuración de Webhooks en Shopify Admin (inventory_levels/update)
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Recepción de cambios de stock en tiempo real por ubicación física estricta (Kennedy, Álamos, Suba)
                </p>
              </div>
              <span className="text-[11px] font-bold bg-amber-50 text-amber-800 border border-amber-200 px-2.5 py-1 rounded-full">
                {isSnapshot ? 'Conexión automática pendiente' : 'Verificar configuración del webhook'}
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 space-y-1">
                <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">Tópico (Topic)</span>
                <code className="font-mono font-bold text-slate-900 block bg-white px-2 py-1 rounded border border-slate-200">
                  inventory_levels/update
                </code>
                <p className="text-[10px] text-slate-500">Se dispara al registrar compras, devoluciones o conteos físicos en Shopify.</p>
              </div>

              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 space-y-1">
                <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">Endpoint de Callback</span>
                <code className="font-mono font-bold text-slate-900 block bg-white px-2 py-1 rounded border border-slate-200 truncate">
                  /api/v1/shopify/webhook
                </code>
                <p className="text-[10px] text-slate-500">Recibe el payload JSON con location_id, inventory_item_id y available.</p>
              </div>

              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 space-y-1">
                <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">Aislamiento de Bodega</span>
                <span className="font-bold text-emerald-700 block bg-emerald-50 px-2 py-1 rounded border border-emerald-200">
                  100% Blindado por Location GID
                </span>
                <p className="text-[10px] text-slate-500">Un cambio en Kennedy jamás altera el stock físico de Álamos ni Suba.</p>
              </div>
            </div>
          </div>

          {/* Formulario Interactivo del Simulador de Webhooks */}
          <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200 space-y-5">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-red-50 text-red-600 flex items-center justify-center font-bold">
                  <Play className="w-4 h-4 fill-current" />
                </div>
                <div>
                  <h4 className="font-black text-slate-900 text-sm">
                    Simulador Interactivo de Eventos de Inventario
                  </h4>
                  <p className="text-xs text-slate-500">
                    Prueba cómo responde Bolt Pets cuando Shopify envía un webhook de actualización de stock.
                  </p>
                </div>
              </div>
              <span className="text-xs font-mono bg-slate-100 text-slate-700 px-2.5 py-1 rounded-full font-bold">
                Modo Seguro (Sin tocar inventario real)
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              {/* Selección de Sede */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">
                  1. Bodega de Cumplimiento (Shopify Location):
                </label>
                <select
                  value={simStoreId}
                  onChange={(e) => setSimStoreId(e.target.value)}
                  className="w-full text-xs font-semibold bg-white border border-slate-300 rounded-xl px-3 py-2.5 text-slate-800 focus:outline-none focus:ring-2 focus:ring-red-500"
                >
                  <option value="HUB_KENNEDY">Bolt Pets Kennedy (GID: ...816)</option>
                  <option value="HUB_ALAMOS">Bolt Pets Álamos (GID: ...584)</option>
                  <option value="HUB_SUBA">Bolt Pets Suba (GID: ...352)</option>
                </select>
                <span className="text-[10px] text-slate-400 mt-1 block">
                  Sede aislada: las otras 2 bodegas no se modificarán.
                </span>
              </div>

              {/* Selección de SKU */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">
                  2. Producto / SKU a actualizar:
                </label>
                <select
                  value={simSku}
                  onChange={(e) => setSimSku(e.target.value)}
                  className="w-full text-xs font-semibold bg-white border border-slate-300 rounded-xl px-3 py-2.5 text-slate-800 focus:outline-none focus:ring-2 focus:ring-red-500"
                >
                  {syncState?.inventoryItems.slice(0, 100).map((item) => (
                    <option key={item.shopifyVariantGid} value={item.sku}>
                      {item.sku} - {item.productName.slice(0, 24)}...
                    </option>
                  ))}
                </select>
                <span className="text-[10px] text-slate-400 mt-1 block">
                  Identificador Inventory Item de Shopify.
                </span>
              </div>

              {/* Cantidad Física (On Hand) */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">
                  3. Stock Físico (On Hand en Shopify):
                </label>
                <input
                  type="number"
                  min="0"
                  max="500"
                  value={simOnHand}
                  onChange={(e) => setSimOnHand(Math.max(0, parseInt(e.target.value) || 0))}
                  className="w-full text-xs font-bold font-mono bg-white border border-slate-300 rounded-xl px-3 py-2 text-slate-900 focus:outline-none focus:ring-2 focus:ring-red-500"
                />
                <span className="text-[10px] text-slate-400 mt-1 block">
                  Unidades contadas en bodega.
                </span>
              </div>

              {/* Cantidad Comprometida */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">
                  4. Comprometido (Committed):
                </label>
                <input
                  type="number"
                  min="0"
                  max="100"
                  value={simCommitted}
                  onChange={(e) => setSimCommitted(Math.max(0, parseInt(e.target.value) || 0))}
                  className="w-full text-xs font-bold font-mono bg-white border border-slate-300 rounded-xl px-3 py-2 text-slate-900 focus:outline-none focus:ring-2 focus:ring-red-500"
                />
                <span className="text-[10px] text-slate-400 mt-1 block">
                  Pedidos en proceso de empaque.
                </span>
              </div>
            </div>

            {/* Cálculo de Stock Vendible Resultante */}
            <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
              <div className="space-y-0.5">
                <span className="font-bold text-slate-700 block">Stock Vendible resultante tras aplicar la regla de autoridad:</span>
                <span className="text-[11px] text-slate-500">
                  Fórmula: {simOnHand} (Físico) - {simCommitted} (Comprometido) - 2 (Stock de Seguridad) ={' '}
                  <strong className="text-emerald-700 font-bold font-mono">
                    {Math.max(0, simOnHand - simCommitted - 2)} unidades vendibles
                  </strong>
                </span>
              </div>

              <button
                onClick={handleRunSimulation}
                disabled={isSimulating || simulatorDisabled}
                className="px-5 py-2.5 bg-red-600 hover:bg-red-700 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-2 shadow-sm transition disabled:opacity-50 shrink-0 cursor-pointer"
              >
                <Zap className={`w-4 h-4 ${isSimulating ? 'animate-spin' : ''}`} />
                <span>Simulador deshabilitado para inventario real</span>
              </button>
            </div>

            {/* Feedback del Simulador */}
            {simResult && (
              <div
                className={`p-3.5 rounded-xl border text-xs flex items-center gap-2.5 animate-in fade-in ${
                  simResult.success
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                    : 'bg-red-50 border-red-200 text-red-900'
                }`}
              >
                {simResult.success ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                ) : (
                  <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
                )}
                <span className="font-medium">{simResult.message}</span>
              </div>
            )}
          </div>

          {/* Historial de Webhooks Recibidos y Auditoría */}
          <div className="bg-white rounded-2xl p-5 shadow-sm border border-slate-200 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="font-black text-slate-900 text-sm">
                  Registro de Auditoría de Webhooks de Inventario
                </h4>
                <p className="text-xs text-slate-500">
                  Histórico de eventos procesados durante la sesión con verificación de sede.
                </p>
              </div>
              <span className="text-[11px] font-bold text-slate-500 font-mono">
                {simHistory.length} eventos registrados
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50/70 text-slate-600 font-bold uppercase tracking-wider">
                    <th className="py-2.5 px-3">Hora Bogotá</th>
                    <th className="py-2.5 px-3">Sede Afectada</th>
                    <th className="py-2.5 px-3">SKU</th>
                    <th className="py-2.5 px-3">Producto</th>
                    <th className="py-2.5 px-3 text-right">Físico</th>
                    <th className="py-2.5 px-3 text-right">Vendible</th>
                    <th className="py-2.5 px-3 text-center">Estado</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-medium">
                  {simHistory.map((ev) => (
                    <tr key={ev.id} className="hover:bg-slate-50/80 transition">
                      <td className="py-3 px-3 font-mono text-slate-500 text-[11px]">
                        {formatTimeBogota(ev.timestamp)}
                      </td>
                      <td className="py-3 px-3 font-bold text-slate-900">
                        {ev.storeName}
                      </td>
                      <td className="py-3 px-3 font-mono font-bold text-slate-800 text-[11px]">
                        {ev.sku}
                      </td>
                      <td className="py-3 px-3 text-slate-700 truncate max-w-xs">
                        {ev.productName}
                      </td>
                      <td className="py-3 px-3 text-right font-mono font-bold text-slate-900">
                        {ev.onHand} uds
                      </td>
                      <td className="py-3 px-3 text-right font-mono font-extrabold text-emerald-600">
                        {ev.sellable} uds
                      </td>
                      <td className="py-3 px-3 text-center">
                        <span className="inline-flex items-center gap-1 text-[10px] font-bold bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-full">
                          <Check className="w-3 h-3" /> Procesado
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
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
              Configura una app propia para Agrocentro Pets (<span className="font-mono font-bold">1c76bc-08.myshopify.com</span>). Las credenciales se guardan únicamente en el servidor:
            </p>
          </div>

          <div className="space-y-4">
            <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200 flex items-start gap-3">
              <div className="w-7 h-7 rounded-xl bg-red-600 text-white font-black text-xs flex items-center justify-center shrink-0">
                1
              </div>
              <div className="space-y-1">
                <h4 className="font-bold text-slate-900 text-sm">Acceder a Shopify Dev Dashboard</h4>
                <p className="text-xs text-slate-600">
                  Ingresa al <a href="https://dev.shopify.com/dashboard" target="_blank" rel="noopener noreferrer" className="underline font-bold">Dev Dashboard oficial</a> con la cuenta propietaria de la organización.
                </p>
              </div>
            </div>

            <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200 flex items-start gap-3">
              <div className="w-7 h-7 rounded-xl bg-red-600 text-white font-black text-xs flex items-center justify-center shrink-0">
                2
              </div>
              <div className="space-y-1">
                <h4 className="font-bold text-slate-900 text-sm">Crear o seleccionar la app propia</h4>
                <p className="text-xs text-slate-600">
                  En <strong>Apps</strong>, crea o selecciona <strong>Bolt Pets Fulfillment</strong>. La app y la tienda deben pertenecer a la misma organización para usar la autorización con Client ID y Client secret.
                </p>
              </div>
            </div>

            <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200 flex items-start gap-3">
              <div className="w-7 h-7 rounded-xl bg-red-600 text-white font-black text-xs flex items-center justify-center shrink-0">
                3
              </div>
              <div className="space-y-1">
                <h4 className="font-bold text-slate-900 text-sm">Comprobar la organización y el método de autorización</h4>
                <p className="text-xs text-slate-600">
                  Verifica que la app tenga acceso a esta tienda. Si la app pertenece a un tercero u otra organización, se necesita el flujo OAuth correspondiente; no se sustituye por credenciales pegadas en esta pantalla.
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
                  En la configuración de acceso de la app, solicita exclusivamente estos permisos; publica la versión e instala o actualiza su autorización en la tienda:
                </p>
                <div className="flex flex-wrap gap-2 pt-1 font-mono text-xs">
                  <span className="bg-white border border-slate-300 px-2 py-0.5 rounded font-bold">read_products</span>
                  <span className="bg-white border border-slate-300 px-2 py-0.5 rounded font-bold">read_inventory</span>
                  <span className="bg-white border border-slate-300 px-2 py-0.5 rounded font-bold">read_locations</span>
                </div>
                <p className="text-[11px] text-amber-700 font-medium pt-1">
                  No habilites permisos de escritura para esta conexión de inventario.
                </p>
              </div>
            </div>

            <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200 flex items-start gap-3">
              <div className="w-7 h-7 rounded-xl bg-red-600 text-white font-black text-xs flex items-center justify-center shrink-0">
                5
              </div>
              <div className="space-y-1">
                <h4 className="font-bold text-slate-900 text-sm">Guardar Client ID y Client secret en el servidor</h4>
                <p className="text-xs text-slate-600">
                  Copia <strong>Client ID</strong> y <strong>Client secret</strong> desde la configuración de la app a los secretos privados del servidor. El servidor intercambia estas credenciales por un token y lo renueva automáticamente antes de vencer. No se introducen credenciales en el navegador.
                </p>
                <p className="text-[11px] text-slate-500 italic pt-1">
                  Consulta el <a href="https://shopify.dev/docs/apps/build/authentication-authorization/client-credentials-grant" target="_blank" rel="noopener noreferrer" className="underline">método oficial de Client credentials</a>. La conexión solo se muestra verificada después de una lectura completa y válida.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
