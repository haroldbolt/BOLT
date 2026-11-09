import React from 'react';
import { Loader2, Navigation } from 'lucide-react';

export function CurrentLocationAction({ onClick, busy = false, error, accuracyMeters }: {
  onClick: () => void; busy?: boolean; error?: string | null; accuracyMeters?: number | null;
}) {
  return <div className="space-y-2">
    <button type="button" onClick={onClick} disabled={busy} aria-busy={busy}
      className="min-h-11 w-full flex items-center justify-center gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-sm font-semibold text-red-700 transition hover:bg-red-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 disabled:opacity-70">
      {busy ? <Loader2 aria-hidden="true" className="h-4 w-4 shrink-0 animate-spin" /> : <Navigation aria-hidden="true" className="h-4 w-4 shrink-0" />}
      {busy ? 'Obteniendo tu ubicación…' : 'Usar mi ubicación actual'}
    </button>
    <p className="text-xs leading-relaxed text-slate-500">Con tu permiso, usaremos la ubicación de este dispositivo para encontrar tu dirección. Podrás revisarla antes de confirmar.</p>
    {error && <p role="alert" className="rounded-xl bg-amber-50 p-3 text-xs leading-relaxed text-amber-900">{error}</p>}
    {accuracyMeters != null && <p role="status" className="rounded-xl bg-blue-50 p-3 text-xs leading-relaxed text-blue-900">Ubicación aproximada · precisión reportada: {Math.max(1, Math.round(accuracyMeters)).toLocaleString('es-CO')} m. Revisa la dirección y ajusta el punto de entrega si hace falta.</p>}
  </div>;
}
