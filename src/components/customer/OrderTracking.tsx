import React, { useEffect, useState, useRef } from 'react';
import { APIProvider, Map, AdvancedMarker, useMap } from '@vis.gl/react-google-maps';
import { 
  ArrowLeft, Phone, ShieldCheck, Clock, CheckCircle2, 
  MapPin, AlertTriangle, Navigation, RefreshCw, Key, ChevronUp, ChevronDown,
  Calendar, Layers, Truck
} from 'lucide-react';
import { Order, GPSTelemetry, ChildShipment } from '../../types';
import { formatCOP, formatTimeBogota, timeAgoSpanish } from '../../lib/formatters';
import { api } from '../../lib/api';
import { pushService } from '../../lib/notifications';
import { useFoldable } from '../../hooks/useFoldable';

declare const google: any;

interface OrderTrackingProps {
  orderId: string;
  onBack: () => void;
}

// Sub-component to manage map bounds and center smoothly
const MapController: React.FC<{
  hub: { lat: number; lng: number };
  customer: { lat: number; lng: number };
  driver?: { lat: number; lng: number };
  recenterTrigger: number;
  isDualScreen?: boolean;
}> = ({ hub, customer, driver, recenterTrigger, isDualScreen }) => {
  const map = useMap();

  useEffect(() => {
    if (!map || typeof google === 'undefined') return;
    const bounds = new google.maps.LatLngBounds();
    bounds.extend(hub);
    bounds.extend(customer);
    if (driver) bounds.extend(driver);
    map.fitBounds(bounds, {
      top: 60,
      right: 60,
      bottom: isDualScreen ? 60 : 220,
      left: 60,
    });
  }, [map, hub, customer, driver, recenterTrigger, isDualScreen]);

  return null;
};

export const OrderTracking: React.FC<OrderTrackingProps> = ({ orderId, onBack }) => {
  const [order, setOrder] = useState<Order | null>(null);
  const [trackingData, setTrackingData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [recenterCount, setRecenterCount] = useState(0);
  const [sheetExpanded, setSheetExpanded] = useState(false);
  const [isSimulatingGps, setIsSimulatingGps] = useState(false);
  const simulationIntervalRef = useRef<any>(null);
  const foldable = useFoldable();
  const isSplitLayout = foldable.isExpanded || foldable.isDualScreen;

  // Multi-shipment tab state for split orders
  const [activeShipmentIndex, setActiveShipmentIndex] = useState(0);

  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || 'AIzaSyBeZD10ABWRpSpwChGlSzPR-6wxdD9oJcE';

  const loadData = async () => {
    try {
      const ord = await api.getOrder(orderId);
      setOrder(ord);
      const tracking = await api.getTracking(orderId);
      setTrackingData(tracking);
    } catch (e) {
      console.error('Error fetching tracking:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 5000);
    return () => clearInterval(interval);
  }, [orderId]);

  // GPS Simulation along road in Bogotá
  const toggleGpsSimulation = () => {
    if (isSimulatingGps) {
      clearInterval(simulationIntervalRef.current);
      setIsSimulatingGps(false);
    } else {
      setIsSimulatingGps(true);
      if (order) {
        pushService.simulateOrderTransition(order.orderNumber, order.id, 'EN_CAMINO', order.driver?.name, order.secretDeliveryCode);
      }
      let step = 0;
      const baseLat = 4.6284;
      const baseLng = -74.1539;
      const destLat = order?.deliveryAddress.coordinates.lat || 4.6365;
      const destLng = order?.deliveryAddress.coordinates.lng || -74.1448;

      simulationIntervalRef.current = setInterval(async () => {
        step = (step + 1) % 20;
        const fraction = step / 20;
        const curLat = baseLat + (destLat - baseLat) * fraction;
        const curLng = baseLng + (destLng - baseLng) * fraction;

        const telemetry: GPSTelemetry = {
          orderId,
          assignmentId: 'ASG-SIM',
          tripId: 'TRP-SIM',
          latitude: curLat,
          longitude: curLng,
          accuracy: 4.0,
          heading: 45,
          speed: 28,
          batteryLevel: 88,
          timestamp: Date.now(),
          sequenceNumber: step + 1,
        };

        await api.sendGpsTelemetry(telemetry);
        await loadData();
      }, 4000);
    }
  };

  useEffect(() => {
    return () => {
      if (simulationIntervalRef.current) clearInterval(simulationIntervalRef.current);
    };
  }, []);

  if (loading || !order) {
    return (
      <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center p-4">
        <div className="w-12 h-12 border-4 border-red-600 border-t-transparent rounded-full animate-spin"></div>
        <p className="mt-4 text-xs font-bold text-slate-300">Cargando seguimiento en tiempo real...</p>
      </div>
    );
  }

  // Active shipment data if split order
  const isSplitOrder = !!order.isSplitOrder && !!order.childShipments?.length;
  const childShipments: ChildShipment[] = order.childShipments || [];
  const currentChild: ChildShipment | undefined = isSplitOrder ? childShipments[activeShipmentIndex] : undefined;

  const deliveredCount = childShipments.filter(s => s.fulfillmentStatus === 'ENTREGADO').length;

  const effectiveStatus = currentChild ? currentChild.fulfillmentStatus : order.fulfillmentStatus;
  const effectiveDriver = currentChild?.driver || order.driver;
  const effectiveSecretCode = currentChild?.secretDeliveryCode || order.secretDeliveryCode;

  const hubCoords = trackingData?.hubCoordinates || { lat: 4.6284, lng: -74.1539 };
  const customerCoords = trackingData?.customerCoordinates || order.deliveryAddress.coordinates;
  const driverCoords = trackingData?.telemetry
    ? { lat: trackingData.telemetry.latitude, lng: trackingData.telemetry.longitude }
    : (effectiveDriver ? { lat: 4.6312, lng: -74.1485 } : undefined);

  const secondsAgo = trackingData?.telemetry?.secondsAgo ?? 4;
  const isStale = secondsAgo > 30 && secondsAgo <= 60;
  const isLost = secondsAgo > 60;

  const getStatusBadge = () => {
    if (order.deliveryMode === 'PROGRAMADO' && effectiveStatus !== 'ENTREGADO') {
      return { text: '📅 Programado', bg: 'bg-blue-600 text-white', dot: 'bg-blue-300' };
    }
    switch (effectiveStatus) {
      case 'EN_CAMINO':
        return { text: '⚡ Repartidor en camino', bg: 'bg-yellow-400 text-red-950', dot: 'bg-red-600 animate-ping' };
      case 'ENTREGADO':
        return { text: '✓ Entregado', bg: 'bg-emerald-600 text-white', dot: 'bg-white' };
      case 'EN_ALISTAMIENTO':
        return { text: '📦 Alistando en tienda', bg: 'bg-blue-600 text-white', dot: 'bg-blue-300 animate-pulse' };
      case 'LISTO_PARA_DESPACHO':
        return { text: '🛵 Listo para recogida', bg: 'bg-amber-600 text-white', dot: 'bg-amber-300' };
      default:
        return { text: 'Confirmado', bg: 'bg-slate-700 text-white', dot: 'bg-slate-300' };
    }
  };

  const statusBadge = getStatusBadge();

  // Vista de doble panel para iPhone Duo desplegado (951px o pantalla amplia)
  if (isSplitLayout) {
    return (
      <div className="relative w-full h-screen overflow-hidden flex flex-row bg-slate-900">
        {/* Panel izquierdo: Información, repartidor, PIN y productos */}
        <div className="w-[45%] max-w-md xl:max-w-lg h-full flex flex-col bg-white border-r border-slate-200 z-10 shadow-2xl overflow-y-auto">
          {/* Cabecera del panel izquierdo */}
          <div className="p-4 border-b border-slate-100 flex items-center justify-between sticky top-0 bg-white/95 backdrop-blur-md z-10">
            <button
              onClick={onBack}
              className="bg-slate-100 text-slate-800 p-2 rounded-full hover:bg-slate-200 transition active:scale-95"
              title="Volver a la tienda"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-2">
              <span className={`w-2.5 h-2.5 rounded-full ${statusBadge.dot}`} />
              <span className="font-black text-xs text-slate-900">{order.orderNumber}</span>
              <span className={`text-[10px] font-extrabold px-2 py-0.5 rounded-full ${statusBadge.bg}`}>
                {statusBadge.text}
              </span>
            </div>
            {isSplitOrder && (
              <span className="text-[10px] font-black bg-amber-100 text-amber-900 px-2 py-0.5 rounded-full">
                {deliveredCount}/{childShipments.length}
              </span>
            )}
          </div>

          <div className="p-5 space-y-4 flex-1">
            {/* Multi-Shipment Tabs for Split Orders */}
            {isSplitOrder && (
              <div className="flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar">
                {childShipments.map((shipment, index) => {
                  const isSelected = activeShipmentIndex === index;
                  const isDelivered = shipment.fulfillmentStatus === 'ENTREGADO';
                  return (
                    <button
                      key={shipment.shipmentId}
                      onClick={() => setActiveShipmentIndex(index)}
                      className={`px-3 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1.5 shrink-0 ${
                        isSelected
                          ? 'bg-red-600 text-white shadow-xs'
                          : isDelivered
                          ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                          : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                      }`}
                    >
                      <span>Envío {index + 1} de {childShipments.length}</span>
                      <span className="text-[10px] opacity-80">({shipment.weightKg} kg)</span>
                      {isDelivered && <span>✓</span>}
                    </button>
                  );
                })}
              </div>
            )}

            {/* Tiempo estimado y PIN secreto */}
            <div className="flex items-center justify-between p-4 bg-slate-50 rounded-2xl border border-slate-200/80">
              <div>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                  {order.deliveryMode === 'PROGRAMADO'
                    ? 'Franja de Entrega'
                    : isSplitOrder
                    ? `Tiempo estimado (Envío ${activeShipmentIndex + 1})`
                    : 'Tiempo estimado'}
                </p>
                <h2 className="text-xl font-black text-slate-900 tracking-tight mt-0.5">
                  {effectiveStatus === 'ENTREGADO' ? (
                    <span className="text-emerald-600">
                      {isSplitOrder ? `¡Envío ${activeShipmentIndex + 1} entregado!` : '¡Pedido entregado!'}
                    </span>
                  ) : order.deliveryMode === 'PROGRAMADO' ? (
                    <span className="text-blue-700 text-base">
                      {order.scheduledWindow?.dateLabel} {order.scheduledWindow?.displayWindow.toLowerCase()}
                    </span>
                  ) : (
                    <span>Llega en aprox. <span className="text-red-600">{order.estimatedDeliveryMinutes} min</span></span>
                  )}
                </h2>
                <p className="text-[11px] text-slate-500 mt-1">
                  Entrega en: <strong className="text-slate-800">{order.deliveryAddress.address}</strong>
                </p>
              </div>

              {/* PIN Code Box */}
              <div className="bg-red-50 border border-red-200 rounded-2xl p-2.5 text-center shadow-xs shrink-0 ml-3">
                <span className="text-[10px] font-bold text-red-700 uppercase flex items-center justify-center gap-1">
                  <Key className="w-3 h-3 text-red-600" />
                  {isSplitOrder ? `PIN Envío ${activeShipmentIndex + 1}` : 'Código Entrega'}
                </span>
                <p className="text-xl font-black text-red-700 tracking-widest mt-0.5">
                  {effectiveSecretCode}
                </p>
              </div>
            </div>

            {/* Repartidor asignado */}
            {effectiveDriver && (
              <div className="p-3 bg-white rounded-2xl border border-slate-200/80 flex items-center justify-between shadow-xs">
                <div className="flex items-center gap-3">
                  <img
                    src={effectiveDriver.photo}
                    alt={effectiveDriver.name}
                    className="w-11 h-11 rounded-full object-cover border border-slate-200 shadow-xs"
                  />
                  <div>
                    <p className="text-xs font-black text-slate-900">
                      {effectiveDriver.name} {isSplitOrder && `(Envío ${activeShipmentIndex + 1})`}
                    </p>
                    <p className="text-[11px] text-slate-500">
                      {effectiveDriver.vehicleType} • Placa: <strong className="text-slate-800">{effectiveDriver.vehiclePlate}</strong>
                    </p>
                    <div className="flex items-center gap-1 text-[11px] text-amber-600 font-bold">
                      <span>★ {effectiveDriver.rating}</span>
                      <span className="text-slate-400">• Flota Propia Bolt Pets</span>
                    </div>
                  </div>
                </div>

                <a
                  href={`tel:${effectiveDriver.phone}`}
                  className="w-10 h-10 rounded-full bg-emerald-600 hover:bg-emerald-700 text-white flex items-center justify-center shadow-md shadow-emerald-600/30 transition shrink-0"
                  title="Llamar al repartidor"
                >
                  <Phone className="w-4 h-4" />
                </a>
              </div>
            )}

            {/* Cobro contra entrega */}
            {order.payment.method === 'CASH_ON_DELIVERY' && currentChild && (
              <div className="text-xs bg-amber-50 text-amber-950 p-2.5 rounded-xl border border-amber-200">
                <strong>Cobro contra entrega de este envío: </strong>
                <span className="font-extrabold">{formatCOP(currentChild.cashToCollect)}</span>
                <span className="text-[11px] text-slate-600 ml-1">
                  (Total pedido: {formatCOP(order.totals.total)})
                </span>
              </div>
            )}

            {/* Indicaciones de portería */}
            <div className="text-xs text-slate-600 bg-slate-50 p-3 rounded-xl border border-slate-200/60">
              <strong className="text-slate-800">Instrucciones de recepción: </strong>
              <span>
                {order.deliveryAddress.porteriaPolicy === 'DEJAR_EN_PORTERIA'
                  ? 'Dejar en portería debidamente sellado.'
                  : order.deliveryAddress.porteriaPolicy === 'SUBIR_A_PUERTA'
                  ? 'Subir al apartamento.'
                  : 'Llamar al teléfono celular al momento de llegar.'}
              </span>
              {order.deliveryAddress.details && ` (${order.deliveryAddress.details})`}
            </div>

            {/* Desglose de productos */}
            <div className="space-y-2 pt-1 border-t border-slate-100">
              <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                {currentChild
                  ? `Productos en este envío (${currentChild.items.length})`
                  : `Productos en el paquete (${order.items.length})`}
              </h4>
              <div className="space-y-1.5 max-h-52 overflow-y-auto pr-1">
                {(currentChild ? currentChild.items : order.items).map(item => (
                  <div key={item.productId} className="flex items-center justify-between text-xs py-1.5 border-b border-slate-100">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-red-600">{item.quantity}x</span>
                      <span className="font-medium text-slate-800">{item.name}</span>
                    </div>
                    <span className="font-bold text-slate-900">{formatCOP(item.price * item.quantity)}</span>
                  </div>
                ))}
              </div>

              <div className="flex justify-between pt-2 text-sm font-black text-slate-900">
                <span>Total del pedido:</span>
                <span className="text-red-600">{formatCOP(order.totals.total)}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Panel derecho: Mapa interactivo en tiempo real a pantalla completa */}
        <div className="flex-1 h-full relative overflow-hidden bg-slate-900">
          {/* Barra superior flotante sobre el mapa */}
          <div className="absolute top-4 left-4 right-4 z-20 flex items-center justify-between pointer-events-none">
            {effectiveStatus === 'EN_CAMINO' ? (
              <div className="pointer-events-auto bg-slate-900/90 backdrop-blur-md text-white text-[11px] font-bold px-3.5 py-1.5 rounded-full shadow-xl flex items-center gap-2 border border-slate-700">
                <span className={`w-2 h-2 rounded-full ${isLost ? 'bg-red-500' : isStale ? 'bg-amber-400' : 'bg-emerald-400 animate-pulse'}`} />
                {isLost ? (
                  <span className="text-red-300">Señal GPS perdida (hace {secondsAgo}s)</span>
                ) : isStale ? (
                  <span className="text-amber-300">Ubicación desactualizada (hace {secondsAgo}s)</span>
                ) : (
                  <span>GPS en vivo ({timeAgoSpanish(trackingData?.telemetry?.timestamp || Date.now())})</span>
                )}
                <button
                  onClick={toggleGpsSimulation}
                  className={`ml-2 px-2 py-0.5 rounded-md text-[10px] font-black transition ${
                    isSimulatingGps ? 'bg-red-600 text-white animate-pulse' : 'bg-slate-800 text-yellow-300 hover:bg-slate-700'
                  }`}
                >
                  {isSimulatingGps ? 'Pausar Simulación' : 'Simular GPS'}
                </button>
              </div>
            ) : order.deliveryMode === 'PROGRAMADO' ? (
              <div className="pointer-events-auto bg-blue-900/90 backdrop-blur-md text-white text-[11px] font-bold px-4 py-1.5 rounded-full shadow-xl flex items-center gap-2 border border-blue-700">
                <Calendar className="w-3.5 h-3.5 text-blue-300" />
                <span>Programado: {order.scheduledWindow?.dateLabel} {order.scheduledWindow?.displayWindow.toLowerCase()}</span>
              </div>
            ) : (
              <div />
            )}

            <button
              onClick={() => setRecenterCount(c => c + 1)}
              className="pointer-events-auto bg-white/95 backdrop-blur-md text-slate-800 p-2.5 rounded-full shadow-lg border border-slate-200/80 hover:bg-slate-50 transition active:scale-95"
              title="Recentrar mapa"
            >
              <Navigation className="w-5 h-5 text-red-600" />
            </button>
          </div>

          <APIProvider apiKey={apiKey}>
            <Map
              defaultCenter={hubCoords}
              defaultZoom={14}
              mapId="DEMO_MAP_ID_DUAL"
              className="w-full h-full"
              gestureHandling="greedy"
              disableDefaultUI={true}
              internalUsageAttributionIds={['gmp_mcp_codeassist_v1_aistudio']}
            >
              <MapController
                hub={hubCoords}
                customer={customerCoords}
                driver={driverCoords}
                recenterTrigger={recenterCount}
                isDualScreen={true}
              />

              {/* Sede / Hub Marker */}
              <AdvancedMarker position={hubCoords} title={`Sede ${order.storeName}`}>
                <div className="flex flex-col items-center">
                  <div className="bg-[#DC2626] text-white p-2 rounded-2xl shadow-xl border-2 border-white flex items-center justify-center">
                    <span className="text-base font-black">⚡</span>
                  </div>
                  <span className="bg-white text-slate-900 font-extrabold text-[10px] px-2 py-0.5 rounded-md shadow-md mt-1 whitespace-nowrap">
                    {order.storeName.replace('Sede ', '')}
                  </span>
                </div>
              </AdvancedMarker>

              {/* Customer Destination Marker */}
              <AdvancedMarker position={customerCoords} title="Dirección de Entrega">
                <div className="flex flex-col items-center">
                  <div className="bg-emerald-600 text-white p-2 rounded-2xl shadow-xl border-2 border-white flex items-center justify-center">
                    <MapPin className="w-4 h-4" />
                  </div>
                  <span className="bg-white text-slate-900 font-extrabold text-[10px] px-2 py-0.5 rounded-md shadow-md mt-1 whitespace-nowrap">
                    Tú (Destino)
                  </span>
                </div>
              </AdvancedMarker>

              {/* Assigned Driver Marker with vehicle */}
              {driverCoords && (
                <AdvancedMarker position={driverCoords} title={effectiveDriver?.name || 'Repartidor'}>
                  <div className="flex flex-col items-center relative">
                    <div className="absolute -inset-1.5 bg-yellow-400 rounded-full animate-ping opacity-40"></div>
                    <div className="relative bg-yellow-400 text-red-950 p-2 rounded-full shadow-2xl border-2 border-white flex items-center justify-center">
                      <span className="text-base">🛵</span>
                    </div>
                    <span className="bg-slate-900 text-white font-extrabold text-[10px] px-2 py-0.5 rounded-md shadow-md mt-1 whitespace-nowrap border border-slate-700">
                      {effectiveDriver?.name?.split(' ')[0] || 'Repartidor'} • {effectiveDriver?.vehiclePlate}
                    </span>
                  </div>
                </AdvancedMarker>
              )}
            </Map>
          </APIProvider>
        </div>
      </div>
    );
  }

  // Vista estándar para pantalla cerrada de iPhone Duo (382px, 385px) y móviles
  return (
    <div className="relative w-full h-screen overflow-hidden flex flex-col bg-slate-900">
      
      {/* Top Floating Header */}
      <div className="absolute top-4 left-4 right-4 z-20 flex items-center justify-between pointer-events-none">
        <button
          onClick={onBack}
          className="pointer-events-auto bg-white/95 backdrop-blur-md text-slate-800 p-2.5 rounded-full shadow-lg border border-slate-200/80 hover:bg-slate-50 transition active:scale-95"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>

        <div className="pointer-events-auto bg-white/95 backdrop-blur-md px-3.5 py-1.5 rounded-full shadow-lg border border-slate-200/80 flex items-center gap-2">
          <span className={`w-2.5 h-2.5 rounded-full ${statusBadge.dot}`} />
          <span className="font-black text-xs text-slate-900">{order.orderNumber}</span>
          <span className={`text-[10px] font-extrabold px-2 py-0.5 rounded-full ${statusBadge.bg}`}>
            {statusBadge.text}
          </span>
          {isSplitOrder && (
            <span className="text-[10px] font-black bg-amber-100 text-amber-900 px-2 py-0.5 rounded-full">
              {deliveredCount} de {childShipments.length} entregados
            </span>
          )}
        </div>

        <button
          onClick={() => setRecenterCount(c => c + 1)}
          className="pointer-events-auto bg-white/95 backdrop-blur-md text-slate-800 p-2.5 rounded-full shadow-lg border border-slate-200/80 hover:bg-slate-50 transition active:scale-95"
          title="Recentrar mapa"
        >
          <Navigation className="w-5 h-5 text-red-600" />
        </button>
      </div>

      {/* GPS Telemetry Pill or Scheduled Banner */}
      {effectiveStatus === 'EN_CAMINO' ? (
        <div className="absolute top-16 left-4 right-4 z-20 flex justify-center pointer-events-none">
          <div className="pointer-events-auto bg-slate-900/90 backdrop-blur-md text-white text-[11px] font-bold px-3.5 py-1.5 rounded-full shadow-xl flex items-center gap-2 border border-slate-700">
            <span className={`w-2 h-2 rounded-full ${isLost ? 'bg-red-500' : isStale ? 'bg-amber-400' : 'bg-emerald-400 animate-pulse'}`} />
            {isLost ? (
              <span className="text-red-300">Señal GPS perdida (hace {secondsAgo}s)</span>
            ) : isStale ? (
              <span className="text-amber-300">Ubicación desactualizada (hace {secondsAgo}s)</span>
            ) : (
              <span>Ubicación GPS en vivo ({timeAgoSpanish(trackingData?.telemetry?.timestamp || Date.now())})</span>
            )}

            <button
              onClick={toggleGpsSimulation}
              className={`ml-2 px-2 py-0.5 rounded-md text-[10px] font-black transition ${
                isSimulatingGps ? 'bg-red-600 text-white animate-pulse' : 'bg-slate-800 text-yellow-300 hover:bg-slate-700'
              }`}
            >
              {isSimulatingGps ? 'Pausar Simulación' : 'Simular GPS'}
            </button>
          </div>
        </div>
      ) : order.deliveryMode === 'PROGRAMADO' && (
        <div className="absolute top-16 left-4 right-4 z-20 flex justify-center pointer-events-none">
          <div className="pointer-events-auto bg-blue-900/90 backdrop-blur-md text-white text-[11px] font-bold px-4 py-1.5 rounded-full shadow-xl flex items-center gap-2 border border-blue-700">
            <Calendar className="w-3.5 h-3.5 text-blue-300" />
            <span>Entrega programada para el {order.scheduledWindow?.dateLabel} {order.scheduledWindow?.displayWindow.toLowerCase()}</span>
          </div>
        </div>
      )}

      {/* Google Map */}
      <div className="flex-1 w-full h-full">
        <APIProvider apiKey={apiKey}>
          <Map
            defaultCenter={hubCoords}
            defaultZoom={14}
            mapId="DEMO_MAP_ID"
            className="w-full h-full"
            gestureHandling="greedy"
            disableDefaultUI={true}
            internalUsageAttributionIds={['gmp_mcp_codeassist_v1_aistudio']}
          >
            <MapController
              hub={hubCoords}
              customer={customerCoords}
              driver={driverCoords}
              recenterTrigger={recenterCount}
              isDualScreen={false}
            />

            {/* Sede / Hub Marker */}
            <AdvancedMarker position={hubCoords} title={`Sede ${order.storeName}`}>
              <div className="flex flex-col items-center">
                <div className="bg-[#DC2626] text-white p-2 rounded-2xl shadow-xl border-2 border-white flex items-center justify-center">
                  <span className="text-base font-black">⚡</span>
                </div>
                <span className="bg-white text-slate-900 font-extrabold text-[10px] px-2 py-0.5 rounded-md shadow-md mt-1 whitespace-nowrap">
                  {order.storeName.replace('Sede ', '')}
                </span>
              </div>
            </AdvancedMarker>

            {/* Customer Destination Marker */}
            <AdvancedMarker position={customerCoords} title="Dirección de Entrega">
              <div className="flex flex-col items-center">
                <div className="bg-emerald-600 text-white p-2 rounded-2xl shadow-xl border-2 border-white flex items-center justify-center">
                  <MapPin className="w-4 h-4" />
                </div>
                <span className="bg-white text-slate-900 font-extrabold text-[10px] px-2 py-0.5 rounded-md shadow-md mt-1 whitespace-nowrap">
                  Tú (Destino)
                </span>
              </div>
            </AdvancedMarker>

            {/* Assigned Driver Marker with vehicle */}
            {driverCoords && (
              <AdvancedMarker position={driverCoords} title={effectiveDriver?.name || 'Repartidor'}>
                <div className="flex flex-col items-center relative">
                  <div className="absolute -inset-1.5 bg-yellow-400 rounded-full animate-ping opacity-40"></div>
                  <div className="relative bg-yellow-400 text-red-950 p-2 rounded-full shadow-2xl border-2 border-white flex items-center justify-center">
                    <span className="text-base">🛵</span>
                  </div>
                  <span className="bg-slate-900 text-white font-extrabold text-[10px] px-2 py-0.5 rounded-md shadow-md mt-1 whitespace-nowrap border border-slate-700">
                    {effectiveDriver?.name?.split(' ')[0] || 'Repartidor'} • {effectiveDriver?.vehiclePlate}
                  </span>
                </div>
              </AdvancedMarker>
            )}
          </Map>
        </APIProvider>
      </div>

      {/* Draggable Bottom Sheet */}
      <div
        className={`absolute bottom-0 left-0 right-0 z-30 bg-white rounded-t-3xl shadow-2xl transition-all duration-300 border-t border-slate-200/80 ${
          sheetExpanded ? 'max-h-[85vh]' : 'max-h-[44vh]'
        } flex flex-col`}
      >
        {/* Drag handle */}
        <div
          onClick={() => setSheetExpanded(!sheetExpanded)}
          className="p-2.5 flex items-center justify-center cursor-pointer hover:bg-slate-50 transition rounded-t-3xl"
        >
          <div className="w-12 h-1.5 bg-slate-300 rounded-full"></div>
        </div>

        {/* Multi-Shipment Tabs for Split Orders */}
        {isSplitOrder && (
          <div className="px-5 pb-2">
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar">
              {childShipments.map((shipment, index) => {
                const isSelected = activeShipmentIndex === index;
                const isDelivered = shipment.fulfillmentStatus === 'ENTREGADO';
                return (
                  <button
                    key={shipment.shipmentId}
                    onClick={() => setActiveShipmentIndex(index)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1.5 shrink-0 ${
                      isSelected
                        ? 'bg-red-600 text-white shadow-xs'
                        : isDelivered
                        ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                        : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                    }`}
                  >
                    <span>Envío {index + 1} de {childShipments.length}</span>
                    <span className="text-[10px] opacity-80">({shipment.weightKg} kg)</span>
                    {isDelivered && <span>✓</span>}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Essential Tracking Bar */}
        <div className="px-5 pb-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                {order.deliveryMode === 'PROGRAMADO'
                  ? 'Franja de Entrega'
                  : isSplitOrder
                  ? `Tiempo estimado (Envío ${activeShipmentIndex + 1})`
                  : 'Tiempo estimado'}
              </p>
              <h2 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight">
                {effectiveStatus === 'ENTREGADO' ? (
                  <span className="text-emerald-600">
                    {isSplitOrder ? `¡Envío ${activeShipmentIndex + 1} entregado!` : '¡Pedido entregado!'}
                  </span>
                ) : order.deliveryMode === 'PROGRAMADO' ? (
                  <span className="text-blue-700 text-lg sm:text-xl">
                    {order.scheduledWindow?.dateLabel} {order.scheduledWindow?.displayWindow.toLowerCase()}
                  </span>
                ) : (
                  <span>Llega en aprox. <span className="text-red-600">{order.estimatedDeliveryMinutes} min</span></span>
                )}
              </h2>
            </div>

            {/* Customer Secret Delivery Code */}
            <div className="bg-red-50 border border-red-200 rounded-2xl p-2.5 text-center shadow-xs">
              <span className="text-[10px] font-bold text-red-700 uppercase flex items-center justify-center gap-1">
                <Key className="w-3 h-3 text-red-600" />
                {isSplitOrder ? `PIN Envío ${activeShipmentIndex + 1}` : 'Código Entrega'}
              </span>
              <p className="text-xl font-black text-red-700 tracking-widest mt-0.5">
                {effectiveSecretCode}
              </p>
            </div>
          </div>

          <p className="text-xs text-slate-500 mt-1">
            Entrega a {order.customer.name} en {order.deliveryAddress.address}
          </p>
        </div>

        {/* Assigned Driver Profile Card */}
        {effectiveDriver && (
          <div className="mx-5 p-3 bg-slate-50 rounded-2xl border border-slate-100 flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              <img
                src={effectiveDriver.photo}
                alt={effectiveDriver.name}
                className="w-11 h-11 rounded-full object-cover border border-white shadow-xs"
              />
              <div>
                <p className="text-xs font-black text-slate-900">
                  {effectiveDriver.name} {isSplitOrder && `(Repartidor Envío ${activeShipmentIndex + 1})`}
                </p>
                <p className="text-[11px] text-slate-500">
                  {effectiveDriver.vehicleType} • Placa: <strong className="text-slate-800">{effectiveDriver.vehiclePlate}</strong>
                </p>
                <div className="flex items-center gap-1 text-[11px] text-amber-600 font-bold">
                  <span>★ {effectiveDriver.rating}</span>
                  <span className="text-slate-400">• Flota Propia Bolt</span>
                </div>
              </div>
            </div>

            <a
              href={`tel:${effectiveDriver.phone}`}
              className="w-10 h-10 rounded-full bg-emerald-600 hover:bg-emerald-700 text-white flex items-center justify-center shadow-md shadow-emerald-600/30 transition"
              title="Llamar al repartidor"
            >
              <Phone className="w-4 h-4" />
            </a>
          </div>
        )}

        {/* Scrollable Extended Content when sheet is opened */}
        <div className="flex-1 overflow-y-auto px-5 pb-5 space-y-3 pb-safe">
          {/* Cash on delivery notice for split orders */}
          {order.payment.method === 'CASH_ON_DELIVERY' && currentChild && (
            <div className="text-xs bg-amber-50 text-amber-950 p-2.5 rounded-xl border border-amber-200">
              <strong>Cobro contra entrega de este envío: </strong>
              <span className="font-extrabold">{formatCOP(currentChild.cashToCollect)}</span>
              <span className="text-[11px] text-slate-600 ml-1">
                (Total pedido: {formatCOP(order.totals.total)})
              </span>
            </div>
          )}

          {/* Portería instruction */}
          <div className="text-xs text-slate-600 bg-slate-50 p-3 rounded-xl border border-slate-100">
            <strong className="text-slate-800">Instrucciones de recepción: </strong>
            <span>
              {order.deliveryAddress.porteriaPolicy === 'DEJAR_EN_PORTERIA'
                ? 'Dejar en portería debidamente sellado.'
                : order.deliveryAddress.porteriaPolicy === 'SUBIR_A_PUERTA'
                ? 'Subir al apartamento.'
                : 'Llamar al teléfono celular al momento de llegar.'}
            </span>
            {order.deliveryAddress.details && ` (${order.deliveryAddress.details})`}
          </div>

          {/* Items Breakdown */}
          <div className="space-y-2">
            <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
              {currentChild
                ? `Productos en este envío (${currentChild.items.length})`
                : `Productos en el paquete (${order.items.length})`}
            </h4>
            <div className="space-y-1.5">
              {(currentChild ? currentChild.items : order.items).map(item => (
                <div key={item.productId} className="flex items-center justify-between text-xs py-1.5 border-b border-slate-100">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-red-600">{item.quantity}x</span>
                    <span className="font-medium text-slate-800">{item.name}</span>
                  </div>
                  <span className="font-bold text-slate-900">{formatCOP(item.price * item.quantity)}</span>
                </div>
              ))}
            </div>

            <div className="flex justify-between pt-2 text-sm font-black text-slate-900">
              <span>Total del pedido:</span>
              <span className="text-red-600">{formatCOP(order.totals.total)}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
