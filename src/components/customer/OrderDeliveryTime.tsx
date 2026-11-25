import { Clock3 } from 'lucide-react';
import { formatDeliveryClock, readDeliveryClock } from '../../lib/customerTrackingTiming';
import type { DeliveryMode, FulfillmentStatus, ScheduledDeliveryWindow } from '../../types';
import type { CustomerTrackingTiming } from '../../types/customerTracking';

type Props = {
  mode?: DeliveryMode;
  status: FulfillmentStatus;
  timing?: CustomerTrackingTiming;
  scheduledWindow?: ScheduledDeliveryWindow;
  now: number;
};

export function OrderDeliveryTime({ mode, status, timing, scheduledWindow, now }: Props) {
  const done = status === 'ENTREGADO';
  const terminal = done || status === 'CANCELADO';
  const active = !terminal && status !== 'CON_INCIDENCIA';

  if (mode === 'PROGRAMADO') {
    if (terminal) return null;
    if (timing?.source === 'BOOKED_WINDOW' && scheduledWindow) {
      return <div className="mt-4 rounded-2xl bg-blue-50 px-4 py-3 text-sm text-blue-950">
        <p className="font-bold">Entrega programada</p>
        <p>{scheduledWindow.dateLabel} · {scheduledWindow.displayWindowShort || scheduledWindow.displayWindow}</p>
      </div>;
    }
    return active ? <p className="mt-3 text-sm text-slate-700">Franja de entrega por confirmar.</p> : null;
  }

  const isTurbo = mode === 'TURBO' || mode === 'TURBO_DIVIDIDO';
  if (isTurbo && (status === 'CONFIRMADO' || status === 'EN_ALISTAMIENTO')) {
    return <p className="mt-3 text-sm text-slate-700">El Tiempo Turbo comenzará cuando la sede marque tu pedido como listo.</p>;
  }

  const readyAt = timing?.stages.prepCompletedAt;
  const clock = readDeliveryClock(isTurbo && readyAt && readyAt === timing?.startedAt ? timing : undefined, now,
    terminal ? (done ? timing?.stages.deliveredAt : timing?.stages.cancelledAt) ?? null : undefined);

  return <>
    {active && (clock.remainingSeconds !== null && !clock.overdue ? (
      <div className="mt-4 flex items-center justify-between gap-3 rounded-2xl bg-red-700 px-4 py-3 text-white">
        <div><p className="font-black">Tiempo Turbo</p><p className="text-xs">Tiempo estimado restante</p></div>
        <time className="text-3xl font-black tabular-nums" aria-label="Tiempo estimado restante" dateTime={`PT${clock.remainingSeconds}S`}>{formatDeliveryClock(clock.remainingSeconds)}</time>
      </div>
    ) : (
      <p className="mt-3 text-sm text-slate-700">{clock.overdue ? 'El tiempo estimado ya pasó. Aquí puedes seguir el estado de la entrega.' : 'Hora de llegada por confirmar.'}</p>
    ))}
    {clock.elapsedSeconds !== null && <p className="mt-2 flex items-center gap-1.5 text-sm text-slate-600">
      <Clock3 className="size-4 shrink-0" aria-hidden="true" />
      <span>{terminal ? 'Duración desde que el pedido estuvo listo' : 'Tiempo desde que estuvo listo'}: <span className="font-bold tabular-nums text-slate-900">{formatDeliveryClock(clock.elapsedSeconds)}</span></span>
    </p>}
  </>;
}
