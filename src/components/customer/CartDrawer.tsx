import React from 'react';
import { X, Trash2, Plus, Minus, FileText, ArrowRight, ShoppingBag, ShieldAlert } from 'lucide-react';
import { CartItem, Product, Store } from '../../types';
import { formatCOP } from '../../lib/formatters';

interface CartDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  cartItems: CartItem[];
  onUpdateQuantity: (p: Product, q: number) => void;
  onClearCart: () => void;
  onProceedToCheckout: () => void;
  currentStore: Store;
}

export const CartDrawer: React.FC<CartDrawerProps> = ({
  isOpen,
  onClose,
  cartItems,
  onUpdateQuantity,
  onClearCart,
  onProceedToCheckout,
  currentStore,
}) => {
  if (!isOpen) return null;

  const subtotal = cartItems.reduce((acc, item) => acc + (item.product.price * item.quantity), 0);
  const totalWeightKg = cartItems.reduce((acc, item) => acc + ((item.product.weightKg || 0.2) * item.quantity), 0);
  const shipping = subtotal >= 70000 ? 0 : 4900;
  const serviceFee = 1500;
  const total = subtotal + (cartItems.length > 0 ? (shipping + serviceFee) : 0);

  const hasPrescriptionItems = cartItems.some(i => i.product.requiresPrescription);
  const exceedsWeight = totalWeightKg > currentStore.vehicleMaxWeightKg;

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex justify-end animate-in fade-in">
      <div className="bg-white w-full max-w-md h-full flex flex-col justify-between shadow-2xl animate-in slide-in-from-right duration-200">
        {/* Header */}
        <div className="p-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
          <div className="flex items-center gap-2">
            <ShoppingBag className="w-5 h-5 text-red-600" />
            <h3 className="font-extrabold text-slate-900 text-base">Mi Carrito Bolt Pets</h3>
            <span className="text-xs bg-red-100 text-red-700 font-bold px-2 py-0.5 rounded-full">
              {cartItems.reduce((a, b) => a + b.quantity, 0)} items
            </span>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-500 transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Item List */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {cartItems.length === 0 ? (
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
              {/* Prescription warning notice if applicable */}
              {hasPrescriptionItems && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-2xl flex items-start gap-2.5 text-xs text-red-900">
                  <FileText className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-extrabold">Contiene medicamentos con fórmula:</span>
                    <p className="text-[11px] text-red-700 mt-0.5">
                      Se solicitará foto o PDF de la fórmula médica en el siguiente paso para revisión farmacéutica.
                    </p>
                  </div>
                </div>
              )}

              {/* Weight warning if over 25 kg */}
              {exceedsWeight && (
                <div className="p-3 bg-amber-50 border border-amber-200 rounded-2xl flex items-start gap-2.5 text-xs text-amber-900">
                  <ShieldAlert className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-extrabold">Límite de peso excedido:</span>
                    <p className="text-[11px] text-amber-700 mt-0.5">
                      Peso actual: {totalWeightKg.toFixed(1)} Kg. La capacidad máxima de despacho motorizado es de {currentStore.vehicleMaxWeightKg} Kg.
                    </p>
                  </div>
                </div>
              )}

              {cartItems.map(item => (
                <div
                  key={item.product.id}
                  className="bg-white p-3 rounded-2xl border border-slate-100 shadow-xs flex items-center gap-3"
                >
                  <img
                    src={item.product.image}
                    alt={item.product.name}
                    className="w-16 h-16 rounded-xl object-cover bg-slate-50 shrink-0"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-bold text-slate-900 line-clamp-1">
                      {item.product.name}
                    </p>
                    <p className="text-[11px] text-slate-500">
                      {item.product.presentation} • {(item.product.weightKg || 0.2) * item.quantity} Kg
                    </p>
                    <p className="text-xs font-black text-slate-900 mt-1">
                      {formatCOP(item.product.price * item.quantity)}
                    </p>
                  </div>

                  <div className="flex items-center gap-1.5 bg-slate-100 rounded-full p-1">
                    <button
                      onClick={() => onUpdateQuantity(item.product, item.quantity - 1)}
                      className="w-6 h-6 rounded-full bg-white flex items-center justify-center text-slate-700 shadow-xs hover:bg-slate-200 transition"
                    >
                      {item.quantity === 1 ? <Trash2 className="w-3 h-3 text-red-600" /> : <Minus className="w-3 h-3" />}
                    </button>
                    <span className="w-5 text-center text-xs font-bold text-slate-900">
                      {item.quantity}
                    </span>
                    <button
                      onClick={() => onUpdateQuantity(item.product, item.quantity + 1)}
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
                <span>Envío Turbo ({currentStore.name.replace('Sede ', '')}):</span>
                {shipping === 0 ? (
                  <span className="font-bold text-emerald-600">¡GRATIS!</span>
                ) : (
                  <span className="font-bold text-slate-900">{formatCOP(shipping)}</span>
                )}
              </div>
              <div className="flex justify-between">
                <span>Tarifa de servicio y embalaje:</span>
                <span className="font-bold text-slate-900">{formatCOP(serviceFee)}</span>
              </div>
              <div className="flex justify-between text-[11px] text-slate-400">
                <span>Peso total estimado:</span>
                <span>{totalWeightKg.toFixed(2)} Kg</span>
              </div>
              <div className="border-t border-slate-200 pt-1.5 flex justify-between text-sm font-black text-slate-900">
                <span>Total a pagar:</span>
                <span className="text-red-600 text-base">{formatCOP(total)}</span>
              </div>
            </div>

            <button
              onClick={onProceedToCheckout}
              disabled={exceedsWeight}
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
