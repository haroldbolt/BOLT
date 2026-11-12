import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { OrderConfirmation, type ConfirmationOrder } from './OrderConfirmation';

interface Props {
  orderId: string;
  initialOrder: ConfirmationOrder | null;
  onTrack: () => void;
  onContinue: () => void;
}

export function OrderConfirmationPage({ orderId, initialOrder, onTrack, onContinue }: Props) {
  const [order, setOrder] = useState(initialOrder);
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    if (initialOrder) return;
    let active = true;
    api.getOrder(orderId, true).then((result) => {
      if (active) setOrder(result);
    }).catch(() => {
      if (active) setLoadFailed(true);
    });
    return () => { active = false; };
  }, [orderId, initialOrder]);

  if (order) return <OrderConfirmation order={order} onTrack={onTrack} onContinue={onContinue} />;

  return (
    <main className="min-h-screen bg-slate-50 p-4 text-slate-950 sm:p-8">
      <div className="mx-auto max-w-lg rounded-2xl border border-slate-200 bg-white p-5">
        <h1 className="text-xl font-extrabold">Resumen de tu pedido</h1>
        <p role="status" className="mt-2 text-sm text-slate-700">
          {loadFailed ? 'No pudimos cargar el resumen. Abre el seguimiento para consultar tu pedido.' : 'Cargando los detalles de tu pedido…'}
        </p>
        {loadFailed && <button type="button" onClick={onTrack} className="mt-3 min-h-11 font-bold text-red-700 underline">Abrir seguimiento</button>}
        <button type="button" onClick={onContinue} className="block min-h-11 text-sm font-semibold text-slate-700">Volver a la tienda</button>
      </div>
    </main>
  );
}
