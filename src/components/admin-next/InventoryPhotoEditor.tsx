import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { CircleAlert, X } from 'lucide-react';
import { ProductImage } from '../common/ProductImage';
import {
  AdminRequestError, boltAdmin, type InventoryItem, type InventoryPhotoSources, type InventoryPhotoTarget, type InventoryPhotoUpdate,
} from './adminClient';
import './priceManagement.css';

const acceptedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const maxPhotoBytes = 5 * 1024 * 1024;

type Props = {
  item: InventoryItem;
  token: string | null;
  save: (update: InventoryPhotoUpdate) => Promise<void>;
  close: () => void;
};

export function InventoryPhotoEditor({ item, token, save, close }: Props) {
  const headingId = useId();
  const fileHintId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const reader = useRef<FileReader | null>(null);
  const saving = useRef(false);
  const [photo, setPhoto] = useState<InventoryPhotoSources | null>(null);
  const [target, setTarget] = useState<InventoryPhotoTarget>('product');
  const [attempt, setAttempt] = useState(0);
  const [loadError, setLoadError] = useState('');
  const [fileError, setFileError] = useState('');
  const [saveError, setSaveError] = useState('');
  const [stale, setStale] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [draft, setDraft] = useState<{ dataUrl: string; filename: string } | null>(null);
  const { productId, variantId } = item;

  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
    heading.current?.scrollIntoView({ block: 'nearest' });
    return () => reader.current?.abort();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void boltAdmin.inventoryPhoto(token, productId, variantId, controller.signal).then(sources => {
      if (controller.signal.aborted) return;
      setTarget(sources.variantImage === null ? 'product' : 'variant');
      setPhoto(sources);
    }).catch(failure => {
      if (!controller.signal.aborted) setLoadError(failure instanceof Error ? failure.message : 'No pudimos consultar las fotos.');
    });
    return () => controller.abort();
  }, [token, productId, variantId, attempt]);

  function reload() {
    setPhoto(null);
    setLoadError('');
    setFileError('');
    setSaveError('');
    setStale(false);
    setDraft(null);
    setAttempt(value => value + 1);
  }

  function selectFile(file?: File) {
    reader.current?.abort();
    reader.current = null;
    setFileError('');
    setSaveError('');
    setDraft(null);
    if (!file) return;
    if (!acceptedTypes.includes(file.type)) {
      setFileError('Elige una imagen JPEG, PNG, WebP o GIF.');
      return;
    }
    if (file.size === 0 || file.size > maxPhotoBytes) {
      setFileError('El archivo debe contener una imagen y pesar máximo 5 MiB.');
      return;
    }
    const next = new FileReader();
    reader.current = next;
    next.onload = () => {
      if (reader.current !== next) return;
      if (typeof next.result === 'string') setDraft({ dataUrl: next.result, filename: file.name });
    };
    next.onerror = () => {
      if (reader.current === next) setFileError('No pudimos leer el archivo. Elige otra imagen.');
    };
    next.readAsDataURL(file);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!photo || !draft || stale || saving.current || fileError) return;
    const expectedImage = target === 'product' ? photo.productImage : photo.variantImage;
    if (expectedImage === null) return;
    saving.current = true;
    setIsSaving(true);
    setSaveError('');
    try {
      await save({ productId, variantId, target, expectedImage, ...draft });
    } catch (failure) {
      if (failure instanceof AdminRequestError && failure.status === 409) {
        setStale(true);
        setSaveError('La foto cambió mientras editabas. Carga las fotos vigentes para continuar.');
      } else {
        setSaveError(failure instanceof Error ? failure.message : 'No pudimos guardar la foto.');
      }
    } finally {
      saving.current = false;
      setIsSaving(false);
    }
  }

  const currentImage = target === 'variant' ? photo?.variantImage || item.image : photo?.productImage;
  return <section className="ba-panel ba-price-editor" aria-labelledby={headingId}>
    <div className="ba-panel-head">
      <div>
        <h2 ref={heading} tabIndex={-1} id={headingId}>Editar foto</h2>
        <p>{item.name}{item.presentation ? ` · ${item.presentation}` : ''}</p>
      </div>
      <button type="button" className="ba-icon-btn" aria-label="Cerrar editor de foto" disabled={isSaving} onClick={close}>
        <X size={18} aria-hidden="true" />
      </button>
    </div>
    <form className="ba-price-form" onSubmit={event => void submit(event)}>
      {!photo && !loadError && <p className="ba-price-scope" role="status">Consultando fotos…</p>}
      {photo && <fieldset className="ba-price-inputs" disabled={isSaving || stale}>
        <legend className="ba-sr">Foto que quieres cambiar</legend>
        {photo.variantImage !== null && <label className="ba-price-toggle">
          <input type="radio" name={headingId} checked={target === 'variant'} onChange={() => setTarget('variant')} />
          Foto de la presentación
        </label>}
        {photo.variantImage !== null ? <label className="ba-price-toggle">
          <input type="radio" name={headingId} checked={target === 'product'} onChange={() => setTarget('product')} />
          Foto principal del producto
        </label> : <p className="ba-photo-target">Foto principal del producto</p>}
        <p className="ba-price-scope">{target === 'product'
          ? 'La foto principal también se usa en las presentaciones que dependen de ella.'
          : 'La foto se aplica únicamente a esta presentación.'}</p>
        <div className="ba-photo-previews">
          <figure className="ba-photo-preview">
            <ProductImage className="ba-photo-image" src={currentImage} alt={item.name} />
            <figcaption>Foto actual</figcaption>
          </figure>
          {draft && !fileError && <figure className="ba-photo-preview">
            <img className="ba-photo-image" src={draft.dataUrl} alt="Foto seleccionada"
              onError={() => setFileError('No pudimos mostrar la vista previa. Elige otra imagen.')} />
            <figcaption>Vista previa</figcaption>
          </figure>}
        </div>
        <label className="ba-field">Nueva foto
          <input type="file" accept={acceptedTypes.join(',')} aria-describedby={fileHintId}
            aria-invalid={Boolean(fileError) || undefined} onChange={event => selectFile(event.currentTarget.files?.[0])} />
        </label>
        <p className="ba-price-scope" id={fileHintId}>JPEG, PNG, WebP o GIF. Máximo 5 MiB.</p>
      </fieldset>}
      {(loadError || fileError || saveError) && <p className="ba-error" role="alert">
        <CircleAlert size={16} aria-hidden="true" /> {loadError || fileError || saveError}
      </p>}
      <div className="ba-price-actions">
        {(stale || loadError) && <button type="button" className="ba-btn ba-btn-secondary" onClick={reload}>Cargar fotos vigentes</button>}
        <button className="ba-btn ba-btn-primary" type="submit" disabled={!photo || !draft || Boolean(fileError) || isSaving || stale}>
          {isSaving ? 'Guardando…' : 'Guardar foto'}
        </button>
      </div>
    </form>
  </section>;
}
