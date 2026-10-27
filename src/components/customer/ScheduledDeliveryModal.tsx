import React, { useState, useMemo } from 'react';
import { X, Calendar, Clock, CheckCircle2, Sparkles, AlertCircle, Info, ChevronRight, Truck } from 'lucide-react';
import { ScheduledSlot } from '../../lib/deliveryService';

interface ScheduledDeliveryModalProps {
  isOpen: boolean;
  onClose: () => void;
  scheduledSlots: ScheduledSlot[];
  selectedSlotId?: string;
  onSelectSlot: (slot: ScheduledSlot) => void;
  localityName?: string;
  isAutoSwitched?: boolean;
  address?: string;
}

export const ScheduledDeliveryModal: React.FC<ScheduledDeliveryModalProps> = ({
  isOpen,
  onClose,
  scheduledSlots,
  selectedSlotId,
  onSelectSlot,
  localityName = 'Bogotá',
  isAutoSwitched = true,
  address,
}) => {
  // Solo franjas vigentes
  const validSlots = useMemo(() => {
    return scheduledSlots.filter(s => !s.cutoffPassed);
  }, [scheduledSlots]);

  // Agrupar franjas por fecha
  const slotsByDate = useMemo(() => {
    const map = new Map<string, { date: string; dateLabel: string; slots: ScheduledSlot[] }>();
    validSlots.forEach(slot => {
      if (!map.has(slot.date)) {
        map.set(slot.date, {
          date: slot.date,
          dateLabel: slot.dateLabel,
          slots: [],
        });
      }
      map.get(slot.date)!.slots.push(slot);
    });
    return Array.from(map.values());
  }, [validSlots]);

  const [activeDate, setActiveDate] = useState<string>(() => {
    if (selectedSlotId) {
      const match = validSlots.find(s => s.slotId === selectedSlotId);
      if (match) return match.date;
    }
    return slotsByDate[0]?.date || '';
  });

  const [currentSelectedSlotId, setCurrentSelectedSlotId] = useState<string>(() => {
    if (selectedSlotId && validSlots.some(s => s.slotId === selectedSlotId)) {
      return selectedSlotId;
    }
    return validSlots[0]?.slotId || '';
  });

  // Sincronizar fecha activa si cambia
  React.useEffect(() => {
    if (isOpen) {
      if (selectedSlotId) {
        const match = validSlots.find(s => s.slotId === selectedSlotId);
        if (match) {
          setActiveDate(match.date);
          setCurrentSelectedSlotId(match.slotId);
          return;
        }
      }
      if (slotsByDate.length > 0 && !slotsByDate.some(d => d.date === activeDate)) {
        setActiveDate(slotsByDate[0].date);
        if (slotsByDate[0].slots.length > 0) {
          setCurrentSelectedSlotId(slotsByDate[0].slots[0].slotId);
        }
      }
    }
  }, [isOpen, selectedSlotId, slotsByDate, validSlots]);

  if (!isOpen) return null;

  const currentDayGroup = slotsByDate.find(g => g.date === activeDate) || slotsByDate[0];
  const activeSlots = currentDayGroup?.slots || [];
  const selectedSlot = validSlots.find(s => s.slotId === currentSelectedSlotId);

  const handleConfirm = () => {
    if (selectedSlot) {
      onSelectSlot(selectedSlot);
    }
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto animate-in fade-in duration-200">
      <div 
        className="bg-white rounded-3xl max-w-lg w-full overflow-hidden shadow-2xl border border-slate-200 flex flex-col my-auto max-h-[90vh]"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-5 md:p-6 border-b border-slate-100 relative bg-slate-50/70">
          <button
            onClick={onClose}
            className="absolute top-5 right-5 p-2 rounded-full text-slate-400 hover:text-slate-600 hover:bg-slate-200/60 transition"
          >
            <X className="w-5 h-5" />
          </button>

          <div className="flex items-center gap-2">
            <span className="p-2 rounded-xl bg-blue-100 text-blue-700">
              <Calendar className="w-5 h-5" />
            </span>
            <div>
              <span className="text-[11px] font-black uppercase tracking-wider text-blue-600">
                Entrega Programada
              </span>
              <h3 className="text-lg md:text-xl font-black text-slate-900 leading-tight">
                Elige cuándo recibir tu pedido
              </h3>
            </div>
          </div>

          {/* Banner de continuidad amigable */}
          <div className="mt-4 bg-blue-50/80 border border-blue-200 text-blue-950 p-3.5 rounded-2xl text-xs space-y-1">
            <div className="flex items-start gap-2">
              <Info className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
              <div>
                <p className="font-extrabold text-blue-900">
                  Para esta dirección, continuamos con envío programado. Elige cuándo recibir tu pedido
                </p>
                <p className="text-blue-800 text-[11px] mt-0.5">
                  {address ? `${address} · ` : ''}Localidad: <strong>{localityName}</strong>. Despacho seguro en camioneta o flota programada de Bogotá.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Content Body */}
        <div className="p-5 md:p-6 overflow-y-auto space-y-5 flex-1">
          {/* Selector de Fechas (Hoy, Mañana, etc.) */}
          {slotsByDate.length > 0 ? (
            <div>
              <label className="text-xs font-bold text-slate-700 block mb-2">
                1. Selecciona la fecha de entrega:
              </label>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {slotsByDate.map(group => {
                  const isCurrent = group.date === activeDate;
                  const isToday = group.dateLabel.includes('Hoy');
                  const isTomorrow = group.dateLabel.includes('Mañana');

                  return (
                    <button
                      key={group.date}
                      type="button"
                      onClick={() => {
                        setActiveDate(group.date);
                        if (group.slots.length > 0) {
                          setCurrentSelectedSlotId(group.slots[0].slotId);
                        }
                      }}
                      className={`p-3 rounded-2xl border text-left transition flex flex-col justify-between ${
                        isCurrent
                          ? 'border-blue-600 bg-blue-50/60 ring-2 ring-blue-500/20'
                          : 'border-slate-200 hover:border-slate-300 bg-white hover:bg-slate-50'
                      }`}
                    >
                      <div>
                        <span className={`text-[10px] font-black uppercase tracking-wider block ${
                          isToday ? 'text-emerald-700' : isTomorrow ? 'text-blue-700' : 'text-slate-500'
                        }`}>
                          {isToday ? 'Hoy' : isTomorrow ? 'Mañana' : group.dateLabel.split(',')[0]}
                        </span>
                        <strong className="text-xs text-slate-900 block mt-0.5">
                          {group.dateLabel.includes(',') ? group.dateLabel.split(',')[1].trim() : group.dateLabel}
                        </strong>
                      </div>
                      <span className="text-[10px] text-slate-500 font-mono mt-2 block">
                        {group.slots.length} {group.slots.length === 1 ? 'franja' : 'franjas'}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="p-4 bg-amber-50 rounded-2xl border border-amber-200 text-amber-900 text-xs">
              No hay franjas disponibles en este momento. Por favor verifica más tarde.
            </div>
          )}

          {/* Selector de Franjas Horarias para la fecha elegida */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-bold text-slate-700 block">
                2. Horarios disponibles ({currentDayGroup?.dateLabel || 'Fecha elegida'}):
              </label>
              <span className="text-[10px] text-slate-400 font-semibold">
                Hora de Bogotá (COT)
              </span>
            </div>

            <div className="space-y-2.5">
              {activeSlots.map(slot => {
                const isSelected = slot.slotId === currentSelectedSlotId;
                return (
                  <button
                    key={slot.slotId}
                    type="button"
                    onClick={() => setCurrentSelectedSlotId(slot.slotId)}
                    className={`w-full p-4 rounded-2xl border text-left transition flex items-center justify-between gap-3 ${
                      isSelected
                        ? 'border-blue-600 bg-blue-50/70 shadow-xs'
                        : 'border-slate-200 hover:border-slate-300 bg-white hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <div className={`mt-0.5 w-4 h-4 rounded-full border flex items-center justify-center shrink-0 ${
                        isSelected ? 'border-blue-600 bg-blue-600' : 'border-slate-300 bg-white'
                      }`}>
                        {isSelected && <span className="w-1.5 h-1.5 rounded-full bg-white"></span>}
                      </div>

                      <div className="space-y-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <strong className="text-sm font-black text-slate-900">
                            {slot.displayWindow}
                          </strong>
                          <span className="text-xs text-slate-500 font-medium">
                            ({slot.displayWindowShort})
                          </span>
                          <span className="text-[10px] font-black bg-blue-100 text-blue-800 px-2 py-0.5 rounded-md">
                            {slot.windowName}
                          </span>
                        </div>

                        <p className="text-xs text-slate-600">
                          {slot.commercialHook}
                        </p>

                        {slot.countdownNotice && (
                          <p className="text-[11px] font-bold text-amber-700 bg-amber-50 px-2 py-0.5 rounded-md inline-block">
                            {slot.countdownNotice}
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="text-right shrink-0">
                      <span className="text-xs font-black text-emerald-600 block">
                        Sin recargo
                      </span>
                      <span className="text-[10px] text-slate-400 font-medium block">
                        Cupos: {slot.availableCapacity}/10
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 md:p-5 border-t border-slate-100 bg-slate-50/80 flex items-center justify-between gap-3">
          <div className="text-xs text-slate-600">
            {selectedSlot ? (
              <div>
                <span className="text-slate-400 text-[10px] block uppercase font-bold">Seleccionado:</span>
                <strong className="text-slate-900">
                  {selectedSlot.dateLabel} · {selectedSlot.displayWindow}
                </strong>
              </div>
            ) : (
              <span>Selecciona una franja para continuar</span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-200 transition"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={!selectedSlot}
              className="px-5 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 disabled:bg-slate-300 text-white text-xs font-black transition flex items-center gap-1.5 shadow-xs"
            >
              <span>Confirmar Franja</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
