import { backendUrl, isBoltSplitDeployment } from '../../lib/backendRequest';

/** Starting over only forgets the local retry. The client must confirm a new purchase separately. */
export function CheckoutAttemptReview({ onStartNew }: { onStartNew: () => void }) {
  const recovery = isBoltSplitDeployment()
    ? new URL('/recuperar-seguimiento', backendUrl('/api/v1/checkout/attempt').origin).href : '/recuperar-seguimiento';
  return <div role="alert" className="space-y-2 rounded-xl bg-amber-50 p-4 text-sm text-amber-950">
    <p>Esta confirmación requiere revisión. Comprueba si tu pedido ya figura en el historial antes de hacer otra compra.</p>
    <a href={recovery} target="_blank" rel="noreferrer" className="block font-bold underline">Recuperar seguimiento privado</a>
    <button type="button" onClick={onStartNew} className="min-h-11 text-left font-bold underline">Ya revisé mi pedido. Preparar otra compra</button>
  </div>;
}
