import React, {createContext, useContext, useRef} from 'react';
import fixtures from '../../../src/tests/coverage-address-fixtures.json';

// The modal owns projection readiness, user input and geocoding. Only the Maps SDK is replaced.
export const APIProvider = ({ children }: React.PropsWithChildren) => <>{children}</>;
export const useApiLoadingStatus = () => 'LOADED';
export const APILoadingStatus = { LOADED: 'LOADED', FAILED: 'FAILED', AUTH_FAILURE: 'AUTH_FAILURE' };

const point = (name: string) => fixtures.find(f => f.name === name)!.coordinates;
type Coordinates = ReturnType<typeof point>;

function createMapFixture(center: Coordinates, zoom: number) {
  const div = document.createElement('div');
  // The fixture's shell has no Tailwind build. Expose a laid-out canvas in the test document.
  div.style.width = '350px';
  div.style.height = '224px';
  const asLatLng = (p: Coordinates) => ({lat: () => p.lat, lng: () => p.lng, toJSON: () => p});
  return {
    getDiv: () => div,
    getBounds: () => ({
      contains: (p: Coordinates | ReturnType<typeof asLatLng>) => {
        const coords = 'toJSON' in p ? p.toJSON() : p;
        return coords.lat >= 4 && coords.lat <= 6 && coords.lng >= -75 && coords.lng <= -73;
      },
      getNorthEast: () => asLatLng({lat: 6, lng: -73}),
      getSouthWest: () => asLatLng({lat: 4, lng: -75}),
    }),
    getProjection: () => ({}),
    getCenter: () => asLatLng(center),
    getZoom: () => zoom,
    setCenter: (p: Coordinates) => { center = p; },
    panTo: (p: Coordinates) => { center = p; },
    setZoom: (z: number) => { zoom = z; },
  };
}
type MapInstance = ReturnType<typeof createMapFixture>;
const MapContext = createContext<MapInstance | null>(null);
export const useMap = () => useContext(MapContext);

export function Map({ children, renderingType, defaultCenter, defaultZoom, onTilesLoaded, onClick }: React.PropsWithChildren<{
  renderingType?: string;
  defaultCenter: Coordinates;
  defaultZoom: number;
  onTilesLoaded?: (event: {map: MapInstance}) => void;
  onClick?: (event: {map: MapInstance; detail: {latLng: Coordinates}}) => void;
}>) {
  const mapRef = useRef<MapInstance | null>(null);
  if (!mapRef.current) mapRef.current = createMapFixture(defaultCenter, defaultZoom);
  const map = mapRef.current;
  const click = (coords: Coordinates) => onClick?.({map, detail: {latLng: coords}});
  return <MapContext.Provider value={map}><div data-test="map-surface" data-rendering={renderingType}>
    <div ref={element => { if (element) element.appendChild(map.getDiv()); }} />
    <button data-test="map-tiles" onClick={() => onTilesLoaded?.({map})}>Completar carga de las calles</button>
    <button data-test="map-click" onClick={() => click(point('Chapinero'))}>Seleccionar punto de Chapinero</button>
    <button data-test="map-chia" onClick={() => click(point('Chia'))}>Seleccionar punto de Chía</button>
    <button data-test="map-invalid-projection" onClick={() => click({lat: 85.0511, lng: -180})}>Emitir punto fuera del mapa</button>
    {children}
  </div></MapContext.Provider>;
}

export function AdvancedMarker({ children, position, draggable, onDragEnd }: React.PropsWithChildren<{
  position: Coordinates;
  draggable?: boolean;
  onDragEnd?: (event: {latLng: {lat: () => number; lng: () => number}}) => void;
}>) {
  const { lat, lng } = point('Suba');
  const isDestination = draggable || !!onDragEnd;
  if (!isDestination) return null;
  return <button data-test="marker" data-lat={position.lat} data-lng={position.lng}
    onClick={() => draggable && onDragEnd?.({latLng: {lat: () => lat, lng: () => lng}})}>
    {children}
  </button>;
}
export const Marker = AdvancedMarker;
