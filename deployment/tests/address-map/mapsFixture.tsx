import React from 'react';
import fixtures from '../../../src/tests/coverage-address-fixtures.json';

// The production modal supplies all three handlers. Only Google's canvas layer is substituted.
export const APIProvider = ({ children }: React.PropsWithChildren) => <>{children}</>;
export const useMap = () => null;
export const useApiLoadingStatus = () => 'LOADED';
export const APILoadingStatus = { LOADED: 'LOADED', FAILED: 'FAILED', AUTH_FAILURE: 'AUTH_FAILURE' };

const point = (name: string) => fixtures.find(f => f.name === name)!.coordinates;
type Coordinates = ReturnType<typeof point>;

export function Map({ children, onClick }: React.PropsWithChildren<{
  onClick: (event: { detail: { latLng: Coordinates } }) => void;
}>) {
  return <div>
    <button data-test="map-click" onClick={() => onClick({ detail: { latLng: point('Chapinero') } })}>
      Seleccionar punto de Chapinero
    </button>
    <button data-test="map-chia" onClick={() => onClick({ detail: { latLng: point('Chia') } })}>
      Seleccionar punto de Chía
    </button>
    {children}
  </div>;
}

export function AdvancedMarker({ children, position, draggable, onDragEnd }: React.PropsWithChildren<{
  position: Coordinates;
  draggable?: boolean;
  onDragEnd: (event: { latLng: { lat: () => number; lng: () => number } }) => void;
}>) {
  if (!draggable) return null;
  const { lat, lng } = point('Suba');
  return <button data-test="marker" data-lat={position.lat} data-lng={position.lng}
    onClick={() => onDragEnd({ latLng: { lat: () => lat, lng: () => lng } })}>
    {children}
  </button>;
}
