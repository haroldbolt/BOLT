import React from 'react';
import { Loader2, Navigation } from 'lucide-react';
import type {DeviceLocationFailure} from '../../lib/deviceLocation';

export function CurrentLocationAction({ onClick, busy = false, error, errorKind, onManualAddress, accuracyMeters }: {
  onClick: () => void; busy?: boolean; error?: string | null; errorKind?: DeviceLocationFailure | null;
  onManualAddress?: () => void; accuracyMeters?: number | null;
}) {
  return <div className="space-y-2">
    <button type="button" onClick={onClick} disabled={busy} aria-busy={busy}
      className="min-h-11 w-full flex items-center justify-center gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-sm font-semibold text-red-700 transition hover:bg-red-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 disabled:opacity-70">
      {busy ? <Loader2 aria-hidden="true" className="h-4 w-4 shrink-0 animate-spin" /> : <Navigation aria-hidden="true" className="h-4 w-4 shrink-0" />}
      {busy ? 'Solicitando tu ubicación…' : error ? 'Volver a intentar ubicación' : 'Usar mi ubicación actual'}
    </button>
    <p className="text-xs leading-relaxed text-slate-500">Con tu permiso, usaremos la ubicación de este dispositivo para encontrar tu dirección. Podrás revisarla antes de confirmar.</p>
    {busy && <p role="status" className="text-xs text-slate-600">Si aparece el aviso del navegador, elige Permitir para continuar. También puedes escribir la dirección.</p>}
    {error && <div role="alert" className="rounded-xl bg-amber-50 p-3 text-xs leading-relaxed text-amber-900">
      <p className="font-semibold">{error}</p>
      {errorKind === 'permission' && <div className="mt-2 space-y-2">
        <p className="font-semibold">En iPhone y Safari:</p>
        <ol className="list-decimal pl-5 space-y-1">
          <li>En el menú junto a la barra de direcciones, abre Configuración del sitio web → Ubicación y elige Preguntar o Permitir.</li>
          <li>En Ajustes del iPhone → Privacidad y seguridad → Localización, comprueba que esté activa y que Sitios web de Safari tenga permiso mientras usas la app.</li>
          <li>Vuelve a BOLT y pulsa Volver a intentar ubicación. Si el permiso no se actualiza, recarga esta página.</li>
        </ol>
        <p>En otros navegadores, revisa el permiso de ubicación del sitio y del dispositivo. BOLT no puede cambiar estos permisos por ti.</p>
      </div>}
    </div>}
    {onManualAddress && (busy || error) && <button type="button" onClick={onManualAddress} className="min-h-11 px-3 py-2 text-sm font-semibold text-slate-700 underline rounded-xl focus-visible:ring-2 focus-visible:ring-red-500">Escribir dirección</button>}
    {accuracyMeters != null && <p role="status" className="rounded-xl bg-blue-50 p-3 text-xs leading-relaxed text-blue-900">Ubicación aproximada · precisión reportada: {Math.max(1, Math.round(accuracyMeters)).toLocaleString('es-CO')} m. Revisa la dirección y ajusta el punto de entrega si hace falta.</p>}
  </div>;
}
