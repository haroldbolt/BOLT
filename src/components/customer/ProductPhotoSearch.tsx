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

export function ProductPhotoSearch({ products, onClose, onOpenProduct, onSearchByText }: Props) {
  const titleId = useId();
  const instructionsId = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const camera = useRef<HTMLInputElement>(null);
  const gallery = useRef<HTMLInputElement>(null);
  const current = useRef<AbortController | null>(null);
  const [phase, setPhase] = useState<'preparing' | 'searching' | null>(null);
  const [photo, setPhoto] = useState<Blob | null>(null);
  const [preview, setPreview] = useState('');
  const [error, setError] = useState('');
  const [result, setResult] = useState<PhotoSearchResponse | null>(null);

  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => {
      current.current?.abort();
      current.current = null;
      element?.close();
    };
  }, []);

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
    dialog.current?.close();
    onClose();
  }, [onClose]);

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

        <p id={instructionsId} className="text-sm leading-relaxed text-slate-600">
          Enfoca el frente del empaque para que se lean la marca y el nombre. Evita incluir personas o documentos.
        </p>

        {preview && <img src={preview} alt="Foto del empaque que elegiste" className="h-36 w-full rounded-2xl bg-slate-50 object-contain" />}

        <input ref={camera} type="file" accept="image/*" capture="environment" onChange={chooseFile} hidden />
        <input ref={gallery} type="file" accept="image/*" onChange={chooseFile} hidden />
        <div className="grid grid-cols-2 gap-2">
          <button type="button" onClick={() => camera.current?.click()}
            className="flex min-h-12 items-center justify-center gap-2 rounded-xl bg-red-600 px-2 py-2.5 text-center text-sm font-bold text-white hover:bg-red-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-600">
            <Camera className="size-4 shrink-0" aria-hidden="true" /> Tomar foto
          </button>
          <button type="button" onClick={() => gallery.current?.click()}
            className="flex min-h-12 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-2 py-2.5 text-center text-sm font-bold text-slate-800 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-red-600">
            <ImagePlus className="size-4 shrink-0" aria-hidden="true" /> Subir foto
          </button>
        </div>

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
