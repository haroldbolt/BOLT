import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, Bike, Check, CircleHelp, Clock3, KeyRound, MapPin, MessageCircle, Phone, RefreshCw } from 'lucide-react';
import type { FulfillmentStatus, Order } from '../../types';
import type { CustomerTracking, TrackingStage } from '../../types/customerTracking';
import type { PublicDispatch } from '../../lib/dispatchClient';
import { BUSINESS } from '../../customer/legal';
import { api } from '../../lib/api';
import { formatDeliveryClock, readDeliveryClock } from '../../lib/customerTrackingTiming';
import { formatCOP, formatTimeBogota } from '../../lib/formatters';
import { pushService } from '../../lib/notifications';
import { LiveDeliveryMap } from './LiveDeliveryMap';
import { OrderEntrancePhoto } from './OrderEntrancePhoto';
import { PendingDeliveryReceipt } from './PendingDeliveryReceipt';
import { WarehouseSummary } from './WarehouseSummary';

interface OrderTrackingProps {
  orderId: string;
  guestOnly?: boolean;
  onBack: () => void;
  onViewSummary?: () => void;
}

type Snapshot = { order: Order; tracking: CustomerTracking; receivedAt: number };
const headings: Record<FulfillmentStatus, string> = {
  PENDIENTE_CONFIRMACION: 'Recibimos tu solicitud',
  CONFIRMADO: 'Tu pedido está confirmado',
  EN_ALISTAMIENTO: 'Estamos preparando tu pedido',
  LISTO_PARA_DESPACHO: 'Tu pedido está listo para recoger',
  REPARTIDOR_ASIGNADO: 'Ya tienes repartidor',
  EN_CAMINO: 'Tu pedido está en camino',
  ENTREGADO: '¡Tu pedido fue entregado!',
  CANCELADO: 'Pedido cancelado',
  CON_INCIDENCIA: 'Estamos revisando tu entrega',
};

const stages: { label: string; time: TrackingStage }[] = [
  { label: 'Confirmado', time: 'confirmedAt' },
  { label: 'En preparación', time: 'prepStartedAt' },
  { label: 'Listo para recoger', time: 'prepCompletedAt' },
  { label: 'Repartidor asignado', time: 'assignedAt' },
  { label: 'En camino', time: 'pickedUpAt' },
  { label: 'Entregado', time: 'deliveredAt' },
];
const stepByStatus: Partial<Record<FulfillmentStatus, number>> = {
  CONFIRMADO: 0, EN_ALISTAMIENTO: 1, LISTO_PARA_DESPACHO: 2, REPARTIDOR_ASIGNADO: 3, EN_CAMINO: 4, ENTREGADO: 5,
};
const handoff = {
  DEJAR_EN_PORTERIA: 'Dejar en portería',
  SUBIR_A_PUERTA: 'Entregar en la puerta',
  LLAMAR_AL_LLEGAR: 'Llamar al llegar',
} as const;
const formatDate = new Intl.DateTimeFormat('es-CO', { timeZone: 'America/Bogota', day: 'numeric', month: 'short' });

function getClockTime(snapshot: Snapshot) {
  const fromServer = Date.parse(snapshot.tracking.timing?.serverTime ?? '');
  return Number.isFinite(fromServer) ? fromServer + Math.max(0, performance.now() - snapshot.receivedAt) : Date.now();
}

function clientPhone(value?: string) {
  if (!value || !/^[+\d\s().-]+$/.test(value)) return null;
  const digits = value.replace(/\D/g, '');
  return /^3\d{9}$/.test(digits) ? '57' + digits : /^573\d{9}$/.test(digits) ? digits : null;
}

export function OrderTracking({ orderId, onBack, guestOnly = false, onViewSummary }: OrderTrackingProps) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [loadError, setLoadError] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const [now, setNow] = useState(0);
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const requestVersion = useRef(0);
  const currentRequest = useRef<number | undefined>(undefined);

  const load = useCallback(async (replace = false) => {
    if (!replace && currentRequest.current !== undefined) return;
    const version = ++requestVersion.current;
    currentRequest.current = version;
    try {
      const order = await api.getOrder(orderId, guestOnly);
      if (version !== requestVersion.current) return;
      const shipmentId = order.isSplitOrder ? order.childShipments?.[activeIndex]?.shipmentId : undefined;
      const tracking = await api.getTracking(orderId, shipmentId, guestOnly);
      if (version !== requestVersion.current) return;
      const received = { order, tracking, receivedAt: performance.now() };
      setSnapshot(received);
      setNow(getClockTime(received));
      setLoadError('');
      pushService.notifyWarehouseAssignment(order);
      pushService.notifyDispatchEvents(order);
    } catch (error) {
      if (version !== requestVersion.current) return;
      const status = (error as { status?: number })?.status;
      if (status === 401 || status === 403 || status === 404) setSnapshot(null);
      setLoadError(error instanceof Error ? error.message : 'No se pudo consultar el seguimiento.');
    } finally {
      if (currentRequest.current === version) currentRequest.current = undefined;
    }
  }, [orderId, activeIndex, guestOnly]);

  useEffect(() => {
    void load(true);
    const refresh = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, 5000);
    const visibility = () => { if (document.visibilityState === 'visible') void load(); };
    document.addEventListener('visibilitychange', visibility);
    return () => {
      ++requestVersion.current;
      currentRequest.current = undefined;
      window.clearInterval(refresh);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [load]);

  useEffect(() => {
    if (!snapshot || ['ENTREGADO', 'CANCELADO'].includes(snapshot.tracking.status)) return;
    const tick = () => setNow(getClockTime(snapshot));
    const timer = window.setInterval(tick, 1000);
    document.addEventListener('visibilitychange', tick);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [snapshot]);

  const order = snapshot?.order.id === orderId ? snapshot.order : null;
  const shipments = order?.isSplitOrder ? order.childShipments ?? [] : [];
  const child = shipments[activeIndex];
  const tracking = order && snapshot && snapshot.tracking.shipmentId === child?.shipmentId ? snapshot.tracking : null;

  const cancel = async () => {
    if (!order) return;
    setCancelling(true);
    setCancelError(null);
    try {
      await api.cancelOrder(order.id, 'Cancelado por el cliente desde la vista de seguimiento', 'CLIENTE', child?.shipmentId, guestOnly);
      await load(true);
    } catch (error) {
      setCancelError(error instanceof Error ? error.message : 'No se pudo cancelar el pedido.');
    } finally { setCancelling(false); }
  };

  if (!order) return <main className="min-h-screen bg-slate-50 p-6 text-slate-900">
    <div className="mx-auto max-w-xl rounded-2xl border border-slate-200 bg-white p-5">
      <h1 className="text-lg font-bold">Seguimiento de tu pedido</h1>
      <p className="mt-2 text-sm text-slate-600" role={loadError ? 'alert' : 'status'}>{loadError || 'Cargando los detalles de tu entrega…'}</p>
      {loadError && <div className="mt-3 flex flex-wrap gap-3 text-sm font-semibold text-red-700">
        <button type="button" onClick={() => void load(true)} className="min-h-11 underline">Reintentar</button>
        <a href="/recuperar-seguimiento" className="inline-flex min-h-11 items-center underline">Recuperar seguimiento privado</a>
      </div>}
      <button type="button" onClick={onBack} className="min-h-11 text-sm underline">Volver</button>
    </div>
  </main>;

  if (order.deliveryReview?.status === 'PENDING') return <PendingDeliveryReceipt order={order} onBack={onBack}
    onRefresh={() => void load(true)} onCancel={() => void cancel()} cancelling={cancelling} error={cancelError} />;

  const status = tracking?.status ?? child?.fulfillmentStatus ?? order.fulfillmentStatus;
  const done = status === 'ENTREGADO';
  const cancelled = status === 'CANCELADO';
  const incident = status === 'CON_INCIDENCIA';
  const terminal = done || cancelled;
  const timing = tracking?.timing;
  const clock = readDeliveryClock(timing, now, terminal ? (done ? timing?.stages.deliveredAt : timing?.stages.cancelledAt) ?? null : undefined);
  const isScheduled = (tracking?.deliveryMode ?? order.deliveryMode) === 'PROGRAMADO';
  const scheduled = timing?.source === 'BOOKED_WINDOW' ? tracking?.scheduledWindow : undefined;
  const countdown = !terminal && !incident && !isScheduled && clock.remainingSeconds !== null && !clock.overdue;
  const dispatches: PublicDispatch[] = (order as Order & { dispatches?: PublicDispatch[] }).dispatches ?? [];
  const dispatch = dispatches.find(entry => entry.shipmentId === child?.shipmentId);
  const driver = tracking?.driver;
  const contact = status === 'REPARTIDOR_ASIGNADO' || status === 'EN_CAMINO' ? clientPhone(driver?.phone) : null;
  const locationAt = tracking?.lastLocationAt;
  const telemetry = tracking?.telemetry;
  const fresh = status === 'EN_CAMINO' && tracking?.locationStatus === 'LIVE' && telemetry &&
    telemetry.timestamp <= now && now - telemetry.timestamp <= tracking.locationMaxAgeSeconds * 1000;
  const stale = status === 'EN_CAMINO' && !!locationAt && !fresh;
  const provider = dispatch?.driverConfirmed ? dispatch.provider : null;
  const items = child?.items ?? order.items;
  const pin = tracking?.secretDeliveryCode;
  const focusedStep = stepByStatus[status] ?? -1;
  const recordedStep = stages.reduce((last, stage, index) => timing?.stages[stage.time] ? index : last, -1);
  const progress = Math.max(focusedStep, recordedStep);
  const handoffLabel = handoff[order.deliveryAddress.porteriaPolicy];
  const showElapsed = !isScheduled && clock.elapsedSeconds !== null;
  const supportEmail = import.meta.env?.VITE_BOLT_SUPPORT_EMAIL || BUSINESS.email;
  const supportHref = /^\S+@\S+\.\S+$/.test(supportEmail) ? `mailto:${supportEmail}` : null;

  return <main className="min-h-dvh bg-slate-50 px-4 pb-10 pt-3 text-slate-950 sm:px-6">
    <div className="mx-auto max-w-6xl">
      <header className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <button type="button" className="inline-flex min-h-11 items-center gap-2 rounded-full px-3 text-sm font-semibold hover:bg-slate-100"
          onClick={onBack}><ArrowLeft className="size-4" aria-hidden="true" /> Volver a la tienda</button>
        <div className="flex flex-wrap items-center gap-1.5 text-sm font-bold">
          {onViewSummary && <button type="button" onClick={onViewSummary} className="min-h-11 rounded-full border border-slate-200 bg-white px-3">Resumen</button>}
          {supportHref && <a className="inline-flex min-h-11 items-center gap-2 rounded-full border border-slate-200 bg-white px-3" href={supportHref}>
            <CircleHelp className="size-4" aria-hidden="true" /> Ayuda</a>}
        </div>
      </header>

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
        <div className="space-y-4">
          <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5" aria-label="Estado y tiempo de la entrega">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <p className="break-all text-sm font-semibold text-slate-600">Pedido {order.purchaseCode || order.orderNumber}</p>
              {tracking?.simulation && <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-bold text-amber-950">Simulación</span>}
            </div>
            <h1 className="text-2xl font-black leading-tight tracking-tight sm:text-3xl">{headings[status]}</h1>
            {dispatch?.code && shipments.length > 1 && <p className="mt-1 text-sm text-slate-600">Despacho {dispatch.code}</p>}
            {countdown ? <div className="mt-4 flex items-center justify-between gap-3 rounded-2xl bg-red-700 px-4 py-3 text-white">
              <div><p className="font-black">Turbo</p><p className="text-xs">Tiempo estimado restante</p></div>
              <time className="text-3xl font-black tabular-nums" aria-label="Tiempo estimado restante" dateTime={`PT${clock.remainingSeconds}S`}>{formatDeliveryClock(clock.remainingSeconds!)}</time>
            </div> : scheduled && !terminal ? <div className="mt-4 rounded-2xl bg-blue-50 px-4 py-3 text-sm text-blue-950">
              <p className="font-bold">Entrega programada</p>
              <p>{scheduled.dateLabel} · {scheduled.displayWindowShort || scheduled.displayWindow}</p>
            </div> : !terminal && !incident ? <p className="mt-3 text-sm text-slate-700">
              {isScheduled ? 'Franja de entrega por confirmar.' : clock.overdue ? 'El tiempo estimado ya pasó. Aquí puedes seguir el estado de la entrega.' : 'Hora de llegada por confirmar.'}
            </p> : null}
            {showElapsed && <p className="mt-2 flex items-center gap-1.5 text-sm text-slate-600">
              <Clock3 className="size-4 shrink-0" aria-hidden="true" />
              <span>{done ? 'Tiempo de entrega' : cancelled ? 'Tiempo hasta la cancelación' : 'Tiempo desde la confirmación'}: <span className="font-bold tabular-nums text-slate-900">{formatDeliveryClock(clock.elapsedSeconds!)}</span></span>
            </p>}
            {loadError && <p role="status" className="mt-2 text-sm text-amber-900">No se pudo actualizar. Mostramos el último estado disponible.</p>}
          </section>

          {shipments.length > 1 && <nav className="flex flex-wrap gap-2" aria-label="Entregas de este pedido">
            {shipments.map((shipment, index) => <button key={shipment.shipmentId} type="button" aria-pressed={index === activeIndex}
              className={`min-h-11 rounded-xl border px-3 text-sm font-bold ${index === activeIndex ? 'border-red-700 bg-red-700 text-white' : 'border-slate-200 bg-white'}`}
              onClick={() => { setCancelError(null); setActiveIndex(index); }}>
              Entrega {index + 1} {shipment.fulfillmentStatus === 'ENTREGADO' && '✓'}
            </button>)}
          </nav>}

          <section aria-label="Avance del pedido" className="rounded-2xl border border-slate-200 bg-white p-4">
            <div aria-hidden="true" className="mb-3 grid grid-cols-6 gap-1">
              {stages.map((stage, index) => <span key={stage.time} className={`h-1.5 rounded-full ${index <= progress ? 'bg-red-700' : 'bg-slate-200'}`} />)}
            </div>
            <ol className="grid grid-cols-3 gap-x-2 gap-y-3 sm:grid-cols-6 lg:grid-cols-3 xl:grid-cols-6">
              {stages.map((stage, index) => {
                const at = timing?.stages[stage.time];
                const completed = Boolean(at) || (focusedStep >= index && !cancelled);
                return <li key={stage.time} aria-current={focusedStep === index ? 'step' : undefined} className="min-w-0 text-xs">
                  <span className={`mb-1 grid size-6 place-items-center rounded-full ${completed ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-700'}`}>
                    {completed ? <Check className="size-3.5" aria-hidden="true" /> : index + 1}
                  </span>
                  <span className={focusedStep === index ? 'font-bold text-red-800' : 'font-semibold text-slate-700'}>{stage.label}</span>
                  {at && <time className="block text-slate-600" dateTime={at}>{formatDate.format(new Date(at))} · {formatTimeBogota(at)}</time>}
                </li>;
              })}
            </ol>
            {incident && order.dispatchStatusMessage && <p className="mt-3 text-sm text-slate-700">{order.dispatchStatusMessage}</p>}
          </section>
        </div>

        <div className="min-w-0 space-y-4">
          <LiveDeliveryMap key={child?.shipmentId ?? order.id}
            origin={tracking?.origin}
            destination={{ name: 'Tu dirección de entrega', coordinates: tracking?.destination.coordinates }}
            route={fresh ? tracking?.trail : undefined}
            inTransit={status === 'EN_CAMINO'}
            courier={fresh ? { coordinates: { lat: telemetry.latitude, lng: telemetry.longitude }, updatedAt: telemetry.timestamp, freshness: 'live' }
              : stale ? { updatedAt: locationAt, freshness: 'stale' } : null} />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="flex items-start gap-1.5 text-sm text-slate-600"><MapPin className="mt-0.5 size-4 shrink-0" aria-hidden="true" />{order.deliveryAddress.address}</p>
            <button type="button" onClick={() => void load(true)} className="inline-flex min-h-11 items-center gap-2 px-1 text-sm font-bold text-red-800">
              <RefreshCw className="size-4" aria-hidden="true" /> Actualizar</button>
          </div>

          {!terminal && (driver || provider || dispatch) && <section aria-label="Repartidor" className="flex flex-wrap items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4">
            {driver?.photo ? <img src={driver.photo} alt="" className="size-11 rounded-full object-cover" />
              : <span className="grid size-11 shrink-0 place-items-center rounded-full bg-red-50 text-red-800"><Bike className="size-5" aria-hidden="true" /></span>}
            <div className="min-w-0 flex-1">
              <p className="break-words font-bold">{driver?.name || (provider ? 'Repartidor asignado' : 'Buscando repartidor')}</p>
              {provider && <p className="text-sm text-slate-600">{provider}</p>}
              {driver?.vehicleType && <p className="text-xs text-slate-600">{driver.vehicleType}{driver.vehiclePlate && ` · Placa ${driver.vehiclePlate}`}</p>}
            </div>
            {contact && <div className="flex flex-wrap gap-2">
              <a href={`tel:+${contact}`} className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-slate-200 px-3 text-sm font-bold">
                <Phone className="size-4" aria-hidden="true" /> Llamar</a>
              {import.meta.env?.VITE_BOLT_TRACKING_WHATSAPP === '1' && <a href={`https://wa.me/${contact}`}
                target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-slate-200 px-3 text-sm font-bold">
                <MessageCircle className="size-4" aria-hidden="true" /> WhatsApp</a>}
            </div>}
          </section>}
          {pin && <div className="flex items-center justify-between gap-2 rounded-2xl border border-red-200 bg-red-50 p-4 text-red-950">
            <span className="flex items-center gap-2 text-sm font-bold"><KeyRound className="size-4 shrink-0" aria-hidden="true" /> Código de entrega</span>
            <strong className="text-lg tracking-widest">{pin}</strong>
          </div>}
        </div>
      </div>

      <section aria-label="Detalles del pedido" className="mt-4 rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
        <WarehouseSummary order={order} />
        <OrderEntrancePhoto orderId={order.id} audience={guestOnly ? 'customer' : api.getStoredAdminToken() ? 'admin' : 'customer'} />
        <h2 className="mt-3 font-bold">{child ? 'Productos de esta entrega' : 'Productos del pedido'}</h2>
        <ul className="mt-1 divide-y divide-slate-100 text-sm">
          {items.map(item => <li key={item.productId} className="flex flex-wrap items-start justify-between gap-2 py-2">
            <span>{item.quantity} × {item.name}{item.presentation && !item.name.endsWith(item.presentation) ? ` · ${item.presentation}` : ''}</span>
            <strong>{formatCOP(item.quantity * item.price)}</strong>
          </li>)}
        </ul>
        {tracking?.cargo && <p className="mt-1 text-sm text-slate-600">Peso con embalaje: {new Intl.NumberFormat('es-CO').format(tracking.cargo.grossWeightGrams / 1000)} kg</p>}
        {handoffLabel && <p className="mt-2 text-sm text-slate-700">{handoffLabel}</p>}
        {order.deliveryAddress.details && <p className="mt-2 break-words text-sm text-slate-700">Instrucciones: {order.deliveryAddress.details}</p>}
        {order.totals.tip > 0 && <p className="mt-2 text-sm text-slate-700">Propina del pedido: {formatCOP(order.totals.tip)}</p>}
        {(dispatch?.cashToCollect ?? child?.cashToCollect ?? order.payment.cashToCollect ?? 0) > 0 && <p className="mt-2 text-sm font-semibold">
          Pago contra entrega: {formatCOP(dispatch?.cashToCollect ?? child?.cashToCollect ?? order.payment.cashToCollect ?? 0)}</p>}
        <div className="mt-3 flex justify-between border-t border-slate-100 pt-3 font-bold"><span>Total del pedido</span><span>{formatCOP(order.totals.total)}</span></div>
        {(status === 'PENDIENTE_CONFIRMACION' || status === 'CONFIRMADO') && <button type="button" disabled={cancelling}
          onClick={() => void cancel()} className="mt-3 min-h-11 rounded-xl border border-red-200 px-3 text-sm font-bold text-red-800">
          {cancelling ? 'Cancelando…' : child ? 'Cancelar esta entrega' : 'Cancelar pedido'}</button>}
        {cancelError && <p role="alert" className="mt-2 text-sm text-red-800">{cancelError}</p>}
      </section>
    </div>
  </main>;
}
