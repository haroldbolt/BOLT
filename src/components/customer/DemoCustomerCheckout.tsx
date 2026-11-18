import { backendFetch } from '../../lib/backendRequest';
import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, MapPin, Package } from 'lucide-react';
import { api } from '../../lib/api';
import { formatCOP } from '../../lib/formatters';
import type { Order, OrderItem } from '../../types';
import { ProductImage } from '../common/ProductImage';
import { OrderConfirmation } from './OrderConfirmation';

export const DEMO_CUSTOMER_CHECKOUT_ENDPOINT = '/api/v1/simulation/customer-checkout';
const checkoutStorageKey = 'bolt_demo_customer_checkout_v1';

interface DemoCheckoutPreview {
  enabled: true;
  storeId: string;
  storeName: string;
  deliveryMode: 'TURBO' | 'PROGRAMADO';
  items: OrderItem[];
  address: string;
  subtotalCOP: number;
  cashToCollect: 0;
}

interface DemoCheckoutAttempt {
  requestId: string;
  orderId?: string;
}

function readAttempt(): DemoCheckoutAttempt | undefined {
  try {
    const attempt = JSON.parse(sessionStorage.getItem(checkoutStorageKey) || 'null');
    if (typeof attempt?.requestId === 'string') return attempt;
  } catch {}
}

function saveAttempt(attempt: DemoCheckoutAttempt) {
  try { sessionStorage.setItem(checkoutStorageKey, JSON.stringify(attempt)); } catch {}
}

export function DemoCustomerCheckout({ onOrderSuccess }: { onOrderSuccess: (order: Order) => void }) {
  const attempt = useRef<DemoCheckoutAttempt | undefined>(undefined);
  const submitting = useRef(false);
  const [preview, setPreview] = useState<DemoCheckoutPreview>();
  const [order, setOrder] = useState<Order>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        attempt.current = readAttempt();
        if (attempt.current?.orderId && api.hasOrderAccess(attempt.current.orderId)) {
          const previous = await api.getOrder(attempt.current.orderId, true).catch(() => undefined);
          if (controller.signal.aborted) return;
          if (previous?.demoCustomerCheckout) {
            setOrder(previous);
            return;
          }
        }

        const response = await backendFetch(DEMO_CUSTOMER_CHECKOUT_ENDPOINT, { cache: 'no-store', signal: controller.signal });
        if (response.status === 404 || !response.headers.get('content-type')?.includes('application/json')) {
          throw new Error('Este pedido de prueba está disponible en la demo privada de BOLT.');
        }
        const data = await response.json();
        if (!response.ok || data?.enabled !== true || data.cashToCollect !== 0) {
          throw new Error(data?.error || 'No pudimos consultar el pedido de prueba. Recarga la página para reintentar.');
        }
        if (!controller.signal.aborted) setPreview(data);
      } catch (cause) {
        if (!controller.signal.aborted) {
          setError(cause instanceof Error && !(cause instanceof TypeError)
            ? cause.message : 'No pudimos cargar el pedido de prueba. Recarga la página para reintentar.');
        }
      }
    }
    void load();
    return () => controller.abort();
  }, []);

  const confirm = async () => {
    if (submitting.current || !preview) return;
    submitting.current = true;
    setBusy(true);
    setError('');

    try {
      const current = attempt.current ??= { requestId: crypto.randomUUID() };
      saveAttempt(current);
      const response = await backendFetch(DEMO_CUSTOMER_CHECKOUT_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': current.requestId },
        cache: 'no-store',
        body: '{}',
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.order?.id || data.order.demoCustomerCheckout !== true || data.order.payment?.cashToCollect !== 0 ||
        typeof data.guestAccessToken !== 'string' || !data.guestAccessToken) {
        throw new Error(data?.error || 'No pudimos confirmar el pedido de prueba. Puedes reintentar.');
      }
      api.saveOrderAccess(data.order.id, data.guestAccessToken);
      current.orderId = data.order.id;
      saveAttempt(current);
      setOrder(data.order);
    } catch (cause) {
      setError(cause instanceof Error && !(cause instanceof TypeError)
        ? cause.message : 'No pudimos confirmar el pedido de prueba. Puedes reintentar.');
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  };

  if (order) {
    return <OrderConfirmation order={order} onTrack={() => onOrderSuccess(order)} onContinue={() => window.location.assign('/')} />;
  }

  return (
    <main className="min-h-dvh bg-slate-50 px-4 pb-10 pt-5 text-slate-950 sm:px-6 sm:pt-9">
      <div className="mx-auto max-w-lg space-y-4">
        <a href="/" className="inline-flex min-h-11 items-center gap-2 rounded-xl pr-3 text-sm font-bold text-slate-700 hover:text-red-700">
          <ArrowLeft className="size-4" aria-hidden="true" /> Volver a BOLT Cliente
        </a>
        <header>
          <p className="text-sm font-bold text-red-700">BOLT Demo</p>
          <h1 className="mt-1 text-2xl font-black tracking-tight sm:text-3xl">Pedido de prueba en Suba</h1>
          <p className="mt-2 text-sm text-slate-600">Usamos datos de prueba y un despacho simulado. No se generará ningún cobro.</p>
        </header>

        {!preview && !error && <p role="status" className="text-sm text-slate-700">Cargando el pedido de prueba…</p>}
        {preview && (
          <section aria-labelledby="demo-checkout-summary" className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
            <h2 id="demo-checkout-summary" className="flex items-center gap-2 text-base font-extrabold">
              <Package className="size-4 text-slate-600" aria-hidden="true" /> Resumen del pedido
            </h2>
            <ul className="space-y-3">
              {preview.items.map(item => (
                <li key={`${item.productId}:${item.sku}`} className="flex items-center gap-3 text-sm">
                  {item.image && <ProductImage src={item.image} alt="" className="size-12 shrink-0 rounded-lg bg-slate-50 object-contain" />}
                  <div className="min-w-0 flex-1">
                    <p className="break-words font-bold">{item.name}</p>
                    <p className="text-slate-600">{item.presentation} · {item.quantity} {item.quantity === 1 ? 'unidad' : 'unidades'}</p>
                  </div>
                </li>
              ))}
            </ul>
            <div className="flex gap-2 border-y border-slate-100 py-3 text-sm text-slate-700">
              <MapPin className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <div>
                <p className="font-bold">{preview.storeName} · {preview.deliveryMode === 'PROGRAMADO' ? 'Programado' : 'Turbo'}</p>
                <p>{preview.address}</p>
              </div>
            </div>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between gap-2 text-slate-700"><dt>Subtotal de prueba</dt><dd>{formatCOP(preview.subtotalCOP)}</dd></div>
              <div className="flex justify-between gap-2 text-base font-extrabold"><dt>Total a cobrar</dt><dd>{formatCOP(preview.cashToCollect)}</dd></div>
            </dl>
            <button type="button" onClick={confirm} disabled={busy}
              className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-red-700 px-4 text-sm font-bold text-white hover:bg-red-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-700 disabled:opacity-50">
              {busy ? 'Confirmando pedido…' : 'Confirmar pedido de prueba'} <ArrowRight className="size-4" aria-hidden="true" />
            </button>
          </section>
        )}
        {error && <p role="alert" className="rounded-xl bg-amber-50 p-4 text-sm text-amber-950">{error}</p>}
      </div>
    </main>
  );
}
