import React, { useState, useEffect, useRef, useMemo } from 'react';
import { APIProvider, Map, AdvancedMarker, useMap } from '@vis.gl/react-google-maps';
import {
  MapPin, X, CheckCircle2, AlertTriangle, Clock,
  Search, ChevronRight, Calendar, Compass, Sparkles, Loader2,
} from 'lucide-react';
import { DeliveryQuote, LatLng, QuoteRequestItem, detectBogotaLocality, getBogotaLocalityName, TURBO_ALLOWED_LOCALITIES } from '../../lib/deliveryService';
import { api } from '../../lib/api';
import { AddressSelectionSession, AddressSelectionState } from '../../lib/addressSelectionSession';
import { resolveAddress, resolveCoordinates } from '../../lib/addressGeocoding';
import { Store, CartItem, Product } from '../../types';
import { TurboPromise } from './TurboPromise';

// This is a visual starting point only, never a delivery destination.
const MAP_CENTER: LatLng = { lat: 4.6533, lng: -74.0837 };
const validPoint = (value: LatLng | null | undefined): value is LatLng => !!value &&
  Number.isFinite(value.lat) && Number.isFinite(value.lng) && Math.abs(value.lat) <= 90 && Math.abs(value.lng) <= 180;
const normalizedAddress = (value: string) => value.trim().toLocaleLowerCase().replace(/[\s,#.]+/g, '');

export type AddressPickerQuote = DeliveryQuote & { cartNeedsReview?: boolean };
const hasDeliveryMode = (quote: DeliveryQuote) => quote.availableModes.turbo || quote.availableModes.turboDividido || quote.availableModes.scheduled;

/** An address can be saved without pretending an unavailable basket can be delivered. */
export async function quoteAddressForSelection(items: QuoteRequestItem[], request: (items: QuoteRequestItem[]) => Promise<DeliveryQuote>, signal: AbortSignal): Promise<AddressPickerQuote> {
  signal.throwIfAborted();
  const basketQuote = await request(items);
  signal.throwIfAborted();
  if (!items.length || hasDeliveryMode(basketQuote)) return basketQuote;
  // Only a valid no-modes response reaches here. Network failures are not coverage.
  const addressQuote = await request([]);
  signal.throwIfAborted();
  return hasDeliveryMode(addressQuote) ? { ...addressQuote, cartNeedsReview: true } : addressQuote;
}

/** Device callbacks cannot be stopped by the browser API; aborted drafts ignore them. */
export function locateAddressDevice(geolocation: Pick<Geolocation, 'getCurrentPosition'>, signal: AbortSignal): Promise<LatLng> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error?: unknown, coordinates?: LatLng) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', cancel);
      if (error) reject(error); else resolve(coordinates!);
    };
    const cancel = () => finish(new DOMException('Consulta de ubicación cancelada', 'AbortError'));
    signal.addEventListener('abort', cancel, { once: true });
    if (signal.aborted) { cancel(); return; }
    try {
      geolocation.getCurrentPosition(position => {
        if (settled) return;
        const { latitude: lat, longitude: lng, accuracy } = position.coords;
        if (!validPoint({ lat, lng }) || !Number.isFinite(accuracy) || accuracy < 0 || accuracy > 200) {
          finish(new Error('La ubicación es aproximada. Escribe tu dirección o selecciona la entrada correcta en el mapa.'));
          return;
        }
        finish(undefined, { lat, lng });
      }, error => finish(new Error(error.code === 1
        ? 'No se autorizó la ubicación. Puedes escribir tu dirección o elegirla en el mapa.'
        : 'No pudimos obtener tu ubicación. Escribe tu dirección o elige un punto en el mapa.')),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 });
    } catch {
      finish(new Error('No pudimos consultar tu ubicación. Puedes escribir tu dirección manualmente.'));
    }
  });
}

const MapRecenter: React.FC<{ center: LatLng }> = ({ center }) => {
  const map = useMap();
  useEffect(() => {
    if (map && Number.isFinite(center.lat) && Number.isFinite(center.lng)) map.panTo(center);
  }, [map, center.lat, center.lng]);
  return null;
};

interface AddressConfirmationModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentAddress: string;
  currentDetails: string;
  currentCoordinates: LatLng | null;
  onConfirmAddress: (address: string, details: string, coordinates: LatLng, quote: DeliveryQuote) => void;
  stores: Store[];
  cartItems?: CartItem[];
  products?: Product[];
  addressRemembered?: boolean;
  onForgetAddress?: () => void;
}

export const AddressConfirmationModal: React.FC<AddressConfirmationModalProps> = ({
  isOpen, onClose, currentAddress, currentDetails, currentCoordinates,
  onConfirmAddress, stores, cartItems, products = [], addressRemembered = false, onForgetAddress,
}) => {
  const [selection, setSelection] = useState<AddressSelectionState<AddressPickerQuote>>({
    address: currentAddress || '', coordinates: currentCoordinates || null,
    quote: null, status: 'idle', error: null,
  });
  const [detailsInput, setDetailsInput] = useState(currentDetails ?? '');
  const [resolvingSource, setResolvingSource] = useState<'text' | 'pin'>('text');
  const [showBreakdown, setShowBreakdown] = useState(false);
  const [isLocating, setIsLocating] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);
  const locationIntentRef = useRef(0);
  const locationRequestRef = useRef<AbortController | null>(null);
  const isLocatingRef = useRef(false);
  const detailsDetachedRef = useRef(false);
  const sessionRef = useRef<AddressSelectionSession<AddressPickerQuote> | null>(null);
  const contextRef = useRef({ detailsInput, cartItems, stores, products });
  contextRef.current = { detailsInput, cartItems, stores, products };
  const initialRef = useRef({ currentAddress, currentDetails, currentCoordinates });
  initialRef.current = { currentAddress, currentDetails, currentCoordinates };

  // Open/close is the only lifecycle trigger. Cart, details and catalog refreshes
  // must never replace the location the customer is currently entering.
  useEffect(() => {
    if (!isOpen) return;
    const initial = initialRef.current;
    setDetailsInput(initial.currentDetails ?? '');
    contextRef.current.detailsInput = initial.currentDetails ?? '';
    setResolvingSource('text');
    setLocationError(null);
    setIsLocating(false);
    isLocatingRef.current = false;
    locationIntentRef.current++;
    locationRequestRef.current?.abort();
    locationRequestRef.current = null;
    detailsDetachedRef.current = false;
    setShowBreakdown(false);
    const session = new AddressSelectionSession<AddressPickerQuote>({
      forward: resolveAddress,
      reverse: resolveCoordinates,
      quote: (location, signal) => {
        const context = contextRef.current;
        return quoteAddressForSelection(context.cartItems?.map(item => ({ productId: item.product.id, quantity: item.quantity })) || [], items => api.getDeliveryQuote({
          destination: { ...location, details: context.detailsInput },
          items,
        }, context.stores, context.products, signal, { authoritative: true }), signal);
      },
      onChange: setSelection,
    });
    sessionRef.current = session;
    if (initial.currentAddress.trim() && validPoint(initial.currentCoordinates)) {
      session.initialize(initial.currentAddress, initial.currentCoordinates);
    } else {
      // A first visit is a useful empty state, not a failed lookup.
      setSelection({ address: '', coordinates: null, quote: null, status: 'idle', error: null });
    }
    return () => {
      locationIntentRef.current++;
      locationRequestRef.current?.abort();
      locationRequestRef.current = null;
      isLocatingRef.current = false;
      session.dispose();
      if (sessionRef.current === session) sessionRef.current = null;
    };
  }, [isOpen]);

  // Refresh only the delivery conditions. An unresolved search retains its draft
  // and will read these current values when it requests its own quote.
  useEffect(() => {
    if (isOpen) sessionRef.current?.refreshQuote();
  }, [isOpen, detailsInput, cartItems, stores, products]);

  const addressInput = selection.address;
  const pinCoordinates = validPoint(selection.coordinates) && (selection.address.trim() || resolvingSource === 'pin') ? selection.coordinates : null;
  const mapCenter = pinCoordinates || MAP_CENTER;
  const quote = selection.quote;
  const cartNeedsReview = !!quote?.cartNeedsReview;
  const isEvaluating = selection.status === 'quoting';
  const isGeocoding = selection.status === 'resolving' && resolvingSource === 'text';
  const isReverseGeocoding = selection.status === 'resolving' && resolvingSource === 'pin';
  const isAddressSynced = selection.status === 'ready';
  const geocodeError = locationError || selection.error;
  const apiKey = import.meta.env?.VITE_GOOGLE_MAPS_API_KEY || 'AIzaSyBeZD10ABWRpSpwChGlSzPR-6wxdD9oJcE';

  const cancelLocationRequest = () => {
    locationIntentRef.current++;
    locationRequestRef.current?.abort();
    locationRequestRef.current = null;
    isLocatingRef.current = false;
    setIsLocating(false);
    setLocationError(null);
  };

  const closeModal = () => {
    cancelLocationRequest();
    sessionRef.current?.dispose();
    sessionRef.current = null;
    setSelection({ address: '', coordinates: null, quote: null, status: 'idle', error: null });
    onClose();
  };

  const detachPreviousDetails = () => {
    if (detailsDetachedRef.current) return;
    detailsDetachedRef.current = true;
    if (!initialRef.current.currentAddress.trim()) return;
    setDetailsInput('');
    contextRef.current.detailsInput = '';
  };

  const handleAddressInputChange = (value: string) => {
    cancelLocationRequest();
    if (normalizedAddress(value) !== normalizedAddress(initialRef.current.currentAddress)) detachPreviousDetails();
    setResolvingSource('text');
    sessionRef.current?.typeAddress(value);
  };

  const selectMapPoint = (value: any) => {
    if (!value) return;
    const lat = typeof value.lat === 'function' ? value.lat() : value.lat;
    const lng = typeof value.lng === 'function' ? value.lng() : value.lng;
    if (!validPoint({ lat, lng })) return;
    cancelLocationRequest();
    const initial = initialRef.current.currentCoordinates;
    // Small entrance-pin adjustments retain apartment details at the same address.
    if (!validPoint(initial) || Math.hypot(lat - initial.lat, lng - initial.lng) > 0.00045) detachPreviousDetails();
    setResolvingSource('pin');
    sessionRef.current?.selectCoordinates({
      lat: Number(lat.toFixed(6)), lng: Number(lng.toFixed(6)),
    });
  };
  const handlePinDragEnd = (event: any) => selectMapPoint(event.latLng);
  const handleMapClick = (event: any) => selectMapPoint(event.detail?.latLng || event.latLng);

  const handleUseLocation = () => {
    const session = sessionRef.current;
    if (!session || isLocatingRef.current) return;
    const intent = ++locationIntentRef.current;
    setLocationError(null);
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setLocationError('Tu navegador no permite consultar la ubicación. Escribe tu dirección o elige un punto en el mapa.');
      return;
    }
    isLocatingRef.current = true;
    setIsLocating(true);
    const controller = new AbortController();
    locationRequestRef.current = controller;
    const isCurrent = () => sessionRef.current === session && locationIntentRef.current === intent;
    void locateAddressDevice(navigator.geolocation, controller.signal).then(coordinates => {
      if (isCurrent()) selectMapPoint(coordinates);
    }).catch(error => {
      if (!isCurrent()) return;
      isLocatingRef.current = false;
      setIsLocating(false);
      setLocationError(error instanceof Error ? error.message : 'Escribe tu dirección o elige un punto en el mapa.');
    });
  };

  const canConfirm = !isLocating && selection.status === 'ready' && !!selection.coordinates && !!quote &&
    (quote.availableModes.turbo || quote.availableModes.turboDividido || quote.availableModes.scheduled);

  const handleConfirm = () => {
    // Read the synchronous session snapshot as well: a click in the same turn as
    // typing cannot submit the previously rendered address or quote.
    const latest = sessionRef.current?.state;
    if (isLocatingRef.current || latest?.status !== 'ready' || !latest.coordinates || !latest.quote ||
      !(latest.quote.availableModes.turbo || latest.quote.availableModes.turboDividido || latest.quote.availableModes.scheduled)) return;
    onConfirmAddress(latest.address, detailsInput, latest.coordinates, latest.quote);
    closeModal();
  };

  const isTurbo = !!quote?.availableModes?.turbo;
  const isTurboDividido = !!quote?.availableModes?.turboDividido;
  const isScheduledOnly = !isTurbo && !isTurboDividido && !!quote?.availableModes?.scheduled;
  const isOutOfAllCoverage = !!quote && !isTurbo && !isTurboDividido && !quote.availableModes.scheduled;
  const needsLocationValidation = quote?.scheduledAssignment?.status === 'DIRECCION_PENDIENTE';
  const detectedLocality = useMemo(() => {
    if (selection.status !== 'ready' || !selection.coordinates) return null;
    return quote?.detectedLocality || detectBogotaLocality(selection.coordinates, addressInput);
  }, [selection.status, selection.coordinates, quote?.detectedLocality, addressInput]);
  const localityName = detectedLocality
    ? quote?.detectedLocalityName || getBogotaLocalityName(detectedLocality)
    : 'Por validar';
  const isTurboLocality = !!detectedLocality && (TURBO_ALLOWED_LOCALITIES as readonly string[]).includes(detectedLocality);
  const isAutoSwitchedToScheduled = !!quote && (
    !!quote.autoSwitchedToScheduled || isScheduledOnly || (!isTurboLocality && !!quote.availableModes?.scheduled)
  );

  if (!isOpen) return null;

  return (
    <div role="dialog" aria-modal="true" aria-label="Confirmar dirección de entrega" className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 md:p-4 animate-in fade-in">
      <div className="bg-white rounded-3xl w-full max-w-2xl min-[669px]:max-w-4xl max-h-[94vh] flex flex-col shadow-2xl overflow-hidden border border-slate-100">
        
        {/* Header */}
        <div className="p-4 border-b border-slate-100 flex items-start justify-between gap-2 bg-slate-50/90 shrink-0">
          <div className="flex items-start gap-2.5 min-w-0">
            <div className="w-9 h-9 rounded-2xl bg-red-600 text-white flex items-center justify-center shadow-md">
              <MapPin className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-black text-slate-900 text-sm md:text-base leading-tight">
                ¿Dónde entregamos tu pedido?
              </h3>
              <div className="mt-1"><TurboPromise/></div>
            </div>
          </div>
          <button
            onClick={closeModal}
            aria-label="Cerrar selector de dirección"
            className="w-8 h-8 shrink-0 rounded-full bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-500 transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">

          {cartNeedsReview && <div role="status" className="rounded-2xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-950">
            <p className="font-bold">Confirmaremos la disponibilidad de tu carrito para esta dirección.</p>
            <p className="mt-1">Conservamos tus productos. Revisa su disponibilidad y las condiciones de entrega después de confirmar.</p>
          </div>}
          
          <div className="flex flex-wrap items-center justify-between gap-2">
            <button type="button" onClick={handleUseLocation} disabled={isLocating}
              className="inline-flex items-center gap-1.5 text-xs font-bold text-red-700 bg-red-50 border border-red-100 rounded-xl px-3 py-2 disabled:opacity-60">
              {isLocating ? <Loader2 className="w-3.5 h-3.5 animate-spin"/> : <Compass className="w-3.5 h-3.5"/>}
              {isLocating ? 'Consultando ubicación…' : 'Usar mi ubicación'}
            </button>
            {addressRemembered && onForgetAddress && <button type="button" onClick={() => {
              cancelLocationRequest();
              onForgetAddress();
              closeModal();
            }} className="text-[11px] font-semibold text-slate-500 underline">Olvidar dirección en este dispositivo</button>}
          </div>

          {/* Address Inputs */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="sm:col-span-2 space-y-1">
              <label className="text-[11px] font-bold text-slate-700 flex items-center justify-between">
                <span className="flex items-center gap-1.5">
                  <span>Dirección en Bogotá</span>
                  {detectedLocality && <span className={`text-[10px] px-2 py-0.2 rounded-full font-bold border ${
                    isTurboLocality
                      ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                      : 'bg-blue-50 text-blue-800 border-blue-200'
                  }`}>
                    Localidad: {localityName} {isTurboLocality ? '⚡' : '📅'}
                  </span>}
                </span>
                {isReverseGeocoding ? (
                  <span className="text-red-600 text-[10px] animate-pulse flex items-center gap-1 font-bold">
                    <Loader2 className="w-3 h-3 animate-spin" />
                    Obteniendo dirección del pin...
                  </span>
                ) : isGeocoding ? (
                  <span className="text-red-600 text-[10px] animate-pulse flex items-center gap-1 font-bold">
                    <Loader2 className="w-3 h-3 animate-spin" />
                    Ubicando en mapa...
                  </span>
                ) : null}
              </label>
              <div className="relative">
                <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
                <input
                  type="text"
                  aria-label="Dirección en Bogotá"
                  value={addressInput}
                  onChange={e => handleAddressInputChange(e.target.value)}
                  placeholder="Escribe tu dirección completa"
                  className={`w-full pl-9 pr-9 py-2.5 text-xs bg-slate-50 border rounded-xl focus:bg-white focus:outline-none focus:border-red-500 font-medium transition shadow-2xs ${
                    isReverseGeocoding ? 'border-red-400 bg-red-50/20' : 'border-slate-200'
                  }`}
                />
                {isReverseGeocoding && (
                  <div className="absolute right-3 top-2.5">
                    <Loader2 className="w-4 h-4 text-red-600 animate-spin" />
                  </div>
                )}
              </div>
            </div>

            {/* Requisito 5: Conserva lo escrito en «Torre / Apto / Portería» */}
            <div className="space-y-1">
              <label className="text-[11px] font-bold text-slate-700">Torre / Apto / Portería (Opcional)</label>
              <input
                type="text"
                aria-label="Torre / Apto / Portería"
                value={detailsInput}
                onChange={e => { contextRef.current.detailsInput = e.target.value; setDetailsInput(e.target.value); }}
                placeholder="Apartamento, torre o referencia de acceso"
                className="w-full px-3 py-2.5 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none focus:border-red-500 font-medium transition shadow-2xs"
              />
            </div>
          </div>

          {/* Banner obligatorio de transición a Envío Programado */}
          {isAutoSwitchedToScheduled && (
            <div className="p-3 bg-blue-50 border border-blue-200 rounded-2xl text-xs text-blue-950 flex items-start gap-2.5 animate-in fade-in">
              <Calendar className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="font-extrabold text-blue-900 text-xs">
                  Para esta dirección, continuamos con envío programado. Elige cuándo recibir tu pedido
                </p>
                <p className="text-[11px] text-blue-800 mt-0.5">
                  {!isTurboLocality
                    ? `Tu dirección se encuentra en ${localityName}. Las entregas Turbo y Turbo Dividido aplican únicamente en Kennedy, Suba y Engativá.`
                    : quote?.message || 'Las condiciones operativas actuales de tu pedido requieren envío programado.'}
                </p>
              </div>
            </div>
          )}

          {/* Requisito 6: Si falla la consulta, informa al usuario */}
          {geocodeError && (
            <div role="alert" className="p-3 rounded-2xl bg-amber-50 border border-amber-200 text-amber-900 text-xs flex items-start gap-2.5 animate-in fade-in">
              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="font-bold text-[11px]">{geocodeError}</p>
                {!locationError && <p className="text-[10px] text-amber-700 mt-0.5">Revisa la dirección y el punto de entrega antes de confirmar.</p>}
              </div>
            </div>
          )}

          {/* Map with Draggable Pin */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs text-slate-600">
              <div className="flex items-center gap-1.5 font-bold text-red-600 bg-red-50 px-2.5 py-1 rounded-lg border border-red-100">
                <Compass className="w-3.5 h-3.5" />
                <span>{pinCoordinates ? 'Ajusta el pin en la entrada de entrega' : 'Escribe tu dirección o elige un punto en el mapa'}</span>
              </div>
              <span className="font-mono text-[10px] text-slate-400 hidden sm:inline">
                {pinCoordinates ? `${pinCoordinates.lat.toFixed(4)}, ${pinCoordinates.lng.toFixed(4)}` : 'Sin punto seleccionado'}
              </span>
            </div>

            <div className="h-56 min-[669px]:h-72 w-full rounded-2xl overflow-hidden border border-slate-200 shadow-inner relative">
              <APIProvider apiKey={apiKey}>
                <Map
                  defaultCenter={mapCenter}
                  defaultZoom={pinCoordinates ? 14 : 11}
                  mapId="BOLT_PETS_MAP"
                  className="w-full h-full"
                  gestureHandling="greedy"
                  disableDefaultUI={true}
                  onClick={handleMapClick}
                  internalUsageAttributionIds={['gmp_mcp_codeassist_v1_aistudio']}
                >
                  <MapRecenter center={mapCenter} />

                  {/* Customer Adjustable Red Delivery Pin */}
                  {pinCoordinates && <AdvancedMarker
                    position={pinCoordinates}
                    title="Punto de entrega de tu pedido"
                    draggable={true}
                    onDragEnd={handlePinDragEnd}
                  >
                    <div className="flex flex-col items-center cursor-grab active:cursor-grabbing">
                      <div className="bg-red-600 text-white p-2 rounded-full shadow-2xl border-2 border-white ring-4 ring-red-500/30 animate-pulse">
                        <MapPin className="w-5 h-5" />
                      </div>
                      <span className="bg-slate-900 text-white text-[9px] font-black px-2 py-0.5 rounded-full shadow-md mt-1 border border-white/20 whitespace-nowrap">
                        {isReverseGeocoding ? 'Consultando...' : 'Ajusta el pin aquí'}
                      </span>
                    </div>
                  </AdvancedMarker>}

                  {/* Enabled Turbo Hubs in Bogotá */}
                  {stores
                    .filter(s => s.turboEnabled && s.isActive)
                    .map(store => (
                      <AdvancedMarker
                        key={store.id}
                        position={store.coordinates}
                        title={`Sede Bolt Pets: ${store.name}`}
                      >
                        <div className="flex flex-col items-center opacity-85 hover:opacity-100 transition">
                          <div className="bg-yellow-400 text-red-950 p-1 rounded-lg border border-white shadow-md">
                            <span className="text-[11px] font-black">⚡</span>
                          </div>
                          <span className="bg-white/95 text-slate-800 text-[8px] font-bold px-1.5 py-0.5 rounded shadow-xs mt-0.5 border border-slate-200">
                            {store.name.replace('Sede ', '')}
                          </span>
                        </div>
                      </AdvancedMarker>
                    ))}
                </Map>
              </APIProvider>

              {/* Requisito 6: Indicadores durante la consulta */}
              {isReverseGeocoding && (
                <div className="absolute top-2 left-2 bg-slate-900/90 text-white backdrop-blur-xs px-2.5 py-1.5 rounded-xl text-[10px] font-bold flex items-center gap-1.5 shadow-lg z-10 animate-in fade-in border border-white/20">
                  <Loader2 className="w-3.5 h-3.5 text-yellow-400 animate-spin" />
                  <span>Obteniendo dirección en Bogotá...</span>
                </div>
              )}

              {isEvaluating && !isReverseGeocoding && (
                <div className="absolute top-2 right-2 bg-white/90 backdrop-blur-xs px-2.5 py-1 rounded-lg border border-slate-200 text-[10px] font-bold text-slate-700 flex items-center gap-1.5 shadow-sm">
                  <div className="w-3 h-3 border-2 border-red-600 border-t-transparent rounded-full animate-spin"></div>
                  <span>Calculando cobertura...</span>
                </div>
              )}
            </div>
          </div>

          {/* Dynamic Delivery Quote & Mode Evaluation Card */}
          {quote && (
            <div
              className={`p-3.5 rounded-2xl border transition-all ${
                isTurbo
                  ? 'bg-emerald-50/80 border-emerald-200 text-emerald-950'
                  : isTurboDividido
                  ? 'bg-amber-50/90 border-amber-200 text-amber-950'
                  : isScheduledOnly
                  ? 'bg-blue-50/90 border-blue-200 text-blue-950'
                  : 'bg-rose-50/80 border-rose-200 text-rose-950'
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-start gap-2.5">
                  {isTurbo ? (
                    <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
                  ) : isTurboDividido ? (
                    <Sparkles className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                  ) : isScheduledOnly ? (
                    <Calendar className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" />
                  ) : (
                    <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
                  )}

                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      {isTurbo && (
                        <>
                          <span className="text-xs font-black uppercase px-2 py-0.5 rounded-md bg-emerald-600 text-white">
                            {cartNeedsReview ? 'Cobertura de la dirección validada' : 'Cobertura Turbo Confirmada'}
                          </span>
                          {!cartNeedsReview && <span className="text-xs font-black bg-yellow-400 text-red-950 px-2 py-0.5 rounded-md flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            Llega en aprox. {quote.estimatedMinutes} min
                          </span>}
                        </>
                      )}

                      {isTurboDividido && (
                        <>
                          <span className="text-xs font-black uppercase px-2 py-0.5 rounded-md bg-amber-600 text-white">
                            Turbo Dividido Disponible
                          </span>
                          <span className="text-xs font-black bg-yellow-400 text-red-950 px-2 py-0.5 rounded-md flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {quote.turboDividido?.shipmentCount} motos en simultáneo (~{quote.estimatedMinutes} min)
                          </span>
                        </>
                      )}

                      {isScheduledOnly && (
                        <>
                          <span className="text-xs font-black uppercase px-2 py-0.5 rounded-md bg-blue-600 text-white">
                            Envío Programado Disponible
                          </span>
                          <span className="text-[11px] font-bold bg-white/80 text-blue-900 px-2 py-0.5 rounded-md border border-blue-200">
                            Franjas horarias en Bogotá
                          </span>
                        </>
                      )}

                      {isOutOfAllCoverage && (
                        <span className="text-xs font-black uppercase px-2 py-0.5 rounded-md bg-rose-600 text-white">
                          Sin Cobertura en la Zona
                        </span>
                      )}
                    </div>

                    <p className="text-xs font-semibold mt-1.5 leading-snug">
                      {cartNeedsReview ? 'La dirección tiene cobertura. Revisaremos los productos y condiciones de entrega de tu carrito.' : quote.message}
                    </p>

                    {(isScheduledOnly ? quote.scheduledAssignment?.storeName : quote.assignedStoreName) && (
                      <p className="text-[11px] mt-1 opacity-90">
                        {cartNeedsReview || isScheduledOnly && quote.scheduledAssignment?.status !== 'CONFIRMADA' ? 'Sede sugerida' : 'Sede asignada'}: <strong>{isScheduledOnly ? quote.scheduledAssignment?.storeName : quote.assignedStoreName}</strong>
                      </p>
                    )}
                    {isScheduledOnly && quote.scheduledAssignment?.reason && quote.scheduledAssignment.status !== 'CONFIRMADA' && <p className="text-[11px] mt-1">{quote.scheduledAssignment.reason}</p>}
                  </div>
                </div>

                {isTurbo && !cartNeedsReview && (
                  <button
                    onClick={() => setShowBreakdown(!showBreakdown)}
                    className="text-[10px] font-bold text-emerald-800 underline hover:text-emerald-950 shrink-0"
                  >
                    {showBreakdown ? 'Ocultar desglose' : 'Ver desglose ETA'}
                  </button>
                )}
              </div>

              {/* Delivery options badges */}
              <div className="mt-2.5 pt-2 border-t border-slate-200/60 flex flex-wrap gap-2 text-[11px]">
                {quote.availableModes.turbo && (
                  <span className="bg-emerald-100 text-emerald-800 font-bold px-2 py-0.5 rounded-md">
                    {cartNeedsReview ? 'Zona con cobertura Turbo' : '✓ Turbo 25 min habilitado'}
                  </span>
                )}
                {quote.availableModes.turboDividido && (
                  <span className="bg-amber-100 text-amber-900 font-bold px-2 py-0.5 rounded-md">
                    ✓ Turbo Dividido ({quote.turboDividido?.shipmentCount} motos)
                  </span>
                )}
                {quote.availableModes.scheduled && (
                  <span className="bg-blue-100 text-blue-900 font-bold px-2 py-0.5 rounded-md">
                    ✓ Envío Programado disponible
                  </span>
                )}
                <span className="text-slate-600">
                  Distancia: <strong>{quote.geographicDistanceKm} km</strong> • Ruta vial: <strong>{quote.roadDistanceKm} km</strong>
                </span>
              </div>

              {/* Detailed ETA Components Breakdown */}
              {!cartNeedsReview && showBreakdown && quote.etaComponents && (
                <div className="mt-2.5 p-2.5 bg-white/90 rounded-xl text-[10px] space-y-1 border border-emerald-200 text-slate-700">
                  <div className="flex justify-between">
                    <span>Alistamiento en bodega (3 min base + picking):</span>
                    <strong>{quote.etaComponents.preparationReadySeconds}s</strong>
                  </div>
                  <div className="flex justify-between">
                    <span>Disponibilidad repartidor en sede:</span>
                    <strong>{quote.etaComponents.courierReadyAtWarehouseSeconds}s</strong>
                  </div>
                  <div className="flex justify-between">
                    <span>Verificación de precintos y entrega:</span>
                    <strong>{quote.etaComponents.pickupHandoffSeconds}s</strong>
                  </div>
                  <div className="flex justify-between">
                    <span>Desplazamiento vial en moto Bogotá (23 km/h):</span>
                    <strong>{quote.etaComponents.roadTravelSeconds}s</strong>
                  </div>
                  <div className="flex justify-between">
                    <span>Entrega física en portería / puerta:</span>
                    <strong>{quote.etaComponents.customerHandoffSeconds}s</strong>
                  </div>
                  <div className="flex justify-between">
                    <span>Margen operativo Bogotá:</span>
                    <strong>{quote.etaComponents.operationalBufferSeconds}s</strong>
                  </div>
                  <div className="flex justify-between pt-1 border-t border-slate-200 font-extrabold text-slate-900">
                    <span>Total tiempo calculado:</span>
                    <span>{quote.etaComponents.totalSeconds} segundos ({quote.estimatedMinutes} minutos ≤ 1.500s)</span>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="p-4 border-t border-slate-100 bg-slate-50 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 shrink-0">
          <div className="text-xs text-slate-600 min-w-0">
            {isLocating ? (
              <span className="text-red-600 font-bold">Consultando la ubicación de tu dispositivo…</span>
            ) : isReverseGeocoding ? (
              <span className="text-red-600 font-bold flex items-center gap-1.5">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Actualizando dirección por movimiento de pin...
              </span>
            ) : isGeocoding ? (
              <span className="text-red-600 font-bold">Ubicando dirección en el mapa...</span>
            ) : isEvaluating ? (
              <span className="text-slate-600 font-bold">Calculando entrega para este punto...</span>
            ) : needsLocationValidation ? (
              <span className="text-amber-700 font-bold">Valida el punto de entrega para identificar la localidad</span>
            ) : !isAddressSynced && geocodeError ? (
              <span className="text-amber-700 font-bold">Dirección desincronizada del pin</span>
            ) : cartNeedsReview ? (
              <span className="text-amber-800 font-bold">Cobertura disponible; carrito pendiente de revisión.</span>
            ) : isTurbo ? (
              <span className="text-emerald-700 font-bold">✓ Cumple radio de 6 km y límite de 25 min</span>
            ) : isTurboDividido ? (
              <span className="text-amber-800 font-bold">✓ Pedido &gt; 60 kg elegible para Turbo Dividido o Programado</span>
            ) : isScheduledOnly ? (
              <span className="text-blue-800 font-bold">✓ Disponible para Envío Programado en Bogotá</span>
            ) : isOutOfAllCoverage ? (
              <span className="text-rose-700 font-bold">Ubicación fuera de cobertura en Bogotá</span>
            ) : (
              <span className="text-slate-600 font-semibold">Elige y confirma dónde quieres recibir tu compra.</span>
            )}
            <p className="text-[10px] text-slate-500 mt-1">La dirección confirmada se guarda en este dispositivo.</p>
          </div>

          <div className="flex items-center justify-end gap-2 shrink-0">
            <button
              onClick={closeModal}
              className="px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-200 rounded-xl transition"
            >
              Cancelar
            </button>
            <button
              onClick={handleConfirm}
              disabled={!canConfirm}
              className="bg-red-600 hover:bg-red-700 disabled:bg-slate-300 text-white font-black text-xs px-5 py-2.5 rounded-xl shadow-md transition disabled:cursor-not-allowed flex items-center gap-1.5"
            >
              {isLocating ? (
                <><Loader2 className="w-3.5 h-3.5 animate-spin"/><span>Consultando ubicación…</span></>
              ) : isReverseGeocoding || isGeocoding ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Obteniendo dirección...</span>
                </>
              ) : isEvaluating ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Cotizando cobertura...</span>
                </>
              ) : needsLocationValidation ? (
                <span>Valida la ubicación...</span>
              ) : !isAddressSynced ? (
                <span>Esperando dirección...</span>
              ) : (
                <>
                  <span>{cartNeedsReview ? 'Confirmar dirección y revisar carrito' : isAutoSwitchedToScheduled ? 'Continuar con Envío Programado' : 'Confirmar dirección'}</span>
                  <ChevronRight className="w-4 h-4" />
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
