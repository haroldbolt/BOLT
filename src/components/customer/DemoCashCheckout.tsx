import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, MapPin, Package } from 'lucide-react';
import { useCustomer } from '../../customer/client';
import { api } from '../../lib/api';
import { hasConfirmedDeliveryQuote } from '../../lib/checkoutReadiness';
import { cashDemoDriverName, cashDemoEmail, cashDemoSku, cashDemoStoreId } from '../../lib/demoCashCheckout';
import type { DeliveryQuote, QuoteRequest } from '../../lib/deliveryService';
import { formatCOP } from '../../lib/formatters';
import type { Order, Product, Store } from '../../types';
import { CheckoutModal } from './CheckoutModal';

export const DEMO_CASH_PATH = '/demo/efectivo-suba';
export const DEMO_CASH_ENDPOINT = '/api/v1/simulation/cash-checkout';
const DEMO_ORDER_KEY = 'bolt_demo_cash_order_suba_v1';
const contact = { name: 'Compra de prueba Suba', phone: '0000000000', email: cashDemoEmail };

interface DemoCashPreview {
  product: Product;
  address: QuoteRequest['destination'];
  store: Store;
}

function restoreDemoOrderId() {
  try { return sessionStorage.getItem(DEMO_ORDER_KEY); } catch { return null; }
}

export function DemoCashCheckout() {
  const { user } = useCustomer();
  const [preview, setPreview] = useState<DemoCashPreview>();
  const [order, setOrder] = useState<Order>();
  const [previousOrderId, setPreviousOrderId] = useState(restoreDemoOrderId);
  const [quote, setQuote] = useState<DeliveryQuote | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isCheckoutOpen, setIsCheckoutOpen] = useState(false);
  const [isQuoting, setIsQuoting] = useState(false);
  const [quoteError, setQuoteError] = useState('');
  const [loadError, setLoadError] = useState('');
  const quoteAttempt = useRef(0);
  const attemptPending = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const response = await fetch(DEMO_CASH_ENDPOINT, { cache: 'no-store', signal: controller.signal });
        if (response.status === 404 || !response.headers.get('content-type')?.includes('application/json')) {
          throw new Error('Esta prueba solo está disponible en la demo privada de BOLT.');
        }
        if (!response.ok) throw new Error('No pudimos cargar los datos de prueba de Suba. Recarga la página para reintentar.');
        const data: DemoCashPreview = await response.json();
        if (data.store?.id !== cashDemoStoreId || data.product?.sku !== cashDemoSku || !data.address?.address || !data.address.coordinates) {
          throw new Error('No pudimos cargar los datos de prueba de Suba. Recarga la página para reintentar.');
        }
        if (controller.signal.aborted) return;
        setPreview(data);
        const orderId = restoreDemoOrderId();
        if (orderId && api.hasOrderAccess(orderId)) {
          const existing = await api.getOrder(orderId, true).catch(() => null);
          if (!controller.signal.aborted && existing?.storeId === data.store.id && existing.items.length === 1 &&
              existing.items[0].productId === data.product.id && existing.items[0].quantity === 1 &&
              existing.payment.method === 'CASH_ON_DELIVERY') setOrder(existing);
        }
      } catch (cause) {
        if (!controller.signal.aborted) setLoadError(cause instanceof Error && !(cause instanceof TypeError)
          ? cause.message : 'No pudimos cargar la prueba. Recarga la página para reintentar.');
      } finally {
        if (!controller.signal.aborted) setIsLoading(false);
      }
    }
    void load();
    return () => { controller.abort(); quoteAttempt.current++; };
  }, []);

  async function openCheckout() {
    if (attemptPending.current || !preview || order || previousOrderId || user) return;
    const attempt = ++quoteAttempt.current;
    attemptPending.current = true;
    setIsQuoting(true);
    setQuoteError('');
    setQuote(null);
    try {
      const response = await fetch(DEMO_CASH_ENDPOINT + '/quote', { method: 'POST', cache: 'no-store' });
      if (!response.ok) throw new Error('Cotización no disponible');
      const result: DeliveryQuote = await response.json();
      if (attempt !== quoteAttempt.current) return;
      if (result.assignedStoreId !== preview.store.id || !result.availableModes?.turbo ||
          !hasConfirmedDeliveryQuote(result) || result.destination.address !== preview.address.address) {
        setIsCheckoutOpen(false);
        setQuoteError('Turbo no está listo para la prueba. Verifica que el conductor de Suba esté en turno, libre y que haya enviado su ubicación simulada. Luego actualiza la cotización.');
        return;
      }
      // The scenario covers one Turbo dispatch. The server still signs and validates the original quote.
      setQuote({ ...result, availableModes: { turbo: true, turboDividido: false, scheduled: false } });
      setIsCheckoutOpen(true);
    } catch {
      if (attempt === quoteAttempt.current) {
        setIsCheckoutOpen(false);
        setQuoteError('No pudimos consultar la cotización de prueba. Intenta nuevamente.');
      }
    } finally {
      if (attempt === quoteAttempt.current) {
        attemptPending.current = false;
        setIsQuoting(false);
      }
    }
  }

  function closeCheckout() {
    quoteAttempt.current++;
    attemptPending.current = false;
    setIsQuoting(false);
    setIsCheckoutOpen(false);
  }

  function acceptOrder(created: Order) {
    closeCheckout();
    setOrder(created);
    setPreviousOrderId(created.id);
    try { sessionStorage.setItem(DEMO_ORDER_KEY, created.id); } catch {}
  }

  const orderRef = order?.purchaseCode || order?.orderNumber || previousOrderId;
  const adminLink = (view: 'turbo' | 'dispatch') => '/admin/nuevo/?' + new URLSearchParams({
    view, sede: cashDemoStoreId, ...(orderRef ? { pedido: orderRef } : {}),
  });
  const linkStyle = 'inline-flex min-h-11 items-center rounded-xl border border-slate-200 px-3 text-sm font-bold text-slate-800 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-red-700';

  return (
    <main className="min-h-dvh bg-slate-50 px-4 pb-10 pt-5 text-slate-950 sm:px-6 sm:pt-9">
      <div className="mx-auto max-w-lg space-y-4">
        <a href="/" className="inline-flex min-h-11 items-center gap-2 pr-3 text-sm font-bold text-slate-700 hover:text-red-700">
          <ArrowLeft className="size-4" aria-hidden="true" /> Volver a BOLT Cliente
        </a>
        <header>
          <p className="text-sm font-bold text-red-700">BOLT Demo</p>
          <h1 className="mt-1 text-2xl font-black tracking-tight sm:text-3xl">Prueba de efectivo en Suba</h1>
          <p className="mt-2 text-sm text-slate-600">Prueba un solo pedido Turbo en los cuatro paneles. Usamos datos ficticios y no habrá cobro ni entrega real.</p>
        </header>
        {isLoading && <p role="status" className="text-sm text-slate-700">Cargando la prueba…</p>}
        {loadError && <p role="alert" className="rounded-xl bg-amber-50 p-4 text-sm text-amber-950">{loadError}</p>}
        {preview && !isLoading && (
          <>
            {previousOrderId ? (
              <section className="space-y-3 rounded-2xl border border-emerald-200 bg-white p-4 shadow-sm sm:p-5">
                <h2 className="text-lg font-extrabold">Pedido de prueba {orderRef}</h2>
                <p className="text-sm text-slate-700">Este es el mismo pedido que verás en Suba. El monto del pedido es de prueba; el cobro real es $0.</p>
                {order && <p className="text-sm font-semibold">Efectivo simulado: {formatCOP(order.totals.total)}</p>}
                <div className="flex flex-wrap gap-2">
                  <a className={linkStyle} href={'/confirmacion/' + encodeURIComponent(previousOrderId)}>Ver confirmación</a>
                  <a className={linkStyle} href={'/pedido/' + encodeURIComponent(previousOrderId)}>BOLT Cliente · Seguimiento</a>
                </div>
              </section>
            ) : (
              <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
                <h2 className="flex items-center gap-2 font-extrabold"><Package className="size-4" aria-hidden="true" /> {preview.product.name}</h2>
                <p className="text-sm text-slate-700">1 unidad · {formatCOP(preview.product.price)}</p>
                <p className="flex items-start gap-2 text-sm text-slate-700"><MapPin className="mt-0.5 size-4 shrink-0" aria-hidden="true" /> {preview.address.address}</p>
                {user ? <p role="status" className="rounded-xl bg-amber-50 p-3 text-sm text-amber-950">Abre esta prueba en una pestaña privada para no vincular el pedido ficticio a tu cuenta.</p> : (
                  <button type="button" disabled={isQuoting} onClick={() => void openCheckout()}
                    className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-red-700 px-4 text-sm font-bold text-white hover:bg-red-800 focus-visible:outline-2 focus-visible:outline-red-700 disabled:opacity-50">
                    {isQuoting ? 'Consultando cotización…' : quoteError ? 'Actualizar cotización' : 'Abrir checkout en efectivo'} <ArrowRight className="size-4" aria-hidden="true" />
                  </button>
                )}
                {quoteError && <p role="alert" className="rounded-xl bg-amber-50 p-3 text-sm text-amber-950">{quoteError}</p>}
              </section>
            )}
            <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5" aria-labelledby="demo-cash-instructions">
              <h2 id="demo-cash-instructions" className="font-extrabold">Recorrido de la prueba</h2>
              <ol className="list-decimal space-y-2 pl-5 text-sm text-slate-700">
                <li>En <a href="/simulacion" className="font-bold underline" target="_blank" rel="noopener">Simulación</a> encontrarás el acceso de <strong>{cashDemoDriverName}</strong>. Inicia turno en BOLT Conductor y toca <strong>Enviar ubicación simulada</strong>.</li>
                <li>Confirma en BOLT Cliente con el método <strong>Efectivo contra entrega</strong>. Los datos de contacto ya son ficticios.</li>
                <li>Abre BOLT Admin para consultar la reserva en Inventario de Suba y marcar ese pedido <strong>En alistamiento</strong> y <strong>Listo para despacho</strong>.</li>
                <li>Revisa la oferta en Despachos, acéptala en Conductor y vuelve al seguimiento de ese mismo pedido en BOLT Cliente.</li>
              </ol>
              <div className="flex flex-wrap gap-2">
                <a href="/conductor" target="_blank" rel="noopener" className={linkStyle}>BOLT Conductor</a>
                <a href={adminLink('turbo')} target="_blank" rel="noopener" className={linkStyle}>BOLT Admin · Suba</a>
                <a href={adminLink('dispatch')} target="_blank" rel="noopener" className={linkStyle}>Despachos · Suba</a>
              </div>
            </section>
          </>
        )}
      </div>
      {preview && <CheckoutModal
        isOpen={isCheckoutOpen && !user}
        onClose={closeCheckout}
        cartItems={[{ product: preview.product, quantity: 1 }]}
        currentStore={preview.store}
        customerAddress={preview.address.address}
        customerAddressDetails={preview.address.details}
        customerCoordinates={preview.address.coordinates}
        deliveryQuote={quote}
        selectedMode="TURBO"
        demoCashContact={contact}
        cartBlockReason={isQuoting ? 'Actualizando cotización…' : undefined}
        onRefreshCatalog={() => void openCheckout()}
        onOrderSuccess={acceptOrder}
      />}
    </main>
  );
}
