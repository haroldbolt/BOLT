import { useState } from 'react';
import { CalendarDays, Check, ClipboardCheck, LoaderCircle, MapPin, ShieldCheck } from 'lucide-react';
import type { DeliveryMode } from '../../types';
import type { DeliveryQuote, ScheduledSlot } from '../../lib/deliveryService';
import { hasConfirmedDeliveryQuote } from '../../lib/checkoutReadiness';
import { formatCOP } from '../../lib/formatters';
import { boltAdmin, type AdminOrder } from './adminClient';

export function deliveryModeLabel(mode: DeliveryMode | null | undefined) {
  if (mode === 'PROGRAMADO') return 'Programado';
  if (mode === 'TURBO') return 'Turbo';
  if (mode === 'TURBO_DIVIDIDO') return 'Turbo dividido';
  return 'Por definir';
}

const slotKey = (slot: ScheduledSlot) => `${slot.date}|${slot.slotId}`;

export function DeliveryReviewPanel({ order, token, isDemo, onConfirmed }: {
  order: AdminOrder;
  token: string | null;
  isDemo: boolean;
  onConfirmed: (order: AdminOrder) => void;
}) {
  const [mode, setMode] = useState<DeliveryMode>(order.deliveryReview?.requestedMode === 'TURBO' ? 'TURBO' : 'PROGRAMADO');
  const [quote, setQuote] = useState<DeliveryQuote | null>(null);
  const [slots, setSlots] = useState<ScheduledSlot[]>([]);
  const [slot, setSlot] = useState<ScheduledSlot | undefined>();
  const [accepted, setAccepted] = useState(false);
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState<'quote' | 'confirm' | null>(null);
  const [error, setError] = useState('');

  const consult = async (chosen?: ScheduledSlot) => {
    if (busy) return;
    setBusy('quote');
    setError('');
    setAccepted(false);
    setQuote(null);
    setSlot(chosen);
    if (!chosen) setSlots([]);
    try {
      const result = await boltAdmin.quote(token, order.id, { deliveryMode: mode, scheduledWindow: chosen });
      setQuote(result);
      if (result.scheduledSlots.length || !chosen) {
        setSlots(result.scheduledSlots.filter(item => !item.cutoffPassed && item.availableCapacity > 0));
      }
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'No pudimos consultar la entrega.');
    } finally { setBusy(null); }
  };

  const canSubmit = !!quote?.recommendedMode && hasConfirmedDeliveryQuote(quote)
    && (quote.recommendedMode !== 'PROGRAMADO' || !!slot);

  const confirm = async () => {
    if (busy || !canSubmit || !quote || !accepted || reference.trim().length < 8) return;
    setBusy('confirm');
    setError('');
    try {
      const result = await boltAdmin.confirm(token, order.id, {
        confirmationToken: quote.confirmationToken,
        deliveryMode: quote.recommendedMode,
        scheduledWindow: quote.recommendedMode === 'PROGRAMADO' ? slot : undefined,
        customerAccepted: accepted,
        customerAgreementReference: reference.trim(),
      });
      onConfirmed(result);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'No pudimos confirmar la entrega.');
      setAccepted(false);
    } finally { setBusy(null); }
  };

  return <section className="ba-review" aria-label="Confirmación de entrega">
    <div className="ba-review-heading">
      <span className="ba-symbol ba-symbol-amber"><ClipboardCheck size={18} aria-hidden="true" /></span>
      <div><h3>Confirmar entrega</h3><p>Consulta una franja y registra la aceptación del cliente.</p></div>
    </div>
    <div className="ba-review-controls">
      <label className="ba-field">Modalidad
        <select value={mode} disabled={!!busy} onChange={event => {
          setMode(event.target.value as DeliveryMode);
          setQuote(null); setSlots([]); setSlot(undefined); setAccepted(false); setError('');
        }}>
          <option value="PROGRAMADO">Programado</option><option value="TURBO">Turbo</option>
        </select>
      </label>
      <button type="button" className="ba-btn ba-btn-secondary" disabled={!!busy} onClick={() => void consult()}>
        {busy === 'quote' ? <LoaderCircle size={16} className="ba-spin" aria-hidden="true" /> : <CalendarDays size={16} aria-hidden="true" />}
        Consultar disponibilidad
      </button>
    </div>
    {slots.length > 0 && (mode === 'PROGRAMADO' || quote?.recommendedMode === 'PROGRAMADO') && <label className="ba-field">
      Franja de entrega
      <select value={slot ? slotKey(slot) : ''} disabled={!!busy} onChange={event => {
        if (event.target.value) void consult(slots.find(item => slotKey(item) === event.target.value));
        else { setSlot(undefined); setQuote(null); setAccepted(false); }
      }}>
        <option value="">Selecciona una franja</option>
        {slots.map(item => <option key={slotKey(item)} value={slotKey(item)}>{item.dateLabel} · {item.displayWindow}</option>)}
      </select>
    </label>}
    {quote && !canSubmit && (slot || slots.length === 0) && <p className="ba-info" role="status">{quote.message}</p>}
    {canSubmit && quote?.charges && <div className="ba-quote">
      <div className="ba-quote-summary">
        <span><MapPin size={16} aria-hidden="true" />{deliveryModeLabel(quote.recommendedMode)}{slot && ` · ${slot.dateLabel} · ${slot.displayWindow}`}</span>
        <strong>{formatCOP(quote.charges.total)}</strong>
      </div>
      <p className="ba-dim">{isDemo ? 'Total simulado · Sin cobro' : 'Total de la propuesta · Pago contra entrega'}</p>
      {isDemo && <p className="ba-info">Prueba: registra una aceptación ficticia, por ejemplo «Cliente de prueba aceptó la franja».</p>}
      <label className="ba-field">Referencia de aceptación
        <input value={reference} onChange={event => setReference(event.target.value)} maxLength={500}
          placeholder={isDemo ? 'Cliente de prueba aceptó la franja' : 'Registra cómo aceptó el cliente, sin datos sensibles'} />
      </label>
      <label className="ba-check"><input type="checkbox" checked={accepted} onChange={event => setAccepted(event.target.checked)} />
        {isDemo ? 'El cliente de prueba aceptó el costo y la entrega.' : 'El cliente aceptó el costo, el horario y el pago contra entrega.'}
      </label>
      <button type="button" className="ba-btn ba-btn-primary" disabled={!!busy || !accepted || reference.trim().length < 8} onClick={() => void confirm()}>
        {busy === 'confirm' ? <LoaderCircle size={16} className="ba-spin" aria-hidden="true" /> : <Check size={16} aria-hidden="true" />}
        Confirmar entrega
      </button>
    </div>}
    {error && <p className="ba-error" role="alert"><ShieldCheck size={16} aria-hidden="true" />{error}</p>}
  </section>;
}
