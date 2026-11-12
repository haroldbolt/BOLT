import type { ConfirmationOrder } from '../components/customer/OrderConfirmation';

const sample: Pick<ConfirmationOrder, 'deliveryAddress' | 'items' | 'totals' | 'payment'> = {
  deliveryAddress: {
    address: 'Dirección de ejemplo en Cedritos, Bogotá',
    details: '',
    porteriaPolicy: 'DEJAR_EN_PORTERIA',
    coordinates: { lat: 4.725, lng: -74.04 },
    municipality: 'Bogotá D.C.',
    locality: 'Usaquén',
    neighborhood: 'Cedritos',
  },
  items: [
    {
      productId: 'DEMO-ALIMENTO',
      sku: 'DEMO-ALIMENTO',
      name: 'Alimento para perro adulto',
      brand: 'Muestra BOLT',
      presentation: 'Bolsa de 3 kg',
      price: 59900,
      quantity: 1,
      image: '',
      weightKg: 3,
      requiresPrescription: false,
    },
    {
      productId: 'DEMO-SNACK',
      sku: 'DEMO-SNACK',
      name: 'Snacks de pollo para perro',
      brand: 'Muestra BOLT',
      presentation: 'Paquete de 100 g',
      price: 6500,
      quantity: 2,
      image: '',
      weightKg: 0.1,
      requiresPrescription: false,
    },
  ],
  totals: { subtotal: 72900, discount: 0, shipping: 0, serviceFee: 0, tip: 0, total: 72900, totalWeightKg: 3.2 },
  payment: { method: 'CASH_ON_DELIVERY', status: 'PENDIENTE', cashToCollect: 72900, cashSettled: false },
};

const confirmed: ConfirmationOrder = {
  ...sample,
  id: 'DEMO-CHECKOUT-CONFIRMADO',
  purchaseCode: 'DEMO-1001',
  orderNumber: 'DEMO-1001',
  fulfillmentStatus: 'CONFIRMADO',
  deliveryMode: 'PROGRAMADO',
  scheduledWindow: {
    slotId: 'DEMO-HORARIO',
    date: '2026-11-18',
    dateLabel: 'Miércoles, 18 de noviembre',
    startTime: '14:00',
    endTime: '17:00',
    displayWindow: '2:00 p. m. a 5:00 p. m.',
  },
  estimatedDeliveryMinutes: 0,
};

const pending: ConfirmationOrder = {
  ...sample,
  id: 'DEMO-CHECKOUT-PENDIENTE',
  purchaseCode: 'DEMO-1002',
  orderNumber: 'DEMO-1002',
  fulfillmentStatus: 'PENDIENTE_CONFIRMACION',
  deliveryReview: {
    status: 'PENDING',
    requestedAt: '2026-11-06T18:00:00.000Z',
    reasonCode: 'TRANSPORT_DATA_PENDING',
    requestedMode: 'PROGRAMADO',
  },
  totals: { ...sample.totals, totalWeightKg: null },
  payment: { ...sample.payment, cashToCollect: 0 },
  estimatedDeliveryMinutes: 0,
};

export function getCheckoutPreviewOrder(state: 'confirmado' | 'pendiente'): ConfirmationOrder {
  return state === 'pendiente' ? pending : confirmed;
}
