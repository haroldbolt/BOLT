import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { CircleAlert, PackagePlus, X } from 'lucide-react';
import { AdminRequestError, boltAdmin, type InventoryItem } from './adminClient';
import './inventoryAdjustments.css';

type AdjustmentProps = {
  item: InventoryItem;
  storeName: string;
  token: string | null;
  close: () => void;
  saved: (updated: InventoryItem) => void;
  refreshRequested: () => void;
};

type InventoryAdjustmentsProps = Omit<AdjustmentProps, 'item'> & { item: InventoryItem | null };

const formatUnits = new Intl.NumberFormat('es-CO');

export function InventoryAdjustments({ item, ...props }: InventoryAdjustmentsProps) {
  const headingId = useId();
  if (item) return <AdjustmentForm key={`${item.storeId}:${item.productId}:${item.variantId}:${item.revision}`} item={item} {...props} />;

  return <section className="ba-panel ba-adjustments" aria-labelledby={headingId}>
    <div className="ba-panel-head">
      <div><h2 id={headingId}>Ajustes de inventario</h2><p>{props.storeName}</p></div>
      <button className="ba-icon-btn" type="button" onClick={props.close} aria-label="Cerrar ajustes de inventario"><X size={19} aria-hidden="true" /></button>
    </div>
    <p className="ba-adjustment-empty"><PackagePlus size={18} aria-hidden="true" /> Busca una presentación y pulsa su cantidad en Existencias.</p>
  </section>;
}

function AdjustmentForm({ item, storeName, token, close, saved, refreshRequested }: AdjustmentProps) {
  const headingId = useId();
  const errorId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const [method, setMethod] = useState<'delta' | 'set'>('delta');
  const [movement, setMovement] = useState<'add' | 'remove'>('add');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [stale, setStale] = useState(false);

  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
    heading.current?.scrollIntoView({ block: 'nearest' });
  }, []);

  const isDelta = method === 'delta';
  const quantity = Number(amount);
  const resultingStock = isDelta ? item.stock + (movement === 'add' ? quantity : -quantity) : quantity;
  let quantityError = '';
  if (amount.trim()) {
    if (!Number.isSafeInteger(quantity) || !Number.isSafeInteger(resultingStock) || quantity < (isDelta ? 1 : 0)) {
      quantityError = 'Ingresa una cantidad válida en unidades enteras.';
    } else if (resultingStock < item.reserved) {
      quantityError = `La existencia debe cubrir las ${formatUnits.format(item.reserved)} unidades reservadas.`;
    } else if (resultingStock === item.stock) {
      quantityError = 'La cantidad es igual a la existencia actual.';
    }
  }
  const validStock = !!amount.trim() && !quantityError;
  const adjustmentReason = reason.trim();
  const canSave = validStock && adjustmentReason.length >= 5 && adjustmentReason.length <= 240 && !saving && !stale;

  function chooseMethod(nextMethod: 'delta' | 'set') {
    setMethod(nextMethod);
    setAmount('');
    if (!stale) setError('');
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSave) return;
    setSaving(true);
    setError('');
    try {
      const { item: updated } = await boltAdmin.adjustInventory(token, item, resultingStock, adjustmentReason);
      saved(updated);
    } catch (failure) {
      setStale(failure instanceof AdminRequestError && failure.status === 409);
      setError(failure instanceof Error ? failure.message : 'No pudimos guardar el ajuste.');
    } finally {
      setSaving(false);
    }
  }

  return <section className="ba-panel ba-adjustments" aria-labelledby={headingId}>
    <div className="ba-panel-head">
      <div>
        <h2 ref={heading} id={headingId} tabIndex={-1}>Ajustes de inventario</h2>
        <p>{storeName}</p>
      </div>
      <button className="ba-icon-btn" type="button" onClick={close} disabled={saving} aria-label="Cerrar ajustes de inventario"><X size={19} aria-hidden="true" /></button>
    </div>

    <form className="ba-adjustment-form" onSubmit={event => void submit(event)}>
      <div className="ba-adjustment-product">
        <h3>{item.name}</h3>
        <p>{[item.presentation, item.sku].filter(Boolean).join(' · ')}</p>
      </div>
      <dl className="ba-adjustment-balances" aria-label="Inventario actual">
        <div><dt>Existencias</dt><dd>{formatUnits.format(item.stock)}</dd></div>
        <div><dt>Reservadas</dt><dd>{formatUnits.format(item.reserved)}</dd></div>
        <div><dt>Disponibles</dt><dd>{formatUnits.format(item.available)}</dd></div>
      </dl>

      <fieldset className="ba-adjustment-method" disabled={saving || stale}>
        <legend>Tipo de ajuste</legend>
        <label className="ba-adjustment-choice">
          <input type="radio" name="adjustmentMethod" checked={isDelta} onChange={() => chooseMethod('delta')} /> Ajustar por
        </label>
        <label className="ba-adjustment-choice">
          <input type="radio" name="adjustmentMethod" checked={!isDelta} onChange={() => chooseMethod('set')} /> Fijar total
        </label>
      </fieldset>
      <div className={`ba-adjustment-quantity${isDelta ? ' ba-adjustment-quantity-delta' : ''}`}>
        {isDelta && <label className="ba-field">Movimiento
          <select value={movement} disabled={saving || stale} onChange={event => setMovement(event.target.value === 'remove' ? 'remove' : 'add')}>
            <option value="add">Añadir unidades</option><option value="remove">Retirar unidades</option>
          </select>
        </label>}
        <label className="ba-field">{isDelta ? 'Unidades' : 'Existencias totales'}
          <input type="number" inputMode="numeric" min={isDelta ? 1 : 0} step={1} value={amount} required disabled={saving || stale}
            aria-invalid={quantityError ? true : undefined} aria-describedby={quantityError ? errorId : undefined}
            onChange={event => setAmount(event.target.value)} />
        </label>
      </div>
      {quantityError && <p id={errorId} className="ba-error"><CircleAlert size={16} aria-hidden="true" />{quantityError}</p>}

      <label className="ba-field">Motivo del ajuste
        <input value={reason} onChange={event => setReason(event.target.value)} required minLength={5} maxLength={240}
          placeholder="Ej. Recepción de mercancía" disabled={saving || stale} />
      </label>

      {validStock && !stale && <div className="ba-adjustment-preview" role="status">
        <h3>Vista previa</h3>
        <dl className="ba-adjustment-balances">
          <div><dt>Nuevas existencias</dt><dd>{formatUnits.format(resultingStock)}</dd></div>
          <div><dt>Reservadas</dt><dd>{formatUnits.format(item.reserved)}</dd></div>
          <div><dt>Nuevas disponibles</dt><dd>{formatUnits.format(resultingStock - item.reserved)}</dd></div>
        </dl>
      </div>}
      {error && <p className="ba-error" role="alert"><CircleAlert size={16} aria-hidden="true" />{error}</p>}
      <div className="ba-adjustment-actions">
        {stale && <button className="ba-btn ba-btn-secondary" type="button" onClick={refreshRequested}>Actualizar inventario</button>}
        <button className="ba-btn ba-btn-primary" type="submit" disabled={!canSave}>{saving ? 'Guardando…' : 'Guardar ajuste'}</button>
      </div>
    </form>
  </section>;
}
