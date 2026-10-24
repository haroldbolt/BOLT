import React from 'react';
import { Zap, ShieldCheck, HeartPulse } from 'lucide-react';

interface CampaignBannerProps {
  onSelectCategory: (cat: any) => void;
}

export const CampaignBanner: React.FC<CampaignBannerProps> = ({ onSelectCategory }) => {
  return (
    <div className="space-y-3">
      {/* Main Campaign Hero Banner */}
      <div className="relative overflow-hidden rounded-3xl bg-linear-to-r from-red-600 via-red-500 to-amber-500 text-white p-5 shadow-sm">
        <div className="relative z-10 max-w-xs md:max-w-md space-y-1.5">
          <span className="inline-flex items-center gap-1 bg-yellow-400 text-red-950 font-black text-[11px] px-2.5 py-0.5 rounded-full uppercase tracking-wider">
            ⚡ Festival de Nutrición & Salud
          </span>
          <h2 className="text-xl md:text-2xl font-black tracking-tight leading-tight">
            Hasta 15% OFF en alimentos y farmacia
          </h2>
          <p className="text-xs text-red-100 font-medium">
            Entrega ultra-rápida en 15 minutos en Kennedy, Álamos y Suba.
          </p>
          <div className="pt-2 flex items-center gap-2">
            <button
              onClick={() => onSelectCategory('Farmacia')}
              className="bg-white hover:bg-red-50 text-red-600 font-extrabold text-xs px-3.5 py-1.5 rounded-full shadow-sm transition"
            >
              Ver Farmacia
            </button>
            <button
              onClick={() => onSelectCategory('Alimentos')}
              className="bg-red-800/60 hover:bg-red-800 text-white font-bold text-xs px-3.5 py-1.5 rounded-full transition"
            >
              Ver Alimentos
            </button>
          </div>
        </div>

        {/* Decorative lightning & silhouette background */}
        <div className="absolute -right-4 -bottom-6 w-36 h-36 opacity-30 pointer-events-none">
          <Zap className="w-full h-full text-yellow-300" />
        </div>
      </div>

      {/* Mini highlight pills */}
      <div className="grid grid-cols-2 gap-2.5">
        <div
          onClick={() => onSelectCategory('Farmacia')}
          className="bg-white p-3 rounded-2xl border border-slate-100 shadow-xs flex items-center gap-2.5 cursor-pointer hover:border-red-200 transition"
        >
          <div className="w-9 h-9 rounded-xl bg-red-50 flex items-center justify-center shrink-0">
            <HeartPulse className="w-5 h-5 text-red-600" />
          </div>
          <div className="overflow-hidden">
            <p className="text-xs font-black text-slate-900 leading-tight">Farmacia Veterinaria</p>
            <p className="text-[11px] text-slate-500 truncate">Medicamentos con Reg. ICA</p>
          </div>
        </div>

        <div
          onClick={() => onSelectCategory('Antipulgas')}
          className="bg-white p-3 rounded-2xl border border-slate-100 shadow-xs flex items-center gap-2.5 cursor-pointer hover:border-yellow-200 transition"
        >
          <div className="w-9 h-9 rounded-xl bg-amber-50 flex items-center justify-center shrink-0">
            <ShieldCheck className="w-5 h-5 text-amber-600" />
          </div>
          <div className="overflow-hidden">
            <p className="text-xs font-black text-slate-900 leading-tight">Antipulgas Express</p>
            <p className="text-[11px] text-slate-500 truncate">NexGard, Bravecto & más</p>
          </div>
        </div>
      </div>
    </div>
  );
};
