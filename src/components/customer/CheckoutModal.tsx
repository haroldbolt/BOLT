import React, { useState } from 'react';
import { X, MapPin, CreditCard, DollarSign, FileText, CheckCircle2, ShieldCheck, ArrowRight, Upload, Phone, User, Building } from 'lucide-react';
import confetti from 'canvas-confetti';
import { CartItem, Store, PaymentMethod, PorteriaPolicy } from '../../types';
import { formatCOP } from '../../lib/formatters';
import { api } from '../../lib/api';

interface CheckoutModalProps {
  isOpen: boolean;
  onClose: () => void;
  cartItems: CartItem[];
  currentStore: Store;
  onOrderSuccess: (orderId: string) => void;
}

export const CheckoutModal: React.FC<CheckoutModalProps> = ({
  isOpen,
  onClose,
  cartItems,
  currentStore,
  onOrderSuccess,
}) => {
  if (!isOpen) return null;

  const [customerName, setCustomerName] = useState('Juan David Gómez');
  const [customerPhone, setCustomerPhone] = useState('+57 312 890 1234');
  const [customerEmail, setCustomerEmail] = useState('juan.gomez@ejemplo.com');
  const [address, setAddress] = useState(
    currentStore.id === 'HUB_KENNEDY'
      ? 'Calle 3 #78-20, Kennedy Central, Bogotá'
      : currentStore.address
  );
  const [addressDetails, setAddressDetails] = useState('Apto 502, Torre 2');
  const [porteriaPolicy, setPorteriaPolicy] = useState<PorteriaPolicy>('DEJAR_EN_PORTERIA');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('WOMPI_CARD');
  const [tip, setTip] = useState(2000);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  // Formula upload states
  const hasPrescriptionItems = cartItems.some(i => i.product.requiresPrescription);
  const [uploadedFormulaName, setUploadedFormulaName] = useState<string>('receta_veterinaria_dr_martinez.pdf');
  const [vetName, setVetName] = useState('Dr. Carlos Martínez - MP: 12904-COMVEZCOL');

  const subtotal = cartItems.reduce((acc, item) => acc + (item.product.price * item.quantity), 0);
  const totalWeightKg = cartItems.reduce((acc, item) => acc + ((item.product.weightKg || 0.2) * item.quantity), 0);
  const shipping = subtotal >= 70000 ? 0 : 4900;
  const serviceFee = 1500;
  const total = subtotal + shipping + serviceFee + tip;

  const handleSubmitOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setErrorMessage('');

    try {
      const payload = {
        storeId: currentStore.id,
        items: cartItems.map(item => ({
          productId: item.product.id,
          sku: item.product.sku,
          name: item.product.name,
          brand: item.product.brand,
          presentation: item.product.presentation,
          price: item.product.price,
          quantity: item.quantity,
          image: item.product.image,
          weightKg: item.product.weightKg || 0.2,
          requiresPrescription: item.product.requiresPrescription,
        })),
        customer: {
          name: customerName,
          phone: customerPhone,
          email: customerEmail,
          isGuest: false,
        },
        deliveryAddress: {
          address,
          details: addressDetails,
          porteriaPolicy,
          coordinates: {
            lat: currentStore.coordinates.lat + 0.008,
            lng: currentStore.coordinates.lng + 0.006,
          },
        },
        paymentMethod,
        tip,
      };

      const newOrder = await api.createOrder(payload);

      // If prescription required, upload document data
      if (hasPrescriptionItems) {
        await api.uploadPrescription(newOrder.id, {
          documentUrl: 'https://images.unsplash.com/photo-1584515979956-d9f6e5d09982?w=800&auto=format&fit=crop&q=80',
          documentName: uploadedFormulaName,
          vetName,
        });
      }

      // Celebrate
      confetti({
        particleCount: 80,
        spread: 70,
        origin: { y: 0.6 },
      });

      onOrderSuccess(newOrder.id);
    } catch (err: any) {
      setErrorMessage(err.message || 'Error al procesar el pedido. Por favor intente de nuevo.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
      <div className="bg-white rounded-3xl max-w-xl w-full max-h-[92vh] overflow-y-auto shadow-2xl animate-in zoom-in-95">
        {/* Header */}
        <div className="p-4 border-b border-slate-100 flex items-center justify-between sticky top-0 bg-white z-10">
          <div>
            <h3 className="font-black text-slate-900 text-lg">Confirmar Pedido Turbo</h3>
            <p className="text-xs text-slate-500">Despacho desde {currentStore.name}</p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-500"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmitOrder} className="p-5 space-y-4">
          {errorMessage && (
            <div className="p-3 bg-red-50 border border-red-200 text-red-800 rounded-2xl text-xs font-semibold">
              {errorMessage}
            </div>
          )}

          {/* Customer info */}
          <div className="space-y-2">
            <h4 className="font-extrabold text-xs text-slate-900 flex items-center gap-1.5 uppercase tracking-wider">
              <User className="w-3.5 h-3.5 text-red-600" />
              Datos de Contacto
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <input
                type="text"
                placeholder="Nombre completo"
                value={customerName}
                onChange={e => setCustomerName(e.target.value)}
                required
                className="w-full text-xs font-medium bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-red-500"
              />
              <input
                type="tel"
                placeholder="Teléfono móvil"
                value={customerPhone}
                onChange={e => setCustomerPhone(e.target.value)}
                required
                className="w-full text-xs font-medium bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-red-500"
              />
            </div>
          </div>

          {/* Delivery Address & Portería Policy */}
          <div className="space-y-2">
            <h4 className="font-extrabold text-xs text-slate-900 flex items-center gap-1.5 uppercase tracking-wider">
              <MapPin className="w-3.5 h-3.5 text-red-600" />
              Dirección de Entrega
            </h4>
            <input
              type="text"
              placeholder="Dirección completa (ej. Calle 3 #78-20)"
              value={address}
              onChange={e => setAddress(e.target.value)}
              required
              className="w-full text-xs font-medium bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-red-500"
            />
            <input
              type="text"
              placeholder="Detalles (Apto, Torre, Conjunto)"
              value={addressDetails}
              onChange={e => setAddressDetails(e.target.value)}
              className="w-full text-xs font-medium bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-red-500"
            />

            {/* Portería options */}
            <div className="pt-1">
              <label className="text-[11px] font-bold text-slate-700 block mb-1.5">
                Política de entrega en conjunto / edificio:
              </label>
              <div className="grid grid-cols-3 gap-2 text-xs">
                {[
                  { id: 'DEJAR_EN_PORTERIA', label: 'Dejar en portería' },
                  { id: 'SUBIR_A_PUERTA', label: 'Subir al apto' },
                  { id: 'LLAMAR_AL_LLEGAR', label: 'Llamar al llegar' },
                ].map(p => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setPorteriaPolicy(p.id as PorteriaPolicy)}
                    className={`py-2 px-2 rounded-xl border text-center font-bold text-[11px] transition ${
                      porteriaPolicy === p.id
                        ? 'border-red-600 bg-red-50 text-red-700'
                        : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Prescription Upload Section if order contains restricted medicines */}
          {hasPrescriptionItems && (
            <div className="p-4 bg-red-50/70 border border-red-200 rounded-2xl space-y-2.5">
              <div className="flex items-center gap-2 text-red-900 font-extrabold text-xs">
                <FileText className="w-4 h-4 text-red-600" />
                <span>Requisito Obligatorio: Fórmula Médica Veterinaria</span>
              </div>
              <p className="text-[11px] text-red-700 leading-relaxed">
                Este pedido incluye medicamentos controlados. Tu receta será verificada por el químico farmacéutico veterinario antes de autorizar el despacho.
              </p>
              <div className="p-3 bg-white rounded-xl border border-red-200 flex items-center justify-between text-xs">
                <div className="flex items-center gap-2 overflow-hidden">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span className="font-semibold text-slate-800 truncate">{uploadedFormulaName}</span>
                </div>
                <span className="text-[10px] text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full font-bold">
                  Adjuntada
                </span>
              </div>
              <input
                type="text"
                placeholder="Nombre del Médico Veterinario y Matrícula"
                value={vetName}
                onChange={e => setVetName(e.target.value)}
                className="w-full text-xs bg-white border border-red-200 rounded-xl px-3 py-2 text-slate-800 focus:outline-none"
              />
            </div>
          )}

          {/* Payment Method Selector */}
          <div className="space-y-2">
            <h4 className="font-extrabold text-xs text-slate-900 flex items-center gap-1.5 uppercase tracking-wider">
              <CreditCard className="w-3.5 h-3.5 text-red-600" />
              Método de Pago
            </h4>
            <div className="grid grid-cols-2 gap-2">
              {[
                { id: 'WOMPI_CARD', label: 'Wompi Tarjeta Débito/Crédito', icon: CreditCard },
                { id: 'WOMPI_PSE', label: 'PSE (Transferencia Banco)', icon: ShieldCheck },
                { id: 'WOMPI_BANCOLOMBIA', label: 'Botón Bancolombia', icon: CheckCircle2 },
                { id: 'CASH_ON_DELIVERY', label: 'Efectivo contra entrega', icon: DollarSign },
              ].map(m => {
                const Icon = m.icon;
                const isSelected = paymentMethod === m.id;
                return (
                  <div
                    key={m.id}
                    onClick={() => setPaymentMethod(m.id as PaymentMethod)}
                    className={`p-3 rounded-2xl border-2 cursor-pointer transition flex items-center gap-2.5 ${
                      isSelected
                        ? 'border-red-600 bg-red-50/60 text-red-900 font-bold'
                        : 'border-slate-200 hover:border-slate-300 text-slate-700 font-medium'
                    }`}
                  >
                    <Icon className={`w-4 h-4 ${isSelected ? 'text-red-600' : 'text-slate-400'}`} />
                    <span className="text-xs leading-tight">{m.label}</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Driver Tip */}
          <div>
            <label className="text-[11px] font-bold text-slate-700 block mb-1">
              Propina voluntaria para el repartidor:
            </label>
            <div className="flex gap-2 text-xs">
              {[0, 2000, 5000, 10000].map(amt => (
                <button
                  key={amt}
                  type="button"
                  onClick={() => setTip(amt)}
                  className={`flex-1 py-1.5 rounded-xl border font-bold transition text-xs ${
                    tip === amt
                      ? 'border-red-600 bg-red-50 text-red-700'
                      : 'border-slate-200 text-slate-600 hover:border-slate-300'
                  }`}
                >
                  {amt === 0 ? '$0' : formatCOP(amt)}
                </button>
              ))}
            </div>
          </div>

          {/* Breakdown and Submit */}
          <div className="bg-slate-50 p-4 rounded-2xl space-y-2 border border-slate-100 text-xs text-slate-600">
            <div className="flex justify-between">
              <span>Subtotal:</span>
              <span className="font-bold text-slate-900">{formatCOP(subtotal)}</span>
            </div>
            <div className="flex justify-between">
              <span>Envío Turbo:</span>
              <span className="font-bold text-emerald-600">{shipping === 0 ? '¡GRATIS!' : formatCOP(shipping)}</span>
            </div>
            <div className="flex justify-between">
              <span>Tarifa de servicio:</span>
              <span className="font-bold text-slate-900">{formatCOP(serviceFee)}</span>
            </div>
            {tip > 0 && (
              <div className="flex justify-between">
                <span>Propina repartidor:</span>
                <span className="font-bold text-slate-900">{formatCOP(tip)}</span>
              </div>
            )}
            <div className="border-t border-slate-200 pt-2 flex justify-between text-base font-black text-slate-900">
              <span>Total final:</span>
              <span className="text-red-600">{formatCOP(total)}</span>
            </div>
          </div>

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full bg-red-600 hover:bg-red-700 disabled:bg-slate-400 text-white font-black py-4 rounded-2xl text-sm flex items-center justify-center gap-2 shadow-lg shadow-red-500/30 transition active:scale-98"
          >
            {isSubmitting ? (
              <span>Procesando pago seguro...</span>
            ) : (
              <>
                <span>Pagar {formatCOP(total)} y Solicitar Turbo</span>
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </button>
        </form>
      </div>
    </div>
  );
};
