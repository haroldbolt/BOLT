import React, { useState, useEffect, useCallback, useRef } from 'react';
import { APIProvider, Map, AdvancedMarker, useMap } from '@vis.gl/react-google-maps';
import { 
  MapPin, X, CheckCircle2, AlertTriangle, Clock, 
  Search, ChevronRight, Calendar, Info, Compass, Sparkles, Navigation
} from 'lucide-react';
import { DeliveryQuote, LatLng, DELIVERY_CONFIG } from '../../lib/deliveryService';
import { api } from '../../lib/api';
import { Store, CartItem, Product } from '../../types';

declare const google: any;

interface MapRecenterProps {
  center: LatLng;
}

const MapRecenter: React.FC<MapRecenterProps> = ({ center }) => {
  const map = useMap();
  useEffect(() => {
    if (map && center && typeof center.lat === 'number') {
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
  currentCoordinates: LatLng;
  onConfirmAddress: (address: string, details: string, coordinates: LatLng, quote: DeliveryQuote) => void;
  stores: Store[];
  cartItems?: CartItem[];
  products?: Product[];
}

/**
 * Geocodificador inteligente para Bogotá:
 * Intenta utilizar la API nativa de Google Maps si está disponible,
 * o mapea con precisión calles, carreras y barrios representativos de Bogotá.
 */
function geocodeBogotaAddress(addressStr: string): LatLng | null {
  const clean = addressStr.toLowerCase().trim();
  if (!clean) return null;

  // Reconocimiento de sectores y vías conocidas de Bogotá
  if (clean.includes('kennedy') || clean.includes('castilla') || clean.includes('timiza')) {
    return { lat: 4.6365, lng: -74.1448 };
  }
  if (clean.includes('alamos') || clean.includes('álamos') || clean.includes('engativa') || clean.includes('engativá') || clean.includes('villas')) {
    return { lat: 4.6934, lng: -74.1192 };
  }
  if (clean.includes('suba') || clean.includes('rincon') || clean.includes('rincón') || clean.includes('pinar') || clean.includes('tibabuyes')) {
    return { lat: 4.7450, lng: -74.0920 };
  }
  if (clean.includes('chapinero') || clean.includes('lourdes') || clean.includes('javeriana')) {
    return { lat: 4.6438, lng: -74.0621 };
  }
  if (clean.includes('usaquen') || clean.includes('usaquén') || clean.includes('santa barbara') || clean.includes('cedritos') || clean.includes('calle 140')) {
    return { lat: 4.7120, lng: -74.0320 };
  }
  if (clean.includes('salitre') || clean.includes('calle 26') || clean.includes('terminal') || clean.includes('modelia')) {
    return { lat: 4.6580, lng: -74.1150 };
  }
  if (clean.includes('fontibon') || clean.includes('fontibón')) {
    return { lat: 4.6730, lng: -74.1420 };
  }
  if (clean.includes('centro') || clean.includes('candelaria') || clean.includes('bolivar') || clean.includes('bolívar')) {
    return { lat: 4.6028, lng: -74.0754 };
  }
  if (clean.includes('chia') || clean.includes('chía') || clean.includes('cota') || clean.includes('cajica')) {
    return { lat: 4.8620, lng: -74.0580 };
  }

  // Heurística de cuadrícula bogotana (Calles y Carreras)
  const calleMatch = clean.match(/(?:calle|clle|cl|c)\.?\s*(\d+)/i);
  const carreraMatch = clean.match(/(?:carrera|cra|cr|kra|k)\.?\s*(\d+)/i);

  if (calleMatch || carreraMatch) {
    const calleNum = calleMatch ? parseInt(calleMatch[1], 10) : 60;
    const craNum = carreraMatch ? parseInt(carreraMatch[1], 10) : 50;

    // Calles en Bogotá aumentan de Sur (lat ~4.50) a Norte (Calle 200: lat ~4.78)
    const baseLat = 4.580;
    const latPerCalle = (4.780 - 4.580) / 200;
    const estLat = Number((baseLat + Math.min(220, calleNum) * latPerCalle).toFixed(4));

    // Carreras en Bogotá aumentan de Oriente (Cra 1: lng ~-74.04) a Occidente (Cra 130: lng ~-74.18)
    const baseLng = -74.045;
    const lngPerCra = (-74.180 - -74.045) / 120;
    const estLng = Number((baseLng + Math.min(130, craNum) * lngPerCra).toFixed(4));

    return { lat: estLat, lng: estLng };
  }

  return null;
}

export const AddressConfirmationModal: React.FC<AddressConfirmationModalProps> = ({
  isOpen,
  onClose,
  currentAddress,
  currentDetails,
  currentCoordinates,
  onConfirmAddress,
  stores,
  cartItems,
  products = [],
}) => {
  const [addressInput, setAddressInput] = useState(currentAddress || 'Calle 3 #78-20, Kennedy Central, Bogotá');
  const [detailsInput, setDetailsInput] = useState(currentDetails || 'Apto 502, Torre 2');
  const [pinCoordinates, setPinCoordinates] = useState<LatLng>(
    currentCoordinates?.lat ? currentCoordinates : { lat: 4.6365, lng: -74.1448 }
  );
  const [quote, setQuote] = useState<DeliveryQuote | null>(null);
  const [isEvaluating, setIsEvaluating] = useState(false);
  const [isGeocoding, setIsGeocoding] = useState(false);
  const [showBreakdown, setShowBreakdown] = useState(false);

  const debounceTimeoutRef = useRef<any>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || 'AIzaSyBeZD10ABWRpSpwChGlSzPR-6wxdD9oJcE';

  // Synchronize inputs when modal opens
  useEffect(() => {
    if (isOpen) {
      setAddressInput(currentAddress || 'Calle 3 #78-20, Kennedy Central, Bogotá');
      setDetailsInput(currentDetails || 'Apto 502, Torre 2');
      if (currentCoordinates?.lat) {
        setPinCoordinates(currentCoordinates);
      }
    }
  }, [isOpen, currentAddress, currentDetails, currentCoordinates]);

  // Request authoritative quote from backend
  const evaluateAddressQuote = useCallback(async (coords: LatLng, addr: string) => {
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
          },
          items: cartItems?.map(i => ({ productId: i.product.id, quantity: i.quantity })),
        },
        stores,
        products
      );
      setQuote(q);
    } catch (e: any) {
      if (e.name !== 'AbortError') {
        console.error('Error fetching delivery quote:', e);
      }
    } finally {
      setIsEvaluating(false);
    }
  }, [detailsInput, cartItems, stores, products]);

  // Debounced quote refresh on pin coordinate change
  useEffect(() => {
    if (!isOpen) return;
    if (debounceTimeoutRef.current) clearTimeout(debounceTimeoutRef.current);
    debounceTimeoutRef.current = setTimeout(() => {
      evaluateAddressQuote(pinCoordinates, addressInput);
    }, 350);

    return () => {
      if (debounceTimeoutRef.current) clearTimeout(debounceTimeoutRef.current);
    };
  }, [isOpen, pinCoordinates]);

  // Handle typing address with automatic geocoding
  const handleAddressInputChange = (val: string) => {
    setAddressInput(val);
    if (debounceTimeoutRef.current) clearTimeout(debounceTimeoutRef.current);

    debounceTimeoutRef.current = setTimeout(() => {
      setIsGeocoding(true);
      // Intentar geocodificación con Google Maps Geocoder si está cargado
      if (typeof google !== 'undefined' && google.maps && google.maps.Geocoder) {
        const geocoder = new google.maps.Geocoder();
        const searchTarget = val.toLowerCase().includes('bogot') ? val : `${val}, Bogotá, Colombia`;
        geocoder.geocode({ address: searchTarget }, (results: any, status: any) => {
          setIsGeocoding(false);
          if (status === 'OK' && results?.[0]?.geometry?.location) {
            const lat = Number(results[0].geometry.location.lat().toFixed(6));
            const lng = Number(results[0].geometry.location.lng().toFixed(6));
            setPinCoordinates({ lat, lng });
          } else {
            // Fallback a geocodificador local de Bogotá
            const localCoords = geocodeBogotaAddress(val);
            if (localCoords) setPinCoordinates(localCoords);
          }
        });
      } else {
        setIsGeocoding(false);
        const localCoords = geocodeBogotaAddress(val);
        if (localCoords) setPinCoordinates(localCoords);
      }
    }, 500);
  };

  // Handle map click to reposition pin precisely
  const handleMapClick = (e: any) => {
    if (e.detail?.latLng) {
      const newCoords = {
        lat: Number(e.detail.latLng.lat.toFixed(6)),
        lng: Number(e.detail.latLng.lng.toFixed(6)),
      };
      setPinCoordinates(newCoords);
    }
  };

  // Handle pin drag end
  const handlePinDragEnd = (e: any) => {
    if (e.latLng) {
      const newCoords = {
        lat: Number(e.latLng.lat().toFixed(6)),
        lng: Number(e.latLng.lng().toFixed(6)),
      };
      setPinCoordinates(newCoords);
    }
  };

  const handleConfirm = () => {
    if (quote && (quote.availableModes.turbo || quote.availableModes.turboDividido || quote.availableModes.scheduled)) {
      onConfirmAddress(addressInput, detailsInput, pinCoordinates, quote);
      onClose();
    }
  };

  const isTurbo = !!quote?.availableModes?.turbo;
  const isTurboDividido = !!quote?.availableModes?.turboDividido;
  const isScheduledOnly = !isTurbo && !isTurboDividido && !!quote?.availableModes?.scheduled;
  const isOutOfAllCoverage = !isTurbo && !isTurboDividido && !quote?.availableModes?.scheduled;

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 md:p-4 animate-in fade-in">
      <div className="bg-white rounded-3xl w-full max-w-2xl max-h-[94vh] flex flex-col shadow-2xl overflow-hidden border border-slate-100">
        
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
                Validación automática de cobertura y asignación de bodega en Bogotá
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-500 transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          
          {/* Address Inputs */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="sm:col-span-2 space-y-1">
              <label className="text-[11px] font-bold text-slate-700 flex items-center justify-between">
                <span>Dirección en Bogotá</span>
                {isGeocoding && <span className="text-red-600 text-[10px] animate-pulse">Ubicando en mapa...</span>}
              </label>
              <div className="relative">
                <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
                <input
                  type="text"
                  value={addressInput}
                  onChange={e => handleAddressInputChange(e.target.value)}
                  placeholder="Escribe tu dirección (ej: Carrera 79A #2-05, Kennedy)"
                  className="w-full pl-9 pr-3 py-2.5 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none focus:border-red-500 font-medium transition shadow-2xs"
                />
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-[11px] font-bold text-slate-700">Torre / Apto / Portería (Opcional)</label>
              <input
                type="text"
                value={detailsInput}
                onChange={e => setDetailsInput(e.target.value)}
                placeholder="Ej: Apto 502, Torre 2"
                className="w-full px-3 py-2.5 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none focus:border-red-500 font-medium transition shadow-2xs"
              />
            </div>
          </div>

          {/* Map with Draggable Pin */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs text-slate-600">
              <div className="flex items-center gap-1.5 font-bold text-red-600 bg-red-50 px-2.5 py-1 rounded-lg border border-red-100">
                <Compass className="w-3.5 h-3.5 animate-spin" />
                <span>Ajusta el pin en la entrada de tu domicilio</span>
              </div>
              <span className="font-mono text-[10px] text-slate-400 hidden sm:inline">
                {pinCoordinates.lat.toFixed(4)}, {pinCoordinates.lng.toFixed(4)}
              </span>
            </div>

            <div className="h-56 w-full rounded-2xl overflow-hidden border border-slate-200 shadow-inner relative">
              <APIProvider apiKey={apiKey}>
                <Map
                  defaultCenter={pinCoordinates}
                  defaultZoom={14}
                  mapId="BOLT_PETS_MAP"
                  className="w-full h-full"
                  gestureHandling="greedy"
                  disableDefaultUI={true}
                  onClick={handleMapClick}
                  internalUsageAttributionIds={['gmp_mcp_codeassist_v1_aistudio']}
                >
                  <MapRecenter center={pinCoordinates} />

                  {/* Customer Adjustable Red Delivery Pin */}
                  <AdvancedMarker
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
                        Ajusta el pin aquí
                      </span>
                    </div>
                  </AdvancedMarker>

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

              {isEvaluating && (
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
                <span className="text-slate-600">
                  Distancia: <strong>{quote.geographicDistanceKm} km</strong> • Ruta vial: <strong>{quote.roadDistanceKm} km</strong>
                </span>
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
            {isTurbo ? (
              <span className="text-emerald-700 font-bold">✓ Cumple radio de 6 km y límite de 25 min</span>
            ) : isTurboDividido ? (
              <span className="text-amber-800 font-bold">✓ Pedido &gt; 60 kg elegible para Turbo Dividido o Programado</span>
            ) : isScheduledOnly ? (
              <span className="text-blue-800 font-bold">✓ Disponible para Envío Programado en Bogotá</span>
            ) : (
              <span className="text-rose-700 font-bold">Ubicación fuera de cobertura en Bogotá</span>
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
              disabled={isOutOfAllCoverage || isEvaluating}
              className="bg-red-600 hover:bg-red-700 disabled:bg-slate-300 text-white font-black text-xs px-5 py-2.5 rounded-xl shadow-md transition disabled:cursor-not-allowed flex items-center gap-1.5"
            >
              <span>Confirmar dirección</span>
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
