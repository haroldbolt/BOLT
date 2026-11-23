import { useEffect, useState } from 'react';
import { MapPin } from 'lucide-react';
import type { CartItem, DeliveryMode, Order, ScheduledDeliveryWindow } from '../../types';
import { api } from '../../lib/api';
import { backendFetch, isBoltSplitDeployment } from '../../lib/backendRequest';
import type { DeliveryQuote, QuoteRequest } from '../../lib/deliveryService';
import { saleVariant } from '../../lib/variantCommerce';
import { CheckoutModal } from './CheckoutModal';
import { OrderConfirmation } from './OrderConfirmation';

type ReviewStore = { id: string; name: string; destination: QuoteRequest['destination'] };
interface ReviewSetup { stores: ReviewStore[]; cart: CartItem[] }
const fixtureId = 'RDI-EFECTIVO-1KG';

async function loadReview(signal: AbortSignal): Promise<ReviewSetup> {
  const unavailable = 'El checkout de prueba no está disponible en esta instalación.';
  if (isBoltSplitDeployment()) throw Error(unavailable);
  const response = await backendFetch('/api/v1/simulation/cash-review', { signal, cache: 'no-store' });
  if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) throw Error(unavailable);
  const data = await response.json();
  if (data.enabled !== true || data.productId !== fixtureId || data.variantId !== fixtureId || !Array.isArray(data.stores) || !data.stores.length) throw Error(unavailable);
  const catalog = await api.getCatalog({ q: fixtureId }, { requireServer: true });
  const product = catalog.find(item => item.id === data.productId);
  if (!product) throw Error('El producto de prueba aún no está disponible en el catálogo.');
  const sale = saleVariant(product, data.variantId);
  if ((sale.variantId ?? sale.id) !== data.variantId) throw Error('La presentación de prueba no está disponible.');
  return { stores: data.stores, cart: [{ product: sale, quantity: 1 }] };
}

export function DemoCashReview({ startInSuba = false }: { startInSuba?: boolean } = {}) {
  const [setup, setSetup] = useState<ReviewSetup | null>(null);
  const [error, setError] = useState('');
  const [store, setStore] = useState<ReviewStore | null>(null);
  const [mode, setMode] = useState<DeliveryMode>('TURBO');
  const [slot, setSlot] = useState<ScheduledDeliveryWindow | null>(null);
  const [quote, setQuote] = useState<DeliveryQuote | null>(null);
  const [revision, setRevision] = useState(0);
  const [order, setOrder] = useState<Order | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    loadReview(controller.signal)
      .then(result => {
        if (controller.signal.aborted) return;
        setSetup(result);
        if (startInSuba) setStore(result.stores.find(item => item.id === 'HUB_SUBA') ?? null);
      })
      .catch(cause => { if (!controller.signal.aborted) setError(cause.message || 'No pudimos abrir el checkout de prueba.'); });
    return () => controller.abort();
  }, [startInSuba]);

  useEffect(() => {
    if (!store || !setup || order) return;
    let active = true;
    api.getDeliveryQuote({
      destination: store.destination,
      items: setup.cart.map(item => ({ productId: item.product.id, quantity: item.quantity })),
      requestedMode: mode,
      scheduledWindow: mode === 'PROGRAMADO' ? slot ?? undefined : undefined,
    }).then(result => {
      if (!active) return;
      if (result.assignedStoreId && result.assignedStoreId !== store.id) {
        setError('La cotización corresponde a otra sede. Vuelve a elegir la sede para esta prueba.');
        return;
      }
      setQuote(result);
      if (!result.basketValidated || !result.assignedStoreId) setError(result.message || 'La sede no pudo validar esta entrega de prueba.');
      else if (result.recommendedMode === 'PROGRAMADO' && mode === 'TURBO' && !result.availableModes.turbo) setMode('PROGRAMADO');
    }).catch(cause => { if (active) setError(cause.message || 'No pudimos consultar la disponibilidad.'); });
    return () => { active = false; };
  }, [store, setup, mode, slot, revision, order]);

  const invalidate = () => { setError(''); setQuote(null); };
  const selectStore = (next: ReviewStore | null) => {
    invalidate(); setMode('TURBO'); setSlot(null); setOrder(null); setStore(next);
  };

  if (order) {
    const adminQuery = new URLSearchParams({
      view: order.deliveryMode === 'PROGRAMADO' ? 'scheduled' : 'turbo',
      sede: order.storeId, pedido: order.id,
    });
    return <>
      <nav aria-label="Revisión del pedido" className="flex flex-wrap justify-center gap-3 bg-white p-3 text-sm font-bold text-red-700">
        <button className="min-h-11 rounded-xl px-4 hover:bg-red-50" onClick={() => selectStore(null)}>Probar otra sede</button>
        <a className="inline-flex min-h-11 items-center rounded-xl px-4 hover:bg-red-50" href={'/admin/nuevo/?' + adminQuery}>Abrir en BOLT Admin</a>
      </nav>
      <OrderConfirmation order={order} onTrack={() => window.location.assign('/pedido/' + encodeURIComponent(order.id))}
        onContinue={() => window.location.assign('/')} />
    </>;
  }

  if (store && setup) return <CheckoutModal isOpen demoCashReview currentStore={null} cartItems={setup.cart}
    customerAddress={store.destination.address} customerCoordinates={store.destination.coordinates}
    deliveryQuote={quote} cartBlockReason={error || (!quote ? 'Consultando la sede…' : undefined)}
    onChangeAddress={() => selectStore(null)} onClose={() => selectStore(null)}
    onRefreshCatalog={() => { invalidate(); setRevision(value => value + 1); }}
    selectedMode={mode} onSelectMode={next => { if (next !== mode) { invalidate(); setSlot(null); setMode(next); } }}
    selectedScheduledWindow={slot} onSelectScheduledWindow={next => {
      if (next.date !== slot?.date || next.slotId !== slot?.slotId) { invalidate(); setSlot(next); }
    }} onOrderSuccess={setOrder} />;

  return <main className="min-h-screen bg-slate-50 p-4 text-slate-950 sm:p-10">
    <div className="mx-auto max-w-lg rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
      <a href="/" className="text-sm font-bold text-red-700 underline">Volver a BOLT Cliente</a>
      <h1 className="mt-5 text-2xl font-black">Checkout de prueba en efectivo</h1>
      <p className="mt-2 text-sm text-slate-700">Elige una sede para probar Turbo o Programado con un producto y una dirección de prueba. El recaudo es $0.</p>
      {error && <p role="alert" className="mt-4 text-sm font-semibold text-red-700">{error} <button type="button" className="underline" onClick={() => window.location.reload()}>Volver a intentar</button></p>}
      {!setup && !error && <p role="status" className="mt-4 text-sm">Consultando las sedes…</p>}
      {setup && <p className="mt-3 text-sm font-bold text-slate-800">{setup.cart[0].product.name} · {setup.cart[0].product.presentation} · 1 unidad</p>}
      <div className="mt-5 grid gap-2">
        {setup?.stores.map(candidate => <button key={candidate.id} type="button" onClick={() => selectStore(candidate)}
          className="flex min-h-12 items-center gap-3 rounded-xl border border-slate-200 px-4 py-3 text-left font-bold hover:border-red-600 focus-visible:outline-red-700">
          <MapPin className="size-5 text-red-700" aria-hidden="true" />{candidate.name}
        </button>)}
      </div>
    </div>
  </main>;
}
