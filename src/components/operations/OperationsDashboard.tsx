import {ProductImage} from '../common/ProductImage';
import { GroupedDispatches } from './GroupedDispatches';
import { TransportManagerTab } from './TransportManagerTab';
import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  AlertTriangle, Battery, Bike, Building2, CheckCircle2, Clock, Crosshair, Download, FileText,
  MapPin, Radio, RefreshCw, Square,
} from 'lucide-react';
import type { Order, Product, Store, OperationRole, FulfillmentStatus, GPSTelemetry, GPSTrackingPoint } from '../../types';
import { formatCOP, formatTimeBogota } from '../../lib/formatters';
import { api } from '../../lib/api';
import { WarehouseManagerTab } from './WarehouseManagerTab';
import { ShopifySyncTab } from './ShopifySyncTab';
import { CatalogManagerTab } from './CatalogManagerTab';

export type OperationsTool = 'PEDIDOS' | 'BODEGAS' | 'CATALOGO' | 'SHOPIFY' | 'FARMACIA' | 'FLOTA' | 'INVENTARIO';

interface OperationsDashboardProps {
  activeTab: OperationsTool;
  selectedStoreId: string;
  onAuthenticate: () => void;
  onOpenDispatches: (orderId?: string) => void;
  onViewOrderTracking: (orderId: string) => void;
}

export const OperationsDashboard: React.FC<OperationsDashboardProps> = ({
  activeTab,
  selectedStoreId,
  onAuthenticate,
  onOpenDispatches,
  onViewOrderTracking,
}) => {
  const currentRole: OperationRole = 'ADMINISTRADOR';
  const [deliveryModeFilter, setDeliveryModeFilter] = useState<'TODOS' | 'TURBO' | 'TURBO_DIVIDIDO' | 'PROGRAMADO'>('TODOS');
  
  // Seguridad y sesión administrativa
  const [adminUser, setAdminUser] = useState<any>(null);
  
  const [orders, setOrders] = useState<Order[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [stores, setStores] = useState<Store[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);

  // Pharmacy review state
  const [reviewNotes, setReviewNotes] = useState('');
  const [reviewerName, setReviewerName] = useState('Dra. Sandra Peña (Q.F. Veterinaria)');

  // ============================================================================
  // GPS TELEMETRY & TRACKING ENGINE (BOLT CONDUCTOR)
  // Transmisión cada 5 segundos vinculada exclusivamente a entregas en EN_CAMINO
  // ============================================================================
  const [gpsTrackingActive, setGpsTrackingActive] = useState<boolean>(false);
  const [gpsActiveOrderId, setGpsActiveOrderId] = useState<string | null>(null);
  const [gpsActiveShipmentId, setGpsActiveShipmentId] = useState<string | null>(null);
  const [gpsActiveDriverId, setGpsActiveDriverId] = useState<string>('DRV-CARLOS-01');
  const [gpsPermissionStatus, setGpsPermissionStatus] = useState<'prompt' | 'granted' | 'denied' | 'unsupported'>('prompt');
  const [gpsCountdown, setGpsCountdown] = useState<number>(5);
  const [gpsLastPoint, setGpsLastPoint] = useState<GPSTrackingPoint | null>(null);
  const [gpsPointsSent, setGpsPointsSent] = useState<number>(0);
  const [gpsError, setGpsError] = useState<string | null>(null);
  const [gpsSuccessNotice, setGpsSuccessNotice] = useState<string | null>(null);
  const [gpsBatteryPercent, setGpsBatteryPercent] = useState<number | null>(null);
  const [gpsHistoryLog, setGpsHistoryLog] = useState<Array<{
    seq: number;
    lat: number;
    lng: number;
    accuracy: number;
    speed?: number;
    heading?: number;
    time: string;
    status: 'OK' | 'ERROR';
    message?: string;
  }>>([]);

  const gpsSequenceRef = useRef<number>(1);
  const gpsIntervalRef = useRef<any>(null);
  const gpsCountdownIntervalRef = useRef<any>(null);
  const gpsActiveOrderRef = useRef<string | null>(null);
  gpsActiveOrderRef.current = gpsActiveOrderId;

  // Verificación reactiva de permisos del navegador
  const checkGpsPermission = useCallback(async () => {
    if (typeof window === 'undefined' || !('geolocation' in navigator)) {
      setGpsPermissionStatus('unsupported');
      return 'unsupported';
    }
    if (navigator.permissions && navigator.permissions.query) {
      try {
        const queryStatus = await navigator.permissions.query({ name: 'geolocation' });
        setGpsPermissionStatus(queryStatus.state as any);
        queryStatus.onchange = () => {
          setGpsPermissionStatus(queryStatus.state as any);
        };
        return queryStatus.state;
      } catch {
        // Fallback para navegadores sin query de geolocalización
      }
    }
    return 'prompt';
  }, []);

  const stopGpsTelemetry = useCallback((reason?: string) => {
    if (gpsIntervalRef.current) {
      clearInterval(gpsIntervalRef.current);
      gpsIntervalRef.current = null;
    }
    if (gpsCountdownIntervalRef.current) {
      clearInterval(gpsCountdownIntervalRef.current);
      gpsCountdownIntervalRef.current = null;
    }
    setGpsTrackingActive(false);
    setGpsActiveOrderId(null);
    setGpsActiveShipmentId(null);
    setGpsCountdown(5);
    if (reason) {
      setGpsSuccessNotice(reason);
      setTimeout(() => setGpsSuccessNotice(null), 6000);
    }
  }, []);

  const loadData = async () => {
    try {
      const [ordList, prodList, storeList] = await Promise.all([
        api.getOrders(),
        api.getCatalog(),
        api.getStores(),
      ]);
      setOrders(ordList);
      setProducts(prodList);
      setStores(storeList);

      // Verificación de fin de ciclo para entrega rastreada
      if (gpsActiveOrderRef.current) {
        const tracked = ordList.find(o => o.id === gpsActiveOrderRef.current);
        if (tracked && (tracked.fulfillmentStatus === 'ENTREGADO' || tracked.fulfillmentStatus === 'CANCELADO')) {
          stopGpsTelemetry(`El pedido ${tracked.orderNumber} pasó a ${tracked.fulfillmentStatus}. Transmisión GPS finalizada automáticamente.`);
        }
      }
    } catch (e) {
      console.error('Error loading operations data:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    checkGpsPermission();

    // Comprobar si existe sesión administrativa activa
    api.getAdminMe().then(res => {
      if (res?.user) setAdminUser(res.user);
    }).catch(() => {});

    // Obtener nivel de batería si el dispositivo lo soporta
    if (typeof navigator !== 'undefined' && (navigator as any).getBattery) {
      (navigator as any).getBattery().then((battery: any) => {
        setGpsBatteryPercent(Math.round(battery.level * 100));
        battery.onlevelchange = () => {
          setGpsBatteryPercent(Math.round(battery.level * 100));
        };
      }).catch(() => {});
    }

    const interval = setInterval(loadData, 6000);
    return () => {
      clearInterval(interval);
      if (gpsIntervalRef.current) clearInterval(gpsIntervalRef.current);
      if (gpsCountdownIntervalRef.current) clearInterval(gpsCountdownIntervalRef.current);
    };
  }, [checkGpsPermission, stopGpsTelemetry]);

  // Funciones de validación de bodegas y exclusión de Centro
  const isCentroStore = (store: Store | { id: string; name?: string }) =>
    store.id === 'HUB_CENTRO' || (store.name?.toLowerCase().includes('centro') ?? false);

  const activeStoresExceptCentro = stores.filter(s => s.isActive && !isCentroStore(s));
  const activeStoresExceptCentroIds = activeStoresExceptCentro.map(s => s.id);

  const selectedStore = selectedStoreId === 'ALL_ACTIVE' ? null : stores.find(s => s.id === selectedStoreId);
  const isSelectedStoreInactive = selectedStore ? !selectedStore.isActive : false;
  const isSelectedStoreCentro = selectedStore ? isCentroStore(selectedStore) : false;

  // Filtrado dinámico de pedidos según bodega seleccionada
  const storeOrders = orders.filter(o => {
    if (selectedStoreId === 'ALL_ACTIVE') {
      return activeStoresExceptCentroIds.includes(o.storeId);
    }
    return o.storeId === selectedStoreId;
  });
  const pendingDeliveryRequests = storeOrders.filter(o => o.deliveryReview?.status === 'PENDING' && o.fulfillmentStatus === 'PENDIENTE_CONFIRMACION');
  const scheduledOrders = orders.filter(o => o.deliveryMode === 'PROGRAMADO');
  const pendingPrescriptionOrders = orders.filter(o => o.prescriptionReview?.status === 'PENDIENTE_REVISION');

  const filteredStoreOrders = storeOrders.filter(o => {
    if (o.deliveryReview?.status === 'PENDING') return false;
    if (deliveryModeFilter === 'TODOS') return true;
    if (deliveryModeFilter === 'TURBO') return (!o.deliveryMode || o.deliveryMode === 'TURBO') && !o.isSplitOrder;
    if (deliveryModeFilter === 'TURBO_DIVIDIDO') return o.isSplitOrder || o.deliveryMode === 'TURBO_DIVIDIDO';
    if (deliveryModeFilter === 'PROGRAMADO') return o.deliveryMode === 'PROGRAMADO';
    return true;
  });

  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [historyModalOrder, setHistoryModalOrder] = useState<Order | null>(null);
  const [orderHistoryEntries, setOrderHistoryEntries] = useState<any[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  const [pinRequest,setPinRequest]=useState<{orderId:string;shipmentId?:string;reason?:string}|null>(null);
  const [enteredPin,setEnteredPin]=useState('');
  // Handle stage change with role authorization and PIN validation
  const handleUpdateStatus = async (orderId: string, status: FulfillmentStatus, shipmentId?: string, reason?: string, deliveryCode?: string) => {
    if(['REPARTIDOR_ASIGNADO','EN_CAMINO','ENTREGADO'].includes(status)){onOpenDispatches(orderId);return;}
    try {
      setErrorMessage(null);
      const targetOrder = orders.find(o => o.id === orderId);

      // Si es entrega física, requiere PIN
      let finalCode = deliveryCode;
      if (status === 'ENTREGADO' && !finalCode) {
        setPinRequest({orderId,shipmentId,reason});setEnteredPin('');return;
      }

      await api.updateOrderStatus(orderId, status, shipmentId, reason, finalCode, currentRole);

      // Si el pedido finaliza o se cancela, detener transmisión GPS activa si correspondía a este pedido
      if (status === 'ENTREGADO' || status === 'CANCELADO') {
        if (gpsActiveOrderId === orderId) {
          stopGpsTelemetry(`El pedido ${targetOrder?.orderNumber || orderId} fue marcado como ${status}. Transmisión GPS finalizada.`);
        }
      }

      await loadData();
      if (selectedOrder && selectedOrder.id === orderId) {
        const updated = await api.getOrder(orderId);
        setSelectedOrder(updated);
      }
    } catch (e: any) {
      setErrorMessage(e.message || 'Error al cambiar estado del pedido');
    }
  };

  const startGpsTelemetry = async (orderId: string, shipmentId?: string) => {
    setGpsError(null);
    setGpsSuccessNotice(null);

    // 1. Validar que la orden existe y está EXCLUSIVAMENTE en estado EN_CAMINO
    const targetOrder = orders.find(o => o.id === orderId);
    if (!targetOrder) {
      setGpsError('Pedido no encontrado en la base de datos.');
      return;
    }

    let isEnCamino = false;
    let driverAssignedId = gpsActiveDriverId;

    if (shipmentId && targetOrder.childShipments) {
      const child = targetOrder.childShipments.find(c => c.shipmentId === shipmentId);
      if (!child) {
        setGpsError(`Envío parcial ${shipmentId} no encontrado.`);
        return;
      }
      isEnCamino = child.fulfillmentStatus === 'EN_CAMINO';
      if (child.driver?.id) driverAssignedId = child.driver.id;

      if (!isEnCamino) {
        if (child.fulfillmentStatus === 'REPARTIDOR_ASIGNADO') {
          await handleUpdateStatus(orderId, 'EN_CAMINO', shipmentId);
          isEnCamino = true;
        } else {
          setGpsError(`El envío ${shipmentId} está en estado '${child.fulfillmentStatus}'. La telemetría GPS está restringida exclusivamente a entregas en 'EN_CAMINO'.`);
          return;
        }
      }
    } else {
      isEnCamino = targetOrder.fulfillmentStatus === 'EN_CAMINO';
      if (targetOrder.driver?.id) driverAssignedId = targetOrder.driver.id;

      if (!isEnCamino) {
        if (targetOrder.fulfillmentStatus === 'REPARTIDOR_ASIGNADO' || targetOrder.fulfillmentStatus === 'LISTO_PARA_DESPACHO') {
          await handleUpdateStatus(orderId, 'EN_CAMINO');
          isEnCamino = true;
        } else {
          setGpsError(`El pedido ${targetOrder.orderNumber} está en estado '${targetOrder.fulfillmentStatus}'. La telemetría GPS está restringida exclusivamente a entregas en 'EN_CAMINO'.`);
          return;
        }
      }
    }

    // 2. Validar soporte de geolocalización en navegador
    if (typeof window === 'undefined' || !('geolocation' in navigator)) {
      setGpsError('El navegador o dispositivo no soporta la API de geolocalización.');
      setGpsPermissionStatus('unsupported');
      return;
    }

    // 3. Captura inicial y comprobación de permisos de ubicación
    try {
      const initialPos = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 10000,
          maximumAge: 0,
        });
      });
      setGpsPermissionStatus('granted');

      // Limpiar temporizadores anteriores si los hubiera
      if (gpsIntervalRef.current) clearInterval(gpsIntervalRef.current);
      if (gpsCountdownIntervalRef.current) clearInterval(gpsCountdownIntervalRef.current);

      setGpsTrackingActive(true);
      setGpsActiveOrderId(orderId);
      setGpsActiveShipmentId(shipmentId || null);
      setGpsActiveDriverId(driverAssignedId);
      gpsSequenceRef.current = 1;
      setGpsPointsSent(0);
      setGpsCountdown(5);

      const transmitPoint = async (pos: GeolocationPosition) => {
        const seq = gpsSequenceRef.current++;
        const pointData: GPSTelemetry = {
          orderId,
          shipmentId: shipmentId || undefined,
          driverId: driverAssignedId,
          assignmentId: targetOrder.assignmentId || `ASG-${orderId.substring(0, 8)}`,
          tripId: targetOrder.tripId || `TRIP-${orderId.substring(0, 8)}`,
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracy: Math.round(pos.coords.accuracy || 5),
          heading: pos.coords.heading ?? 0,
          speed: pos.coords.speed ?? 0,
          batteryLevel: gpsBatteryPercent ?? 85,
          timestamp: Date.now(),
          sequenceNumber: seq,
        };

        const trackingPoint: GPSTrackingPoint = {
          orderId,
          shipmentId: shipmentId || undefined,
          driverId: driverAssignedId,
          driverName: targetOrder.driver?.name || 'Conductor Bolt',
          latitude: pointData.latitude,
          longitude: pointData.longitude,
          accuracy: pointData.accuracy,
          heading: pointData.heading,
          speed: pointData.speed,
          batteryLevel: pointData.batteryLevel,
          timestamp: pointData.timestamp,
          sequenceNumber: seq,
        };

        setGpsLastPoint(trackingPoint);

        try {
          await api.sendGpsTelemetry(pointData, driverAssignedId);
          setGpsPointsSent(prev => prev + 1);
          setGpsHistoryLog(prev => [
            {
              seq,
              lat: pointData.latitude,
              lng: pointData.longitude,
              accuracy: pointData.accuracy,
              speed: pointData.speed,
              heading: pointData.heading,
              time: new Date().toLocaleTimeString('es-CO', { timeZone: 'America/Bogota' }),
              status: 'OK',
            },
            ...prev.slice(0, 49),
          ]);
        } catch (err: any) {
          const errMsg = err.message || 'Error en endpoint /api/v1/driver/gps';
          setGpsHistoryLog(prev => [
            {
              seq,
              lat: pointData.latitude,
              lng: pointData.longitude,
              accuracy: pointData.accuracy,
              speed: pointData.speed,
              heading: pointData.heading,
              time: new Date().toLocaleTimeString('es-CO', { timeZone: 'America/Bogota' }),
              status: 'ERROR',
              message: errMsg,
            },
            ...prev.slice(0, 49),
          ]);

          if (errMsg.toLowerCase().includes('no está en camino') || errMsg.toLowerCase().includes('finalizada')) {
            stopGpsTelemetry(errMsg);
          } else {
            setGpsError(errMsg);
          }
        }
      };

      // Transmisión inmediata del primer punto
      await transmitPoint(initialPos);

      // Temporizador de cuenta regresiva visual cada segundo (5 -> 0)
      let count = 5;
      gpsCountdownIntervalRef.current = setInterval(() => {
        count = count <= 1 ? 5 : count - 1;
        setGpsCountdown(count);
      }, 1000);

      // Ciclo estricto de transmisión recurrente cada 5 segundos (5000ms)
      gpsIntervalRef.current = setInterval(() => {
        navigator.geolocation.getCurrentPosition(
          async (pos) => {
            await transmitPoint(pos);
          },
          (err) => {
            console.warn('Advertencia al consultar GPS en intervalo:', err.message);
            setGpsError(`Señal GPS: ${err.message}`);
          },
          {
            enableHighAccuracy: true,
            timeout: 4800,
            maximumAge: 0,
          }
        );
      }, 5000);

      setGpsSuccessNotice(`Transmisión GPS iniciada para pedido ${targetOrder.orderNumber} cada 5 segundos.`);
      setTimeout(() => setGpsSuccessNotice(null), 5000);

    } catch (err: any) {
      if (err.code === 1) {
        setGpsPermissionStatus('denied');
        setGpsError('Permiso de ubicación denegado en el navegador. Por favor otorgue acceso de ubicación para transmitir telemetría.');
      } else if (err.code === 2) {
        setGpsError('Ubicación física no disponible en este dispositivo.');
      } else if (err.code === 3) {
        setGpsError('Tiempo de espera agotado al consultar coordenadas satelitales GPS.');
      } else {
        setGpsError(err.message || 'Error al iniciar captura GPS.');
      }
    }
  };

  // Handle driver assign (supports whole order or specific child shipment)
  const handleAssignDriver = async (orderId: string, shipmentId?: string) => {
    try {
      setErrorMessage(null);
      await api.assignDriver(orderId, '', shipmentId);
      onOpenDispatches(orderId);
    } catch (e: any) {
      setErrorMessage(e.message || 'Error al asignar conductor');
    }
  };

  // Handle physical return confirmation
  const handleConfirmPhysicalReturn = async (orderId: string, shipmentId?: string) => {
    try {
      setErrorMessage(null);
      await api.confirmPhysicalReturn(orderId, `Operador Bodega (${currentRole})`, undefined, shipmentId);
      await loadData();
      if (selectedOrder && selectedOrder.id === orderId) {
        const updated = await api.getOrder(orderId);
        setSelectedOrder(updated);
      }
    } catch (e: any) {
      setErrorMessage(e.message || 'Error al confirmar retorno físico');
    }
  };

  // Open audit history modal
  const handleOpenHistory = async (ord: Order) => {
    setHistoryModalOrder(ord);
    setLoadingHistory(true);
    try {
      const data = await api.getOrderHistory(ord.id);
      setOrderHistoryEntries(data.history || []);
    } catch (e) {
      console.error('Error fetching audit history:', e);
      setOrderHistoryEntries(ord.statusHistory || []);
    } finally {
      setLoadingHistory(false);
    }
  };

  // Handle prescription review
  const handleReviewPrescription = async (orderId: string, status: 'APROBADA' | 'RECHAZADA') => {
    await api.reviewPrescription(orderId, status, reviewNotes, reviewerName);
    setReviewNotes('');
    await loadData();
    if (selectedOrder && selectedOrder.id === orderId) {
      setSelectedOrder(null);
    }
  };

  // Download contract files
  const downloadContract = (type: 'contract' | 'openapi') => {
    const filename = type === 'contract' ? 'bolt-conductor-integration-contract.md' : 'bolt-pets-openapi.yaml';
    const content = type === 'contract'
      ? `# BOLT CONDUCTOR INTEGRATION CONTRACT\nVersión 1.0.0\nConsulte docs/driver-integration-contract.md en el repositorio.`
      : `openapi: 3.0.3\ninfo:\n  title: Bolt Pets API\nConsulte docs/openapi.yaml en el repositorio.`;
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Selector visual de Bodega para las pestañas operativas (PEDIDOS e INVENTARIO)
  const renderAuditBanners = () => (
    <>
      {isSelectedStoreInactive && (
        <div className="bg-amber-50 border border-amber-200 text-amber-900 p-3.5 rounded-2xl flex items-center justify-between text-xs">
          <div className="flex items-center gap-2.5">
            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
            <div>
              <p className="font-bold text-amber-950">
                Ubicación Inactiva: {selectedStore?.name}
              </p>
              <p className="text-amber-800 text-[11px]">
                Esta bodega está inactiva y no recibe órdenes Turbo en vivo. Visualizando inventario y registros en modo auditoría.
              </p>
            </div>
          </div>
          <span className="text-[10px] font-black bg-amber-200 text-amber-950 px-2.5 py-1 rounded-lg uppercase tracking-wide shrink-0">
            Modo Auditoría
          </span>
        </div>
      )}

      {isSelectedStoreCentro && (
        <div className="bg-slate-100 border border-slate-200 text-slate-800 p-3.5 rounded-2xl flex items-center justify-between text-xs">
          <div className="flex items-center gap-2.5">
            <Building2 className="w-4 h-4 text-slate-600 shrink-0" />
            <div>
              <p className="font-bold text-slate-900">
                Sede Centro Histórico (Excluida por defecto)
              </p>
              <p className="text-slate-600 text-[11px]">
                Ubicación administrativa fuera de la red de despachos Turbo (SLA 25 min). Se encuentra excluida de la vista consolidada activa.
              </p>
            </div>
          </div>
          <span className="text-[10px] font-black bg-slate-200 text-slate-800 px-2.5 py-1 rounded-lg uppercase tracking-wide shrink-0">
            Sede Administrativa
          </span>
        </div>
      )}
    </>
  );

  return (
    <div className="min-w-0 text-slate-900">
      {/* Barra Flotante / Alerta de Transmisión GPS Activa */}
      {gpsTrackingActive && (
        <div className="bg-slate-900 border-b border-emerald-500/40 text-white px-4 py-2.5 shadow-lg sticky top-24 z-20 transition">
          <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-3">
              <span className="flex h-3 w-3 relative">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500"></span>
              </span>
              <div className="flex items-center gap-2">
                <span className="font-black text-emerald-400 uppercase tracking-wider text-[11px]">GPS EN VIVO (5s):</span>
                <strong className="text-white font-mono bg-slate-800 px-2 py-0.5 rounded">
                  {orders.find(o => o.id === gpsActiveOrderId)?.orderNumber || gpsActiveOrderId}
                </strong>
                {gpsActiveShipmentId && (
                  <span className="bg-amber-500/20 text-amber-300 px-1.5 py-0.2 rounded font-bold text-[10px]">
                    Envío {gpsActiveShipmentId}
                  </span>
                )}
                <span className="text-slate-400 hidden sm:inline">
                  • {gpsActiveDriverId}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-3 md:gap-4 text-[11px]">
              <div className="flex items-center gap-1.5 text-slate-300">
                <Crosshair className="w-3.5 h-3.5 text-emerald-400" />
                <span className="font-mono">
                  {gpsLastPoint ? `${gpsLastPoint.latitude.toFixed(4)}, ${gpsLastPoint.longitude.toFixed(4)} (±${gpsLastPoint.accuracy}m)` : 'Obteniendo señal satelital...'}
                </span>
              </div>

              <div className="flex items-center gap-1.5 bg-slate-800 px-2.5 py-0.5 rounded-lg border border-slate-700">
                <Clock className="w-3 h-3 text-yellow-400" />
                <span>Próximo ping: <strong className="text-yellow-300 font-mono">{gpsCountdown}s</strong></span>
                <span className="text-slate-600">|</span>
                <span>Enviados: <strong className="text-emerald-400 font-mono">{gpsPointsSent}</strong></span>
              </div>

              {gpsBatteryPercent !== null && (
                <div className="flex items-center gap-1 text-slate-400 hidden md:flex">
                  <Battery className="w-3.5 h-3.5 text-emerald-400" />
                  <span>{gpsBatteryPercent}%</span>
                </div>
              )}

              <div className="flex items-center gap-2">
                {gpsActiveOrderId && (
                  <button
                    onClick={() => onViewOrderTracking(gpsActiveOrderId)}
                    className="bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold px-2.5 py-1 rounded-lg text-[11px] transition"
                  >
                    Ver en Mapa
                  </button>
                )}
                <button
                  onClick={() => stopGpsTelemetry('Transmisión detenida por el conductor.')}
                  className="bg-rose-600 hover:bg-rose-700 text-white font-black px-3 py-1 rounded-lg text-[11px] flex items-center gap-1 transition shadow-xs"
                >
                  <Square className="w-3 h-3 fill-current" />
                  <span>Detener GPS</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Notificación de Éxito de GPS */}
      {gpsSuccessNotice && (
        <div className="bg-emerald-50 border-b border-emerald-200 text-emerald-900 px-4 py-2 text-xs font-bold flex items-center justify-between">
          <div className="max-w-7xl mx-auto w-full flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>{gpsSuccessNotice}</span>
            </div>
            <button onClick={() => setGpsSuccessNotice(null)} className="text-emerald-700 hover:text-emerald-900 font-bold px-2">✕</button>
          </div>
        </div>
      )}

      {/* Notificación de Error de GPS */}
      {gpsError && (
        <div className="bg-rose-50 border-b border-rose-200 text-rose-900 px-4 py-2 text-xs font-bold flex items-center justify-between">
          <div className="max-w-7xl mx-auto w-full flex items-center justify-between">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
              <span>{gpsError}</span>
            </div>
            <button onClick={() => setGpsError(null)} className="text-rose-700 hover:text-rose-900 font-bold px-2">✕</button>
          </div>
        </div>
      )}

      {pinRequest && <div role="dialog" aria-modal="true" aria-label="Confirmar entrega con PIN" className="fixed inset-0 z-50 bg-black/50 grid place-items-center"><form className="bg-white p-6 rounded-2xl space-y-3" onSubmit={e=>{e.preventDefault();void handleUpdateStatus(pinRequest.orderId,'ENTREGADO',pinRequest.shipmentId,pinRequest.reason,enteredPin);setPinRequest(null);}}><label className="block">PIN del cliente<input aria-label="PIN del cliente" className="block border p-3 rounded-xl" value={enteredPin} onChange={e=>setEnteredPin(e.target.value)} inputMode="numeric" maxLength={4}/></label><button disabled={!/^\d{4}$/.test(enteredPin)} className="bg-red-600 text-white p-3 rounded-xl">Validar entrega</button><button type="button" className="p-3" onClick={()=>setPinRequest(null)}>Volver</button></form></div>}

      {/* Main Content Area */}
      <div className="space-y-6">
        {/* ============================================================== */}
        {/* TAB 1: LIVE ORDERS BOARD */}
        {/* ============================================================== */}
        {activeTab === 'PEDIDOS' && (
          <div className="space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h2 className="text-xl font-black text-slate-900">Cola de Alistamiento & Despacho</h2>
                <p className="text-xs text-slate-500">
                  Priorizado por promesa de entrega aceptada (SLA Turbo hasta 25 min • Programados)
                </p>
              </div>
              
              <div className="flex items-center gap-2">
                <button
                  onClick={loadData}
                  className="bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-bold px-3 py-1.5 rounded-xl flex items-center gap-1.5 shadow-xs transition"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Actualizar</span>
                </button>
              </div>
            </div>

            {/* Error / Rejection Banner */}
            {errorMessage && (
              <div className="bg-rose-50 border border-rose-300 text-rose-800 p-3.5 rounded-2xl flex items-center justify-between text-xs font-bold shadow-xs">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
                  <span>{errorMessage}</span>
                </div>
                <button
                  onClick={() => setErrorMessage(null)}
                  className="text-rose-500 hover:text-rose-700 font-extrabold text-sm ml-2 px-1"
                >
                  ✕
                </button>
              </div>
            )}

            {/* Inactive / Excluded Store Audit Banners */}
            {renderAuditBanners()}
            {pendingDeliveryRequests.length > 0 && (
              <section aria-label="Solicitudes pendientes de entrega" className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
                <p className="font-bold">{pendingDeliveryRequests.length} solicitud(es) pendientes de confirmar entrega</p>
                <p className="mt-1">Sin cobro ni horario confirmado. Revisa la capacidad y acuerda el costo y la entrega con el cliente.</p>
                <button type="button" onClick={() => onOpenDispatches()} className="mt-2 min-h-11 font-bold underline">Revisar solicitudes</button>
              </section>
            )}
            <GroupedDispatches orders={filteredStoreOrders} transition={handleUpdateStatus} assign={handleAssignDriver} confirmReturn={handleConfirmPhysicalReturn} track={onViewOrderTracking} />

            {/* Delivery Mode Filter Chips */}
            <div className="flex items-center gap-2 overflow-x-auto pb-1 no-scrollbar text-xs font-bold">
              <span className="text-slate-400 text-[11px] uppercase mr-1">Filtrar por modo:</span>
              {[
                { id: 'TODOS', label: 'Todos', count: storeOrders.length },
                { id: 'TURBO', label: '⚡ Turbo (25 min)', count: storeOrders.filter(o => o.deliveryReview?.status !== 'PENDING' && (!o.deliveryMode || o.deliveryMode === 'TURBO') && !o.isSplitOrder).length },
                { id: 'TURBO_DIVIDIDO', label: '⚡ Turbo en varias entregas', count: storeOrders.filter(o => o.isSplitOrder || o.deliveryMode === 'TURBO_DIVIDIDO').length },
                { id: 'PROGRAMADO', label: '📅 Envío Programado', count: storeOrders.filter(o => o.deliveryMode === 'PROGRAMADO').length },
              ].map(f => {
                const isSelected = deliveryModeFilter === f.id;
                return (
                  <button
                    key={f.id}
                    onClick={() => setDeliveryModeFilter(f.id as any)}
                    className={`px-3 py-1.5 rounded-xl border text-xs font-extrabold transition flex items-center gap-1.5 shrink-0 ${
                      isSelected
                        ? 'bg-slate-900 text-white border-slate-900 shadow-xs'
                        : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    <span>{f.label}</span>
                    <span className={`text-[10px] px-1.5 py-0.2 rounded-full ${isSelected ? 'bg-slate-700 text-white' : 'bg-slate-100 text-slate-700'}`}>
                      {f.count}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Kanban Columns */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              {/* Column 1: Por Confirmar / Alistamiento */}
              <div className="bg-slate-200/60 p-3 rounded-2xl flex flex-col space-y-3">
                <div className="flex items-center justify-between text-xs font-black text-slate-700 px-1">
                  <span>1. EN ALISTAMIENTO</span>
                  <span className="bg-slate-300 px-2 py-0.5 rounded-full text-[10px]">
                    {filteredStoreOrders.filter(o=>!o.childShipments?.length).filter(o => !o.childShipments?.length && o.fulfillmentStatus === 'CONFIRMADO' || o.fulfillmentStatus === 'EN_ALISTAMIENTO').length}
                  </span>
                </div>

                <div className="space-y-2.5">
                  {filteredStoreOrders.filter(o=>!o.childShipments?.length)
                    .filter(o => !o.childShipments?.length && o.fulfillmentStatus === 'CONFIRMADO' || o.fulfillmentStatus === 'EN_ALISTAMIENTO')
                    .map(order => (
                      <div
                        key={order.id}
                        className="bg-white p-3.5 rounded-2xl border border-slate-200 shadow-xs space-y-2.5 hover:border-red-300 transition"
                      >
                        <div className="flex items-start justify-between">
                          <div>
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="text-xs font-black text-slate-900">{order.orderNumber}</span>
                              {order.isSplitOrder && (
                                <span className="text-[9px] font-black bg-amber-100 text-amber-900 px-1.5 py-0.2 rounded">
                                  ⚡ Split {order.shipmentCount} envíos
                                </span>
                              )}
                              {order.deliveryMode === 'PROGRAMADO' && (
                                <span className="text-[9px] font-black bg-blue-100 text-blue-900 px-1.5 py-0.2 rounded">
                                  📅 {order.scheduledWindow?.startTime} - {order.scheduledWindow?.endTime}
                                </span>
                              )}
                            </div>
                            <p className="text-[11px] text-slate-500">{order.customer.name}</p>
                          </div>
                          <span className="text-[10px] font-extrabold bg-blue-100 text-blue-800 px-2 py-0.5 rounded-md">
                            {formatTimeBogota(order.createdAt)}
                          </span>
                        </div>

                        {/* Prescription Warning */}
                        {order.prescriptionReview?.status === 'PENDIENTE_REVISION' && (
                          <div className="bg-red-50 text-red-800 text-[10px] font-extrabold p-2 rounded-xl flex items-center gap-1.5 border border-red-200">
                            <FileText className="w-3.5 h-3.5 text-red-600 shrink-0" />
                            <span>Fórmula pendiente de revisión médica</span>
                          </div>
                        )}

                        <div className="text-xs text-slate-600 space-y-1">
                          {order.items.map(item => (
                            <div key={item.productId} className="flex justify-between text-[11px]">
                              <span className="font-semibold">{item.quantity}x {item.name}</span>
                              <span className="text-slate-400">{item.presentation}</span>
                            </div>
                          ))}
                        </div>

                        <div className="pt-2 border-t border-slate-100 flex items-center justify-between">
                          <span className="text-xs font-black text-slate-900">
                            {formatCOP(order.totals.total)}
                          </span>
                          <button
                            onClick={() => handleUpdateStatus(order.id, 'LISTO_PARA_DESPACHO')}
                            disabled={order.prescriptionReview?.status === 'PENDIENTE_REVISION'}
                            className="bg-slate-900 hover:bg-slate-800 disabled:bg-slate-300 text-white font-bold text-xs px-3 py-1.5 rounded-xl transition"
                          >
                            Empacado ✓
                          </button>
                        </div>
                      </div>
                    ))}
                </div>
              </div>

              {/* Column 2: Listo para Despacho */}
              <div className="bg-slate-200/60 p-3 rounded-2xl flex flex-col space-y-3">
                <div className="flex items-center justify-between text-xs font-black text-slate-700 px-1">
                  <span>2. LISTO PARA DESPACHO</span>
                  <span className="bg-slate-300 px-2 py-0.5 rounded-full text-[10px]">
                    {filteredStoreOrders.filter(o=>!o.childShipments?.length).filter(o => !o.childShipments?.length && o.fulfillmentStatus === 'LISTO_PARA_DESPACHO').length}
                  </span>
                </div>

                <div className="space-y-2.5">
                  {filteredStoreOrders.filter(o=>!o.childShipments?.length)
                    .filter(o => !o.childShipments?.length && o.fulfillmentStatus === 'LISTO_PARA_DESPACHO')
                    .map(order => (
                      <div
                        key={order.id}
                        className="bg-white p-3.5 rounded-2xl border border-slate-200 shadow-xs space-y-2.5"
                      >
                        <div className="flex justify-between items-start">
                          <div>
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="text-xs font-black text-slate-900">{order.orderNumber}</span>
                              {order.isSplitOrder && (
                                <span className="text-[9px] font-black bg-amber-100 text-amber-900 px-1.5 py-0.2 rounded">
                                  ⚡ Split {order.shipmentCount} motos
                                </span>
                              )}
                              {order.deliveryMode === 'PROGRAMADO' && (
                                <span className="text-[9px] font-black bg-blue-100 text-blue-900 px-1.5 py-0.2 rounded">
                                  📅 Camioneta Cargo
                                </span>
                              )}
                            </div>
                            <p className="text-[11px] text-slate-500">{order.deliveryAddress.address}</p>
                          </div>
                          <span className="text-[10px] font-bold bg-amber-100 text-amber-800 px-2 py-0.5 rounded-md">
                            Listo
                          </span>
                        </div>

                        {/* Split Child Shipments Assignment */}
                        {order.isSplitOrder && order.childShipments && order.childShipments.length > 0 ? (
                          <div className="space-y-1.5 pt-1">
                            <p className="text-[10px] font-extrabold text-amber-900 uppercase">
                              Asignación de Repartidores por Envío ({order.childShipments.length} motos):
                            </p>
                            {order.childShipments.map(child => (
                              <div
                                key={child.shipmentId}
                                className="bg-amber-50/60 p-2 rounded-xl border border-amber-200 flex items-center justify-between text-[11px]"
                              >
                                <div>
                                  <span className="font-bold text-slate-800">Envío {child.shipmentIndex}</span>
                                  <span className="text-slate-500 ml-1">({child.weightKg} kg)</span>
                                  {child.driver && (
                                    <p className="text-[10px] text-slate-600 font-semibold">{child.driver.name}</p>
                                  )}
                                </div>
                                <button
                                  onClick={() => handleAssignDriver(order.id, child.shipmentId)}
                                  className="bg-amber-600 hover:bg-amber-700 text-white font-bold text-[10px] px-2.5 py-1 rounded-lg transition"
                                >
                                  {child.driver ? 'Reasignar' : 'Asignar Moto'}
                                </button>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <button
                            onClick={() => handleAssignDriver(order.id)}
                            className="w-full bg-red-600 hover:bg-red-700 text-white font-bold text-xs py-2 rounded-xl flex items-center justify-center gap-1.5 shadow-sm transition"
                          >
                            <Bike className="w-3.5 h-3.5" />
                            <span>{order.deliveryMode === 'PROGRAMADO' ? 'Asignar Camioneta' : 'Asignar Conductor Propio'}</span>
                          </button>
                        )}
                      </div>
                    ))}
                </div>
              </div>

              {/* Column 3: En Camino */}
              <div className="bg-slate-200/60 p-3 rounded-2xl flex flex-col space-y-3">
                <div className="flex items-center justify-between text-xs font-black text-slate-700 px-1">
                  <span>3. EN CAMINO (GPS ACTIVO)</span>
                  <span className="bg-slate-300 px-2 py-0.5 rounded-full text-[10px]">
                    {filteredStoreOrders.filter(o=>!o.childShipments?.length).filter(o => !o.childShipments?.length && o.fulfillmentStatus === 'EN_CAMINO' || o.fulfillmentStatus === 'REPARTIDOR_ASIGNADO').length}
                  </span>
                </div>

                <div className="space-y-2.5">
                  {filteredStoreOrders.filter(o=>!o.childShipments?.length)
                    .filter(o => !o.childShipments?.length && o.fulfillmentStatus === 'EN_CAMINO' || o.fulfillmentStatus === 'REPARTIDOR_ASIGNADO')
                    .map(order => (
                      <div
                        key={order.id}
                        className="bg-white p-3.5 rounded-2xl border border-yellow-300 shadow-xs space-y-2.5 relative overflow-hidden"
                      >
                        <div className="absolute top-0 right-0 w-2 h-full bg-yellow-400"></div>
                        <div className="flex justify-between items-start">
                          <div>
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="text-xs font-black text-slate-900">{order.orderNumber}</span>
                              {order.isSplitOrder && (
                                <span className="text-[9px] font-black bg-amber-100 text-amber-900 px-1.5 py-0.2 rounded">
                                  ⚡ Split {order.childShipments?.filter(s => s.fulfillmentStatus === 'ENTREGADO').length || 0}/{order.shipmentCount} entregados
                                </span>
                              )}
                            </div>
                            <p className="text-[11px] text-slate-500">Conductor: {order.driver?.name || 'Asignado'}</p>
                          </div>
                          <span className="text-[10px] font-black bg-yellow-400 text-red-950 px-2 py-0.5 rounded-md">
                            ⚡ En ruta
                          </span>
                        </div>

                        {/* If Split Order: Show Individual Child Shipments Status & Controls */}
                        {order.isSplitOrder && order.childShipments && order.childShipments.length > 0 ? (
                          <div className="space-y-1.5 pt-1">
                            {order.childShipments.map(child => {
                              const isThisChildTracking = gpsTrackingActive && gpsActiveOrderId === order.id && gpsActiveShipmentId === child.shipmentId;
                              return (
                                <div
                                  key={child.shipmentId}
                                  className="bg-slate-50 p-2 rounded-xl border border-slate-200 text-[11px] space-y-1.5"
                                >
                                  <div className="flex justify-between items-center">
                                    <span className="font-bold text-slate-800">
                                      Envío {child.shipmentIndex} ({child.weightKg} kg):
                                    </span>
                                    <span className={`text-[9px] font-black px-1.5 py-0.2 rounded ${
                                      child.fulfillmentStatus === 'ENTREGADO'
                                        ? 'bg-emerald-100 text-emerald-800'
                                        : 'bg-yellow-100 text-yellow-900'
                                    }`}>
                                      {child.fulfillmentStatus}
                                    </span>
                                  </div>
                                  <div className="flex justify-between items-center text-[10px] text-slate-500">
                                    <span>PIN: <strong className="text-red-600 font-mono">{child.secretDeliveryCode}</strong></span>
                                    <span>{child.driver?.name?.split(' ')[0]} ({child.driver?.vehiclePlate})</span>
                                  </div>

                                  {/* GPS Telemetry Controls per Child Shipment */}
                                  {child.fulfillmentStatus === 'EN_CAMINO' && (
                                    isThisChildTracking ? (
                                      <div className="bg-emerald-50 border border-emerald-300 text-emerald-900 p-1.5 rounded-lg text-[10px] flex items-center justify-between">
                                        <div className="flex items-center gap-1 font-bold">
                                          <span className="flex h-1.5 w-1.5 relative">
                                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                                            <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-600"></span>
                                          </span>
                                          <span>GPS Activo (5s) • #{gpsPointsSent}</span>
                                        </div>
                                        <button
                                          onClick={() => stopGpsTelemetry('Transmisión detenida por el conductor')}
                                          className="text-rose-700 hover:text-rose-900 font-extrabold text-[10px] underline ml-1"
                                        >
                                          Detener
                                        </button>
                                      </div>
                                    ) : (
                                      <button
                                        onClick={() => startGpsTelemetry(order.id, child.shipmentId)}
                                        className="w-full bg-amber-500 hover:bg-amber-600 text-white font-bold text-[10px] py-1 rounded-lg flex items-center justify-center gap-1 transition shadow-2xs"
                                      >
                                        <Radio className="w-3 h-3" />
                                        <span>Transmitir GPS Envío {child.shipmentIndex} (5s)</span>
                                      </button>
                                    )
                                  )}

                                  {child.fulfillmentStatus !== 'ENTREGADO' && (
                                    <button
                                      onClick={() => handleUpdateStatus(order.id, 'ENTREGADO', child.shipmentId)}
                                      className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-[10px] py-1 rounded-lg transition"
                                    >
                                      Confirmar Entrega Envío {child.shipmentIndex} ✓
                                    </button>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        ) : (
                          <div className="space-y-1.5">
                            <div className="p-2 bg-slate-50 rounded-xl text-xs space-y-1">
                              <p className="text-slate-600 text-[11px]">
                                Vehículo: <strong className="text-slate-800">{order.driver?.vehiclePlate}</strong>
                              </p>
                              <p className="text-slate-600 text-[11px]">
                                Código Secreto: <strong className="text-red-600 font-black">{order.secretDeliveryCode}</strong>
                              </p>
                            </div>

                            {/* Direct GPS Telemetry Status for Non-Split Order */}
                            {gpsTrackingActive && gpsActiveOrderId === order.id && !gpsActiveShipmentId ? (
                              <div className="bg-emerald-50 border border-emerald-300 text-emerald-900 p-2 rounded-xl text-xs flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                  <span className="flex h-2.5 w-2.5 relative">
                                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                                    <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-600"></span>
                                  </span>
                                  <div>
                                    <p className="font-bold text-[11px]">GPS Transmitiendo cada 5s</p>
                                    <p className="text-[10px] text-emerald-700 font-mono">
                                      {gpsLastPoint ? `${gpsLastPoint.latitude.toFixed(4)}, ${gpsLastPoint.longitude.toFixed(4)}` : 'Obteniendo GPS...'}
                                    </p>
                                  </div>
                                </div>
                                <button
                                  onClick={() => stopGpsTelemetry('Transmisión detenida por el conductor')}
                                  className="bg-rose-600 hover:bg-rose-700 text-white font-black text-[10px] px-2.5 py-1 rounded-lg transition"
                                >
                                  Detener
                                </button>
                              </div>
                            ) : (
                              <button
                                onClick={() => startGpsTelemetry(order.id)}
                                className="w-full bg-yellow-400 hover:bg-yellow-500 text-red-950 font-black text-xs py-2 rounded-xl flex items-center justify-center gap-1.5 transition shadow-xs"
                              >
                                <Radio className="w-3.5 h-3.5" />
                                <span>Iniciar GPS Conductor (5s)</span>
                              </button>
                            )}
                          </div>
                        )}

                        <div className="flex gap-2">
                          <button
                            onClick={() => onViewOrderTracking(order.id)}
                            className="flex-1 bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs py-2 rounded-xl text-center transition flex items-center justify-center gap-1"
                          >
                            <MapPin className="w-3 h-3 text-red-400" />
                            <span>Ver en Mapa</span>
                          </button>
                          <button
                            onClick={() => handleUpdateStatus(order.id, 'ENTREGADO')}
                            className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs px-3 py-2 rounded-xl transition"
                            title="Confirmar entrega total"
                          >
                            ✓
                          </button>
                        </div>
                      </div>
                    ))}
                </div>
              </div>

              {/* Column 4: Entregados */}
              <div className="bg-slate-200/60 p-3 rounded-2xl flex flex-col space-y-3">
                <div className="flex items-center justify-between text-xs font-black text-slate-700 px-1">
                  <span>4. ENTREGADOS HOY</span>
                  <span className="bg-slate-300 px-2 py-0.5 rounded-full text-[10px]">
                    {filteredStoreOrders.filter(o=>!o.childShipments?.length).filter(o => !o.childShipments?.length && o.fulfillmentStatus === 'ENTREGADO').length}
                  </span>
                </div>

                <div className="space-y-2.5">
                  {filteredStoreOrders.filter(o=>!o.childShipments?.length)
                    .filter(o => !o.childShipments?.length && o.fulfillmentStatus === 'ENTREGADO')
                    .map(order => (
                      <div
                        key={order.id}
                        className="bg-white p-3.5 rounded-2xl border border-emerald-200 shadow-xs space-y-2 opacity-90"
                      >
                        <div className="flex justify-between items-start">
                          <div>
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="text-xs font-black text-slate-900">{order.orderNumber}</span>
                              {order.isSplitOrder && (
                                <span className="text-[9px] font-black bg-emerald-100 text-emerald-900 px-1.5 py-0.2 rounded">
                                  ✓ Split ({order.shipmentCount} envíos entregados)
                                </span>
                              )}
                            </div>
                            <p className="text-[11px] text-slate-500">{order.customer.name}</p>
                          </div>
                          <span className="text-[10px] font-bold bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-md">
                            Entregado
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-400">
                          {order.timestamps.deliveredAt ? formatTimeBogota(order.timestamps.deliveredAt) : 'Completado'}
                        </p>
                      </div>
                    ))}
                </div>
              </div>
            </div>

            {/* Cancelled Orders & Physical Returns Queue */}
            {filteredStoreOrders.filter(o=>!o.childShipments?.length).some(o => o.fulfillmentStatus === 'CANCELADO' || o.physicalReturnPending) && (
              <div className="bg-rose-50/70 border border-rose-200 rounded-3xl p-4 md:p-5 space-y-3 shadow-xs">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-black text-rose-950 uppercase tracking-wider flex items-center gap-1.5">
                    <AlertTriangle className="w-4 h-4 text-rose-600" />
                    <span>Pedidos Cancelados & Devoluciones Físicas a Bodega</span>
                  </h3>
                  <span className="text-[10px] font-extrabold bg-rose-200 text-rose-900 px-2 py-0.5 rounded-full">
                    {filteredStoreOrders.filter(o=>!o.childShipments?.length).filter(o => !o.childShipments?.length && o.fulfillmentStatus === 'CANCELADO').length} cancelados
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {filteredStoreOrders.filter(o=>!o.childShipments?.length)
                    .filter(o => !o.childShipments?.length && o.fulfillmentStatus === 'CANCELADO' || o.physicalReturnPending)
                    .map(order => (
                      <div key={order.id} className="bg-white p-3.5 rounded-2xl border border-rose-200 text-xs space-y-2 shadow-xs">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-1.5">
                            <span className="font-black text-slate-900">{order.orderNumber}</span>
                            <span className="text-[10px] bg-rose-100 text-rose-800 font-bold px-2 py-0.5 rounded">
                              CANCELADO
                            </span>
                          </div>
                          <button
                            onClick={() => handleOpenHistory(order)}
                            className="text-[10px] font-bold text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 px-2 py-0.5 rounded-md transition"
                          >
                            Auditoría
                          </button>
                        </div>

                        {order.cancelReason && (
                          <p className="text-[11px] text-slate-600">
                            <strong>Motivo:</strong> {order.cancelReason}
                          </p>
                        )}

                        {order.physicalReturnPending ? (
                          <div className="bg-amber-50 border border-amber-200 p-2.5 rounded-xl space-y-1.5">
                            <p className="text-[11px] font-extrabold text-amber-900">
                              ⚠️ Mercancía despachada: Retorno físico pendiente de verificación
                            </p>
                            <p className="text-[10px] text-amber-700">
                              El stock reservado permanece en cuarentena y NO está disponible para la venta hasta confirmación de inspección física en sede.
                            </p>
                            <button
                              onClick={() => handleConfirmPhysicalReturn(order.id)}
                              className="w-full bg-amber-600 hover:bg-amber-700 text-white font-bold text-[10px] py-1.5 rounded-lg transition shadow-xs"
                            >
                              Confirmar Inspección Física y Reingreso de Stock ✓
                            </button>
                          </div>
                        ) : order.physicalReturnConfirmedAt ? (
                          <div className="text-[10px] text-emerald-700 font-bold bg-emerald-50 p-2 rounded-xl border border-emerald-100">
                            ✓ Retorno físico verificado por {order.physicalReturnConfirmedBy} ({formatTimeBogota(order.physicalReturnConfirmedAt)})
                          </div>
                        ) : (
                          <div className="text-[10px] text-slate-500 bg-slate-50 p-2 rounded-xl border border-slate-100">
                            Cancelado antes de despacho: Stock liberado atómicamente a inventario vendible.
                          </div>
                        )}
                      </div>
                    ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ============================================================== */}
        {/* TAB: BODEGAS INDEPENDIENTES Y CALIBRACIÓN DE ENTRADAS EN MAPA */}
        {/* ============================================================== */}
        {activeTab === 'BODEGAS' && (
          <WarehouseManagerTab
            stores={stores}
            products={products}
            orders={orders}
            onRefreshStores={loadData}
          />
        )}

        {/* ============================================================== */}
        {/* TAB: ADMINISTRADOR DE CATÁLOGO & PRECIOS */}
        {/* ============================================================== */}
        {activeTab === 'CATALOGO' && (
          <CatalogManagerTab
            currentAdminUser={adminUser}
            onOpenAuthModal={onAuthenticate}
            onRefreshCatalog={loadData}
          />
        )}

        {/* ============================================================== */}
        {/* TAB: SINCRONIZACIÓN SHOPIFY AGROCENTRO PETS */}
        {/* ============================================================== */}
        {activeTab === 'SHOPIFY' && (
          <ShopifySyncTab
            onRefreshData={loadData}
          />
        )}

        {/* ============================================================== */}
        {/* TAB 2: VETERINARY PRESCRIPTION QUEUE */}
        {/* ============================================================== */}
        {activeTab === 'FARMACIA' && (
          <div className="space-y-4">
            <div>
              <h2 className="text-xl font-black text-slate-900 flex items-center gap-2">
                <span>💊 Cola de Revisión de Fórmulas Médicas Veterinarias</span>
                <span className="text-xs bg-red-100 text-red-700 font-bold px-2.5 py-0.5 rounded-full">
                  Exclusivo Q.F. / Médico Veterinario
                </span>
              </h2>
              <p className="text-xs text-slate-500">
                Validación obligatoria de recetas, registro ICA, posología y firma antes de habilitar despacho.
              </p>
            </div>

            {pendingPrescriptionOrders.length === 0 ? (
              <div className="bg-white p-8 rounded-3xl border border-slate-200 text-center space-y-2">
                <CheckCircle2 className="w-10 h-10 text-emerald-600 mx-auto" />
                <h3 className="font-bold text-slate-800 text-sm">No hay fórmulas pendientes de revisión</h3>
                <p className="text-xs text-slate-500">
                  Todas las recetas subidas por los clientes han sido procesadas conformes a la normativa.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {pendingPrescriptionOrders.map(order => (
                  <div
                    key={order.id}
                    className="bg-white p-5 rounded-3xl border-2 border-red-200 shadow-sm space-y-4"
                  >
                    <div className="flex items-start justify-between">
                      <div>
                        <span className="text-sm font-black text-slate-900">{order.orderNumber}</span>
                        <p className="text-xs text-slate-600 font-semibold">{order.customer.name} • {order.customer.phone}</p>
                        <p className="text-[11px] text-slate-400">Subido: {order.prescriptionReview.uploadedAt ? formatTimeBogota(order.prescriptionReview.uploadedAt) : ''}</p>
                      </div>
                      <span className="text-xs bg-red-100 text-red-800 font-black px-2.5 py-1 rounded-full">
                        Requiere Aprobación
                      </span>
                    </div>

                    {/* Prescribed Items in order */}
                    <div className="bg-slate-50 p-3 rounded-2xl border border-slate-100 space-y-2 text-xs">
                      <p className="font-bold text-slate-700">Medicamentos restringidos en el pedido:</p>
                      {order.items.filter(i => i.requiresPrescription).map(item => (
                        <div key={item.productId} className="flex justify-between items-center text-slate-800">
                          <span className="font-bold text-red-600">{item.quantity}x {item.name}</span>
                          <span className="text-[11px] bg-white border border-slate-200 px-2 py-0.5 rounded-md font-mono">
                            {item.sku}
                          </span>
                        </div>
                      ))}
                    </div>

                    {/* Document Preview Link */}
                    <div className="bg-slate-50 p-3 rounded-2xl border border-slate-100 flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2 overflow-hidden">
                        <FileText className="w-4 h-4 text-slate-600 shrink-0" />
                        <span className="font-medium text-slate-800 truncate">
                          {order.prescriptionReview.documentName || 'receta_adjunta.pdf'}
                        </span>
                      </div>
                      {order.prescriptionReview.documentUrl && (
                        <a
                          href={order.prescriptionReview.documentUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="bg-slate-200 hover:bg-slate-300 text-slate-800 font-bold px-3 py-1 rounded-xl text-xs transition"
                        >
                          Ver Receta
                        </a>
                      )}
                    </div>

                    <div className="space-y-1">
                      <label className="text-xs font-bold text-slate-700">Observaciones del Revisor Farmacéutico:</label>
                      <input
                        type="text"
                        placeholder="Ej. Receta vigente, posología adecuada para canino 12kg"
                        value={reviewNotes}
                        onChange={e => setReviewNotes(e.target.value)}
                        className="w-full text-xs bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-slate-800"
                      />
                    </div>

                    <div className="pt-2 flex items-center gap-2">
                      <button
                        onClick={() => handleReviewPrescription(order.id, 'APROBADA')}
                        className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs py-2.5 rounded-xl transition flex items-center justify-center gap-1.5 shadow-sm"
                      >
                        <CheckCircle2 className="w-4 h-4" />
                        <span>Aprobar y Habilitar Despacho</span>
                      </button>
                      <button
                        onClick={() => handleReviewPrescription(order.id, 'RECHAZADA')}
                        className="bg-rose-100 hover:bg-rose-200 text-rose-800 font-bold text-xs px-4 py-2.5 rounded-xl transition"
                      >
                        Rechazar
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ============================================================== */}
        {/* TAB 3: FLEET & LIVE REPARTIDORES */}
        {/* ============================================================== */}
        {activeTab === 'FLOTA' && <TransportManagerTab admin={adminUser} onAuthenticate={onAuthenticate} />}

        {/* ============================================================== */}
        {/* TAB 4: INVENTORY & EXPIRY */}
        {/* ============================================================== */}
        {activeTab === 'INVENTARIO' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xl font-black text-slate-900">Control de Inventario, Lotes y Cadena de Frío</h2>
                <p className="text-xs text-slate-500">
                  Regla de seguridad: Venta online se pausa automáticamente cuando quedan 2 o menos unidades.
                </p>
              </div>
            </div>

            {/* Inactive / Excluded Store Audit Banners */}
            {renderAuditBanners()}

            <div className="bg-white rounded-3xl border border-slate-200 overflow-hidden shadow-xs">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 uppercase tracking-wider font-extrabold">
                    <tr>
                      <th className="p-3.5">Producto</th>
                      <th className="p-3.5">SKU / Reg ICA</th>
                      <th className="p-3.5">Categoría</th>
                      <th className="p-3.5">Precio COP</th>
                      <th className="p-3.5">
                        {selectedStoreId === 'ALL_ACTIVE'
                          ? 'Stock Total (Activas)'
                          : `Stock Sede (${selectedStore?.name.replace('Bolt Pets ', '') || ''})`}
                      </th>
                      <th className="p-3.5">Reservado</th>
                      <th className="p-3.5">Lote / Vencimiento</th>
                      <th className="p-3.5">Estado Venta</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 font-medium text-slate-700">
                    {products.map(prod => {
                      let stock = 0;
                      let reserved = 0;
                      if (selectedStoreId === 'ALL_ACTIVE') {
                        activeStoresExceptCentro.forEach(s => {
                          stock += (prod.stockByStore[s.id] || 0);
                          reserved += (prod.reservedStockByStore[s.id] || 0);
                        });
                      } else {
                        stock = prod.stockByStore[selectedStoreId] || 0;
                        reserved = prod.reservedStockByStore[selectedStoreId] || 0;
                      }
                      const available = Math.max(0, stock - reserved);
                      const lot = prod.lots?.[0];

                      return (
                        <tr key={prod.id} className="hover:bg-slate-50/80">
                          <td className="p-3.5 flex items-center gap-2.5">
                            <ProductImage src={prod.image} alt="" className="w-8 h-8 rounded-lg object-cover" />
                            <div>
                              <p className="font-bold text-slate-900 leading-tight">{prod.name}</p>
                              <p className="text-[11px] text-slate-400">{prod.presentation}</p>
                            </div>
                          </td>
                          <td className="p-3.5">
                            <span className="font-mono bg-slate-100 px-1.5 py-0.5 rounded text-[11px]">
                              {prod.sku}
                            </span>
                            {prod.icaRegistration && (
                              <p className="text-[10px] text-emerald-700 font-bold mt-0.5">
                                {prod.icaRegistration}
                              </p>
                            )}
                          </td>
                          <td className="p-3.5">
                            <span className="text-[11px] bg-slate-100 text-slate-700 px-2 py-0.5 rounded-full font-semibold">
                              {prod.category}
                            </span>
                          </td>
                          <td className="p-3.5 font-bold text-slate-900 font-mono">
                            {formatCOP(prod.price)}
                          </td>
                          <td className="p-3.5 font-bold text-slate-900">
                            <span className="font-mono text-sm">{stock}</span>
                            {selectedStoreId === 'ALL_ACTIVE' && (
                              <p className="text-[10px] text-slate-400 font-mono font-medium mt-0.5">
                                {activeStoresExceptCentro.map(s => {
                                  const label = s.name.replace('Bolt Pets ', '').substring(0, 3).toUpperCase();
                                  return `${label}: ${prod.stockByStore[s.id] || 0}`;
                                }).join(' · ')}
                              </p>
                            )}
                          </td>
                          <td className="p-3.5 text-amber-700 font-bold font-mono">
                            {reserved}
                          </td>
                          <td className="p-3.5 text-[11px]">
                            {lot ? (
                              <div>
                                <span className="font-bold">{lot.lotNumber}</span>
                                <p className="text-slate-400">Vence: {lot.expiryDate}</p>
                              </div>
                            ) : 'N/A'}
                          </td>
                          <td className="p-3.5">
                            {isSelectedStoreInactive ? (
                              <span className="text-[10px] font-bold bg-slate-200 text-slate-700 px-2 py-0.5 rounded-full">
                                Bodega Inactiva ({available})
                              </span>
                            ) : available <= 0 ? (
                              <span className="text-[10px] font-bold bg-rose-100 text-rose-800 px-2 py-0.5 rounded-full">
                                Agotado
                              </span>
                            ) : available <= 2 ? (
                              <span className="text-[10px] font-bold bg-amber-100 text-amber-800 px-2 py-0.5 rounded-full">
                                Pausado (Margen Seg.)
                              </span>
                            ) : (
                              <span className="text-[10px] font-bold bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-full">
                                Activo ({available})
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

      </div>

      {/* Modal de Auditoría y Trazabilidad de Estados del Servidor */}
      {historyModalOrder && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-xl w-full p-6 shadow-2xl space-y-4 max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h3 className="text-base font-black text-slate-900 flex items-center gap-2">
                  <FileText className="w-4 h-4 text-red-600" />
                  <span>Historial de Auditoría — {historyModalOrder.orderNumber}</span>
                </h3>
                <p className="text-xs text-slate-500">
                  Registro inmutable de transiciones y eventos validados por el servidor
                </p>
              </div>
              <button
                onClick={() => setHistoryModalOrder(null)}
                className="w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-700 flex items-center justify-center font-bold text-sm transition"
              >
                ✕
              </button>
            </div>

            <div className="flex-1 overflow-y-auto space-y-2.5 pr-1">
              {loadingHistory ? (
                <div className="py-8 text-center text-xs font-bold text-slate-400">
                  Cargando trazabilidad desde el servidor autoritativo...
                </div>
              ) : orderHistoryEntries.length === 0 ? (
                <div className="py-8 text-center text-xs text-slate-400">
                  No hay registros de auditoría disponibles para este pedido.
                </div>
              ) : (
                orderHistoryEntries.map((entry, idx) => (
                  <div key={entry.id || idx} className="bg-slate-50 p-3.5 rounded-2xl border border-slate-200/80 text-xs space-y-1.5 shadow-2xs">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-[10px] text-slate-400 font-bold">#{idx + 1}</span>
                        <span className="font-extrabold text-slate-900">
                          {entry.previousStatus} → <span className="text-red-600 font-black">{entry.newStatus}</span>
                        </span>
                        {entry.shipmentId && (
                          <span className="text-[10px] bg-amber-100 text-amber-900 px-1.5 py-0.2 rounded font-bold">
                            {entry.shipmentId}
                          </span>
                        )}
                      </div>
                      <span className="text-[10px] font-mono text-slate-500">
                        {formatTimeBogota(entry.timestamp)}
                      </span>
                    </div>

                    <div className="flex items-center gap-2 text-[11px] text-slate-600">
                      <span className="font-bold bg-slate-200 text-slate-800 px-1.5 py-0.2 rounded-md text-[10px]">
                        Actor: {entry.actor?.role}
                      </span>
                      <span>{entry.actor?.name || entry.actor?.id || 'Sistema'}</span>
                    </div>

                    {entry.reason && (
                      <p className="text-[11px] text-slate-700 bg-white p-2 rounded-xl border border-slate-100 font-medium">
                        <strong>Motivo:</strong> {entry.reason}
                      </p>
                    )}
                  </div>
                ))
              )}
            </div>

            <div className="pt-2 border-t border-slate-100 flex justify-end">
              <button
                onClick={() => setHistoryModalOrder(null)}
                className="bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs px-4 py-2 rounded-xl transition"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};
