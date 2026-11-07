import { TERRITORY_OPTIONS } from '../../lib/territoryConfig';
import { AddressTerritory, validDestinationCoordinates } from '../../lib/addressGeography';
import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { APIProvider, Map, AdvancedMarker, useMap } from '@vis.gl/react-google-maps';
import { 
  MapPin, X, CheckCircle2, AlertTriangle, Clock, 
  Search, ChevronRight, Calendar, Info, Compass, Sparkles, Navigation, Loader2
} from 'lucide-react';
import { DeliveryQuote, LatLng, DELIVERY_CONFIG, TURBO_ALLOWED_LOCALITIES } from '../../lib/deliveryService';
import { api } from '../../lib/api';
import { Store, CartItem, Product } from '../../types';

declare const google: any;

interface MapRecenterProps {
  center: LatLng;
}

const MapRecenter: React.FC<MapRecenterProps> = ({ center }) => {
  const map = useMap();
  useEffect(() => {
    if (map && center && typeof center.lat === 'number' && typeof center.lng === 'number') {
      map.panTo(center);
    }
  }, [map, center]);
  return null;
};

interface AddressConfirmationModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentAddress: string;
  currentDetails: string;
  currentCoordinates?: LatLng;
  currentTerritory?: AddressTerritory;
  onConfirmAddress: (address: string, details: string, coordinates: LatLng, quote: DeliveryQuote, metadata?: {name:string;isDefault:boolean}) => boolean | void;
  savedAddressOptions?: {name:string;isDefault:boolean};
  saveError?: string;
  stores: Store[];
  cartItems?: CartItem[];
  products?: Product[];
}

/**
 * Limpia y normaliza cadenas de dirección de Bogotá obtenidas de Google Maps Geocoder
 */
function formatCleanBogotaAddress(raw: string): string {
  if (!raw) return '';
  let cleaned = raw
    .replace(/,\s*Bogotá,\s*D\.C\.,\s*Bogotá,\s*Bogotá,\s*D\.C\./gi, ', Bogotá')
    .replace(/,\s*Bogotá,\s*D\.C\./gi, ', Bogotá')
    .replace(/,\s*Cundinamarca/gi, '')
    .trim();
  return cleaned;
}

export const AddressConfirmationModal: React.FC<AddressConfirmationModalProps> = ({
  isOpen,
  onClose,
  currentAddress,
  currentDetails,
  currentCoordinates,
  currentTerritory,
  onConfirmAddress,
  savedAddressOptions, saveError,
  stores,
  cartItems,
  products = [],
}) => {
  const [savedName,setSavedName]=useState(savedAddressOptions?.name || '');
  const [savedDefault,setSavedDefault]=useState(savedAddressOptions?.isDefault || false);
  const [addressInput, setAddressInput] = useState(currentAddress ?? '');
  const [detailsInput, setDetailsInput] = useState(currentDetails ?? '');
  const [pinCoordinates, setPinCoordinates] = useState<Partial<LatLng>>(currentCoordinates ?? {});
  const destinationPoint = validDestinationCoordinates(pinCoordinates) ? pinCoordinates : null;
  // Viewport only: this overview is never sent as the customer's destination.
  const mapCenter = destinationPoint ?? { lat: 4.711, lng: -74.0721 };
  const [territory, setTerritory] = useState<AddressTerritory>(currentTerritory ?? {});
  const requestSeq = useRef(0);
  const [quote, setQuote] = useState<DeliveryQuote | null>(null);
  const [isEvaluating, setIsEvaluating] = useState(false);
  const [isGeocoding, setIsGeocoding] = useState(false);
  const [isReverseGeocoding, setIsReverseGeocoding] = useState(false);
  const [isAddressSynced, setIsAddressSynced] = useState(!!currentAddress?.trim() && validDestinationCoordinates(currentCoordinates));
  const [geocodeError, setGeocodeError] = useState<string | null>(null);
  const [showBreakdown, setShowBreakdown] = useState(false);

  const debounceTimeoutRef = useRef<any>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const reverseGeocodeReqSeqRef = useRef<number>(0);

  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || 'AIzaSyBeZD10ABWRpSpwChGlSzPR-6wxdD9oJcE';

  // Request authoritative quote from backend
  const evaluateAddressQuote = useCallback(async (coords: Partial<LatLng>, addr: string, geo: AddressTerritory = {}) => {
    const seq = ++requestSeq.current;
    setQuote(null);
    if (!addr.trim() || !validDestinationCoordinates(coords)) { setIsEvaluating(false); return; }
    setIsEvaluating(true);
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    abortControllerRef.current = new AbortController();

    try {
      const q = await api.getDeliveryQuote(
        {
          destination: {
            address: addr,
            details: detailsInput,
            coordinates: coords,
            municipality:geo.municipality, locality:geo.locality, neighborhood:geo.neighborhood,
          },
          items: cartItems?.map(i => ({ productId: i.product.id, quantity: i.quantity })),
        },
        stores,
        products
      );
      if(seq === requestSeq.current) setQuote(q);
    } catch (e: any) {
      if (e.name !== 'AbortError') {
        if(seq === requestSeq.current) setGeocodeError('No fue posible validar la entrega con el servidor. Intenta nuevamente.');
      }
    } finally {
      if(seq === requestSeq.current) setIsEvaluating(false);
    }
  }, [detailsInput, cartItems, stores, products]);

  useEffect(()=>()=>{++requestSeq.current; ++reverseGeocodeReqSeqRef.current; if(debounceTimeoutRef.current) clearTimeout(debounceTimeoutRef.current)},[]);

  // Synchronize inputs when modal opens
  useEffect(() => {
    if (isOpen) {
      const initialAddr = currentAddress ?? '';
      const initialDetails = currentDetails ?? '';
      const initialCoords = currentCoordinates ?? {};
      ++requestSeq.current;
      ++reverseGeocodeReqSeqRef.current;
      if (debounceTimeoutRef.current) clearTimeout(debounceTimeoutRef.current);

      setSavedName(savedAddressOptions?.name || '');setSavedDefault(savedAddressOptions?.isDefault || false);
      setAddressInput(initialAddr);
      setDetailsInput(initialDetails);
      setPinCoordinates(initialCoords);
      setIsAddressSynced(!!initialAddr.trim() && validDestinationCoordinates(initialCoords));
      setQuote(null);
      setTerritory(currentTerritory ?? {});
      setIsGeocoding(false);
      setIsEvaluating(false);
      setGeocodeError(null);
      setIsReverseGeocoding(false);

      if (initialAddr.trim() && validDestinationCoordinates(initialCoords)) evaluateAddressQuote(initialCoords, initialAddr, currentTerritory);
    }
    return () => {
      ++requestSeq.current; ++reverseGeocodeReqSeqRef.current;
      if (debounceTimeoutRef.current) clearTimeout(debounceTimeoutRef.current);
    };
  }, [isOpen]);

  /**
   * Ejecuta la geocodificación inversa para las coordenadas del pin.
   * Soporta múltiples movimientos descartando resultados obsoletos (reqId).
   * Mantiene en sincronía el pin, la dirección y la cotización.
   */
  const triggerReverseGeocode = useCallback((newCoords: LatLng) => {
    const reqId = ++reverseGeocodeReqSeqRef.current;
    ++requestSeq.current; setQuote(null); setTerritory({});
    setIsReverseGeocoding(true); setIsAddressSynced(false); setGeocodeError(null);
    if(debounceTimeoutRef.current) clearTimeout(debounceTimeoutRef.current);
    api.reverseGeocode(newCoords.lat,newCoords.lng).then(result=>{
      if(reqId!==reverseGeocodeReqSeqRef.current) return;
      if(result?.address) {
        setAddressInput(result.address); setTerritory(result); setIsAddressSynced(true);
        evaluateAddressQuote(newCoords,result.address,result);
      } else setGeocodeError('No se pudo identificar la dirección del pin. Conservamos tu dirección; confirma sus datos o intenta de nuevo.');
    }).finally(()=>{if(reqId===reverseGeocodeReqSeqRef.current) setIsReverseGeocoding(false)});
  },[evaluateAddressQuote]);

  // Requisito 1: En handlePinDragEnd, al soltar el pin, actualiza sus coordenadas y consulta la dirección mediante geocodificación inversa de Google Maps
  const handlePinDragEnd = (e: any) => {
    let lat: number | null = null;
    let lng: number | null = null;

    if (e.latLng) {
      lat = typeof e.latLng.lat === 'function' ? e.latLng.lat() : e.latLng.lat;
      lng = typeof e.latLng.lng === 'function' ? e.latLng.lng() : e.latLng.lng;
    }

    if (lat !== null && lng !== null && !isNaN(lat) && !isNaN(lng)) {
      const newCoords: LatLng = {
        lat: Number(lat.toFixed(6)),
        lng: Number(lng.toFixed(6)),
      };
      setPinCoordinates(newCoords);
      triggerReverseGeocode(newCoords);
    }
  };

  // Requisito 3: Aplica el mismo comportamiento en handleMapClick cuando el usuario seleccione otro punto
  const handleMapClick = (e: any) => {
    let lat: number | null = null;
    let lng: number | null = null;

    if (e.detail?.latLng) {
      lat = typeof e.detail.latLng.lat === 'function' ? e.detail.latLng.lat() : e.detail.latLng.lat;
      lng = typeof e.detail.latLng.lng === 'function' ? e.detail.latLng.lng() : e.detail.latLng.lng;
    } else if (e.latLng) {
      lat = typeof e.latLng.lat === 'function' ? e.latLng.lat() : e.latLng.lat;
      lng = typeof e.latLng.lng === 'function' ? e.latLng.lng() : e.latLng.lng;
    }

    if (lat !== null && lng !== null && !isNaN(lat) && !isNaN(lng)) {
      const newCoords: LatLng = {
        lat: Number(lat.toFixed(6)),
        lng: Number(lng.toFixed(6)),
      };
      setPinCoordinates(newCoords);
      triggerReverseGeocode(newCoords);
    }
  };

  // Manejo de escritura manual de la dirección
  const handleAddressInputChange = (val: string) => {
    setAddressInput(val); setPinCoordinates({}); setQuote(null); setTerritory({}); setGeocodeError(null); setIsAddressSynced(false);
    ++requestSeq.current;
    const seq=++reverseGeocodeReqSeqRef.current;
    setIsReverseGeocoding(false); setIsGeocoding(true);
    if(debounceTimeoutRef.current) clearTimeout(debounceTimeoutRef.current);
    if (!val.trim()) { setIsGeocoding(false); return; }
    debounceTimeoutRef.current=setTimeout(async()=>{
      const result=val.trim() ? await api.forwardGeocode(val) : null;
      if(seq!==reverseGeocodeReqSeqRef.current) return;
      setIsGeocoding(false);
      if(result?.coordinates) {
        setPinCoordinates(result.coordinates); setTerritory(result); setIsAddressSynced(true);
        evaluateAddressQuote(result.coordinates,val,result);
      } else setGeocodeError('Dirección pendiente de ubicar. Completa la dirección o confirma las coordenadas del destino; no es una exclusión de cobertura.');
    },500);
  };
  const confirmDestinationPoint = () => {
    if (!addressInput.trim() || !destinationPoint) return;
    ++reverseGeocodeReqSeqRef.current;
    if(debounceTimeoutRef.current) clearTimeout(debounceTimeoutRef.current);
    setIsGeocoding(false); setIsReverseGeocoding(false); setIsAddressSynced(true); setGeocodeError(null);
    evaluateAddressQuote(destinationPoint,addressInput,territory);
  };

  const handleCoordinateChange = (axis: 'lat' | 'lng', value: string) => {
    ++requestSeq.current; ++reverseGeocodeReqSeqRef.current;
    if (debounceTimeoutRef.current) clearTimeout(debounceTimeoutRef.current);
    setQuote(null); setIsAddressSynced(false); setIsGeocoding(false); setIsReverseGeocoding(false); setIsEvaluating(false);
    setPinCoordinates(previous => ({...previous,[axis]:value.trim() ? Number(value) : undefined}));
  };

  // Requisito 4: Al confirmar, onConfirmAddress debe recibir los datos de esa misma ubicación
  const canConfirm = 
    (!savedAddressOptions || !!savedName.trim()) && !!addressInput.trim() && !!destinationPoint &&
    !isEvaluating && !isGeocoding && 
    !isReverseGeocoding && 
    isAddressSynced && 
    !geocodeError &&
    !!quote && 
    quote.eligibilityStatus !== 'ADDRESS_NEEDS_CONFIRMATION';

  const handleConfirm = () => {
    if (canConfirm && quote && destinationPoint) {
      // Requisito 5: Conserva lo escrito en «Torre / Apto / Portería» (detailsInput)
      if(onConfirmAddress(addressInput,detailsInput,destinationPoint,quote,savedAddressOptions?{name:savedName,isDefault:savedDefault}:undefined)!==false) onClose();
    }
  };

  const isTurbo = !!quote?.availableModes?.turbo;
  const isTurboDividido = !!quote?.availableModes?.turboDividido;
  const isScheduledOnly = !isTurbo && !isTurboDividido && !!quote?.availableModes?.scheduled;
  const isOutOfAllCoverage = quote?.eligibilityStatus === 'OUT_OF_COVERAGE';

  const detectedLocality = useMemo(() => {
    return quote?.locality || ''; 
  }, [quote?.detectedLocality, pinCoordinates, addressInput]);
  const localityName = quote?.locality || quote?.municipality || 'Pendiente de identificar';
  const isTurboLocality = (TURBO_ALLOWED_LOCALITIES as readonly string[]).includes(detectedLocality.toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''));
  const isAutoSwitchedToScheduled = !!quote?.availableModes?.scheduled && (
    !!quote?.autoSwitchedToScheduled ||
    isScheduledOnly ||
    (!isTurboLocality && !!quote?.availableModes?.scheduled));

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 md:p-4 animate-in fade-in">
      <div className="bg-white rounded-3xl w-full max-w-2xl min-[669px]:max-w-4xl max-h-[94vh] flex flex-col shadow-2xl overflow-hidden border border-slate-100">
        
        {/* Header */}
        <div className="p-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/90">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-2xl bg-red-600 text-white flex items-center justify-center shadow-md">
              <MapPin className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-black text-slate-900 text-sm md:text-base leading-tight">
                ¿Dónde entregamos tu pedido?
              </h3>
              <p className="text-[11px] text-slate-500 font-medium">
                Zonas habilitadas de Bogotá, Soacha, Chía y Cajicá
              </p>
            </div>
          </div>
          <button
            onClick={onClose} aria-label="Cerrar formulario de dirección"
            className="w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-500 transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          
          {savedAddressOptions && <div className="p-3 rounded-2xl bg-slate-50 space-y-2">
            <label className="block text-xs font-bold text-slate-700">Nombre de la dirección<input aria-label="Nombre de la dirección guardada" value={savedName} maxLength={60} onChange={e=>setSavedName(e.target.value)} className="block w-full mt-1 p-3 rounded-xl border border-slate-200 bg-white text-sm"/></label>
            <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={savedDefault} onChange={e=>setSavedDefault(e.target.checked)}/>Usar como predeterminada</label>
            {saveError && <p role="status" className="text-xs text-amber-800">{saveError}</p>}
          </div>}
          {/* Address Inputs */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="sm:col-span-2 space-y-1">
              <label className="text-[11px] font-bold text-slate-700 flex items-center justify-between">
                <span className="flex items-center gap-1.5">
                  <span>Dirección de entrega</span>
                  <span className={`text-[10px] px-2 py-0.2 rounded-full font-bold border ${
                    isTurboLocality
                      ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                      : 'bg-blue-50 text-blue-800 border-blue-200'
                  }`}>
                    {quote?.locality ? 'Localidad' : 'Municipio'}: {localityName} {isTurbo ? '⚡' : isScheduledOnly ? '📅' : ''}
                  </span>
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
                  value={addressInput}
                  onChange={e => handleAddressInputChange(e.target.value)}
                  aria-label="Dirección de entrega"
                  placeholder="Escribe tu dirección de entrega"
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
              <label htmlFor="delivery-details" className="text-[11px] font-bold text-slate-700">Torre / Apto / Portería (Opcional)</label>
              <input
                type="text"
                id="delivery-details"
                value={detailsInput}
                onChange={e => setDetailsInput(e.target.value)}
                className="w-full px-3 py-2.5 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none focus:border-red-500 font-medium transition shadow-2xs"
              />
            </div>
          </div>

          <details className="p-3 rounded-xl border border-slate-200 space-y-2">
            <summary className="text-xs font-bold cursor-pointer">Completar o confirmar el punto de entrega</summary>
            <label className="block text-xs font-bold">Localidad (si falta identificarla)
              <select aria-label="Localidad de entrega" value={territory.locality || ''} onChange={e=>{
                const next={...territory, municipality:'Bogotá D.C.',locality:e.target.value};
                setTerritory(next); evaluateAddressQuote(pinCoordinates,addressInput,next);
              }} className="block w-full p-2 border rounded-lg">
                <option value="">Identificar por el punto de entrega</option>
                {TERRITORY_OPTIONS.flatMap(g=>g.items).filter(i=>i.locality).map(i=><option key={i.locality} value={i.locality}>{i.label}</option>)}
              </select>
            </label>
            <p className="text-xs">También puedes confirmar el punto exacto del destino. El servidor valida su localidad y cobertura urbana.</p>
            <div className="flex gap-2">
              {(['lat','lng'] as const).map(axis=><label key={axis} className="text-xs min-w-0">{axis==='lat'?'Latitud del destino':'Longitud del destino'}<input aria-label={axis==='lat'?'Latitud del destino':'Longitud del destino'} type="number" step="any" value={pinCoordinates[axis] ?? ''} onChange={e=>handleCoordinateChange(axis,e.target.value)} className="w-full border rounded p-2" /></label>)}
            </div>
            <button onClick={confirmDestinationPoint} disabled={!addressInput.trim() || !destinationPoint} className="text-xs font-bold text-red-700 underline disabled:text-slate-400">Validar este destino</button>
          </details>

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
            <div className="p-3 rounded-2xl bg-amber-50 border border-amber-200 text-amber-900 text-xs flex items-start gap-2.5 animate-in fade-in">
              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="font-bold text-[11px]">{geocodeError}</p>
                <p className="text-[10px] text-amber-700 mt-0.5">
                  La confirmación se encuentra pausada para evitar enviar tu pedido a una dirección previa no coincidente.
                </p>
              </div>
            </div>
          )}

          {/* Map with Draggable Pin */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs text-slate-600">
              <div className="flex items-center gap-1.5 font-bold text-red-600 bg-red-50 px-2.5 py-1 rounded-lg border border-red-100">
                <Compass className="w-3.5 h-3.5 animate-spin" />
                <span>Mueve el pin o haz clic en el mapa para ubicar tu dirección</span>
              </div>
              <span className="font-mono text-[10px] text-slate-400 hidden sm:inline">
                {destinationPoint ? `${destinationPoint.lat.toFixed(4)}, ${destinationPoint.lng.toFixed(4)}` : 'Punto de entrega pendiente'}
              </span>
            </div>

            <div className="h-56 min-[669px]:h-72 w-full rounded-2xl overflow-hidden border border-slate-200 shadow-inner relative">
              <APIProvider apiKey={apiKey}>
                <Map
                  defaultCenter={mapCenter}
                  defaultZoom={destinationPoint ? 14 : 11}
                  mapId="BOLT_PETS_MAP"
                  className="w-full h-full"
                  gestureHandling="greedy"
                  disableDefaultUI={true}
                  onClick={handleMapClick}
                  internalUsageAttributionIds={['gmp_mcp_codeassist_v1_aistudio']}
                >
                  <MapRecenter center={mapCenter} />

                  {/* Customer Adjustable Red Delivery Pin */}
                  {destinationPoint && <AdvancedMarker
                    position={destinationPoint}
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
                  <span>Obteniendo dirección del destino...</span>
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
                            Cobertura Turbo Confirmada
                          </span>
                          <span className="text-xs font-black bg-yellow-400 text-red-950 px-2 py-0.5 rounded-md flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            Llega en aprox. {quote.estimatedMinutes} min
                          </span>
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
                            Franjas horarias disponibles
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
                      {quote.message}
                    </p>

                    {quote.assignedStoreName && (
                      <p className="text-[11px] mt-1 opacity-90">
                        Sede asignada automáticamente: <strong>{quote.assignedStoreName}</strong>
                      </p>
                    )}
                  </div>
                </div>

                {isTurbo && (
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
                    ✓ Turbo 25 min habilitado
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
                {!isOutOfAllCoverage && quote.assignedStoreId && <span className="text-slate-600">
                  Distancia: <strong>{quote.geographicDistanceKm} km</strong> • Ruta vial estimada: <strong>{quote.roadDistanceKm} km</strong>
                </span>}
              </div>

              {/* Detailed ETA Components Breakdown */}
              {showBreakdown && quote.etaComponents && (
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
        <div className="p-4 border-t border-slate-100 bg-slate-50 flex items-center justify-between gap-3">
          <div className="text-xs text-slate-600">
            {isReverseGeocoding ? (
              <span className="text-red-600 font-bold flex items-center gap-1.5">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Actualizando dirección por movimiento de pin...
              </span>
            ) : !isAddressSynced && geocodeError ? (
              <span className="text-amber-700 font-bold">Dirección desincronizada del pin</span>
            ) : isTurbo ? (
              <span className="text-emerald-700 font-bold">✓ Cumple radio de 6 km y límite de 25 min</span>
            ) : isTurboDividido ? (
              <span className="text-amber-800 font-bold">✓ Distribución por capacidad verificada para esta compra</span>
            ) : isScheduledOnly ? (
              <span className="text-blue-800 font-bold">✓ Disponible para Envío Programado</span>
            ) : (
              <span className="text-rose-700 font-bold">{quote?.eligibilityStatus === 'OUT_OF_COVERAGE' ? 'Ubicación fuera de cobertura' : quote?.message || 'Completa y valida tu dirección'}</span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-200 rounded-xl transition"
            >
              Cancelar
            </button>
            <button
              onClick={handleConfirm}
              disabled={!canConfirm}
              className="bg-red-600 hover:bg-red-700 disabled:bg-slate-300 text-white font-black text-xs px-5 py-2.5 rounded-xl shadow-md transition disabled:cursor-not-allowed flex items-center gap-1.5"
            >
              {isReverseGeocoding ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Obteniendo dirección...</span>
                </>
              ) : isEvaluating ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Cotizando cobertura...</span>
                </>
              ) : !isAddressSynced ? (
                <span>Esperando dirección...</span>
              ) : (
                <>
                  <span>{savedAddressOptions ? 'Guardar cambios' : 'Confirmar dirección'}</span>
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
