import {canRequestDeliveryReview,hasConfirmedDeliveryQuote,visibleDeliveryCharges} from '../../lib/checkoutReadiness';
import {ProductImage} from '../common/ProductImage';
import { DeliveryPlanSummary } from './DeliveryPlanSummary';
import type { DeliveryQuote } from '../../lib/deliveryService';
import React from 'react';
import { X, Trash2, Plus, Minus, FileText, ArrowRight, ShoppingBag, ShieldAlert, ShieldCheck } from 'lucide-react';
import { CartItem, Product, Store } from '../../types';
import { CartReference, cartReferenceKey } from '../../lib/guestCart';
import { formatCOP } from '../../lib/formatters';

interface CartDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  cartItems: CartItem[];
  onUpdateQuantity: (p: Product, q: number) => void;
  onClearCart: () => void;
  onProceedToCheckout: () => void;
  currentStore: Store | null;
  unavailableItems?: CartReference[];
  onRemoveUnavailable?: (ref: CartReference) => void;
  pendingCount?: number;
  blockReason?: string;
  deliveryQuote?: DeliveryQuote | null;
  onRefreshCatalog?: () => void;
}

export const CartDrawer: React.FC<CartDrawerProps> = ({
  isOpen,
  onClose,
  cartItems,
  onUpdateQuantity,
  onClearCart,
  onProceedToCheckout,
  currentStore,
  unavailableItems = [], onRemoveUnavailable, pendingCount, blockReason, onRefreshCatalog, deliveryQuote,
}) => {
  if (!isOpen) return null;

  const hasPrescriptionItems=cartItems.some(i=>i.product.requiresPrescription);
  const subtotal = cartItems.reduce((acc, item) => acc + (item.product.price * item.quantity), 0);
  const totalWeightKg = deliveryQuote?.transportPlan?.feasible ? deliveryQuote.totalWeightKg : null;
  const ready=hasConfirmedDeliveryQuote(deliveryQuote);
  const review=canRequestDeliveryReview(deliveryQuote);
  const visibleCharges = visibleDeliveryCharges(deliveryQuote,subtotal);
  const shipping = visibleCharges?.shipping;
  const serviceFee = visibleCharges?.serviceFee;
  const total = visibleCharges?.total;

  return (
    <div role="dialog" aria-modal="true" aria-label="Mi carrito" className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex justify-end animate-in fade-in">
      <div className="bg-white w-full max-w-md h-full flex flex-col justify-between shadow-2xl animate-in slide-in-from-right duration-200">
        {/* Header */}
        <div className="p-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
          <div className="flex items-center gap-2">
            <ShoppingBag className="w-5 h-5 text-red-600" />
            <h3 className="font-extrabold text-slate-900 text-base">Mi Carrito Bolt Pets</h3>
            <span className="text-xs bg-red-100 text-red-700 font-bold px-2 py-0.5 rounded-full">
              {pendingCount ?? (cartItems.reduce((a, b) => a + b.quantity, 0) + unavailableItems.reduce((a, b) => a + b.quantity, 0))} items
            </span>
          </div>
          <button
            aria-label="Cerrar carrito" onClick={onClose}
            className="w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-500 transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Item List */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {blockReason && <div role="status" className="rounded-2xl bg-amber-50 border border-amber-200 p-3 text-xs text-amber-950">
            <p>{blockReason}</p>
            <button className="mt-2 font-bold underline" onClick={onRefreshCatalog}>Actualizar precio y disponibilidad</button>
          </div>}
          {unavailableItems.map((item, index) => <div key={cartReferenceKey(item)} className="rounded-2xl border border-amber-200 p-3 text-sm">
            <p className="font-bold">Presentación guardada no disponible ({index + 1})</p>
            <p>Ya no aparece en el catálogo. Cantidad guardada: {item.quantity}. No la hemos sustituido.</p>
            <button className="mt-2 font-bold text-red-600 underline" onClick={() => onRemoveUnavailable?.(item)}>Eliminar presentación no disponible {index + 1}</button>
          </div>)}
          {cartItems.length === 0 && unavailableItems.length === 0 && !blockReason ? (
            <div className="h-full flex flex-col items-center justify-center text-center p-6 text-slate-400 space-y-3">
              <div className="w-16 h-16 rounded-full bg-slate-100 flex items-center justify-center text-slate-400">
                <ShoppingBag className="w-8 h-8" />
              </div>
              <p className="font-bold text-slate-700 text-sm">Tu carrito está vacío</p>
              <p className="text-xs max-w-xs text-slate-500">
                Explora alimentos, farmacia veterinaria y snacks con entrega ultra-rápida (hasta 25 min).
              </p>
            </div>
          ) : (
            <>
              {/* Informative notice for veterinary medicines */}
              {hasPrescriptionItems && (
                <div className="p-3 bg-blue-50 border border-blue-200 rounded-2xl flex items-start gap-2.5 text-xs text-blue-900">
                  <ShieldCheck className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-extrabold">Medicamento veterinario incluido:</span>
                    <p className="text-[11px] text-blue-700 mt-0.5">
                      Compra directa sin adjuntar archivos. Sigue las indicaciones y dosificación de tu médico veterinario.
                    </p>
                  </div>
                </div>
              )}

              {!blockReason && <DeliveryPlanSummary quote={deliveryQuote} onRefresh={onRefreshCatalog} />}

              {cartItems.map(item => (
                <div
                  key={item.product.id}
                  className="bg-white p-3 rounded-2xl border border-slate-100 shadow-xs flex items-center gap-3"
                >
                  <ProductImage
                    src={item.product.image}
                    alt={item.product.name}
                    className="w-16 h-16 rounded-xl object-cover bg-slate-50 shrink-0"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-bold text-slate-900 line-clamp-1">
                      {item.product.name}
                    </p>
                    <p className="text-[11px] text-slate-500">
                      {item.product.presentation}
                    </p>
                    <p className="text-[11px] text-slate-600">{formatCOP(item.product.price)} por unidad · Cantidad: {item.quantity}</p>
                    <p className="text-xs font-black text-slate-900 mt-1">
                      {formatCOP(item.product.price * item.quantity)}
                    </p>
                  </div>

                  <div className="flex items-center gap-1.5 bg-slate-100 rounded-full p-1">
                    <button
                      aria-label={`Quitar una unidad de ${item.product.presentation}`} onClick={() => onUpdateQuantity(item.product, item.quantity - 1)}
                      className="w-6 h-6 rounded-full bg-white flex items-center justify-center text-slate-700 shadow-xs hover:bg-slate-200 transition"
                    >
                      {item.quantity === 1 ? <Trash2 className="w-3 h-3 text-red-600" /> : <Minus className="w-3 h-3" />}
                    </button>
                    <span className="w-5 text-center text-xs font-bold text-slate-900">
                      {item.quantity}
                    </span>
                    <button
                      aria-label={`Agregar una unidad de ${item.product.presentation}`} onClick={() => onUpdateQuantity(item.product, item.quantity + 1)}
                      className="w-6 h-6 rounded-full bg-white flex items-center justify-center text-slate-700 shadow-xs hover:bg-slate-200 transition"
                    >
                      <Plus className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              ))}
            </>
          )}
        </div>

        {/* Footer Summary & Checkout */}
        {cartItems.length > 0 && (
          <div className="p-4 border-t border-slate-100 bg-slate-50 space-y-3">
            <div className="space-y-1.5 text-xs text-slate-600">
              <div className="flex justify-between">
                <span>Subtotal productos:</span>
                <span className="font-bold text-slate-900">{formatCOP(subtotal)}</span>
              </div>
              <div className="flex justify-between items-center">
                <span>Envío:</span>
                {shipping === 0 ? (
                  <span className="font-bold text-emerald-600">Envío gratis</span>
                ) : (
                  <span className="font-bold text-slate-900">{shipping===undefined?'Por confirmar':formatCOP(shipping)}</span>
                )}
              </div>
              <div className="flex justify-between">
                <span>Tarifa de servicio:</span>
                <span className="font-bold text-slate-900">{serviceFee===undefined?'Por confirmar':serviceFee===0?'¡GRATIS!':formatCOP(serviceFee)}</span>
              </div>
              {totalWeightKg !== null && <div className="flex justify-between text-[11px] text-slate-400">
                <span>Peso total estimado:</span>
                <span>{totalWeightKg.toLocaleString('es-CO')} kg</span>
              </div>}
              <div className="border-t border-slate-200 pt-1.5 flex justify-between text-sm font-black text-slate-900">
                <span>{review?'Total estimado:':'Total a pagar:'}</span>
                <span className="text-red-600 text-base">{total===undefined?'Por confirmar':formatCOP(total)}</span>
              </div>
            </div>

            <button
              onClick={onProceedToCheckout}
              disabled={!!blockReason || (!ready && !review)}
              className="w-full bg-red-600 hover:bg-red-700 disabled:bg-slate-300 active:scale-98 text-white font-black py-3.5 rounded-2xl text-sm flex items-center justify-center gap-2 shadow-lg shadow-red-500/30 transition"
            >
              <span>Continuar con el pedido</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
