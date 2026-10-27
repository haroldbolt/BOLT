import React from 'react';
import { Zap, Heart, Tag, LayoutGrid, Search, ShoppingBag, Bookmark } from 'lucide-react';
import { formatCOP } from '../../lib/formatters';

export type CustomerNavTab = 'turbo' | 'favoritos' | 'deseos' | 'ofertas' | 'categorias';

interface FloatingNavProps {
  currentTab: CustomerNavTab;
  onSelectTab: (tab: CustomerNavTab) => void;
  onTriggerSearch: () => void;
  cartCount: number;
  cartTotal: number;
  onOpenCart: () => void;
  wishlistCount?: number;
}

export const FloatingNav: React.FC<FloatingNavProps> = ({
  currentTab,
  onSelectTab,
  onTriggerSearch,
  cartCount,
  cartTotal,
  onOpenCart,
  wishlistCount = 0,
}) => {
  return (
    <div className="fixed bottom-0 left-0 right-0 z-40 px-3 sm:px-6 pointer-events-none pb-safe">
      <div className="max-w-md sm:max-w-lg mx-auto flex flex-col gap-2.5">
        {/* Floating "Ver Carrito" bar above menu when cart has items */}
        {cartCount > 0 && (
          <div
            onClick={onOpenCart}
            className="pointer-events-auto bg-[#DC2626] hover:bg-red-700 active:scale-[0.98] text-white px-4 py-3 rounded-2xl shadow-xl flex items-center justify-between cursor-pointer transition animate-in slide-in-from-bottom-2 duration-200"
          >
            <div className="flex items-center gap-2.5">
              <span className="w-6 h-6 rounded-full bg-white text-red-600 flex items-center justify-center text-xs font-black">
                {cartCount}
              </span>
              <span className="font-extrabold text-sm tracking-tight">Ver carrito</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="font-black text-sm">{formatCOP(cartTotal)}</span>
              <span className="text-yellow-300 text-xs">➔</span>
            </div>
          </div>
        )}

        {/* Floating 5-item Navigation bar + circular search button */}
        <div className="flex items-center gap-2" id="tour-bottom-nav">
          {/* Main 5-destination pill */}
          <nav className="pointer-events-auto flex-1 bg-white/95 backdrop-blur-md rounded-full px-2 sm:px-3 py-1.5 sm:py-2 shadow-2xl border border-slate-200/80 flex items-center justify-around">
            {/* 1. Turbo */}
            <button
              onClick={() => onSelectTab('turbo')}
              className={`flex flex-col items-center gap-0.5 transition px-1.5 sm:px-2 py-1 rounded-xl ${
                currentTab === 'turbo'
                  ? 'text-red-600 font-extrabold'
                  : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              <Zap className={`w-4 h-4 sm:w-5 sm:h-5 ${currentTab === 'turbo' ? 'fill-red-600' : ''}`} />
              <span className="text-[9px] sm:text-[10px] tracking-tight">Turbo</span>
            </button>

            {/* 2. Favoritos */}
            <button
              onClick={() => onSelectTab('favoritos')}
              className={`flex flex-col items-center gap-0.5 transition px-1.5 sm:px-2 py-1 rounded-xl ${
                currentTab === 'favoritos'
                  ? 'text-red-600 font-extrabold'
                  : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              <Heart className={`w-4 h-4 sm:w-5 sm:h-5 ${currentTab === 'favoritos' ? 'fill-red-600' : ''}`} />
              <span className="text-[9px] sm:text-[10px] tracking-tight">Favoritos</span>
            </button>

            {/* 3. Listas de Deseos */}
            <button
              onClick={() => onSelectTab('deseos')}
              className={`flex flex-col items-center gap-0.5 transition px-1.5 sm:px-2 py-1 rounded-xl relative ${
                currentTab === 'deseos'
                  ? 'text-amber-600 font-extrabold'
                  : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              <Bookmark className={`w-4 h-4 sm:w-5 sm:h-5 ${currentTab === 'deseos' ? 'fill-amber-500' : ''}`} />
              <span className="text-[9px] sm:text-[10px] tracking-tight">Listas</span>
              {wishlistCount > 0 && (
                <span className="absolute top-0 right-1 w-2 h-2 rounded-full bg-amber-500 ring-2 ring-white" />
              )}
            </button>

            {/* 4. Ofertas */}
            <button
              onClick={() => onSelectTab('ofertas')}
              className={`flex flex-col items-center gap-0.5 transition px-1.5 sm:px-2 py-1 rounded-xl ${
                currentTab === 'ofertas'
                  ? 'text-red-600 font-extrabold'
                  : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              <Tag className={`w-4 h-4 sm:w-5 sm:h-5 ${currentTab === 'ofertas' ? 'fill-red-600' : ''}`} />
              <span className="text-[9px] sm:text-[10px] tracking-tight">Ofertas</span>
            </button>

            {/* 5. Categorías */}
            <button
              onClick={() => onSelectTab('categorias')}
              className={`flex flex-col items-center gap-0.5 transition px-1.5 sm:px-2 py-1 rounded-xl ${
                currentTab === 'categorias'
                  ? 'text-red-600 font-extrabold'
                  : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              <LayoutGrid className={`w-4 h-4 sm:w-5 sm:h-5 ${currentTab === 'categorias' ? 'fill-red-600' : ''}`} />
              <span className="text-[9px] sm:text-[10px] tracking-tight">Categorías</span>
            </button>
          </nav>

          {/* Separate circular search button to the right matching screenshots */}
          <button
            onClick={onTriggerSearch}
            className="pointer-events-auto w-11 h-11 sm:w-12 sm:h-12 rounded-full bg-white hover:bg-slate-50 active:scale-95 text-slate-800 shadow-2xl border border-slate-200/80 flex items-center justify-center shrink-0 transition"
            title="Buscar en Bolt Pets"
          >
            <Search className="w-5 h-5 text-slate-700" />
          </button>
        </div>
      </div>
    </div>
  );
};
