/// <reference types="google.maps" />
import React, {useCallback, useEffect, useRef, useState} from 'react';
import {AdvancedMarker, Map, Marker, useMap} from '@vis.gl/react-google-maps';
import {MapPin} from 'lucide-react';
import {validDestinationCoordinates} from '../../lib/addressGeography';
import type {LatLng} from '../../lib/deliveryService';
import type {Store} from '../../types';

const overview = {lat: 4.711, lng: -74.0721};
const streetZoom = 17;
const mapId = import.meta.env?.VITE_GOOGLE_MAPS_ADDRESS_MAP_ID?.trim() || undefined;

function FollowDestination({point}: {point: LatLng | null}) {
  const map = useMap();
  const hadPoint = useRef(false);
  useEffect(() => {
    if (!map) return;
    if (point) {
      if (!hadPoint.current && (map.getZoom() ?? 0) < streetZoom) map.setZoom(streetZoom);
      map.panTo(point);
    }
    hadPoint.current = !!point;
  }, [map, point]);
  return null;
}

type Props = {
  point: LatLng | null;
  stores: Store[];
  label: string;
  onSelect: (point: LatLng) => void;
};

function StreetMapSession({point, stores, label, onSelect, onPaint}: Props & {onPaint: () => void}) {
  const [status, setStatus] = useState<'loading' | 'slow' | 'ready'>('loading');
  const [attempt, setAttempt] = useState(0);
  const readyMap = useRef<google.maps.Map | null>(null);
  useEffect(() => {
    if (status !== 'loading') return;
    const timer = window.setTimeout(() => setStatus('slow'), 12_000);
    return () => window.clearTimeout(timer);
  }, [status, attempt]);

  const onTilesLoaded = useCallback(({map}: {map: google.maps.Map}) => {
    const frame = map.getDiv();
    if (document.hidden || !frame.clientWidth || !frame.clientHeight || !map.getProjection() || !map.getBounds()) return;
    readyMap.current = map;
    onPaint();
    setStatus('ready');
  }, [onPaint]);

  const selectVisiblePoint = (candidate: LatLng | null | undefined) => {
    if (document.hidden || !validDestinationCoordinates(candidate) || !readyMap.current?.getBounds()?.contains(candidate)) return;
    onSelect({lat: Number(candidate.lat.toFixed(6)), lng: Number(candidate.lng.toFixed(6))});
  };
  const onDragEnd = (event: google.maps.MapMouseEvent) => selectVisiblePoint(event.latLng && {lat: event.latLng.lat(), lng: event.latLng.lng()});
  const pinProps = {position: point ?? overview, title: 'Punto de entrega de tu pedido', draggable: status === 'ready', onDragEnd, zIndex: 10};

  return <>
    <Map key={attempt} defaultCenter={point ?? overview} defaultZoom={point ? streetZoom : 11}
      mapId={mapId} renderingType="RASTER" mapTypeId="roadmap"
      style={{position: 'absolute', inset: 0}} clickableIcons={false} gestureHandling="greedy"
      disableDefaultUI zoomControl onTilesLoaded={onTilesLoaded}
      onClick={event => selectVisiblePoint(event.detail.latLng)}>
      <FollowDestination point={point}/>
      {point && (mapId
        ? <AdvancedMarker {...pinProps}>
            <div className="flex flex-col items-center cursor-grab active:cursor-grabbing">
              <span className="rounded-full border-2 border-white bg-red-600 p-2 text-white shadow-md"><MapPin className="size-5"/></span>
              <span className="whitespace-nowrap rounded-full bg-slate-900 px-2 py-0.5 text-[9px] font-bold text-white">{label}</span>
            </div>
          </AdvancedMarker>
        : <Marker {...pinProps} optimized={false}/>)}
      {stores.filter(store => store.isActive && store.turboEnabled).map(store => mapId
        ? <AdvancedMarker key={store.id} position={store.coordinates} title={`Sede Bolt Pets: ${store.name}`}>
            <span className="whitespace-nowrap rounded-lg border border-white bg-yellow-400 px-1 text-[10px] font-bold text-slate-900">⚡ {store.name}</span>
          </AdvancedMarker>
        : <Marker key={store.id} position={store.coordinates} title={`Sede Bolt Pets: ${store.name}`} label="B" clickable={false}/>)}
    </Map>
    {status !== 'ready' && <div role="status" className="absolute inset-0 grid place-content-center gap-2 bg-slate-50 px-5 text-center text-sm text-slate-700">
      {status === 'loading' ? 'Cargando las calles…' : <>
        <p>Las calles aún no cargaron. Puedes volver a intentar o escribir la dirección.</p>
        <button type="button" className="mx-auto rounded-lg px-4 py-2 font-semibold text-red-700 underline"
          onClick={() => {readyMap.current = null; setStatus('loading'); setAttempt(value => value + 1);}}>Reintentar mapa</button>
      </>}
    </div>}
  </>;
}

export function AddressStreetMap(props: Props) {
  const frame = useRef<HTMLDivElement>(null);
  const [canMount, setCanMount] = useState(false);
  const painted = useRef(false);
  const onPaint = useCallback(() => {painted.current = true;}, []);
  useEffect(() => {
    const element = frame.current;
    if (!element) return;
    const measure = () => {
      // An initialized map can resume in place. Recreate only an unfinished surface
      // when Safari suspends it or the form loses its layout.
      if (document.hidden && painted.current) return;
      const drawable = !document.hidden && element.clientWidth > 0 && element.clientHeight > 0;
      if (!drawable) painted.current = false;
      setCanMount(drawable);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    document.addEventListener('visibilitychange', measure);
    window.addEventListener('pageshow', measure);
    measure();
    return () => {
      observer.disconnect();
      document.removeEventListener('visibilitychange', measure);
      window.removeEventListener('pageshow', measure);
    };
  }, []);
  return <div ref={frame} data-address-map-frame className="absolute inset-0">
    {canMount ? <StreetMapSession {...props} onPaint={onPaint}/> : <p role="status" className="p-4 text-sm text-slate-600">Esperando a que el mapa esté visible…</p>}
  </div>;
}
