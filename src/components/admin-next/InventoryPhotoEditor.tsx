import { useEffect, useId, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { CircleAlert, X } from 'lucide-react';
import { MAX_PRODUCT_GALLERY_PHOTOS as maxGalleryPhotos } from '../../lib/productImages';
import { ProductImage } from '../common/ProductImage';
import {
  AdminRequestError, boltAdmin, type InventoryItem, type InventoryPhotoSources, type InventoryPhotoTarget,
  type InventoryPhotoUpdate, type NewInventoryPhoto,
} from './adminClient';
import './priceManagement.css';

const acceptedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const maxPhotoBytes = 5 * 1024 * 1024;

type PreviewStatus = 'pending' | 'ready' | 'invalid';
type NewPhotoDraft = { id: number; file: File; preview: PreviewStatus };
type GalleryDraft = { id: number; url: string } | NewPhotoDraft;

type Props = {
  item: InventoryItem;
  token: string | null;
  save: (update: InventoryPhotoUpdate) => Promise<void>;
  close: () => void;
};

function readPhoto(file: File): Promise<NewInventoryPhoto> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    const fail = () => reject(new Error(`No pudimos leer ${file.name}. Elige otra imagen.`));
    reader.onerror = fail;
    reader.onload = () => {
      if (typeof reader.result === 'string') resolve({ dataUrl: reader.result, filename: file.name });
      else fail();
    };
    reader.readAsDataURL(file);
  });
}

function DraftPreview({ draft, status, alt }: {
  draft: NewPhotoDraft;
  status: (value: PreviewStatus) => void;
  alt: string;
}) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    const local = URL.createObjectURL(draft.file);
    setUrl(local);
    return () => URL.revokeObjectURL(local);
  }, [draft.file]);

  return draft.preview === 'invalid'
    ? <div className="ba-photo-image ba-photo-invalid">Vista previa no disponible</div>
    : <img className="ba-photo-image" src={url || undefined} alt={alt}
        onLoad={() => status('ready')} onError={() => status('invalid')} />;
}

export function InventoryPhotoEditor({ item, token, save, close }: Props) {
  const headingId = useId();
  const fileHintId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const nextPhotoId = useRef(0);
  const saving = useRef(false);
  const [photo, setPhoto] = useState<InventoryPhotoSources | null>(null);
  const [target, setTarget] = useState<InventoryPhotoTarget>('product');
  const [attempt, setAttempt] = useState(0);
  const [loadError, setLoadError] = useState('');
  const [fileError, setFileError] = useState('');
  const [saveError, setSaveError] = useState('');
  const [stale, setStale] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [variantDraft, setVariantDraft] = useState<NewPhotoDraft | null>(null);
  const [gallery, setGallery] = useState<GalleryDraft[]>([]);
  const { productId, variantId } = item;

  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
    heading.current?.scrollIntoView({ block: 'nearest' });
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void boltAdmin.inventoryPhoto(token, productId, variantId, controller.signal).then(sources => {
      if (controller.signal.aborted) return;
      setTarget(sources.variantImage === null ? 'product' : 'variant');
      setGallery(sources.gallery.map(url => ({ id: nextPhotoId.current++, url })));
      setPhoto(sources);
    }).catch(failure => {
      if (!controller.signal.aborted) setLoadError(failure instanceof Error ? failure.message : 'No pudimos consultar las fotos.');
    });
    return () => controller.abort();
  }, [token, productId, variantId, attempt]);

  const editingGallery = target === 'product';
  const galleryChanged = photo !== null && (gallery.length !== photo.gallery.length ||
    gallery.some((entry, index) => !('url' in entry) || entry.url !== photo.gallery[index]));
  const invalidPreview = editingGallery
    ? gallery.some(entry => 'file' in entry && entry.preview === 'invalid')
    : variantDraft?.preview === 'invalid';
  const canSave = Boolean(photo && !stale && !isSaving && (editingGallery
    ? galleryChanged && gallery.length <= maxGalleryPhotos && gallery.every(entry => 'url' in entry || entry.preview === 'ready')
    : variantDraft?.preview === 'ready'));
  const error = loadError || saveError || fileError || (invalidPreview ? 'Reemplaza o quita la foto cuya vista previa no carga.' : '');

  function clearEditErrors() {
    setFileError('');
    setSaveError('');
  }

  function reload() {
    setPhoto(null);
    setLoadError('');
    clearEditErrors();
    setStale(false);
    setVariantDraft(null);
    setGallery([]);
    setAttempt(value => value + 1);
  }

  function selectFiles(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.currentTarget.files ?? []);
    event.currentTarget.value = '';
    if (!files.length) return;
    clearEditErrors();
    if (!editingGallery) setVariantDraft(null);
    if (editingGallery && gallery.length + files.length > maxGalleryPhotos) {
      setFileError(`Puedes guardar hasta ${maxGalleryPhotos} fotos por producto.`);
      return;
    }
    for (const file of files) {
      if (!acceptedTypes.includes(file.type)) {
        setFileError(`${file.name}: elige una imagen JPEG, PNG, WebP o GIF.`);
        return;
      }
      if (file.size === 0 || file.size > maxPhotoBytes) {
        setFileError(`${file.name}: el archivo debe contener una imagen y pesar máximo 5 MiB.`);
        return;
      }
    }
    const drafts = files.map((file): NewPhotoDraft => ({ id: nextPhotoId.current++, file, preview: 'pending' }));
    if (editingGallery) setGallery(current => [...current, ...drafts]);
    else setVariantDraft(drafts[0]);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!photo || !canSave || saving.current) return;
    saving.current = true;
    setIsSaving(true);
    clearEditErrors();
    try {
      if (editingGallery) {
        const photos = await Promise.all(gallery.map(entry => 'url' in entry ? { url: entry.url } : readPhoto(entry.file)));
        await save({ productId, variantId, target, expectedImage: photo.productImage, expectedGallery: photo.gallery, photos });
      } else if (variantDraft && photo.variantImage !== null) {
        const upload = await readPhoto(variantDraft.file);
        await save({ productId, variantId, target, expectedImage: photo.variantImage, ...upload });
      }
    } catch (failure) {
      if (failure instanceof AdminRequestError && failure.status === 409) {
        setStale(true);
        setSaveError('Las fotos cambiaron mientras editabas. Carga las fotos vigentes para continuar.');
      } else {
        setSaveError(failure instanceof Error ? failure.message : 'No pudimos guardar las fotos.');
      }
    } finally {
      saving.current = false;
      setIsSaving(false);
    }
  }

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
        <legend className="ba-sr">Fotos que quieres cambiar</legend>
        {photo.variantImage !== null && <label className="ba-price-toggle">
          <input type="radio" name={headingId} checked={!editingGallery}
            onChange={() => { setTarget('variant'); clearEditErrors(); }} />
          Foto de la presentación
        </label>}
        {photo.variantImage !== null ? <label className="ba-price-toggle">
          <input type="radio" name={headingId} checked={editingGallery}
            onChange={() => { setTarget('product'); clearEditErrors(); }} />
          Galería del producto
        </label> : <p className="ba-photo-target">Galería del producto</p>}
        {editingGallery ? <>
          <p className="ba-price-scope">La primera foto es la principal. Las fotos propias de cada presentación se conservan.</p>
          <p className="ba-photo-target" aria-live="polite">{gallery.length} de {maxGalleryPhotos} fotos</p>
          {gallery.length === 0 && <p className="ba-price-scope">Sin fotos del producto.</p>}
          <div className="ba-photo-previews">
            {gallery.map((entry, index) => {
              const label = index === 0 ? 'Foto principal' : `Foto ${index + 1}`;
              return <figure className="ba-photo-preview ba-photo-card" key={entry.id}>
                {'url' in entry
                  ? <ProductImage className="ba-photo-image" src={entry.url} alt={label} />
                  : <DraftPreview draft={entry} alt={label} status={preview => setGallery(current =>
                    current.map(candidate => candidate.id === entry.id && 'file' in candidate && candidate.preview !== preview
                      ? { ...candidate, preview } : candidate))} />}
                <figcaption>{label}</figcaption>
                <div className="ba-photo-card-actions">
                  {index > 0 && <button type="button" className="ba-btn ba-btn-secondary ba-photo-card-button" aria-label={`Hacer principal la foto ${index + 1}`}
                    onClick={() => {
                      setGallery(current => {
                        const selected = current.find(photo => photo.id === entry.id);
                        return selected ? [selected, ...current.filter(photo => photo.id !== selected.id)] : current;
                      });
                      clearEditErrors();
                    }}>
                    Hacer principal
                  </button>}
                  <button type="button" className="ba-btn ba-btn-secondary ba-photo-card-button" aria-label={`Quitar ${label.toLowerCase()}`}
                    onClick={() => { setGallery(current => current.filter(photo => photo.id !== entry.id)); clearEditErrors(); }}>
                    Quitar
                  </button>
                </div>
              </figure>;
            })}
          </div>
        </> : <>
          <p className="ba-price-scope">La foto se aplica únicamente a esta presentación.</p>
          <div className="ba-photo-previews">
            <figure className="ba-photo-preview">
              <ProductImage className="ba-photo-image" src={photo.variantImage || item.image} alt={item.name} />
              <figcaption>Foto actual</figcaption>
            </figure>
            {variantDraft && <figure className="ba-photo-preview">
              <DraftPreview key={variantDraft.id} draft={variantDraft} alt="Foto seleccionada" status={preview =>
                setVariantDraft(current => current?.id === variantDraft.id && current.preview !== preview ? { ...current, preview } : current)} />
              <figcaption>Vista previa</figcaption>
            </figure>}
          </div>
        </>}
        <label className="ba-field">{editingGallery ? 'Agregar fotos' : 'Nueva foto'}
          <input key={target} type="file" accept={acceptedTypes.join(',')} multiple={editingGallery}
            disabled={editingGallery && gallery.length >= maxGalleryPhotos} aria-describedby={fileHintId}
            aria-invalid={Boolean(fileError || invalidPreview) || undefined} onChange={selectFiles} />
        </label>
        <p className="ba-price-scope" id={fileHintId}>JPEG, PNG, WebP o GIF. Máximo 5 MiB por foto.</p>
      </fieldset>}
      {error && <p className="ba-error" role="alert"><CircleAlert size={16} aria-hidden="true" /> {error}</p>}
      <div className="ba-price-actions">
        {(stale || loadError) && <button type="button" className="ba-btn ba-btn-secondary" onClick={reload}>Cargar fotos vigentes</button>}
        <button className="ba-btn ba-btn-primary" type="submit" disabled={!canSave}>
          {isSaving ? 'Guardando…' : editingGallery ? 'Guardar galería' : 'Guardar foto'}
        </button>
      </div>
    </form>
  </section>;
}
