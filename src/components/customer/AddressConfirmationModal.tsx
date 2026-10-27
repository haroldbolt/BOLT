import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { APIProvider, Map, AdvancedMarker, useMap } from '@vis.gl/react-google-maps';
import { 
  MapPin, X, CheckCircle2, AlertTriangle, Clock, 
  Search, ChevronRight, Calendar, Info, Compass, Sparkles, Navigation, Loader2
} from 'lucide-react';
import { DeliveryQuote, LatLng, DELIVERY_CONFIG, detectBogotaLocality, getBogotaLocalityName, TURBO_ALLOWED_LOCALITIES } from '../../lib/deliveryService';
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
  currentCoordinates: LatLng;
  onConfirmAddress: (address: string, details: string, coordinates: LatLng, quote: DeliveryQuote) => void;
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
  if (!cleaned.toLowerCase().includes('bogot')) {
    cleaned = `${cleaned}, Bogotá`;
  }
  return cleaned;
}

/**
 * Geocodificador inteligente de respaldo para Bogotá:
 * Mapea calles, carreras y barrios representativos cuando se escribe manualmente
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
  const [isReverseGeocoding, setIsReverseGeocoding] = useState(false);
  const [isAddressSynced, setIsAddressSynced] = useState(true);
  const [geocodeError, setGeocodeError] = useState<string | null>(null);
  const [showBreakdown, setShowBreakdown] = useState(false);

  const debounceTimeoutRef = useRef<any>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const reverseGeocodeReqSeqRef = useRef<number>(0);

  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || 'AIzaSyBeZD10ABWRpSpwChGlSzPR-6wxdD9oJcE';

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

  // Synchronize inputs when modal opens
  useEffect(() => {
    if (isOpen) {
      const initialAddr = currentAddress || 'Calle 3 #78-20, Kennedy Central, Bogotá';
      const initialDetails = currentDetails || 'Apto 502, Torre 2';
      const initialCoords = currentCoordinates?.lat ? currentCoordinates : { lat: 4.6365, lng: -74.1448 };

      setAddressInput(initialAddr);
      setDetailsInput(initialDetails);
      setPinCoordinates(initialCoords);
      setIsAddressSynced(true);
      setGeocodeError(null);
      setIsReverseGeocoding(false);
      reverseGeocodeReqSeqRef.current = 0;

      evaluateAddressQuote(initialCoords, initialAddr);
    }
  }, [isOpen, currentAddress, currentDetails, currentCoordinates, evaluateAddressQuote]);

  /**
   * Ejecuta la geocodificación inversa para las coordenadas del pin.
   * Soporta múltiples movimientos descartando resultados obsoletos (reqId).
   * Mantiene en sincronía el pin, la dirección y la cotización.
   */
  const triggerReverseGeocode = useCallback((newCoords: LatLng) => {
    // Requisito 7: Si el usuario mueve el pin varias veces, utiliza únicamente el resultado de la última ubicación
    const reqId = ++reverseGeocodeReqSeqRef.current;

    // Requisito 6: Muestra un indicador durante la consulta y evita confirmar una dirección anterior asociada a coordenadas nuevas
    setIsReverseGeocoding(true);
    setIsAddressSynced(false);
    setGeocodeError(null);

    // Cancelar cualquier debounce de entrada de texto pendiente
    if (debounceTimeoutRef.current) {
      clearTimeout(debounceTimeoutRef.current);
    }

    const execute = async () => {
      let resolvedAddress: string | null = null;

      try {
        // 1. Intentar Geocoder nativo del SDK de Google Maps si está cargado
        if (typeof google !== 'undefined' && google.maps) {
          try {
            let geocoderInstance: any = null;
            if (google.maps.Geocoder) {
              geocoderInstance = new google.maps.Geocoder();
            } else if (typeof google.maps.importLibrary === 'function') {
              const geocodingLib = await google.maps.importLibrary('geocoding') as any;
              if (geocodingLib?.Geocoder) {
                geocoderInstance = new geocodingLib.Geocoder();
              }
            }

            if (geocoderInstance) {
              const results = await new Promise<any[]>((resolve, reject) => {
                geocoderInstance.geocode(
                  { location: { lat: newCoords.lat, lng: newCoords.lng } },
                  (res: any, status: any) => {
                    if (status === 'OK' && res && res.length > 0) {
                      resolve(res);
                    } else {
                      reject(new Error(status || 'ZERO_RESULTS'));
                    }
                  }
                );
              });

              if (results && results[0]?.formatted_address) {
                resolvedAddress = formatCleanBogotaAddress(results[0].formatted_address);
              }
            }
          } catch (sdkErr) {
            console.warn('Geocodificación inversa SDK falló, intentando proxy:', sdkErr);
          }
        }

        // 2. Respaldo autoritativo con proxy del backend a Google Maps Geocoding API
        if (!resolvedAddress) {
          try {
            const proxyRes = await api.reverseGeocode(newCoords.lat, newCoords.lng);
            if (proxyRes?.address) {
              resolvedAddress = proxyRes.address;
            }
          } catch (proxyErr) {
            console.warn('Error en proxy de geocodificación inversa:', proxyErr);
          }
        }

        // Requisito 7: Si llegó un nuevo movimiento mientras esta petición corría, descartar resultado
        if (reqId !== reverseGeocodeReqSeqRef.current) {
          return;
        }

        if (resolvedAddress) {
          // Requisito 2: Actualiza addressInput con setAddressInput usando la dirección real obtenida
          setAddressInput(resolvedAddress);
          setIsAddressSynced(true);
          setGeocodeError(null);

          // Requisito 4: Mantén sincronizados el pin, la dirección y la cotización de domicilio
          evaluateAddressQuote(newCoords, resolvedAddress);
        } else {
          // Requisito 6: Si falla, informa al usuario y evita confirmar una dirección anterior asociada a coordenadas nuevas
          setIsAddressSynced(false);
          setGeocodeError('No fue posible identificar la dirección de este punto en Bogotá. Por favor mueve el pin a una vía reconocida o digita la dirección manualmente.');
        }
      } catch (err: any) {
        if (reqId === reverseGeocodeReqSeqRef.current) {
          setIsAddressSynced(false);
          setGeocodeError('Error al consultar la dirección en el mapa. Intenta mover el pin nuevamente.');
        }
      } finally {
        if (reqId === reverseGeocodeReqSeqRef.current) {
          setIsReverseGeocoding(false);
        }
      }
    };

    execute();
  }, [evaluateAddressQuote]);

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
    setAddressInput(val);
    setGeocodeError(null);
    setIsAddressSynced(true);

    // Cancelar solicitudes de geocodificación inversa en curso
    reverseGeocodeReqSeqRef.current++;
    setIsReverseGeocoding(false);

    if (debounceTimeoutRef.current) clearTimeout(debounceTimeoutRef.current);

    debounceTimeoutRef.current = setTimeout(async () => {
      if (!val.trim()) return;
      setIsGeocoding(true);

      let foundCoords: LatLng | null = null;

      // 1. Intentar Geocoder nativo de Google Maps
      if (typeof google !== 'undefined' && google.maps && google.maps.Geocoder) {
        try {
          const geocoder = new google.maps.Geocoder();
          const searchTarget = val.toLowerCase().includes('bogot') ? val : `${val}, Bogotá, Colombia`;
          const results = await new Promise<any[]>((resolve, reject) => {
            geocoder.geocode({ address: searchTarget }, (res: any, status: any) => {
              if (status === 'OK' && res && res.length > 0) resolve(res);
              else reject(status);
            });
          });
          if (results?.[0]?.geometry?.location) {
            foundCoords = {
              lat: Number(results[0].geometry.location.lat().toFixed(6)),
              lng: Number(results[0].geometry.location.lng().toFixed(6)),
            };
          }
        } catch {
          // Continuar con respaldo
        }
      }

      // 2. Intentar backend forward geocode proxy
      if (!foundCoords) {
        try {
          const forwardRes = await api.forwardGeocode(val);
          if (forwardRes?.coordinates) {
            foundCoords = forwardRes.coordinates;
          }
        } catch {
          // Continuar con cuadrícula heurística
        }
      }

      // 3. Fallback a cuadrícula de Bogotá
      if (!foundCoords) {
        foundCoords = geocodeBogotaAddress(val);
      }

      setIsGeocoding(false);

      if (foundCoords) {
        setPinCoordinates(foundCoords);
        evaluateAddressQuote(foundCoords, val);
      }
    }, 500);
  };

  // Requisito 4: Al confirmar, onConfirmAddress debe recibir los datos de esa misma ubicación
  const canConfirm = 
    !isEvaluating && 
    !isReverseGeocoding && 
    isAddressSynced && 
    !geocodeError &&
    !!quote && 
    (quote.availableModes.turbo || quote.availableModes.turboDividido || quote.availableModes.scheduled);

  const handleConfirm = () => {
    if (canConfirm && quote) {
      // Requisito 5: Conserva lo escrito en «Torre / Apto / Portería» (detailsInput)
      onConfirmAddress(addressInput, detailsInput, pinCoordinates, quote);
      onClose();
    }
  };

  const isTurbo = !!quote?.availableModes?.turbo;
  const isTurboDividido = !!quote?.availableModes?.turboDividido;
  const isScheduledOnly = !isTurbo && !isTurboDividido && !!quote?.availableModes?.scheduled;
  const isOutOfAllCoverage = !isTurbo && !isTurboDividido && !quote?.availableModes?.scheduled;

  const detectedLocality = useMemo(() => {
    return quote?.detectedLocality || detectBogotaLocality(pinCoordinates, addressInput);
  }, [quote?.detectedLocality, pinCoordinates, addressInput]);
  const localityName = quote?.detectedLocalityName || getBogotaLocalityName(detectedLocality);
  const isTurboLocality = (TURBO_ALLOWED_LOCALITIES as readonly string[]).includes(detectedLocality);
  const isAutoSwitchedToScheduled =
    !!quote?.autoSwitchedToScheduled ||
    isScheduledOnly ||
    (!isTurboLocality && !!quote?.availableModes?.scheduled);

  const PRESET_LOCATIONS = [
    { label: 'Kennedy', locality: 'Kennedy', address: 'Calle 3 #78-20, Kennedy Central, Bogotá', coords: { lat: 4.6365, lng: -74.1448 }, turbo: true },
    { label: 'Suba', locality: 'Suba', address: 'Carrera 107 #143-31, Suba Pinar, Bogotá', coords: { lat: 4.7450, lng: -74.0920 }, turbo: true },
    { label: 'Engativá', locality: 'Engativá', address: 'Calle 64 #70-30, Álamos, Engativá, Bogotá', coords: { lat: 4.6934, lng: -74.1192 }, turbo: true },
    { label: 'Usaquén', locality: 'Usaquén', address: 'Calle 140 #11-45, Cedritos, Usaquén, Bogotá', coords: { lat: 4.7120, lng: -74.0320 }, turbo: false },
    { label: 'Chapinero', locality: 'Chapinero', address: 'Carrera 7 #53-20, Chapinero, Bogotá', coords: { lat: 4.6438, lng: -74.0621 }, turbo: false },
    { label: 'Centro', locality: 'Santa Fe', address: 'Calle 11 #15-53, La Candelaria / Centro, Bogotá', coords: { lat: 4.6028, lng: -74.0754 }, turbo: false },
  ];

  const handleSelectPreset = (preset: typeof PRESET_LOCATIONS[0]) => {
    setAddressInput(preset.address);
    setPinCoordinates(preset.coords);
    setIsAddressSynced(true);
    setGeocodeError(null);
    evaluateAddressQuote(preset.coords, preset.address);
  };

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
                Validación de localidad, distancia máxima 6 km y ETA ≤ 25 min en Bogotá
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
          
          {/* Quick preset locations for rapid testing */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-[11px] text-slate-500 font-semibold">
              <span>Probar por localidad de Bogotá:</span>
              <span className="text-[10px] text-slate-400">⚡ Turbo: Kennedy, Suba, Engativá · 📅 Programado: Resto de la ciudad</span>
            </div>
            <div className="flex gap-1.5 overflow-x-auto pb-1 no-scrollbar">
              {PRESET_LOCATIONS.map((preset) => {
                const isActive = addressInput.includes(preset.locality);
                return (
                  <button
                    key={preset.label}
                    type="button"
                    onClick={() => handleSelectPreset(preset)}
                    className={`px-2.5 py-1 rounded-xl text-[11px] font-bold shrink-0 transition border ${
                      isActive
                        ? preset.turbo
                          ? 'bg-emerald-600 text-white border-emerald-600 shadow-xs'
                          : 'bg-blue-600 text-white border-blue-600 shadow-xs'
                        : preset.turbo
                        ? 'bg-emerald-50 text-emerald-800 border-emerald-200 hover:bg-emerald-100'
                        : 'bg-blue-50 text-blue-800 border-blue-200 hover:bg-blue-100'
                    }`}
                  >
                    <span>{preset.turbo ? '⚡' : '📅'} {preset.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Address Inputs */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="sm:col-span-2 space-y-1">
              <label className="text-[11px] font-bold text-slate-700 flex items-center justify-between">
                <span className="flex items-center gap-1.5">
                  <span>Dirección en Bogotá</span>
                  <span className={`text-[10px] px-2 py-0.2 rounded-full font-bold border ${
                    isTurboLocality
                      ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                      : 'bg-blue-50 text-blue-800 border-blue-200'
                  }`}>
                    Localidad: {localityName} {isTurboLocality ? '⚡' : '📅'}
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
                  placeholder="Escribe tu dirección (ej: Carrera 79A #2-05, Kennedy)"
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
                value={detailsInput}
                onChange={e => setDetailsInput(e.target.value)}
                placeholder="Ej: Apto 502, Torre 2"
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
                {pinCoordinates.lat.toFixed(4)}, {pinCoordinates.lng.toFixed(4)}
              </span>
            </div>

            <div className="h-56 min-[669px]:h-72 w-full rounded-2xl overflow-hidden border border-slate-200 shadow-inner relative">
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
                        {isReverseGeocoding ? 'Consultando...' : 'Ajusta el pin aquí'}
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
                  <span>{isAutoSwitchedToScheduled ? 'Continuar con Envío Programado' : 'Confirmar dirección'}</span>
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
