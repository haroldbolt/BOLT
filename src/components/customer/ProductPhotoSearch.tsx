import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Camera, ChevronRight, ImagePlus, LoaderCircle, Search, X } from 'lucide-react';
import type { Product } from '../../types';
import { prepareEntrancePhoto } from '../../lib/entrancePhotos';
import { resolvePhotoMatches, searchCatalogPhoto, type PhotoSearchResponse } from '../../lib/photoSearchClient';
import { ProductImage } from '../common/ProductImage';

type Props = {
  products: Product[];
  onClose: () => void;
  onOpenProduct: (product: Product) => void;
  onSearchByText: () => void;
};

type CameraRect = Pick<DOMRectReadOnly, 'left' | 'top' | 'width' | 'height'>;

export function getCameraCrop(width: number, height: number, preview: CameraRect, frame: CameraRect) {
  const scale = Math.max(preview.width / width, preview.height / height);
  return {
    x: (width - preview.width / scale) / 2 + (frame.left - preview.left) / scale,
    y: (height - preview.height / scale) / 2 + (frame.top - preview.top) / scale,
    width: frame.width / scale,
    height: frame.height / scale,
  };
}

async function captureCameraPhoto(video: HTMLVideoElement, frame: HTMLElement): Promise<Blob> {
  if (video.readyState < 2 || !video.videoWidth || !video.videoHeight) {
    throw Error('Espera a que se vea el producto en la cámara.');
  }
  const crop = getCameraCrop(video.videoWidth, video.videoHeight, video.getBoundingClientRect(), frame.getBoundingClientRect());
  const scale = Math.min(1, 1280 / Math.max(crop.width, crop.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(crop.width * scale);
  canvas.height = Math.round(crop.height * scale);
  const context = canvas.getContext('2d');
  if (!context || !canvas.width || !canvas.height) throw Error('No pudimos preparar la foto.');
  context.drawImage(video, crop.x, crop.y, crop.width, crop.height, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => blob && blob.type === 'image/jpeg' && blob.size
      ? resolve(blob)
      : reject(Error('No pudimos preparar la foto. Intenta otra vez.')), 'image/jpeg', 0.86);
  });
}

export function ProductPhotoSearch({ products, onClose, onOpenProduct, onSearchByText }: Props) {
  const titleId = useId();
  const instructionsId = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const camera = useRef<HTMLInputElement>(null);
  const gallery = useRef<HTMLInputElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const cameraRequest = useRef(0);
  const stream = useRef<MediaStream | null>(null);
  const capturing = useRef(false);
  const current = useRef<AbortController | null>(null);
  const [cameraStatus, setCameraStatus] = useState<'opening' | 'preview' | 'unavailable' | null>(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [isCapturing, setIsCapturing] = useState(false);
  const [phase, setPhase] = useState<'preparing' | 'searching' | null>(null);
  const [photo, setPhoto] = useState<Blob | null>(null);
  const [preview, setPreview] = useState('');
  const [error, setError] = useState('');
  const [result, setResult] = useState<PhotoSearchResponse | null>(null);

  const releaseCamera = useCallback(() => {
    cameraRequest.current++;
    stream.current?.getTracks().forEach(track => track.stop());
    stream.current = null;
    capturing.current = false;
  }, []);

  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => {
      current.current?.abort();
      current.current = null;
      releaseCamera();
      element?.close();
    };
  }, [releaseCamera]);

  useEffect(() => {
    const element = video.current;
    const activeStream = stream.current;
    if (cameraStatus !== 'preview' || !element || !activeStream) return;
    const videoTrack = activeStream.getVideoTracks()[0];
    const cameraUnavailable = () => {
      if (stream.current !== activeStream) return;
      releaseCamera();
      setCameraStatus('unavailable');
    };
    videoTrack?.addEventListener('ended', cameraUnavailable);
    element.addEventListener('error', cameraUnavailable);
    element.srcObject = activeStream;
    void element.play().catch(cameraUnavailable);
    return () => {
      videoTrack?.removeEventListener('ended', cameraUnavailable);
      element.removeEventListener('error', cameraUnavailable);
      element.srcObject = null;
    };
  }, [cameraStatus, releaseCamera]);

  useEffect(() => {
    if (!photo) {
      setPreview('');
      return;
    }
    const url = URL.createObjectURL(photo);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [photo]);

  const close = useCallback(() => {
    current.current?.abort();
    current.current = null;
    releaseCamera();
    dialog.current?.close();
    onClose();
  }, [onClose, releaseCamera]);

  const openProduct = useCallback((product: Product) => {
    if (!dialog.current?.open) return;
    close();
    onOpenProduct(product);
  }, [close, onOpenProduct]);

  const matches = result ? resolvePhotoMatches(result, products) : null;
  const automatic = matches?.automatic;
  useEffect(() => {
    if (automatic) openProduct(automatic);
  }, [automatic, openProduct]);

  async function analyze(input: File | Blob, alreadyPrepared = false) {
    current.current?.abort();
    const request = new AbortController();
    current.current = request;
    setResult(null);
    setError('');
    setPhase(alreadyPrepared ? 'searching' : 'preparing');
    if (!alreadyPrepared) setPhoto(null);
    let timeout: ReturnType<typeof setTimeout> | undefined;

    try {
      // Reuse BOLT's JPEG compression and metadata removal without persisting the photo.
      const prepared = alreadyPrepared ? input : await prepareEntrancePhoto(input as File);
      if (current.current !== request) return;
      if (prepared.size > 1024 * 1024) throw Error('La foto es demasiado grande. Toma una nueva o elige otra.');
      setPhoto(prepared);
      setPhase('searching');
      timeout = setTimeout(() => request.abort(), 15_000);
      const response = await searchCatalogPhoto(prepared, request.signal);
      if (current.current !== request) return;
      if (request.signal.aborted) throw Error('La búsqueda tardó demasiado.');
      setResult(response);
    } catch (failure) {
      if (current.current !== request) return;
      setError(request.signal.aborted
        ? 'La búsqueda tardó demasiado. Intenta otra vez o busca por nombre.'
        : failure instanceof Error && !(failure instanceof TypeError)
          ? failure.message
          : 'No pudimos conectar con BOLT. Revisa tu conexión o busca por nombre.');
    } finally {
      clearTimeout(timeout);
      if (current.current === request) {
        current.current = null;
        setPhase(null);
      }
    }
  }

  function chooseFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file) void analyze(file);
  }

  function stopCamera() {
    releaseCamera();
    setCameraStatus(null);
    setCameraReady(false);
    setIsCapturing(false);
    setError('');
  }

  async function startCamera() {
    if (!navigator.mediaDevices?.getUserMedia) {
      camera.current?.click();
      return;
    }
    stopCamera();
    current.current?.abort();
    current.current = null;
    setPhase(null);
    setPhoto(null);
    setResult(null);
    setCameraStatus('opening');

    const attempt = cameraRequest.current;
    try {
      const newStream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
      });
      if (cameraRequest.current !== attempt) {
        newStream.getTracks().forEach(track => track.stop());
        return;
      }
      stream.current = newStream;
      setCameraStatus('preview');
    } catch {
      if (cameraRequest.current === attempt) setCameraStatus('unavailable');
    }
  }

  async function takeCameraPhoto() {
    if (!video.current || !frame.current || !cameraReady || capturing.current) return;
    const attempt = cameraRequest.current;
    capturing.current = true;
    setIsCapturing(true);
    setError('');
    try {
      const jpeg = await captureCameraPhoto(video.current, frame.current);
      if (cameraRequest.current !== attempt) return;
      stopCamera();
      void analyze(jpeg, true);
    } catch (failure) {
      if (cameraRequest.current !== attempt) return;
      setError(failure instanceof Error ? failure.message : 'No pudimos preparar la foto. Intenta otra vez.');
      capturing.current = false;
      setIsCapturing(false);
    }
  }

  return (
    <dialog
      ref={dialog}
      aria-labelledby={titleId}
      aria-describedby={instructionsId}
      onCancel={event => { event.preventDefault(); close(); }}
      className="fixed inset-x-0 bottom-0 top-auto m-0 max-h-[calc(100dvh-1rem)] w-full max-w-none overflow-y-auto rounded-t-3xl border-0 bg-white text-slate-900 shadow-2xl backdrop:bg-slate-950/60 sm:inset-0 sm:m-auto sm:max-h-[88dvh] sm:max-w-md sm:rounded-3xl"
    >
      <div className="space-y-4 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:p-6">
        <header className="flex items-center gap-3">
          <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-red-50 text-red-700">
            <Camera size={21} aria-hidden="true" />
          </span>
          <h2 id={titleId} className="flex-1 text-xl font-black tracking-tight">Buscar por foto</h2>
          <button type="button" onClick={close} aria-label="Cerrar búsqueda por foto"
            className="grid size-11 shrink-0 place-items-center rounded-full bg-slate-100 text-slate-700 hover:bg-slate-200 focus-visible:outline-2 focus-visible:outline-red-600">
            <X size={21} aria-hidden="true" />
          </button>
        </header>

        <input ref={camera} type="file" accept="image/*" capture="environment" onChange={chooseFile} hidden />
        <input ref={gallery} type="file" accept="image/*" onChange={chooseFile} hidden />

        {cameraStatus ? (
          <>
            <p id={instructionsId} className="text-sm leading-relaxed text-slate-600">
              Acerca el empaque hasta llenar el marco. Deja visibles la marca y el nombre.
            </p>
            {cameraStatus === 'preview' && (
              <div className="relative mx-auto aspect-[3/4] max-h-[48dvh] w-full max-w-72 overflow-hidden rounded-2xl bg-slate-950">
                <video ref={video} autoPlay playsInline muted onPlaying={() => setCameraReady(true)}
                  aria-label="Vista previa de la cámara" className="absolute inset-0 h-full w-full object-cover" />
                <div ref={frame} aria-hidden="true" className="pointer-events-none absolute inset-[9%] rounded-xl border-2 border-white shadow-[0_0_0_999px_rgba(0,0,0,0.35)]" />
              </div>
            )}
            {cameraStatus === 'opening' && <p role="status" className="text-sm text-slate-700">Permite el acceso a la cámara para ver el empaque.</p>}
            {cameraStatus === 'preview' && !cameraReady && <p role="status" className="text-sm text-slate-700">Preparando la vista de la cámara…</p>}
            {cameraStatus === 'unavailable' && <p role="alert" className="text-sm text-amber-950">No pudimos abrir la cámara en BOLT. Puedes usar la cámara del teléfono o subir una foto.</p>}
            <div className="flex flex-wrap items-center gap-2">
              {cameraStatus === 'preview' ? (
                <button type="button" disabled={!cameraReady || isCapturing} onClick={() => void takeCameraPhoto()}
                  className="flex min-h-12 flex-1 items-center justify-center gap-2 rounded-xl bg-red-600 px-3 text-sm font-bold text-white hover:bg-red-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-600 disabled:opacity-50">
                  <Camera className="size-4 shrink-0" aria-hidden="true" /> {isCapturing ? 'Preparando…' : 'Capturar'}
                </button>
              ) : (
                <button type="button" onClick={() => { stopCamera(); camera.current?.click(); }}
                  className="min-h-12 flex-1 rounded-xl bg-red-600 px-3 text-sm font-bold text-white hover:bg-red-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-600">
                  Usar cámara del teléfono
                </button>
              )}
              <button type="button" onClick={stopCamera}
                className="min-h-12 flex-1 rounded-xl border border-slate-200 px-3 text-sm font-bold text-slate-800 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-600">
                Cancelar cámara
              </button>
            </div>
            {cameraStatus === 'preview' && !cameraReady && (
              <button type="button" onClick={() => { stopCamera(); camera.current?.click(); }}
                className="min-h-11 text-sm font-bold text-slate-700 underline">
                Usar cámara del teléfono
              </button>
            )}
          </>
        ) : (
          <>
            <p id={instructionsId} className="text-sm leading-relaxed text-slate-600">
              Enfoca el frente del empaque para que se lean la marca y el nombre. Evita incluir personas o documentos.
            </p>

            {preview && <img src={preview} alt="Foto del empaque que elegiste" className="h-36 w-full rounded-2xl bg-slate-50 object-contain" />}

            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={() => void startCamera()}
                className="flex min-h-12 items-center justify-center gap-2 rounded-xl bg-red-600 px-2 py-2.5 text-center text-sm font-bold text-white hover:bg-red-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-600">
                <Camera className="size-4 shrink-0" aria-hidden="true" /> Tomar foto
              </button>
              <button type="button" onClick={() => gallery.current?.click()}
                className="flex min-h-12 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-2 py-2.5 text-center text-sm font-bold text-slate-800 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-red-600">
                <ImagePlus className="size-4 shrink-0" aria-hidden="true" /> Subir foto
              </button>
            </div>
          </>
        )}

        <div role="status" aria-live="polite" className="empty:hidden">
          {phase && <p className="flex items-center gap-2 rounded-xl bg-slate-50 p-3 text-sm font-semibold text-slate-700">
            <LoaderCircle className="size-4 motion-safe:animate-spin" aria-hidden="true" />
            {phase === 'preparing' ? 'Preparando tu foto…' : 'Buscando el producto en BOLT…'}
          </p>}
          {!phase && matches && !automatic && <p className="text-sm font-bold text-slate-800">
            {matches.candidates.length ? 'Elige el producto de tu foto' : 'No encontramos una coincidencia. Prueba con otra foto o busca por nombre.'}
          </p>}
        </div>

        {error && <div role="alert" className="rounded-xl bg-amber-50 p-3 text-sm text-amber-950">
          <p>{error}</p>
          {photo && <button type="button" className="min-h-11 font-bold underline" onClick={() => void analyze(photo, true)}>Reintentar con esta foto</button>}
        </div>}

        {!automatic && !!matches?.candidates.length && <ul className="space-y-2">
          {matches.candidates.map(product => <li key={product.id}>
            <button type="button" onClick={() => openProduct(product)}
              className="flex w-full items-center gap-3 rounded-2xl border border-slate-200 p-2 text-left hover:bg-red-50 focus-visible:outline-2 focus-visible:outline-red-600">
              <ProductImage src={product.image} alt="" className="size-14 shrink-0 rounded-xl object-contain" />
              <span className="min-w-0 flex-1">
                <span className="block text-xs text-slate-600">{product.brand}</span>
                <span className="block text-sm font-extrabold">{product.name}</span>
              </span>
              <ChevronRight className="size-5 shrink-0 text-red-600" aria-hidden="true" />
            </button>
          </li>)}
        </ul>}

        <button type="button" onClick={() => { close(); onSearchByText(); }}
          className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl text-sm font-bold text-slate-700 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-red-600">
          <Search size={16} aria-hidden="true" /> Buscar por nombre
        </button>
      </div>
    </dialog>
  );
}
