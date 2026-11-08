import {ProductImage} from '../common/ProductImage';
import React from 'react';
import {PresentationSelector} from './PresentationSelector';
import {usePresentation} from './PresentationContext';
import {hasSalePrice} from '../../lib/presentationSelection';
import {validOffer} from '../../lib/catalogPurchase';
import { Heart, ShoppingCart, LoaderCircle, Minus, Scale, Bookmark, ShieldCheck } from 'lucide-react';
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
  const add = (event:React.MouseEvent<HTMLButtonElement>) => {
    if(event.detail>1) return; // The second click of a double click is the same purchase gesture.
    if(!selected) {focusSelector();return;}
    if(availability.canAdd && !presentation.busy) void presentation.add(onAddToCart);
  };
  const blocked = presentation.busy || (!!selected && !availability.canAdd);
  const offer = validOffer(selected);

  return (
    <article aria-label={product.name} className="bg-white rounded-3xl p-3 shadow-xs border border-slate-100 flex flex-col h-full min-w-0 relative group hover:shadow-md transition">
      {/* Top badges & Actions (Compare & Heart) */}
      <div className="absolute top-2.5 left-2.5 right-2.5 flex items-center justify-between z-10 pointer-events-none">
        <div className="flex flex-col gap-1 items-start">
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
              aria-pressed={isCompared}
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

      <button type="button" onClick={()=>onOpenDetails(product)} className="w-full aspect-square shrink-0 rounded-2xl overflow-hidden bg-slate-50" aria-label={`Ver ${product.name}`}>
        <ProductImage src={displayProduct.image} alt={`${product.name}${selected ? ` · ${selected.presentation}` : ''}`} className="w-full h-full object-contain group-hover:scale-105 transition duration-300" loading="lazy" />
      </button>
      <div className="flex flex-col flex-1 min-w-0 pt-3">
        <p className="min-h-4 text-[11px] text-slate-500 font-medium truncate">{product.brand ? `Por ${product.brand}` : ''}</p>
        <button type="button" onClick={()=>onOpenDetails(product)} className="text-left mt-1"><h3 className="text-xs sm:text-sm font-bold text-slate-800 line-clamp-2 min-h-8 sm:min-h-10 leading-4 sm:leading-5">{product.name}</h3></button>
        <div className="mt-2 min-h-8" aria-live="polite" aria-atomic="true">
          {offer?.percent && <span className="block text-[11px] font-extrabold text-red-600">{offer.percent}% de descuento</span>}
          <div className="flex items-baseline gap-1.5 flex-wrap">
            <span className={`${selected && hasSalePrice(selected) ? 'text-lg sm:text-xl' : 'text-sm'} font-black text-slate-900 tracking-tight`}>{!selected ? 'Selecciona una presentación' : hasSalePrice(selected) ? formatCOP(selected.price) : 'Precio por confirmar'}</span>
            {offer && <span className="text-xs text-slate-400 line-through">{formatCOP(offer.originalPrice)}</span>}
          </div>
        </div>
        <PresentationSelector product={product} selectedId={selectedId} onSelect={select} selectorRef={selectorRef} storeId={presentation.storeId} disabled={presentation.busy} />
        <p className={`mt-2 text-[11px] font-semibold ${availability.canAdd ? 'text-emerald-700' : 'text-slate-600'}`}>{availability.message}</p>
        {availability.available !== undefined && availability.canAdd && availability.available<=2 && <p className="text-[10px] text-amber-700">¡Últimas {availability.available} unidades!</p>}
        {availability.message.includes('Reintenta') && <button type="button" onClick={presentation.retry} className="text-xs underline py-2 text-left">Reintentar entrega</button>}
        <div className="mt-auto pt-2">
          <div className="min-h-11 flex items-center justify-between gap-1">
            <p role="status" aria-atomic="true" className={`text-[11px] leading-4 font-semibold ${presentation.feedback?.error ? 'text-red-700' : 'text-emerald-700'}`}>
              {presentation.feedback?.text || (quantityInCart>0 ? `${quantityInCart} en tu carrito` : '')}
            </p>
            {quantityInCart>0 && <button type="button" onClick={()=>selected && onUpdateQuantity(selected,quantityInCart-1)} disabled={presentation.busy} aria-label={`Quitar una unidad de ${selected?.presentation}`} className="w-11 h-11 shrink-0 flex items-center justify-center rounded-xl text-slate-600 hover:bg-slate-100 disabled:opacity-50"><Minus className="w-4 h-4" /></button>}
          </div>
          <button type="button" onClick={add} disabled={blocked} aria-busy={presentation.adding} aria-label={selected ? `Agregar ${product.name}, ${selected.presentation}` : `Agregar ${product.name}: elige una presentación`} className="w-full min-h-11 px-2 py-3 rounded-xl bg-red-600 hover:bg-red-700 active:scale-[0.98] text-white text-sm font-extrabold flex items-center justify-center gap-2 transition disabled:bg-slate-200 disabled:text-slate-500 disabled:cursor-not-allowed focus-visible:ring-2 focus-visible:ring-red-600 focus-visible:ring-offset-2">
            {presentation.adding ? <LoaderCircle aria-hidden="true" className="w-4 h-4 animate-spin" /> : <ShoppingCart aria-hidden="true" className="w-4 h-4" />}
            {presentation.adding ? 'Agregando…' : 'Agregar'}
          </button>
        </div>
      </div>
    </article>
  );
};
