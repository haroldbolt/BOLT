import React from 'react';
import { Product } from '../../types';
import { Scale, X, ArrowRight, Trash2 } from 'lucide-react';
import { formatCOP } from '../../lib/formatters';

interface ProductCompareBarProps {
  compareProducts: Product[];
  onRemoveProduct: (productId: string) => void;
  onClearAll: () => void;
  onOpenModal: () => void;
}

export const ProductCompareBar: React.FC<ProductCompareBarProps> = ({
  compareProducts,
  onRemoveProduct,
  onClearAll,
  onOpenModal,
}) => {
  if (compareProducts.length === 0) return null;

  return (
    <div className="fixed bottom-20 md:bottom-6 left-1/2 -translate-x-1/2 z-40 w-[95%] max-w-2xl animate-in slide-in-from-bottom duration-300">
      <div className="bg-slate-900/95 backdrop-blur-md text-white rounded-2xl p-3 sm:p-3.5 shadow-2xl border border-slate-800 flex items-center justify-between gap-3">
        {/* Left side: Icon, title & product preview badges */}
        <div className="flex items-center gap-3 overflow-hidden">
          <div className="w-9 h-9 rounded-xl bg-amber-400 text-slate-900 flex items-center justify-center shrink-0 font-black shadow-xs">
            <Scale className="w-5 h-5 stroke-[2.5]" />
          </div>

          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-black text-xs sm:text-sm tracking-tight text-white">
                Comparador
              </span>
              <span className="text-[10px] font-bold bg-amber-400/20 text-amber-300 border border-amber-400/30 px-1.5 py-0.5 rounded-full">
                {compareProducts.length}/3
              </span>
            </div>
            <p className="text-[11px] text-slate-300 hidden sm:block truncate">
              {compareProducts.map(p => p.name).join(' vs ')}
            </p>
          </div>

          {/* Product thumbnails with remove button */}
          <div className="flex items-center gap-1.5 pl-2 border-l border-slate-700/60">
            {compareProducts.map((prod) => (
              <div key={prod.id} className="relative group shrink-0">
                <img
                  src={prod.image}
                  alt={prod.name}
                  className="w-8 h-8 sm:w-9 sm:h-9 rounded-lg object-cover bg-white p-0.5 border border-slate-700"
                  title={`${prod.name} (${formatCOP(prod.price)})`}
                />
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemoveProduct(prod.id);
                  }}
                  className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-slate-800 hover:bg-rose-600 text-white flex items-center justify-center text-[10px] shadow-xs cursor-pointer transition-colors"
                  title="Quitar del comparador"
                >
                  <X className="w-2.5 h-2.5" />
                </button>
              </div>
            ))}

            {/* Empty slots placeholders */}
            {Array.from({ length: 3 - compareProducts.length }).map((_, idx) => (
              <div
                key={`empty-${idx}`}
                className="w-8 h-8 sm:w-9 sm:h-9 rounded-lg border border-dashed border-slate-700 flex items-center justify-center text-slate-500 text-[10px] font-bold"
                title="Espacio disponible para comparar"
              >
                +
              </div>
            ))}
          </div>
        </div>

        {/* Right side: Actions */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={onClearAll}
            className="p-2 rounded-xl text-slate-400 hover:text-rose-400 hover:bg-slate-800 transition-colors cursor-pointer"
            title="Limpiar comparador"
          >
            <Trash2 className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={onOpenModal}
            className="px-3.5 py-2 bg-amber-400 hover:bg-amber-300 text-slate-900 font-extrabold text-xs rounded-xl shadow-xs transition-all flex items-center gap-1.5 cursor-pointer whitespace-nowrap active:scale-95"
          >
            <span>Comparar {compareProducts.length >= 2 ? `(${compareProducts.length})` : ''}</span>
            <ArrowRight className="w-3.5 h-3.5 stroke-[2.5]" />
          </button>
        </div>
      </div>
    </div>
  );
};
