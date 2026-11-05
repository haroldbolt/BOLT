import React from 'react';

/** General offer, kept separate from an individual order's validated delivery time. */
export function TurboPromise({ inverse = false }: { inverse?: boolean }) {
  return <div className="space-y-0.5" aria-label="Oferta de entrega Turbo">
    <span className="inline-flex items-center gap-1 rounded-full bg-yellow-400 px-2.5 py-1 text-[11px] font-black text-red-950">⚡ Turbo hasta 25 minutos</span>
    <p className={`text-[10px] leading-snug ${inverse ? 'text-red-100' : 'text-slate-500'}`}>En zonas habilitadas. Confirma tu dirección.</p>
  </div>;
}
