import { ArrowRight, Check, Clock3, CreditCard, MapPin, Package, X } from 'lucide-react';
import { formatCOP } from '../../lib/formatters';
import type { Order } from '../../types';
import { ProductImage } from '../common/ProductImage';

export type ConfirmationOrder = Pick<Order,
  'id' | 'orderNumber' | 'purchaseCode' | 'fulfillmentStatus' | 'deliveryReview' |
  'deliveryMode' | 'scheduledWindow' | 'estimatedDeliveryMinutes' | 'deliveryAddress' |
  'items' | 'totals' | 'payment'>;

interface Props {
  order: ConfirmationOrder;
  onTrack: () => void;
  onContinue: () => void;
}

function paymentDetails(payment: Order['payment'], waitingForDelivery: boolean) {
  if (payment.status === 'REEMBOLSADO') return 'Pago reembolsado';
  if (payment.status === 'RECHAZADO') return 'Pago rechazado';
  if (payment.status === 'APROBADO' || payment.cashSettled) return 'Pago aprobado';
  if (waitingForDelivery) return 'Sin cobro por ahora';
  if (payment.method === 'CASH_ON_DELIVERY') return 'Pendiente · Pago contra entrega';
  return 'Pago pendiente';
}

export function OrderConfirmation({ order, onTrack, onContinue }: Props) {
  const cancelled = order.fulfillmentStatus === 'CANCELADO';
  const pending = !cancelled && (order.fulfillmentStatus === 'PENDIENTE_CONFIRMACION' || order.deliveryReview?.status === 'PENDING');
  const delivered = order.fulfillmentStatus === 'ENTREGADO';
  const unconfirmedTotal = pending || order.deliveryReview?.status === 'PENDING';
  const title = cancelled ? 'Pedido cancelado' : pending ? 'Recibimos tu pedido' : delivered ? 'Pedido entregado' : '¡Pedido confirmado!';
  const description = cancelled ? 'Consulta los detalles de la cancelación en tu pedido.' : pending
    ? 'La sede confirmará la entrega contigo.'
    : delivered ? 'Gracias por comprar en Bolt Pets.' : 'Consulta el avance de tu entrega desde el seguimiento.';
  const StatusIcon = cancelled ? X : pending ? Clock3 : Check;
  const statusStyle = cancelled ? 'bg-slate-100 text-slate-600' : pending ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800';
  const mode = order.deliveryMode === 'PROGRAMADO' ? 'Entrega programada'
    : order.deliveryMode === 'TURBO_DIVIDIDO' ? 'Entrega Turbo en varios envíos'
    : order.deliveryMode === 'TURBO' ? 'Entrega Turbo' : 'Entrega';
  const scheduled = order.deliveryMode === 'PROGRAMADO' ? order.scheduledWindow : undefined;
  const eta = order.deliveryMode !== 'PROGRAMADO' && order.estimatedDeliveryMinutes > 0
    ? `Tiempo estimado: ${Math.ceil(order.estimatedDeliveryMinutes)} min` : null;

  return (
    <main className="min-h-screen bg-slate-50 px-4 pb-10 pt-5 text-slate-950 sm:px-6 sm:pt-9">
      <div className="mx-auto max-w-3xl space-y-4">
        <header className="rounded-3xl border border-slate-200 bg-white px-5 py-7 text-center shadow-sm sm:px-10">
          <img src="/assets/aistudio/Bolt_Pets_logo_original__1__ce47c0d5.jpg" alt="Bolt Pets" className="mx-auto mb-5 h-9 w-auto object-contain" />
          <span className={`mx-auto mb-3 grid size-12 place-items-center rounded-full ${statusStyle}`}>
            <StatusIcon className="size-6" aria-hidden="true" />
          </span>
          <h1 className="text-2xl font-black tracking-tight sm:text-3xl">{title}</h1>
          <p className="mt-2 text-sm text-slate-600 sm:text-base">{description}</p>
          <p className="mt-3 break-all text-sm font-bold text-slate-700">Pedido {order.purchaseCode || order.orderNumber}</p>
          <div className="mx-auto mt-5 flex max-w-sm flex-col gap-1.5 sm:flex-row sm:justify-center">
            <button type="button" onClick={onTrack} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-red-700 px-5 text-sm font-bold text-white transition hover:bg-red-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-700">
              Ver mi pedido <ArrowRight className="size-4" aria-hidden="true" />
            </button>
            <button type="button" onClick={onContinue} className="min-h-11 rounded-xl px-4 text-sm font-semibold text-slate-700 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-700">
              Seguir comprando
            </button>
          </div>
        </header>

        <div className="grid items-start gap-4 sm:grid-cols-[3fr_2fr]">
          <section aria-labelledby="confirmation-items" className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
            <h2 id="confirmation-items" className="flex items-center gap-2 text-base font-extrabold">
              <Package className="size-4 text-slate-600" aria-hidden="true" /> Resumen del pedido
            </h2>
            <ul className="mt-2 divide-y divide-slate-100">
              {order.items.map((item) => (
                <li key={item.productId} className="flex items-center gap-3 py-3 text-sm">
                  {item.image && (
                    <div className="size-10 shrink-0 overflow-hidden rounded-lg bg-slate-50">
                      <ProductImage src={item.image} alt="" className="size-full object-contain" />
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="break-words font-semibold">{item.name}</p>
                    {item.presentation && <p className="text-xs text-slate-600">{item.presentation}</p>}
                    <p className="text-xs text-slate-600">Cantidad: {item.quantity}</p>
                  </div>
                  <p className="shrink-0 font-bold tabular-nums">{formatCOP(item.quantity * item.price)}</p>
                </li>
              ))}
            </ul>
            <dl className="space-y-2 border-t border-slate-200 pt-3 text-sm text-slate-700">
              <PriceRow label="Subtotal de productos" amount={formatCOP(order.totals.subtotal)} />
              {unconfirmedTotal ? <PriceRow label="Total final" amount="Por confirmar" strong /> : (
                <>
                  {order.totals.discount > 0 && <PriceRow label="Descuento" amount={`−${formatCOP(order.totals.discount)}`} />}
                  <PriceRow label="Envío" amount={order.totals.shipping === 0 ? 'Gratis' : formatCOP(order.totals.shipping)} />
                  {order.totals.serviceFee > 0 && <PriceRow label="Tarifa de servicio" amount={formatCOP(order.totals.serviceFee)} />}
                  {order.totals.tip > 0 && <PriceRow label="Propina" amount={formatCOP(order.totals.tip)} />}
                  <PriceRow label="Total del pedido" amount={formatCOP(order.totals.total)} strong />
                </>
              )}
            </dl>
          </section>

          <div className="grid gap-4">
            <section aria-labelledby="confirmation-payment" className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
              <h2 id="confirmation-payment" className="flex items-center gap-2 text-base font-extrabold">
                <CreditCard className="size-4 text-slate-600" aria-hidden="true" /> Pago
              </h2>
              <p className="mt-2 text-sm font-semibold text-slate-800">{paymentDetails(order.payment, unconfirmedTotal)}</p>
            </section>

            <section aria-labelledby="confirmation-delivery" className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
              <h2 id="confirmation-delivery" className="flex items-center gap-2 text-base font-extrabold">
                <MapPin className="size-4 text-slate-600" aria-hidden="true" /> Entrega
              </h2>
              {pending && <p className="mt-2 text-sm font-semibold text-amber-900">Costo y horario por confirmar</p>}
              {cancelled && <p className="mt-2 text-sm font-semibold text-slate-700">Entrega cancelada</p>}
              {!pending && !cancelled && (
                <div className="mt-2 text-sm text-slate-700">
                  <p className="font-semibold text-slate-800">{mode}</p>
                  {scheduled && <p>{scheduled.dateLabel} · {scheduled.displayWindowShort || scheduled.displayWindow}</p>}
                  {!delivered && eta && <p>{eta}</p>}
                </div>
              )}
              {order.deliveryAddress.address && (
                <p className="mt-2 break-words text-sm text-slate-600">{order.deliveryAddress.address}</p>
              )}
            </section>
          </div>
        </div>
      </div>
    </main>
  );
}

function PriceRow({ label, amount, strong }: { label: string; amount: string; strong?: boolean }) {
  return (
    <div className={`flex items-baseline justify-between gap-3 ${strong ? 'border-t border-slate-100 pt-2 font-extrabold text-slate-950' : ''}`}>
      <dt>{label}</dt><dd className="text-right tabular-nums">{amount}</dd>
    </div>
  );
}
