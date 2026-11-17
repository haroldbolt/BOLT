import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  AdvancedMarker, APIProvider, APILoadingStatus, Map, Polyline, useApiLoadingStatus, useMap, useMapsLibrary,
} from '@vis.gl/react-google-maps';
import { Bike, LocateFixed, MapPin, Warehouse } from 'lucide-react';

export type MapPoint = { lat: number; lng: number };

interface Props {
  origin?: { name: string; coordinates?: MapPoint | null } | null;
  destination: { name?: string; coordinates?: MapPoint | null };
  courier?: { coordinates?: MapPoint | null; updatedAt: string | number; freshness: 'live' | 'stale' } | null;
  inTransit?: boolean;
  route?: { coordinates: MapPoint[]; source: 'RECORDED_GPS' } | null;
}

function validPoint(value: MapPoint | null | undefined): value is MapPoint {
  return !!value && Number.isFinite(value.lat) && Number.isFinite(value.lng)
    && Math.abs(value.lat) <= 90 && Math.abs(value.lng) <= 180
    && (value.lat !== 0 || value.lng !== 0);
}

const pointKey = (point: MapPoint) => `${point.lat},${point.lng}`;
const time = new Intl.DateTimeFormat('es-CO', {
  timeZone: 'America/Bogota', hour: '2-digit', minute: '2-digit', second: '2-digit',
});

function usePoint(value: MapPoint | null | undefined) {
  const lat = value?.lat;
  const lng = value?.lng;
  return useMemo(() => {
    const point = typeof lat === 'number' && typeof lng === 'number' ? { lat, lng } : null;
    return validPoint(point) ? point : null;
  }, [lat, lng]);
}

function useRoute(route: Props['route']) {
  return useMemo(() => {
    if (route?.source !== 'RECORDED_GPS' || !Array.isArray(route.coordinates)
      || route.coordinates.length < 2 || !route.coordinates.every(validPoint)
      || new Set(route.coordinates.map(pointKey)).size < 2) return null;
    return route.coordinates;
  }, [route]);
}

function MapFrame({ origin, destination, courier, route, recenter }: {
  origin: MapPoint | null;
  destination: MapPoint | null;
  courier: MapPoint | null;
  route: MapPoint[] | null;
  recenter: number;
}) {
  const map = useMap();
  const core = useMapsLibrary('core');
  const lastFrame = useRef<{ map: NonNullable<ReturnType<typeof useMap>>; recenter: number; hasCourier: boolean } | undefined>(undefined);

  useEffect(() => {
    if (!map || !core) return;
    const previous = lastFrame.current;
    const explicitRecenter = previous?.recenter !== recenter;
    // Fit once for a new view or newly received GPS. Subsequent samples move only the marker.
    if (previous?.map === map && !explicitRecenter && (previous.hasCourier || !courier)) return;
    lastFrame.current = { map, recenter, hasCourier: !!courier };

    const points = [origin, destination, courier, ...(route ?? [])].filter(validPoint);
    if (points.length === 0) return;
    if (new Set(points.map(pointKey)).size === 1) {
      map.setCenter(points[0]);
      map.setZoom(16);
      return;
    }
    const bounds = new core.LatLngBounds();
    for (const point of points) bounds.extend(point);
    map.fitBounds(bounds, 48);
  }, [map, core, origin, destination, courier, route, recenter]);

  return null;
}

const markerStyle = {
  origin: { icon: Warehouse, background: 'bg-slate-800', chip: 'bg-slate-800' },
  destination: { icon: MapPin, background: 'bg-rose-600', chip: 'bg-rose-600' },
  courier: { icon: Bike, background: 'bg-emerald-700', chip: 'bg-emerald-700' },
} as const;

function DeliveryMarker({ kind, point, title }: { kind: keyof typeof markerStyle; point: MapPoint; title: string }) {
  const { icon: Icon, background } = markerStyle[kind];
  return <AdvancedMarker position={point} title={title} zIndex={kind === 'courier' ? 3 : kind === 'destination' ? 2 : 1}>
    <span className={`grid size-9 place-items-center rounded-full border-2 border-white text-white shadow-md ${background}`}>
      <Icon size={17} aria-hidden="true" />
    </span>
  </AdvancedMarker>;
}

function MapFallback({ children }: { children: ReactNode }) {
  return <div className="flex min-h-44 flex-col items-center justify-center gap-2 bg-slate-50 px-4 py-6 text-center text-sm text-slate-700">
    <MapPin className="text-slate-500" size={21} aria-hidden="true" />
    <p>{children}</p>
  </div>;
}

function GoogleDeliveryMap({ center, mapId, origin, destination, courier, originName, destinationName, route, failed, onFailure }: {
  center: MapPoint;
  mapId: string;
  origin: MapPoint | null;
  destination: MapPoint | null;
  courier: MapPoint | null;
  originName: string;
  destinationName: string;
  route: MapPoint[] | null;
  failed: boolean;
  onFailure: () => void;
}) {
  const status = useApiLoadingStatus();
  const [recenter, setRecenter] = useState(0);

  useEffect(() => {
    if (status !== APILoadingStatus.LOADED && status !== APILoadingStatus.FAILED && status !== APILoadingStatus.AUTH_FAILURE && !failed) {
      const timeout = window.setTimeout(onFailure, 12_000);
      return () => window.clearTimeout(timeout);
    }
  }, [status, failed, onFailure]);

  if (failed || status === APILoadingStatus.FAILED || status === APILoadingStatus.AUTH_FAILURE) {
    return <MapFallback>El mapa no está disponible en este momento.</MapFallback>;
  }
  if (status !== APILoadingStatus.LOADED) return <MapFallback>Cargando mapa de entrega…</MapFallback>;

  return <div className="relative h-72 bg-slate-50 sm:h-80">
    <Map className="size-full" defaultCenter={center} defaultZoom={14} mapId={mapId}
      renderingType="RASTER" gestureHandling="cooperative" mapTypeControl={false} streetViewControl={false}
      fullscreenControl={false} keyboardShortcuts zoomControl clickableIcons={false} maxZoom={19}>
      <MapFrame origin={origin} destination={destination} courier={courier} route={route} recenter={recenter} />
      {origin && <DeliveryMarker kind="origin" point={origin} title={originName} />}
      {destination && <DeliveryMarker kind="destination" point={destination} title={destinationName} />}
      {courier && <DeliveryMarker kind="courier" point={courier} title="Ubicación actual del repartidor" />}
      {route && <Polyline path={route} strokeColor="#1D4ED8" strokeWeight={4} strokeOpacity={0.88} clickable={false} />}
    </Map>
    <button type="button" onClick={() => setRecenter(value => value + 1)}
      aria-label="Recentrar mapa" title="Recentrar mapa"
      className="absolute left-3 top-3 grid size-11 place-items-center rounded-xl border border-slate-200 bg-white text-slate-800 shadow-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-600">
      <LocateFixed size={19} aria-hidden="true" />
    </button>
  </div>;
}

function MapLegendItem({ kind, children }: { kind: keyof typeof markerStyle; children: ReactNode }) {
  const { icon: Icon, chip } = markerStyle[kind];
  return <li className="flex min-w-0 items-center gap-2"><span className={`grid size-6 shrink-0 place-items-center rounded-full text-white ${chip}`}><Icon size={13} aria-hidden="true" /></span><span className="min-w-0 break-words">{children}</span></li>;
}

export function LiveDeliveryMap({ origin, destination, courier, inTransit = false, route }: Props) {
  const apiKey = import.meta.env?.VITE_GOOGLE_MAPS_API_KEY;
  const mapId = import.meta.env?.VITE_GOOGLE_MAPS_TRACKING_MAP_ID || 'DEMO_MAP_ID';
  const [failed, setFailed] = useState(false);
  const onFailure = useCallback(() => setFailed(true), []);
  const originPoint = usePoint(origin?.coordinates);
  const destinationPoint = usePoint(destination.coordinates);
  const courierPoint = usePoint(courier?.freshness === 'live' ? courier.coordinates : null);
  const routePoints = useRoute(route);
  const center = destinationPoint ?? originPoint ?? courierPoint;
  const originName = origin?.name || 'Sede de salida';
  const destinationName = destination.name || 'Punto de entrega';
  const timestamp = courier?.updatedAt === undefined ? NaN : new Date(courier.updatedAt).getTime();
  const reading = Number.isFinite(timestamp) ? time.format(timestamp) : null;

  useEffect(() => {
    window.addEventListener('gmp-quota-exceeded', onFailure);
    return () => window.removeEventListener('gmp-quota-exceeded', onFailure);
  }, [onFailure]);

  return <section aria-label="Mapa de entrega" className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
    {!center ? <MapFallback>Todavía no hay puntos de entrega disponibles para mostrar en el mapa.</MapFallback>
      : !apiKey?.trim() || failed ? <MapFallback>El mapa no está disponible en este momento.</MapFallback>
        : <APIProvider apiKey={apiKey} onError={onFailure}>
          <GoogleDeliveryMap center={center} mapId={mapId} origin={originPoint} destination={destinationPoint}
            courier={courierPoint} originName={originName} destinationName={destinationName}
            route={routePoints} failed={failed} onFailure={onFailure} />
        </APIProvider>}
    <div className="grid gap-2 p-3 text-sm text-slate-700 sm:p-4">
      <ul aria-label="Puntos de la entrega" className="flex flex-wrap gap-x-4 gap-y-2">
        {origin && <MapLegendItem kind="origin">{originName}</MapLegendItem>}
        <MapLegendItem kind="destination">{destinationName}</MapLegendItem>
        {courierPoint && <MapLegendItem kind="courier">Repartidor en vivo</MapLegendItem>}
      </ul>
      {routePoints && <p className="text-xs font-semibold text-blue-800">Recorrido registrado por GPS</p>}
      {courierPoint && reading && <p className="text-xs text-slate-600">Última actualización GPS: {reading}</p>}
      {courier?.freshness === 'stale' && <p role="status" className="rounded-lg bg-amber-50 px-2.5 py-2 text-xs text-amber-950">
        Se perdió la señal GPS del repartidor. El pedido sigue en camino{reading ? ` · última lectura ${reading}` : ''}.
      </p>}
      {!courierPoint && courier?.freshness !== 'stale' && inTransit && <p role="status" className="text-xs text-slate-600">Esperando la ubicación GPS del repartidor.</p>}
    </div>
  </section>;
}
