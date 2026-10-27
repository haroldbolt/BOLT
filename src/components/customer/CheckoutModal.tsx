import React, { useState, useEffect } from 'react';
import { 
  X, MapPin, CreditCard, DollarSign, FileText, CheckCircle2, 
  ShieldCheck, ArrowRight, Upload, Phone, User, Building, Clock, 
  Edit3, Calendar, Sparkles, AlertTriangle, Truck
} from 'lucide-react';
import confetti from 'canvas-confetti';
import { CartItem, Store, PaymentMethod, PorteriaPolicy, DeliveryMode, ScheduledDeliveryWindow } from '../../types';
import { DeliveryQuote, LatLng, ScheduledSlot } from '../../lib/deliveryService';
import { formatCOP } from '../../lib/formatters';
import { api } from '../../lib/api';
import { BenefitProgressBar } from './BenefitProgressBar';

interface CheckoutModalProps {
  isOpen: boolean;
  onClose: () => void;
  cartItems: CartItem[];
  currentStore: Store;
  onOrderSuccess: (orderId: string) => void;
  customerAddress?: string;
  customerAddressDetails?: string;
  customerCoordinates?: LatLng;
  deliveryQuote?: DeliveryQuote | null;
  onChangeAddress?: () => void;
  selectedMode?: DeliveryMode;
  onSelectMode?: (mode: DeliveryMode) => void;
  selectedScheduledWindow?: ScheduledDeliveryWindow | null;
  onSelectScheduledWindow?: (window: ScheduledDeliveryWindow) => void;
}

export const CheckoutModal: React.FC<CheckoutModalProps> = ({
  isOpen,
  onClose,
  cartItems,
  currentStore,
  onOrderSuccess,
  customerAddress,
  customerAddressDetails,
  customerCoordinates,
  deliveryQuote,
  onChangeAddress,
  selectedMode: selectedModeProp,
  onSelectMode,
  selectedScheduledWindow: selectedScheduledWindowProp,
  onSelectScheduledWindow,
}) => {
  const [customerName, setCustomerName] = useState('Juan David Gómez');
  const [customerPhone, setCustomerPhone] = useState('+57 312 890 1234');
  const [customerEmail, setCustomerEmail] = useState('juan.gomez@ejemplo.com');
  const [address, setAddress] = useState(
    customerAddress || (currentStore.id === 'HUB_KENNEDY'
      ? 'Calle 3 #78-20, Kennedy Central, Bogotá'
      : currentStore.address)
  );
  const [addressDetails, setAddressDetails] = useState(customerAddressDetails || 'Apto 502, Torre 2');
  const [porteriaPolicy, setPorteriaPolicy] = useState<PorteriaPolicy>('DEJAR_EN_PORTERIA');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('WOMPI_CARD');
  const [tip, setTip] = useState(2000);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  // Delivery mode state
  const defaultMode: DeliveryMode = selectedModeProp || deliveryQuote?.recommendedMode || 'TURBO';
  const [selectedMode, setSelectedMode] = useState<DeliveryMode>(defaultMode);

  // Scheduled delivery slot state: nunca mostrar franjas expiradas
  const availableSlots: ScheduledSlot[] = (deliveryQuote?.scheduledSlots || []).filter(s => !s.cutoffPassed);
  const [selectedSlotId, setSelectedSlotId] = useState<string>(() => {
    if (selectedScheduledWindowProp?.slotId && availableSlots.some(s => s.slotId === selectedScheduledWindowProp.slotId)) {
      return selectedScheduledWindowProp.slotId;
    }
    return availableSlots[0]?.slotId || '';
  });

  // Synchronize inputs when modal opens
  useEffect(() => {
    if (isOpen) {
      if (customerAddress) setAddress(customerAddress);
      if (customerAddressDetails) setAddressDetails(customerAddressDetails);
    }
  }, [isOpen, customerAddress, customerAddressDetails]);

  useEffect(() => {
    if (!isOpen) return;
    if (selectedModeProp) {
      setSelectedMode(selectedModeProp);
    } else if (deliveryQuote?.recommendedMode) {
      setSelectedMode(deliveryQuote.recommendedMode);
    }
  }, [isOpen, selectedModeProp, deliveryQuote]);

  useEffect(() => {
    if (!isOpen) return;
    if (selectedScheduledWindowProp?.slotId && availableSlots.some(s => s.slotId === selectedScheduledWindowProp.slotId)) {
      setSelectedSlotId(selectedScheduledWindowProp.slotId);
    } else if (!selectedSlotId && availableSlots.length > 0) {
      setSelectedSlotId(availableSlots[0].slotId);
      onSelectScheduledWindow?.(availableSlots[0]);
    }
  }, [isOpen, selectedScheduledWindowProp, availableSlots]);

  // Formula upload states
  const hasPrescriptionItems = cartItems.some(i => i.product.requiresPrescription);
  const [uploadedFormulaName, setUploadedFormulaName] = useState<string>('receta_veterinaria_dr_martinez.pdf');
  const [vetName, setVetName] = useState('Dr. Carlos Martínez - MP: 12904-COMVEZCOL');

  const subtotal = cartItems.reduce((acc, item) => acc + (item.product.price * item.quantity), 0);
  const totalWeightKg = cartItems.reduce((acc, item) => acc + ((item.product.weightKg || 0.2) * item.quantity), 0);
  const totalWeightGrams = Math.round(totalWeightKg * 1000);
  const shipping = subtotal >= 70000 ? 0 : 4900;
  const serviceFee = 1500;
  const total = subtotal + shipping + serviceFee + tip;

  const selectedSlot = availableSlots.find(s => s.slotId === selectedSlotId);

  const handleSubmitOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setErrorMessage('');

    try {
      const scheduledWindowPayload: ScheduledDeliveryWindow | undefined =
        selectedMode === 'PROGRAMADO' && selectedSlot
          ? {
              slotId: selectedSlot.slotId,
              windowId: selectedSlot.windowId,
              windowName: selectedSlot.windowName,
              date: selectedSlot.date,
              dateLabel: selectedSlot.dateLabel,
              startTime: selectedSlot.startTime,
              endTime: selectedSlot.endTime,
              displayWindow: selectedSlot.displayWindow,
              displayWindowShort: selectedSlot.displayWindowShort,
              bookingCutoffTime: selectedSlot.bookingCutoffTime,
              bookingCutoffLabel: selectedSlot.bookingCutoffLabel,
              commercialHook: selectedSlot.commercialHook,
              countdownNotice: selectedSlot.countdownNotice,
              price: selectedSlot.price,
            }
          : undefined;

      const payload = {
        storeId: deliveryQuote?.assignedStoreId || currentStore.id,
        deliveryMode: selectedMode,
        scheduledWindow: scheduledWindowPayload,
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
          coordinates: customerCoordinates || {
            lat: 4.6365,
            lng: -74.1448,
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

  const isEligibleForAny =
    !deliveryQuote ||
    deliveryQuote.availableModes.turbo ||
    deliveryQuote.availableModes.turboDividido ||
    deliveryQuote.availableModes.scheduled;

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
      <div className="bg-white rounded-3xl max-w-xl w-full max-h-[94vh] overflow-y-auto shadow-2xl animate-in zoom-in-95 border border-slate-100">
        
        {/* Header */}
        <div className="p-4 border-b border-slate-100 flex items-center justify-between sticky top-0 bg-white/95 backdrop-blur-xs z-10">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-black text-slate-900 text-lg">
                {selectedMode === 'PROGRAMADO'
                  ? 'Confirmar Envío Programado'
                  : selectedMode === 'TURBO_DIVIDIDO'
                  ? 'Confirmar Turbo Dividido'
                  : 'Confirmar Pedido Turbo'}
              </h3>
              {selectedMode !== 'PROGRAMADO' && (
                <span className="text-[11px] font-black bg-yellow-400 text-red-950 px-2 py-0.5 rounded-md flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  ~{deliveryQuote?.estimatedMinutes || 25} min
                </span>
              )}
            </div>
            <p className="text-xs text-slate-500">
              Sede asignada: {deliveryQuote?.assignedStoreName || currentStore.name} • Peso: {totalWeightKg.toFixed(1)} kg
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-500 transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmitOrder} className="p-5 space-y-4">
          {errorMessage && (
            <div className="p-3 bg-red-50 border border-red-200 text-red-800 rounded-2xl text-xs font-semibold flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* Delivery Mode Selector (Turbo, Turbo Dividido, Programado) */}
          <div className="space-y-2">
            <h4 className="font-extrabold text-xs text-slate-900 flex items-center gap-1.5 uppercase tracking-wider">
              <Truck className="w-3.5 h-3.5 text-red-600" />
              Modo de Entrega
            </h4>

            {/* Outside Turbo coverage banner if applicable */}
            {deliveryQuote && !deliveryQuote.availableModes.turbo && !deliveryQuote.availableModes.turboDividido && deliveryQuote.availableModes.scheduled && (
              <div className="p-3 bg-blue-50/80 border border-blue-200 rounded-2xl text-xs text-blue-900">
                <p className="font-bold flex items-center gap-1.5">
                  <Calendar className="w-4 h-4 text-blue-600" />
                  Envío Programado en Bogotá
                </p>
                <p className="text-[11px] text-blue-800 mt-0.5">
                  {deliveryQuote.scheduledExplanation || deliveryQuote.message}
                </p>
              </div>
            )}

            {/* Mode selection buttons */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {/* Option: Turbo standard */}
              {deliveryQuote?.availableModes.turbo && (
                <div
                  onClick={() => {
                    setSelectedMode('TURBO');
                    onSelectMode?.('TURBO');
                  }}
                  className={`p-3 rounded-2xl border-2 cursor-pointer transition ${
                    selectedMode === 'TURBO'
                      ? 'border-red-600 bg-red-50/70 text-red-950 font-bold shadow-xs'
                      : 'border-slate-200 hover:border-slate-300 text-slate-700 bg-white'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-extrabold text-xs flex items-center gap-1 text-red-600">
                      ⚡ Entrega Turbo
                    </span>
                    <span className="text-[10px] font-black bg-yellow-400 text-red-950 px-1.5 py-0.5 rounded">
                      ~{deliveryQuote.estimatedMinutes} min
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-500 mt-1">
                    Directo a tu puerta en motocicleta antes de 25 min.
                  </p>
                </div>
              )}

              {/* Option: Turbo Dividido (> 60 kg) */}
              {deliveryQuote?.availableModes.turboDividido && (
                <div
                  onClick={() => {
                    setSelectedMode('TURBO_DIVIDIDO');
                    onSelectMode?.('TURBO_DIVIDIDO');
                  }}
                  className={`p-3 rounded-2xl border-2 cursor-pointer transition ${
                    selectedMode === 'TURBO_DIVIDIDO'
                      ? 'border-amber-600 bg-amber-50/80 text-amber-950 font-bold shadow-xs'
                      : 'border-slate-200 hover:border-slate-300 text-slate-700 bg-white'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-extrabold text-xs flex items-center gap-1 text-amber-700">
                      ⚡ Turbo Dividido
                    </span>
                    <span className="text-[10px] font-black bg-yellow-400 text-red-950 px-1.5 py-0.5 rounded">
                      {deliveryQuote.turboDividido?.shipmentCount} motos (~{deliveryQuote.estimatedMinutes} min)
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-600 mt-1">
                    Carga pesada ({totalWeightKg.toFixed(0)} kg): {deliveryQuote.turboDividido?.shipmentCount} motos simultáneas con plazo común de 25 min.
                  </p>
                </div>
              )}

              {/* Option: Envío Programado */}
              {deliveryQuote?.availableModes.scheduled && (
                <div
                  onClick={() => {
                    setSelectedMode('PROGRAMADO');
                    onSelectMode?.('PROGRAMADO');
                  }}
                  className={`p-3 rounded-2xl border-2 cursor-pointer transition ${
                    selectedMode === 'PROGRAMADO'
                      ? 'border-blue-600 bg-blue-50/80 text-blue-950 font-bold shadow-xs'
                      : 'border-slate-200 hover:border-slate-300 text-slate-700 bg-white'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-extrabold text-xs flex items-center gap-1 text-blue-700">
                      📅 Envío Programado
                    </span>
                    <span className="text-[10px] font-bold bg-blue-100 text-blue-800 px-1.5 py-0.5 rounded">
                      Elige Franja
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-500 mt-1">
                    Recibe tu compra en fecha y franja horaria preferida.
                  </p>
                </div>
              )}
            </div>

            {/* Split Order Information Details */}
            {selectedMode === 'TURBO_DIVIDIDO' && deliveryQuote?.turboDividido && (
              <div className="p-3 bg-amber-50 rounded-2xl border border-amber-200 text-xs text-amber-950 space-y-1.5">
                <div className="flex items-center justify-between font-extrabold">
                  <span>Detalle de partición en {deliveryQuote.turboDividido.shipmentCount} envíos:</span>
                  <span className="text-[11px] text-amber-800">
                    Límite común: 25 min (1.500s)
                  </span>
                </div>
                <div className="space-y-1 pt-1">
                  {deliveryQuote.turboDividido.shipments.map((s, idx) => (
                    <div key={s.shipmentId} className="flex justify-between items-center text-[11px] bg-white/80 p-1.5 rounded-lg border border-amber-200">
                      <span>
                        <strong>Envío {idx + 1}:</strong> {s.weightKg} kg ({s.items.length} productos)
                      </span>
                      <span className="font-semibold text-slate-700">
                        {paymentMethod === 'CASH_ON_DELIVERY' ? `Cobro: ${formatCOP(s.subtotal)}` : 'Despacho simultáneo'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Scheduled Slot Picker */}
            {selectedMode === 'PROGRAMADO' && (
              <div className="p-3.5 bg-slate-50 rounded-2xl border border-slate-200 space-y-2.5">
                <div className="flex items-center justify-between">
                  <label className="text-[11px] font-extrabold text-slate-800 flex items-center gap-1.5">
                    <Calendar className="w-3.5 h-3.5 text-blue-600" />
                    <span>Selecciona la franja oficial de entrega:</span>
                  </label>
                  <span className="text-[10px] text-slate-500 font-semibold">Hora de Bogotá (COT)</span>
                </div>

                {availableSlots.length === 0 ? (
                  <div className="p-3 bg-amber-50 rounded-xl border border-amber-200 text-xs text-amber-900">
                    Las franjas de entrega para hoy ya cerraron su horario de corte. Por favor consulta las opciones disponibles para mañana.
                  </div>
                ) : (
                  <div className="grid grid-cols-1 gap-2">
                    {availableSlots.map(slot => {
                      const isSelected = selectedSlotId === slot.slotId;
                      return (
                        <div
                          key={slot.slotId}
                          onClick={() => {
                            setSelectedSlotId(slot.slotId);
                            onSelectScheduledWindow?.(slot);
                          }}
                          className={`p-3 rounded-2xl border-2 text-left cursor-pointer transition ${
                            isSelected
                              ? 'border-blue-600 bg-blue-50/90 text-blue-950 font-bold shadow-xs'
                              : 'border-slate-200 bg-white hover:border-slate-300 text-slate-700'
                          }`}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="font-extrabold text-xs text-slate-900">
                                  {slot.windowName} ({slot.displayWindow})
                                </span>
                                <span className="text-[10px] font-bold bg-blue-100 text-blue-800 px-1.5 py-0.2 rounded-md">
                                  {slot.dateLabel}
                                </span>
                              </div>
                              <p className="text-[11px] text-blue-950/80 font-medium mt-1">
                                {slot.commercialHook}
                              </p>
                            </div>
                            <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200 shrink-0">
                              {slot.availableCapacity} cupos
                            </span>
                          </div>

                          {slot.countdownNotice && (
                            <div className="mt-2 text-[10px] font-extrabold text-amber-900 bg-amber-100/90 border border-amber-300 px-2.5 py-1 rounded-xl inline-flex items-center gap-1.5 animate-pulse">
                              <span>{slot.countdownNotice}</span>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                {selectedSlot && (
                  <p className="text-[11px] text-blue-900 font-semibold pt-1">
                    ✓ Entrega programada para <strong>{selectedSlot.windowName} ({selectedSlot.displayWindow})</strong> · <strong>{selectedSlot.dateLabel}</strong>.
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Customer Contact Info */}
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
            <div className="flex items-center justify-between">
              <h4 className="font-extrabold text-xs text-slate-900 flex items-center gap-1.5 uppercase tracking-wider">
                <MapPin className="w-3.5 h-3.5 text-red-600" />
                Dirección de Entrega
              </h4>
              {onChangeAddress && (
                <button
                  type="button"
                  onClick={onChangeAddress}
                  className="text-[11px] font-bold text-red-600 hover:text-red-700 flex items-center gap-1"
                >
                  <Edit3 className="w-3 h-3" />
                  Cambiar en mapa
                </button>
              )}
            </div>

            <input
              type="text"
              placeholder="Dirección completa (ej. Calle 3 #78-20, Kennedy)"
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

            {/* COD reconciliation note for split orders */}
            {paymentMethod === 'CASH_ON_DELIVERY' && selectedMode === 'TURBO_DIVIDIDO' && (
              <p className="text-[11px] text-amber-900 bg-amber-50 p-2 rounded-xl border border-amber-200 font-medium">
                💵 Al pagar contra entrega en pedido dividido, cada repartidor cobrará el monto proporcional de su envío correspondiente al entregártelo.
              </p>
            )}
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

          {/* Dynamic Free Shipping Benefit relocated to Checkout */}
          <div className="pt-1">
            <BenefitProgressBar subtotal={subtotal} threshold={70000} />
          </div>

          {/* Breakdown and Submit */}
          <div className="bg-slate-50 p-4 rounded-2xl space-y-2 border border-slate-100 text-xs text-slate-600">
            <div className="flex justify-between">
              <span>Subtotal:</span>
              <span className="font-bold text-slate-900">{formatCOP(subtotal)}</span>
            </div>
            <div className="flex justify-between">
              <span>Envío ({selectedMode === 'PROGRAMADO' ? 'Programado' : selectedMode === 'TURBO_DIVIDIDO' ? 'Turbo Dividido' : 'Turbo'}):</span>
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
            disabled={isSubmitting || !isEligibleForAny}
            className="w-full bg-red-600 hover:bg-red-700 disabled:bg-slate-400 text-white font-black py-4 rounded-2xl text-sm flex items-center justify-center gap-2 shadow-lg shadow-red-500/30 transition active:scale-98 disabled:cursor-not-allowed"
          >
            {isSubmitting ? (
              <span>Procesando pago seguro...</span>
            ) : !isEligibleForAny ? (
              <span>Dirección fuera de cobertura</span>
            ) : selectedMode === 'PROGRAMADO' ? (
              <>
                <span>Confirmar y Programar Entrega ({formatCOP(total)})</span>
                <ArrowRight className="w-4 h-4" />
              </>
            ) : selectedMode === 'TURBO_DIVIDIDO' ? (
              <>
                <span>Pagar {formatCOP(total)} y Solicitar Turbo Dividido</span>
                <ArrowRight className="w-4 h-4" />
              </>
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
