import React from 'react';
import {PresentationSelector} from './PresentationSelector';
import {usePresentation} from './PresentationContext';
import {hasSalePrice} from '../../lib/presentationSelection';
import { Heart, Plus, Minus, FileText, Scale, Check, Bookmark, ShieldCheck } from 'lucide-react';
import { Product } from '../../types';
import { formatCOP } from '../../lib/formatters';

interface ProductCardProps {
  product: Product;
  quantityInCart: number;
  onAddToCart: (product: Product) => void;
  onUpdateQuantity: (product: Product, newQuantity: number) => void;
  isFavorite: boolean;
  onToggleFavorite: (product: Product) => void;
  onOpenDetails: (product: Product) => void;
  selectedStoreId: string;
  isCompared?: boolean;
  onToggleCompare?: (product: Product) => void;
  isInWishlist?: boolean;
  onOpenSaveToWishlist?: (product: Product) => void;
}

export const ProductCard: React.FC<ProductCardProps> = ({
  product,
  quantityInCart,
  onAddToCart,
  onUpdateQuantity,
  isFavorite,
  onToggleFavorite,
  onOpenDetails,
  selectedStoreId,
  isCompared = false,
  onToggleCompare,
  isInWishlist = false,
  onOpenSaveToWishlist,
}) => {
  const presentation = usePresentation(product);
  const {selected, availability, selectorRef, selectedId, select, focusSelector} = presentation;
  quantityInCart = presentation.quantity;
  const displayProduct = selected || product;
  const add = () => selected ? availability.canAdd && onAddToCart(selected) : focusSelector();
  const blocked = !!selected && !availability.canAdd;

  return (
    <article aria-label={product.name} className="bg-white rounded-3xl p-3 shadow-xs border border-slate-100 flex flex-col justify-between relative group hover:shadow-md transition">
      {/* Top badges & Actions (Compare & Heart) */}
      <div className="absolute top-2.5 left-2.5 right-2.5 flex items-center justify-between z-10 pointer-events-none">
        <div className="flex flex-col gap-1 items-start">
          {selected?.discountPercent && selected?.discountPercent > 0 && (
            <span className="bg-yellow-400 text-red-950 font-black text-[11px] px-2 py-0.5 rounded-md shadow-xs">
              -{selected?.discountPercent}%
            </span>
          )}
          {product.requiresPrescription && (
            <span className="bg-blue-600 text-white font-extrabold text-[10px] px-2 py-0.5 rounded-md shadow-xs flex items-center gap-1">
              <ShieldCheck className="w-2.5 h-2.5" />
              Rx Vet
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5 pointer-events-auto">
          {onToggleCompare && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onToggleCompare(product);
              }}
              className={`w-7 h-7 rounded-full backdrop-blur-xs shadow-xs flex items-center justify-center transition-all cursor-pointer ${
                isCompared
                  ? 'bg-amber-400 text-slate-900 ring-2 ring-amber-500 scale-105'
                  : 'bg-white/90 text-slate-400 hover:text-slate-800'
              }`}
              title={isCompared ? 'Quitar del comparador' : 'Comparar producto (hasta 3)'}
            >
              <Scale className="w-3.5 h-3.5" />
            </button>
          )}

          {onOpenSaveToWishlist && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onOpenSaveToWishlist(product);
              }}
              className={`w-7 h-7 sm:w-8 sm:h-8 rounded-full backdrop-blur-xs shadow-xs flex items-center justify-center hover:scale-110 active:scale-95 transition cursor-pointer ${
                isInWishlist
                  ? 'bg-amber-500 text-white shadow-xs ring-1 ring-amber-600/30'
                  : 'bg-white/90 text-slate-400 hover:text-amber-600'
              }`}
              title={isInWishlist ? 'En tu lista de deseos (organizar)' : 'Guardar en Lista de Deseos'}
            >
              <Bookmark className={`w-3.5 h-3.5 ${isInWishlist ? 'fill-white' : ''}`} />
            </button>
          )}

          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onToggleFavorite(product);
            }}
            className="w-7 h-7 sm:w-8 sm:h-8 rounded-full bg-white/90 backdrop-blur-xs shadow-xs flex items-center justify-center hover:scale-110 active:scale-95 transition cursor-pointer"
            title={isFavorite ? 'Quitar de favoritos' : 'Agregar a favoritos'}
          >
            <Heart
              className={`w-4 h-4 transition ${
                isFavorite ? 'fill-red-600 text-red-600' : 'text-slate-400 hover:text-red-500'
              }`}
            />
          </button>
        </div>
      </div>

      <div className="w-full aspect-square rounded-2xl overflow-hidden bg-slate-50 mb-2 relative">
        <button type="button" onClick={()=>onOpenDetails(product)} className="w-full h-full" aria-label={`Ver ${product.name}`}>
          <img src={displayProduct.image} alt={`${product.name}${selected ? ` · ${selected.presentation}` : ''}`} className="w-full h-full object-cover group-hover:scale-105 transition duration-300" loading="lazy" />
        </button>
        <div className="absolute bottom-2 right-2 z-10">
          {quantityInCart===0 ? <button type="button" onClick={add} disabled={blocked} aria-label={selected ? `Agregar ${product.name}, ${selected.presentation}` : `Seleccionar presentación de ${product.name}`} className="w-11 h-11 rounded-full bg-red-600 hover:bg-red-700 text-white shadow-md flex items-center justify-center disabled:bg-slate-300 disabled:cursor-not-allowed">
            <Plus className="w-5 h-5 stroke-[2.5]" />
          </button> : <div className="flex items-center bg-red-600 text-white rounded-full p-0.5 shadow-md">
            <button type="button" onClick={()=>selected && onUpdateQuantity(selected,quantityInCart-1)} aria-label={`Quitar una unidad de ${selected?.presentation}`} className="w-10 h-10 rounded-full flex items-center justify-center hover:bg-red-700"><Minus className="w-4 h-4" /></button>
            <span className="w-5 text-center text-xs font-black">{quantityInCart}</span>
            <button type="button" onClick={add} disabled={blocked} aria-label={`Agregar una unidad de ${selected?.presentation}`} className="w-10 h-10 rounded-full flex items-center justify-center hover:bg-red-700 disabled:opacity-40"><Plus className="w-4 h-4" /></button>
          </div>}
        </div>
      </div>
      <div className="flex flex-col flex-1">
        <div className="flex items-baseline gap-1.5 flex-wrap" aria-live="polite" aria-atomic="true">
          <span className="text-base font-black text-slate-900 tracking-tight">{!selected ? 'Selecciona una presentación' : hasSalePrice(selected) ? formatCOP(selected.price) : 'Precio por confirmar'}</span>
          {selected?.originalPrice && selected.originalPrice>selected.price ? <span className="text-xs text-slate-400 line-through">{formatCOP(selected.originalPrice)}</span> : null}
        </div>
        <button type="button" onClick={()=>onOpenDetails(product)} className="text-left"><h3 className="text-xs font-bold text-slate-800 line-clamp-2 mt-1 leading-snug">{product.name}</h3></button>
        <PresentationSelector product={product} selectedId={selectedId} onSelect={select} selectorRef={selectorRef} />
        <p role="status" className={`mt-2 text-[11px] font-semibold ${availability.canAdd ? 'text-emerald-700' : 'text-slate-600'}`}>{availability.message}</p>
        {availability.available !== undefined && availability.canAdd && availability.available<=2 && <p className="text-[10px] text-amber-700">¡Últimas {availability.available} unidades!</p>}
        {availability.message.includes('Reintenta') && <button type="button" onClick={presentation.retry} className="text-xs underline py-2 text-left">Reintentar entrega</button>}
        {onToggleCompare && <button type="button" onClick={()=>onToggleCompare(product)} aria-pressed={isCompared} className="mt-auto pt-3 pb-1 flex items-center gap-1.5 text-[11px] text-slate-500 hover:text-slate-900 min-h-11">
          <span className={`w-3.5 h-3.5 rounded border flex items-center justify-center ${isCompared ? 'bg-amber-400 border-amber-500 text-slate-900' : 'border-slate-300 bg-white'}`}>{isCompared && <Check className="w-2.5 h-2.5" />}</span>
          {isCompared ? 'En comparador' : 'Comparar'}
        </button>}
      </div>
    </article>
  );
};
