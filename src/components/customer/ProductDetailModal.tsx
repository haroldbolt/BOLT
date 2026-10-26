import React from 'react';
import { X, Heart, Plus, Minus, ShieldCheck, Thermometer, FileText, CheckCircle2, Scale } from 'lucide-react';
import { Product } from '../../types';
import { formatCOP } from '../../lib/formatters';

interface ProductDetailModalProps {
  product: Product | null;
  onClose: () => void;
  quantityInCart: number;
  onAddToCart: (p: Product) => void;
  onUpdateQuantity: (p: Product, q: number) => void;
  isFavorite: boolean;
  onToggleFavorite: (p: Product) => void;
  selectedStoreId: string;
  isCompared?: boolean;
  onToggleCompare?: (p: Product) => void;
}

export const ProductDetailModal: React.FC<ProductDetailModalProps> = ({
  product,
  onClose,
  quantityInCart,
  onAddToCart,
  onUpdateQuantity,
  isFavorite,
  onToggleFavorite,
  selectedStoreId,
  isCompared = false,
  onToggleCompare,
}) => {
  if (!product) return null;

  const stock = product.stockByStore[selectedStoreId] || 0;
  const reserved = product.reservedStockByStore[selectedStoreId] || 0;
  const availableToSell = Math.max(0, stock - reserved);
  const isOutOfStock = availableToSell <= 0;

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4 animate-in fade-in">
      <div className="bg-white rounded-t-3xl sm:rounded-3xl max-w-lg w-full max-h-[90vh] overflow-y-auto shadow-2xl relative">
        {/* Sticky close and favorite header */}
        <div className="sticky top-0 z-20 flex items-center justify-between p-4 bg-white/90 backdrop-blur-md border-b border-slate-100">
          <div className="flex items-center gap-2">
            <button
              onClick={() => onToggleFavorite(product)}
              className="w-9 h-9 rounded-full bg-slate-100 hover:bg-slate-200 flex items-center justify-center transition cursor-pointer"
              title={isFavorite ? 'Quitar de favoritos' : 'Agregar a favoritos'}
            >
              <Heart
                className={`w-5 h-5 ${
                  isFavorite ? 'fill-red-600 text-red-600' : 'text-slate-500'
                }`}
              />
            </button>

            {onToggleCompare && (
              <button
                type="button"
                onClick={() => onToggleCompare(product)}
                className={`h-9 px-3 rounded-full flex items-center gap-1.5 text-xs font-bold transition cursor-pointer ${
                  isCompared
                    ? 'bg-amber-400 text-slate-900 shadow-xs'
                    : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
                }`}
                title={isCompared ? 'Quitar del comparador' : 'Comparar con otros productos (hasta 3)'}
              >
                <Scale className="w-4 h-4" />
                <span>{isCompared ? 'En comparador' : 'Comparar'}</span>
              </button>
            )}
          </div>

          <span className="text-xs font-bold text-slate-500 uppercase tracking-wider truncate max-w-[140px]">
            {product.brand}
          </span>

          <button
            onClick={onClose}
            className="w-9 h-9 rounded-full bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-600 transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Product Image */}
        <div className="w-full aspect-4/3 bg-slate-50 flex items-center justify-center relative overflow-hidden">
          <img
            src={product.image}
            alt={product.name}
            className="w-full h-full object-cover"
          />
          {product.discountPercent && product.discountPercent > 0 && (
            <span className="absolute bottom-3 left-4 bg-yellow-400 text-red-950 font-black text-xs px-2.5 py-1 rounded-md shadow-xs">
              -{product.discountPercent}% DESCUENTO
            </span>
          )}
        </div>

        {/* Content details */}
        <div className="p-5 space-y-4">
          <div>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-black text-slate-900">
                {formatCOP(product.price)}
              </span>
              {product.originalPrice && product.originalPrice > product.price && (
                <span className="text-sm text-slate-400 line-through font-semibold">
                  {formatCOP(product.originalPrice)}
                </span>
              )}
            </div>
            <h2 className="text-lg font-black text-slate-900 mt-1 leading-snug">
              {product.name}
            </h2>
            <div className="flex items-center gap-3 text-xs text-slate-500 mt-1.5 font-medium">
              <span>Presentación: <strong className="text-slate-700">{product.presentation}</strong></span>
              <span>•</span>
              <span>SKU: <code className="bg-slate-100 px-1 py-0.5 rounded text-slate-700">{product.sku}</code></span>
            </div>
          </div>

          {/* Prescription Alert if required */}
          {product.requiresPrescription && (
            <div className="p-3.5 bg-red-50 border border-red-200 rounded-2xl flex items-start gap-3">
              <FileText className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
              <div className="text-xs text-red-900">
                <p className="font-black">Requiere Fórmula Médica Veterinaria</p>
                <p className="mt-0.5 text-red-700">
                  Para el despacho de este medicamento, deberás adjuntar la receta de tu médico veterinario durante el proceso de compra.
                </p>
              </div>
            </div>
          )}

          {/* Technical and Veterinary Specifications */}
          <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100 space-y-2 text-xs">
            <h4 className="font-black text-slate-900 flex items-center gap-1.5">
              <ShieldCheck className="w-4 h-4 text-emerald-600" />
              Ficha Técnica & Trazabilidad
            </h4>

            {product.icaRegistration && (
              <div className="flex justify-between py-1 border-b border-slate-200/60">
                <span className="text-slate-500">Registro ICA:</span>
                <span className="font-bold text-slate-800">{product.icaRegistration}</span>
              </div>
            )}
            {product.activeIngredient && (
              <div className="flex justify-between py-1 border-b border-slate-200/60">
                <span className="text-slate-500">Principio Activo:</span>
                <span className="font-bold text-slate-800">{product.activeIngredient}</span>
              </div>
            )}
            {product.concentration && (
              <div className="flex justify-between py-1 border-b border-slate-200/60">
                <span className="text-slate-500">Concentración:</span>
                <span className="font-bold text-slate-800">{product.concentration}</span>
              </div>
            )}
            {product.pharmaceuticalForm && (
              <div className="flex justify-between py-1 border-b border-slate-200/60">
                <span className="text-slate-500">Forma Farmacéutica:</span>
                <span className="font-bold text-slate-800">{product.pharmaceuticalForm}</span>
              </div>
            )}
            <div className="flex justify-between py-1">
              <span className="text-slate-500">Almacenamiento:</span>
              <span className="font-bold text-slate-800">
                {product.storageCondition === 'CADENA_FRIO_2_8' ? 'Cadena de frío (2°C - 8°C)' : 'Lugar fresco y seco (<30°C)'}
              </span>
            </div>
          </div>

          {/* Description */}
          <div>
            <h4 className="font-bold text-slate-900 text-xs mb-1">Descripción</h4>
            <p className="text-xs text-slate-600 leading-relaxed">{product.description}</p>
          </div>

          {/* Bottom Action Bar */}
          <div className="pt-3 border-t border-slate-100 flex items-center justify-between gap-4">
            <div>
              <p className="text-[11px] text-slate-500">Stock disponible:</p>
              <p className="text-xs font-bold text-slate-800">
                {isOutOfStock ? (
                  <span className="text-red-600">Agotado</span>
                ) : (
                  <span className="text-emerald-700">{availableToSell} unidades en sede</span>
                )}
              </p>
            </div>

            {quantityInCart === 0 ? (
              <button
                onClick={() => onAddToCart(product)}
                disabled={isOutOfStock}
                className="flex-1 bg-red-600 hover:bg-red-700 disabled:bg-slate-300 text-white font-black py-3 rounded-2xl text-xs flex items-center justify-center gap-2 shadow-md shadow-red-500/30 transition"
              >
                <Plus className="w-4 h-4" />
                Agregar a mi pedido
              </button>
            ) : (
              <div className="flex items-center gap-3 bg-red-600 text-white rounded-2xl px-3 py-2 shadow-md">
                <button
                  onClick={() => onUpdateQuantity(product, quantityInCart - 1)}
                  className="w-8 h-8 rounded-xl bg-red-700 hover:bg-red-800 flex items-center justify-center transition"
                >
                  <Minus className="w-4 h-4" />
                </button>
                <span className="font-black text-sm px-2">{quantityInCart}</span>
                <button
                  onClick={() => onUpdateQuantity(product, quantityInCart + 1)}
                  disabled={quantityInCart >= availableToSell}
                  className="w-8 h-8 rounded-xl bg-red-700 hover:bg-red-800 disabled:opacity-50 flex items-center justify-center transition"
                >
                  <Plus className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
