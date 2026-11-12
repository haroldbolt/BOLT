import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { CircleAlert, Tag, X } from 'lucide-react';
import { formatCOP } from '../../lib/formatters';
import { AdminRequestError, type PriceAdjustment, type PriceItem } from './adminClient';
import './priceManagement.css';

const maxPriceCOP = Math.floor(Number.MAX_SAFE_INTEGER / 100);

function roundedDiscount(regularPrice: number, effectivePrice: number) {
  return Math.round((1 - effectivePrice / regularPrice) * 100);
}

function activePromotion(item: PriceItem) {
  return item.originalPrice !== null && item.originalPrice > item.price && item.price > 0;
}

function positiveWholePesos(input: string) {
  const value = Number(input);
  return Number.isSafeInteger(value) && value > 0 && value <= maxPriceCOP ? value : null;
}

export function PriceEditor({ item, saving = false, save, close, refreshPrices }: {
  item: PriceItem;
  saving?: boolean;
  save: (adjustment: PriceAdjustment) => Promise<void>;
  close: () => void;
  refreshPrices: () => void;
}) {
  const headingId = useId();
  const regularErrorId = useId();
  const promotionErrorId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const hadPromotion = activePromotion(item);
  const initialRegular = hadPromotion ? item.originalPrice : item.price;
  const [regular, setRegular] = useState(initialRegular && initialRegular > 0 ? String(initialRegular) : '');
  const [hasPromotion, setHasPromotion] = useState(hadPromotion);
  const [method, setMethod] = useState<'price' | 'percent'>('price');
  const [amount, setAmount] = useState(hadPromotion ? String(item.price) : '');
  const [percentage, setPercentage] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [stale, setStale] = useState(false);

  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
    heading.current?.scrollIntoView({ block: 'nearest' });
  }, []);

  const regularPrice = positiveWholePesos(regular);
  const discountPercent = Number(percentage);
  const validPercent = /^\d+(?:\.\d{1,2})?$/.test(percentage) && discountPercent > 0 && discountPercent < 100;
  const promotionInput = method === 'price' ? amount : percentage;
  const promoPrice = method === 'price' ? positiveWholePesos(amount) : regularPrice !== null && validPercent
    ? Math.round(regularPrice * (1 - discountPercent / 100)) : null;
  const validPromo = promoPrice !== null && promoPrice > 0 && regularPrice !== null && promoPrice < regularPrice;
  const valid = regularPrice !== null && (!hasPromotion || validPromo);
  const effectivePrice = hasPromotion ? promoPrice : regularPrice;
  const previewDiscount = hasPromotion && valid && regularPrice && effectivePrice ? roundedDiscount(regularPrice, effectivePrice) : 0;
  const hasChanges = effectivePrice !== item.price || (hasPromotion ? regularPrice : null) !== (hadPromotion ? item.originalPrice : null);
  const adjustmentReason = reason.trim();
  const canSave = valid && hasChanges && adjustmentReason.length >= 5 && adjustmentReason.length <= 240 && !saving && !stale;
  const regularError = regular !== '' && regularPrice === null;
  const promotionError = hasPromotion && promotionInput !== '' && regularPrice !== null && !validPromo;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSave || regularPrice === null) return;
    setError('');
    try {
      await save({
        productId: item.productId, variantId: item.variantId, expectedRevision: item.revision,
        regularPriceCOP: regularPrice, promoPriceCOP: hasPromotion ? promoPrice : null, reason: adjustmentReason,
      });
    } catch (failure) {
      setStale(failure instanceof AdminRequestError && failure.status === 409);
      setError(failure instanceof Error ? failure.message : 'No pudimos guardar el precio.');
    }
  }

  return <section className="ba-panel ba-price-editor" aria-labelledby={headingId}>
    <div className="ba-panel-head">
      <div>
        <h2 ref={heading} tabIndex={-1} id={headingId}>Editar precio</h2>
        <p>{item.name}{item.presentation ? ` · ${item.presentation}` : ''}</p>
      </div>
      <button type="button" className="ba-icon-btn" aria-label="Cerrar editor de precio" disabled={saving} onClick={close}><X size={18} aria-hidden="true" /></button>
    </div>
    <form className="ba-price-form" onSubmit={event => void submit(event)}>
      <p className="ba-price-scope">El precio se aplica en todas las sedes donde se vende esta presentación.</p>
      <fieldset className="ba-price-inputs" disabled={saving || stale}>
        <legend className="ba-sr">Precio y descuento</legend>
        <label className="ba-field">Precio regular (COP)
          <input type="number" inputMode="numeric" min={1} max={maxPriceCOP} step={1} value={regular} required onChange={event => setRegular(event.target.value)}
            aria-invalid={regularError || undefined} aria-describedby={regularError ? regularErrorId : undefined} />
        </label>
        {regularError && <p id={regularErrorId} className="ba-price-validation">Ingresa un valor válido en pesos enteros.</p>}
        <label className="ba-price-toggle"><input type="checkbox" checked={hasPromotion} onChange={event => setHasPromotion(event.target.checked)} /> Activar promoción</label>
        {hasPromotion && <div className="ba-price-promotion-fields">
          <label className="ba-field">Forma del descuento
            <select value={method} onChange={event => setMethod(event.target.value === 'percent' ? 'percent' : 'price')}>
              <option value="price">Precio promocional</option><option value="percent">Porcentaje de descuento</option>
            </select>
          </label>
          {method === 'price' ? <label className="ba-field">Precio promocional (COP)
            <input type="number" inputMode="numeric" min={1} max={maxPriceCOP} step={1} value={amount} required onChange={event => setAmount(event.target.value)}
              aria-invalid={promotionError || undefined} aria-describedby={promotionError ? promotionErrorId : undefined} />
          </label> : <label className="ba-field">Descuento (%)
            <input type="number" inputMode="decimal" min={0.01} max={99.99} step={0.01} value={percentage} required onChange={event => setPercentage(event.target.value)}
              aria-invalid={promotionError || undefined} aria-describedby={promotionError ? promotionErrorId : undefined} />
          </label>}
          {promotionError && <p id={promotionErrorId} className="ba-price-validation">
            {method === 'percent' && !validPercent ? 'Ingresa un porcentaje entre 0,01 y 99,99.' : 'El precio con descuento debe ser positivo y menor que el regular.'}
          </p>}
        </div>}
        <label className="ba-field">Motivo del ajuste
          <input value={reason} required minLength={5} maxLength={240} placeholder="Ej. Promoción de temporada" onChange={event => setReason(event.target.value)} />
        </label>
      </fieldset>
      {valid && effectivePrice !== null && !stale && <div className="ba-price-preview" role="status">
        <span>Precio que verá el cliente</span>
        <div>
          <strong>{formatCOP(effectivePrice)}</strong>
          {hasPromotion && regularPrice !== null && <>
            <del>{formatCOP(regularPrice)}</del>
            {previewDiscount > 0 && <span className="ba-price-discount"><Tag size={13} aria-hidden="true" /> {previewDiscount}% de descuento</span>}
          </>}
        </div>
      </div>}
      {error && <p className="ba-error" role="alert"><CircleAlert size={16} aria-hidden="true" /> {error}</p>}
      <div className="ba-price-actions">
        {stale && <button className="ba-btn ba-btn-secondary" type="button" onClick={refreshPrices}>Cargar precios vigentes</button>}
        <button className="ba-btn ba-btn-primary" type="submit" disabled={!canSave}>{saving ? 'Guardando…' : 'Guardar precio'}</button>
      </div>
    </form>
  </section>;
}
