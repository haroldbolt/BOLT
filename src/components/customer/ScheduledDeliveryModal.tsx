import React, { useMemo, useState } from 'react';
import { X, Calendar, Info, ChevronRight } from 'lucide-react';
import type { DeliveryQuote, ScheduledSlot } from '../../lib/deliveryService';

interface ScheduledDeliveryModalProps {
  isOpen: boolean;
  onClose: () => void;
  scheduledSlots: ScheduledSlot[];
  selectedSlotId?: string;
  onSelectSlot: (slot: ScheduledSlot) => void;
  localityName?: string;
  isAutoSwitched?: boolean;
  address?: string;
  quote?: DeliveryQuote | null;
  loading?: boolean;
}
export const EMPTY_SCHEDULE_DATE = 'No hay horarios disponibles para esta fecha. Elige otro día';

export const ScheduledDeliveryModal: React.FC<ScheduledDeliveryModalProps> = ({
  isOpen, onClose, scheduledSlots, selectedSlotId, onSelectSlot,
  localityName = 'Destino pendiente de identificar', address, quote, loading = false,
}) => {
  const validSlots = useMemo(() => scheduledSlots.filter(s => !s.cutoffPassed && s.availableCapacity > 0), [scheduledSlots]);
  const initial = scheduledSlots.find(s => s.slotId === selectedSlotId);
  const [activeDate, setActiveDate] = useState(initial?.date || validSlots[0]?.date || scheduledSlots[0]?.date || '');
  const [selection, setSelection] = useState(initial && validSlots.includes(initial) ? initial.slotId : '');
  const wasOpen = React.useRef(isOpen);
  React.useEffect(() => {
    if (isOpen && !wasOpen.current) {
      const saved = scheduledSlots.find(s => s.slotId === selectedSlotId);
      setActiveDate(saved?.date || validSlots[0]?.date || scheduledSlots[0]?.date || '');
      setSelection(saved && validSlots.includes(saved) ? saved.slotId : '');
    }
    wasOpen.current = isOpen;
  }, [isOpen, selectedSlotId, scheduledSlots, validSlots]);
  React.useEffect(() => {
    if (loading) return;
    // Keep a date that became full visible; never silently move the customer to another date/slot.
    if (!activeDate) setActiveDate(validSlots[0]?.date || scheduledSlots[0]?.date || '');
    if (selection && !validSlots.some(s => s.slotId === selection && s.date === activeDate)) setSelection('');
  }, [loading, activeDate, selection, scheduledSlots, validSlots]);

  const groups = useMemo(() => {
    const map = new Map<string, {date:string; label:string; slots:ScheduledSlot[]}>();
    for (const slot of scheduledSlots) {
      if (!map.has(slot.date)) map.set(slot.date, {date:slot.date, label:slot.dateLabel, slots:[]});
      if (!slot.cutoffPassed && slot.availableCapacity>0) map.get(slot.date)!.slots.push(slot);
    }
    return [...map.values()];
  }, [scheduledSlots]);
  const currentDay = groups.find(g => g.date === activeDate);
  const activeSlots = currentDay?.slots || [];
  const selectedSlot = validSlots.find(s => s.slotId === selection && s.date === activeDate);
  const warehouse = quote?.warehouse?.customerName || quote?.assignedStoreName;
  const slotIssue = (quote?.reasonCode==='SLOT_CAPACITY_EXCEEDED' || quote?.selectedSlotInvalid===true) && scheduledSlots.length>0;
  const blocked = !!quote && !quote.scheduledEligible && !slotIssue && !quote.availableModes.scheduled;
  const transportIssue = scheduledSlots.find(s => s.date === activeDate && s.unavailableReason==='TRANSPORT');
  const emptyMessage = transportIssue?.unavailableMessage || EMPTY_SCHEDULE_DATE;
  const canConfirm = !loading && !blocked && !!selectedSlot;
  if (!isOpen) return null;

  return <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
    <section role="dialog" aria-modal="true" aria-labelledby="schedule-title" aria-busy={loading}
      className="bg-white rounded-3xl max-w-lg w-full overflow-hidden shadow-2xl border border-slate-200 flex flex-col my-auto max-h-[90vh]">
      <div className="p-5 md:p-6 border-b border-slate-100 relative bg-slate-50/70">
        <button type="button" aria-label="Cerrar horarios" onClick={onClose} className="absolute top-4 right-4 p-2 rounded-full text-slate-400 hover:bg-slate-200"><X className="w-5 h-5" /></button>
        <div className="flex items-center gap-2 pr-6">
          <span className="p-2 rounded-xl bg-blue-100 text-blue-700"><Calendar className="w-5 h-5" /></span>
          <div><span className="text-[11px] font-black uppercase tracking-wider text-blue-600">Entrega Programada</span>
            <h3 id="schedule-title" className="text-lg md:text-xl font-black text-slate-900 leading-tight">Elige cuándo recibir tu pedido</h3></div>
        </div>
        <div className="mt-4 bg-blue-50/80 border border-blue-200 text-blue-950 p-3.5 rounded-2xl text-xs flex gap-2">
          <Info className="w-4 h-4 text-blue-600 shrink-0" />
          <div><p className="font-extrabold text-blue-900">{loading ? 'Consultando sede y horarios…' : `Programado · Sede ${warehouse || 'pendiente de confirmar'}`}</p>
            <p className="text-blue-800 mt-1">{address} · Zona: <strong>{localityName}</strong></p>
            {!loading && !blocked && <p className="mt-1">Elige una franja. Confirmaremos disponibilidad y costo con tu carrito antes de crear el pedido.</p>}
          </div>
        </div>
      </div>
      <div className="p-5 md:p-6 overflow-y-auto space-y-5 flex-1">
        {loading ? <p role="status" className="text-sm text-slate-600">Actualizando disponibilidad…</p>
          : blocked ? <p role="status" className="p-4 bg-amber-50 rounded-2xl border border-amber-200 text-amber-900 text-sm">{quote?.message}</p>
          : <>
            {groups.some(g => g.slots.length>0) && <div>
              <p className="text-xs font-bold text-slate-700 mb-2">1. Selecciona la fecha de entrega:</p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {groups.filter(g => g.slots.length>0 || g.date===activeDate).map(group => <button key={group.date} type="button" aria-pressed={group.date===activeDate}
                  onClick={() => {setActiveDate(group.date);setSelection('');}}
                  className={`p-3 rounded-2xl border text-left min-h-16 ${group.date===activeDate ? 'border-blue-600 bg-blue-50 ring-2 ring-blue-500/20' : 'border-slate-200 hover:bg-slate-50'}`}>
                  <strong className="text-xs block">{group.label}</strong><span className="text-[10px] text-slate-500">{group.slots.length} {group.slots.length===1?'franja disponible':'franjas disponibles'}</span>
                </button>)}
              </div>
            </div>}
            <div>
              <p className="text-xs font-bold text-slate-700 mb-2">Horarios disponibles{currentDay ? ` (${currentDay.label})` : ''} <span className="block text-[10px] text-slate-400 mt-1">Hora de Bogotá (COT)</span></p>
              {activeSlots.length===0 ? <p role="status" className="p-4 bg-amber-50 rounded-2xl border border-amber-200 text-amber-900 text-sm">{emptyMessage}</p>
                : <div className="space-y-2.5">{activeSlots.map(slot => <button key={slot.slotId} type="button" aria-pressed={slot.slotId===selection} onClick={() => setSelection(slot.slotId)}
                    className={`w-full p-4 rounded-2xl border text-left flex items-start justify-between gap-3 ${slot.slotId===selection ? 'border-blue-600 bg-blue-50 shadow-xs' : 'border-slate-200 hover:bg-slate-50'}`}>
                    <div className="space-y-1"><strong className="text-sm text-slate-900 block">{slot.displayWindowFull}</strong><span className="text-xs text-slate-500 block">{slot.windowName}</span>
                      <p className="text-xs text-slate-600">{slot.commercialHook}</p>{slot.countdownNotice && <p className="text-[11px] font-bold text-amber-700">{slot.countdownNotice}</p>}</div>
                    <span className="text-[10px] text-slate-500 shrink-0">Cupos: {slot.availableCapacity}/{slot.maxCapacity}</span>
                  </button>)}</div>}
            </div>
          </>}
      </div>
      <div className="p-4 md:p-5 border-t border-slate-100 bg-slate-50/80 flex items-center justify-between gap-3">
        <p className="text-xs text-slate-600">{canConfirm ? `${selectedSlot!.dateLabel} · ${selectedSlot!.displayWindow}` : 'Selecciona una franja para continuar'}</p>
        <button type="button" disabled={!canConfirm} onClick={() => {if(canConfirm && selectedSlot) {onSelectSlot(selectedSlot);onClose();}}}
          className="px-5 py-3 min-h-11 rounded-xl bg-slate-900 hover:bg-slate-800 disabled:bg-slate-300 text-white text-xs font-black flex items-center gap-1.5 shrink-0">
          Confirmar franja <ChevronRight className="w-3.5 h-3.5" />
        </button>
      </div>
    </section>
  </div>;
};
