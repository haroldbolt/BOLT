import React, { useState, useEffect, useMemo } from 'react';
import { 
  X, MapPin, CreditCard, DollarSign, FileText, CheckCircle2, 
  ShieldCheck, ArrowRight, Upload, Phone, User, Building, Clock, 
  Edit3, Calendar, Sparkles, AlertTriangle, Truck
} from 'lucide-react';
import confetti from 'canvas-confetti';
import { CartItem, Store, PaymentMethod, NewOrderPorteriaPolicy, DeliveryMode, ScheduledDeliveryWindow } from '../../types';
import { DeliveryQuote, LatLng, ScheduledSlot } from '../../lib/deliveryService';
import { formatCOP } from '../../lib/formatters';
import { api } from '../../lib/api';
import { BenefitProgressBar } from './BenefitProgressBar';
import { TurboPromise } from './TurboPromise';
import { deliveryPricingContext, deliveryStore } from '../../lib/deliverySelection';
import { NEW_ORDER_DELIVERY_OPTIONS, NEW_ORDER_SERVICE_FEE, isNewOrderPorteriaPolicy } from '../../lib/checkoutPolicy';

/** A cached quote with the retired fee must be refreshed before checkout. */
export function isCurrentCheckoutPrice(value: unknown): value is Awaited<ReturnType<typeof api.priceCart>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const price = value as Awaited<ReturnType<typeof api.priceCart>>;
  return [price.subtotal, price.discount, price.shipping, price.serviceFee, price.total]
    .every(amount => typeof amount === 'number' && Number.isFinite(amount) && amount >= 0) &&
    price.discount <= price.subtotal && price.serviceFee === NEW_ORDER_SERVICE_FEE &&
    price.total === price.subtotal - price.discount + price.shipping;
}

interface CheckoutModalProps {
  isOpen: boolean;
  onClose: () => void;
  cartItems: CartItem[];
  currentStore: Store;
  onOrderSuccess: (orderId: string) => void;
  customerAddress?: string;
  customerAddressDetails?: string;
  customerCoordinates?: LatLng;
  onChangeAddressDetails: (details: string) => void;
  deliveryQuote?: DeliveryQuote | null;
  catalogReady: boolean;
  addressReady?: boolean;
  cartReviewMessage?: string;
  onRefreshDeliveryQuote?: () => void;
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
  onChangeAddressDetails,
  deliveryQuote: suppliedDeliveryQuote,
  catalogReady,
  addressReady = true,
  cartReviewMessage,
  onRefreshDeliveryQuote,
  onChangeAddress,
  selectedMode: selectedModeProp,
  onSelectMode,
  selectedScheduledWindow: selectedScheduledWindowProp,
  onSelectScheduledWindow,
}) => {
  const deliveryQuote = addressReady ? suppliedDeliveryQuote : null;
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  // The selector owns the validated address/coordinate pair. Checkout cannot
  // edit only its text and accidentally keep another delivery point.
  const address = customerAddress ?? '';
  const addressDetails = customerAddressDetails ?? '';
  const [porteriaPolicy, setPorteriaPolicy] = useState<NewOrderPorteriaPolicy>('DEJAR_EN_PORTERIA');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('WOMPI_CARD');
  const [tip, setTip] = useState(2000);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  // Delivery mode state
  const defaultMode: DeliveryMode = selectedModeProp || deliveryQuote?.recommendedMode || 'TURBO';
  const [selectedMode, setSelectedMode] = useState<DeliveryMode>(defaultMode);

  // Scheduled delivery slot state: solo mostrar franjas vigentes
  const availableSlots: ScheduledSlot[] = useMemo(() => {
    return (deliveryQuote?.scheduledSlots || []).filter(s => !s.cutoffPassed && s.availableCapacity > 0);
  }, [deliveryQuote?.scheduledSlots]);

  // Agrupar franjas por fecha para visualización limpia
  const slotsByDate = useMemo(() => {
    const map = new Map<string, { date: string; dateLabel: string; slots: ScheduledSlot[] }>();
    availableSlots.forEach(slot => {
      if (!map.has(slot.date)) {
        map.set(slot.date, {
          date: slot.date,
          dateLabel: slot.dateLabel,
          slots: [],
        });
      }
      map.get(slot.date)!.slots.push(slot);
    });
    return Array.from(map.values());
  }, [availableSlots]);

  const [checkoutActiveDate, setCheckoutActiveDate] = useState<string>('');

  useEffect(() => {
    if (slotsByDate.length > 0) {
      if (!checkoutActiveDate || !slotsByDate.some(d => d.date === checkoutActiveDate)) {
        setCheckoutActiveDate(slotsByDate[0].date);
      }
    }
  }, [slotsByDate, checkoutActiveDate]);

  const [selectedSlotId, setSelectedSlotId] = useState<string>(() => {
    if (selectedScheduledWindowProp?.slotId && availableSlots.some(s => s.slotId === selectedScheduledWindowProp.slotId)) {
      return selectedScheduledWindowProp.slotId;
    }
    return availableSlots[0]?.slotId || '';
  });

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
    } else if (selectedSlotId && !availableSlots.some(slot => slot.slotId === selectedSlotId)) {
      setSelectedSlotId('');
    }
  }, [isOpen, selectedScheduledWindowProp, availableSlots]);

  // Formula upload states
  const hasPrescriptionItems = cartItems.some(i => i.product.requiresPrescription);
  const [uploadedFormulaName, setUploadedFormulaName] = useState<string>('');
  const [vetName, setVetName] = useState('');
  const [pricingSnapshot, setPricingSnapshot] = useState<{ key: string; price: Awaited<ReturnType<typeof api.priceCart>> } | null>(null);
  const [pricingFailure, setPricingFailure] = useState<{ key: string; message: string } | null>(null);
  const [pricingRevision, setPricingRevision] = useState(0);
  const pricingKey = JSON.stringify(cartItems.map(item => ({ productId: item.product.id, quantity: item.quantity })));
  const dispatch = deliveryStore(deliveryQuote, selectedMode);
  const pricingStoreId = dispatch?.id;
  const contextKey = deliveryPricingContext({ mode: selectedMode, storeId: pricingStoreId, address,
    coordinates: customerCoordinates, items: JSON.parse(pricingKey) });
  const modeSynchronized = !selectedModeProp || selectedModeProp === selectedMode;
  const serverPrice = addressReady && catalogReady && modeSynchronized && pricingSnapshot?.key === contextKey &&
    isCurrentCheckoutPrice(pricingSnapshot.price) ? pricingSnapshot.price : null;
  const pricingError = pricingFailure?.key === contextKey ? pricingFailure.message : '';
  useEffect(() => {
    if (!isOpen || !addressReady || !pricingStoreId || !catalogReady || !modeSynchronized) return;
    let stopped = false;
    let sequence = 0;
    let controller: AbortController | undefined;
    const refresh = async () => {
      controller?.abort();
      const current = new AbortController();
      controller = current;
      const request = ++sequence;
      setPricingSnapshot(null);
      try {
        let price = await api.priceCart(pricingStoreId, JSON.parse(pricingKey), current.signal);
        if (!isCurrentCheckoutPrice(price)) {
          // Re-read once during an update; never accept a cached fee or total.
          price = await api.priceCart(pricingStoreId, JSON.parse(pricingKey), current.signal);
        }
        if (!isCurrentCheckoutPrice(price)) throw new Error('La cotización cambió. Recarga la página para confirmar el total actualizado sin tarifa de servicio.');
        if (!stopped && request === sequence && !current.signal.aborted) {
          setPricingSnapshot({ key: contextKey, price }); setPricingFailure(null);
        }
      } catch (error: any) {
        if (!stopped && request === sequence && !current.signal.aborted) {
          setPricingSnapshot(null); setPricingFailure({ key: contextKey, message: error.message });
        }
      }
    };
    refresh();
    const interval = window.setInterval(refresh, 15000);
    return () => { stopped = true; controller?.abort(); window.clearInterval(interval); };
  }, [isOpen, addressReady, contextKey, catalogReady, modeSynchronized, pricingRevision]);

  const subtotal = serverPrice?.subtotal ?? cartItems.reduce((acc, item) => acc + (item.product.price * item.quantity), 0);
  const totalWeightKg = cartItems.reduce((acc, item) => acc + ((item.product.weightKg || 0.2) * item.quantity), 0);
  const totalWeightGrams = Math.round(totalWeightKg * 1000);
  const shipping = serverPrice?.shipping ?? (subtotal >= 70000 ? 0 : 4900);
  const discount = serverPrice?.discount ?? 0;
  const total = subtotal - discount + shipping + tip;

  const selectedSlot = availableSlots.find(s => s.slotId === selectedSlotId);

  const handleSubmitOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setErrorMessage('');

    try {
      if (!addressReady) throw new Error('Confirma tu dirección y espera la validación de cobertura antes de continuar.');
      if (!isNewOrderPorteriaPolicy(porteriaPolicy)) throw new Error('Selecciona «Llamar al llegar» o «Dejar en portería».');
      if (!address.trim() || !customerCoordinates || !Number.isFinite(customerCoordinates.lat) || !Number.isFinite(customerCoordinates.lng) || !deliveryQuote) {
        throw new Error('Valida la dirección en el mapa y espera la cotización antes de continuar.');
      }
      if (!catalogReady || !modeSynchronized || !dispatch?.confirmed || dispatch.id !== currentStore.id) {
        throw new Error(deliveryQuote.scheduledAssignment?.reason || 'Espera la validación de productos y bodega para esta modalidad.');
      }
      if (selectedMode === 'PROGRAMADO' && !selectedSlot) throw new Error('Selecciona una franja vigente antes de continuar.');
      if (!serverPrice || pricingError) throw new Error(pricingError || 'Espera la verificación del total antes de continuar.');
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
        storeId: dispatch.id,
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
          coordinates: { ...customerCoordinates },
        },
        paymentMethod,
        tip,
        expectedTotal: total,
        expectedDiscount: discount,
      };

      const newOrder = await api.createOrder(payload);

      // If prescription required, upload document data
      if (hasPrescriptionItems && uploadedFormulaName) {
        await api.uploadPrescription(newOrder.id, {
          documentUrl: '',
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
      setPricingSnapshot(null);
      setPricingRevision(previous => previous + 1);
      onRefreshDeliveryQuote?.();
    } finally {
      setIsSubmitting(false);
    }
  };

  const isEligibleForAny = !!deliveryQuote && (selectedMode === 'PROGRAMADO'
    ? deliveryQuote.availableModes.scheduled : selectedMode === 'TURBO'
      ? deliveryQuote.availableModes.turbo : deliveryQuote.availableModes.turboDividido);
  const dispatchReady = addressReady && !!dispatch?.confirmed && dispatch.id === currentStore.id && catalogReady && modeSynchronized;
  const instructionReady = isNewOrderPorteriaPolicy(porteriaPolicy);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
      <div className="bg-white rounded-3xl max-w-xl min-[669px]:max-w-4xl w-full max-h-[94vh] overflow-y-auto shadow-2xl animate-in zoom-in-95 border border-slate-100">
        
        {/* Header */}
        <div className="p-4 border-b border-slate-100 flex items-center justify-between sticky top-0 bg-white/95 backdrop-blur-xs z-10">
          <div>
            <TurboPromise/>
            <div className="flex items-center gap-2">
              <h3 className="font-black text-slate-900 text-lg">
                {selectedMode === 'PROGRAMADO'
                  ? 'Confirmar Envío Programado'
                  : selectedMode === 'TURBO_DIVIDIDO'
                  ? 'Confirmar Turbo Dividido'
                  : 'Confirmar Pedido Turbo'}
              </h3>
              {addressReady && selectedMode !== 'PROGRAMADO' && deliveryQuote?.estimatedMinutes && (
                <span className="text-[11px] font-black bg-yellow-400 text-red-950 px-2 py-0.5 rounded-md flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  ~{deliveryQuote.estimatedMinutes} min
                </span>
              )}
            </div>
            <p className="text-xs text-slate-500">
              {!addressReady ? 'Confirma tu dirección para validar la entrega' : dispatch?.name ? `${dispatch.confirmed ? 'Sede confirmada' : 'Sede sugerida'}: ${dispatch.name}` : 'Verificando sede de despacho…'} • Peso: {totalWeightKg.toFixed(1)} kg
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
          {cartReviewMessage && <p role="status" className="p-3 rounded-xl border border-amber-200 bg-amber-50 text-xs text-amber-900">{cartReviewMessage}</p>}
          {!addressReady && <div role="status" className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-900">Confirma tu dirección antes de continuar. <button type="button" onClick={onChangeAddress} className="font-bold underline">Agregar o revisar dirección</button></div>}
          {errorMessage && (
            <div className="p-3 bg-red-50 border border-red-200 text-red-800 rounded-2xl text-xs font-semibold flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}

          <div className="grid grid-cols-1 min-[669px]:grid-cols-2 gap-5 items-start">
            {/* Columna Izquierda: Modalidad de entrega y dirección */}
            <div className="space-y-4">
              {/* Delivery Mode Selector (Turbo, Turbo Dividido, Programado) */}
              <div className="space-y-2">
                <h4 className="font-extrabold text-xs text-slate-900 flex items-center gap-1.5 uppercase tracking-wider">
                  <Truck className="w-3.5 h-3.5 text-red-600" />
                  Modo de Entrega
                </h4>

            {/* Outside Turbo coverage banner or auto-switch notification */}
            {deliveryQuote?.availableModes.scheduled && (deliveryQuote.autoSwitchedToScheduled || selectedMode === 'PROGRAMADO' || (!deliveryQuote.availableModes.turbo && !deliveryQuote.availableModes.turboDividido)) && (
              <div className="p-3.5 bg-blue-50/90 border border-blue-200 rounded-2xl text-xs text-blue-950 space-y-1">
                <p className="font-extrabold flex items-center gap-1.5 text-blue-900">
                  <Calendar className="w-4 h-4 text-blue-600 shrink-0" />
                  Para esta dirección, continuamos con envío programado. Elige cuándo recibir tu pedido
                </p>
                <p className="text-[11px] text-blue-800">
                  {deliveryQuote?.detectedLocalityName ? `Localidad: ${deliveryQuote.detectedLocalityName}. ` : ''}
                  {deliveryQuote?.message || 'Selecciona a continuación la fecha y franja horaria para recibir tu compra.'}
                </p>
              </div>
            )}
            {selectedMode === 'PROGRAMADO' && deliveryQuote?.scheduledAssignment && deliveryQuote.scheduledAssignment.status !== 'CONFIRMADA' && (
              <p role="status" className="p-3 bg-amber-50 border border-amber-200 text-amber-900 rounded-xl text-xs">
                {deliveryQuote.scheduledAssignment.reason || 'La sede sugerida está pendiente de validar inventario y disponibilidad para tu pedido.'}
              </p>
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
                    Recibe tu compra en fecha y franja horaria preferida en Bogotá.
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

                {/* Selector de días disponibles */}
                {slotsByDate.length > 1 && (
                  <div className="flex gap-1.5 overflow-x-auto pb-1 no-scrollbar">
                    {slotsByDate.map(d => {
                      const isCurrent = checkoutActiveDate === d.date;
                      return (
                        <button
                          key={d.date}
                          type="button"
                          onClick={() => setCheckoutActiveDate(d.date)}
                          className={`px-3 py-1 rounded-xl text-xs font-bold transition border ${
                            isCurrent
                              ? 'bg-blue-600 text-white border-blue-600 shadow-xs'
                              : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-100'
                          }`}
                        >
                          {d.dateLabel.split(',')[0]}
                        </button>
                      );
                    })}
                  </div>
                )}

                {availableSlots.length === 0 ? (
                  <div className="p-3 bg-amber-50 rounded-xl border border-amber-200 text-xs text-amber-900">
                    Las franjas de entrega para hoy ya cerraron su horario de corte. Por favor consulta las opciones disponibles para mañana.
                  </div>
                ) : (
                  <div className="grid grid-cols-1 gap-2">
                    {availableSlots
                      .filter(slot => !checkoutActiveDate || slot.date === checkoutActiveDate)
                      .map(slot => {
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
              readOnly
              aria-label="Dirección de entrega confirmada"
              onClick={onChangeAddress}
              required
              className="w-full text-xs font-medium bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-red-500"
            />
            <input
              type="text"
              placeholder="Detalles (Apto, Torre, Conjunto)"
              value={addressDetails}
              aria-label="Detalles de la dirección"
              onChange={e => onChangeAddressDetails(e.target.value)}
              className="w-full text-xs font-medium bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-red-500"
            />

            {/* Portería options */}
            <div className="pt-1">
              <label className="text-[11px] font-bold text-slate-700 block mb-1.5">
                Política de entrega en conjunto / edificio:
              </label>
              <div className="grid grid-cols-2 gap-2 text-xs">
                {NEW_ORDER_DELIVERY_OPTIONS.map(p => (
                  <button
                    key={p.value}
                    type="button"
                    onClick={() => setPorteriaPolicy(p.value)}
                    className={`py-2 px-2 rounded-xl border text-center font-bold text-[11px] transition ${
                      porteriaPolicy === p.value
                        ? 'border-red-600 bg-red-50 text-red-700'
                        : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
              {!instructionReady && <p role="alert" className="text-xs text-red-600 mt-1">Elige una de las instrucciones de entrega disponibles.</p>}
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
        </div>

        {/* Columna Derecha: Contacto, Pago, Propina y Resumen */}
        <div className="space-y-4">
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
              <span className="font-bold text-slate-900">{serverPrice ? formatCOP(subtotal) : 'Por verificar'}</span>
            </div>
            {discount > 0 && <div className="flex justify-between text-emerald-700"><span>{serverPrice?.promotionName || 'Promoción'}:</span><strong>−{formatCOP(discount)}</strong></div>}
            {pricingError && <p role="alert" className="text-red-600">{pricingError}</p>}
            {!serverPrice && !pricingError && <p>Verificando precios y promociones…</p>}
            {!catalogReady && <p role="status">Actualizando productos de la sede seleccionada…</p>}
            <div className="flex justify-between">
              <span>Envío ({selectedMode === 'PROGRAMADO' ? 'Programado' : selectedMode === 'TURBO_DIVIDIDO' ? 'Turbo Dividido' : 'Turbo'}):</span>
              <span className="font-bold text-emerald-600">{!addressReady ? 'Por confirmar' : shipping === 0 ? '¡GRATIS!' : formatCOP(shipping)}</span>
            </div>
            {tip > 0 && (
              <div className="flex justify-between">
                <span>Propina repartidor:</span>
                <span className="font-bold text-slate-900">{formatCOP(tip)}</span>
              </div>
            )}
            <div className="border-t border-slate-200 pt-2 flex justify-between text-base font-black text-slate-900">
              <span>Total final:</span>
              <span className="text-red-600">{serverPrice ? formatCOP(total) : 'Por verificar'}</span>
            </div>
          </div>

          <button
            type="submit"
            disabled={!addressReady || isSubmitting || !isEligibleForAny || !dispatchReady || !instructionReady || !serverPrice || !!pricingError || (selectedMode === 'PROGRAMADO' && !selectedSlot)}
            className="w-full bg-red-600 hover:bg-red-700 disabled:bg-slate-400 text-white font-black py-4 rounded-2xl text-sm flex items-center justify-center gap-2 shadow-lg shadow-red-500/30 transition active:scale-98 disabled:cursor-not-allowed"
          >
            {isSubmitting ? (
              <span>Creando pedido…</span>
            ) : !addressReady ? (
              <span>Confirma tu dirección para continuar</span>
            ) : !isEligibleForAny ? (
              <span>Dirección fuera de cobertura</span>
            ) : !dispatchReady || !serverPrice ? (
              <span>Verificando sede y disponibilidad…</span>
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
        </div>
      </div>
    </form>
      </div>
    </div>
  );
};
