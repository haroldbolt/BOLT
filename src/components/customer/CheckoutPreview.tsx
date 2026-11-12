import { useEffect, useRef, useState } from 'react';
import { OrderConfirmation, type ConfirmationOrder } from './OrderConfirmation';

export const CHECKOUT_PREVIEW_PATH = '/demo/checkout';

const scenarios = [
  { state: 'confirmado', label: 'Pedido confirmado' },
  { state: 'pendiente', label: 'Pendiente de confirmación' },
] as const;

type Preview = { order: ConfirmationOrder } | { message: string };

export function CheckoutPreview() {
  const state = new URLSearchParams(window.location.search).get('estado') === 'pendiente' ? 'pendiente' : 'confirmado';
  const [preview, setPreview] = useState<Preview | null>(null);
  const [showTracking, setShowTracking] = useState(false);
  const trackingHeading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const response = await fetch(`/api/v1/simulation/checkout-preview?estado=${state}`, {
          cache: 'no-store',
          signal: controller.signal,
        });
        if (response.status === 401) {
          setPreview({ message: 'Ingresa con la clave de la demo para ver los pedidos de prueba.' });
          return;
        }
        if (response.status === 404 || !response.headers.get('content-type')?.includes('application/json')) {
          setPreview({ message: 'Esta vista está disponible en la demo privada de BOLT.' });
          return;
        }
        if (!response.ok) throw new Error('No se pudo cargar el pedido de prueba');
        const order: ConfirmationOrder = await response.json();
        if (!controller.signal.aborted) setPreview({ order });
      } catch {
        if (!controller.signal.aborted) setPreview({ message: 'No pudimos cargar la prueba. Recarga la página para intentar de nuevo.' });
      }
    }
    void load();
    return () => controller.abort();
  }, [state]);

  useEffect(() => {
    if (showTracking) trackingHeading.current?.focus();
  }, [showTracking]);

  if (!preview) {
    return <p role="status" className="mx-auto max-w-xl p-6 text-slate-700">Cargando pedido de prueba…</p>;
  }
  if ('message' in preview) {
    return (
      <main className="mx-auto max-w-xl space-y-4 p-6">
        <h1 className="text-xl font-bold text-slate-900">Vista de checkout</h1>
        <p role="status" className="text-slate-700">{preview.message}</p>
        <a href="/" className="inline-flex min-h-11 items-center font-bold text-red-700 underline">Volver a BOLT</a>
      </main>
    );
  }

  const { order } = preview;
  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white pt-safe pl-safe pr-safe">
        <div className="mx-auto max-w-3xl space-y-3 px-3 pb-3 sm:px-5">
          <p className="text-sm font-semibold text-slate-700"><span className="font-black text-red-700">BOLT Demo</span> · Pedido de prueba sin cobro</p>
          <nav aria-label="Estados de prueba" className="grid grid-cols-2 gap-2">
            {scenarios.map(scenario => (
              <a key={scenario.state} href={`${CHECKOUT_PREVIEW_PATH}?estado=${scenario.state}`}
                aria-current={scenario.state === state ? 'page' : undefined}
                className="flex min-h-11 items-center justify-center rounded-xl border border-slate-200 px-2 py-2 text-center text-xs font-bold text-slate-700 hover:border-red-300 aria-[current=page]:border-red-200 aria-[current=page]:bg-red-50 aria-[current=page]:text-red-800 sm:text-sm">
                {scenario.label}
              </a>
            ))}
          </nav>
        </div>
      </header>
      {showTracking ? (
        <main className="mx-auto max-w-3xl px-4 py-6 sm:px-6">
          <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 sm:p-7">
            <h1 ref={trackingHeading} tabIndex={-1} className="text-xl font-black text-slate-900">Seguimiento de prueba</h1>
            <p className="font-bold text-slate-800">Pedido {order.purchaseCode || order.orderNumber}</p>
            <p className="text-sm leading-relaxed text-slate-600">
              {state === 'pendiente' ? 'La sede está revisando la disponibilidad de entrega.' : 'Tu entrega programada quedó confirmada en este ejemplo.'}
            </p>
            <button type="button" onClick={() => setShowTracking(false)} className="min-h-11 rounded-xl border border-slate-200 px-4 font-bold text-slate-800">Volver al resumen</button>
          </section>
        </main>
      ) : (
        <OrderConfirmation order={order} onTrack={() => setShowTracking(true)} onContinue={() => window.location.assign('/')} />
      )}
    </div>
  );
}
