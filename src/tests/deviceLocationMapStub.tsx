// Browser review only: do not contact an external map provider with test coordinates.
import React from 'react';
export const APIProvider = ({children}:any) => <>{children}</>;
export const Map = ({children}:any) => <div className="p-5 text-sm text-slate-500">Mapa omitido en esta simulación. Coordenadas de fixtures verificables.{children}</div>;
export const AdvancedMarker = () => null;
export const useMap = () => null;
