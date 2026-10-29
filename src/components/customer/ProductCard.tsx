import React from 'react';
import { Heart, Plus, Minus, FileText, Scale, Check, Bookmark } from 'lucide-react';
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
  const stock = product.stockByStore[selectedStoreId] || 0;
  const reserved = product.reservedStockByStore[selectedStoreId] || 0;
  const availableToSell = Math.max(0, stock - reserved);
  const isOutOfStock = availableToSell <= 0;
  const isLowStock = availableToSell > 0 && availableToSell <= 2;

  return (
    <div className="bg-white rounded-3xl p-3 shadow-xs border border-slate-100 flex flex-col justify-between relative group hover:shadow-md transition">
      {/* Top badges & Actions (Compare & Heart) */}
      <div className="absolute top-2.5 left-2.5 right-2.5 flex items-center justify-between z-10 pointer-events-none">
        <div className="flex flex-col gap-1 items-start">
          {product.discountPercent && product.discountPercent > 0 && (
            <span className="bg-yellow-400 text-red-950 font-black text-[11px] px-2 py-0.5 rounded-md shadow-xs">
              -{product.discountPercent}%
            </span>
          )}
          {product.requiresPrescription && (
            <span className="bg-red-600 text-white font-extrabold text-[10px] px-2 py-0.5 rounded-md shadow-xs flex items-center gap-1">
              <FileText className="w-2.5 h-2.5" />
              Fórmula
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

      {/* Product Image */}
      <div
        onClick={() => onOpenDetails(product)}
        className="w-full aspect-square rounded-2xl overflow-hidden bg-slate-50 flex items-center justify-center cursor-pointer mb-2 relative"
      >
        <img
          src={product.image}
          alt={product.name}
          className="w-full h-full object-cover group-hover:scale-105 transition duration-300"
          loading="lazy"
        />

        {/* Quick Add Button (+) or Stepper overlay */}
        <div
          onClick={(e) => e.stopPropagation()}
          className="absolute bottom-2 right-2 z-10"
        >
          {quantityInCart === 0 ? (
            <button
              onClick={() => onAddToCart(product)}
              disabled={isOutOfStock}
              className={`w-10 h-10 rounded-full flex items-center justify-center shadow-md transition-all ${
                isOutOfStock
                  ? 'bg-slate-300 text-white cursor-not-allowed'
                  : 'bg-red-600 hover:bg-red-700 active:scale-90 text-white shadow-red-500/30'
              }`}
              title="Agregar al carrito"
            >
              <Plus className="w-5 h-5 stroke-[2.5]" />
            </button>
          ) : (
            <div className="flex items-center bg-red-600 text-white rounded-full p-0.5 shadow-md shadow-red-500/30">
              <button
                onClick={() => onUpdateQuantity(product, quantityInCart - 1)}
                className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-red-700 active:scale-90 transition"
              >
                <Minus className="w-4 h-4 stroke-[2.5]" />
              </button>
              <span className="w-6 text-center text-xs font-black select-none">
                {quantityInCart}
              </span>
              <button
                onClick={() => onUpdateQuantity(product, quantityInCart + 1)}
                disabled={quantityInCart >= availableToSell}
                className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-red-700 active:scale-90 transition disabled:opacity-50"
              >
                <Plus className="w-4 h-4 stroke-[2.5]" />
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Pricing and Details */}
      <div className="cursor-pointer" onClick={() => onOpenDetails(product)}>
        {/* Prices matching Rappi Turbo format */}
        <div className="flex items-baseline gap-1.5 flex-wrap">
          <span className="text-base font-black text-slate-900 tracking-tight">
            {product.price > 0 ? formatCOP(product.price) : 'Consultar precio'}
          </span>
          {product.originalPrice && product.originalPrice > product.price && (
            <span className="text-xs text-slate-400 line-through font-semibold">
              {formatCOP(product.originalPrice)}
            </span>
          )}
        </div>

        {/* Product Name */}
        <h3 className="text-xs font-bold text-slate-800 line-clamp-2 mt-1 leading-snug">
          {product.name}
        </h3>

        {/* Presentation & Unit Price */}
        <div className="mt-1 flex items-center justify-between text-[11px] text-slate-500 font-medium">
          <span className="truncate">{product.presentation}</span>
          {product.presentaciones && product.presentaciones.length > 1 ? (
            <span className="text-[10px] font-bold bg-slate-100 text-slate-700 px-1.5 py-0.5 rounded">
              {product.presentaciones.length} variantes
            </span>
          ) : product.unitPriceText ? (
            <span className="text-slate-400 font-semibold">{product.unitPriceText}</span>
          ) : null}
        </div>

        {/* Stock / Warning notice */}
        <div className="mt-1.5 flex items-center gap-1 text-[10px]">
          {isOutOfStock ? (
            <span className="text-red-600 font-bold bg-red-50 px-1.5 py-0.5 rounded">
              Agotado en esta sede
            </span>
          ) : isLowStock ? (
            <span className="text-amber-700 font-bold bg-amber-50 px-1.5 py-0.5 rounded">
              ¡Últimas {availableToSell} unidades!
            </span>
          ) : (
            <span className="text-emerald-700 font-medium">
              Disponible para Turbo
            </span>
          )}
        </div>

        {/* Compare row */}
        {onToggleCompare && (
          <div
            onClick={(e) => {
              e.stopPropagation();
              onToggleCompare(product);
            }}
            className="mt-2 pt-2 border-t border-slate-100 flex items-center gap-1.5 text-[11px] text-slate-500 hover:text-slate-900 cursor-pointer select-none"
          >
            <div
              className={`w-3.5 h-3.5 rounded border flex items-center justify-center transition-colors ${
                isCompared ? 'bg-amber-400 border-amber-500 text-slate-900' : 'border-slate-300 bg-white'
              }`}
            >
              {isCompared && <Check className="w-2.5 h-2.5 stroke-[3]" />}
            </div>
            <span className={isCompared ? 'font-bold text-slate-900' : 'font-medium'}>
              {isCompared ? 'En comparador' : 'Comparar'}
            </span>
          </div>
        )}
      </div>
    </div>
  );
};
