import type { TransportVehicle } from '../types/transport';
import type { Order } from '../types';

export const cashDemoEmail = 'efectivo-suba@example.invalid';
export const cashDemoSku = 'SIM-CARD-1';
export const cashDemoStoreId = 'HUB_SUBA';
export const cashDemoDriverId = 'SIM-CASH-SUBA';
export const cashDemoDriverName = 'Conductor de prueba · Efectivo Suba';
export const cashDemoVehicle: TransportVehicle = {
  driverId: cashDemoDriverId,
  storeIds: [cashDemoStoreId],
  enabled: true,
  modes: ['TURBO'],
  maxLoadGrams: 5000,
  packagingGrams: 200,
  cargoDimensionsCm: [60, 40, 35],
  maxVolumeCm3: 84000,
  scheduledSlots: [],
};

export function isDemoCashCheckoutOrder(order: Order) {
  return order.storeId === cashDemoStoreId &&
    order.payment.method === 'CASH_ON_DELIVERY' &&
    order.customer.email === cashDemoEmail &&
    !!order.creationRequestId &&
    /^[a-f0-9]{64}$/.test(order.creationRequestFingerprint ?? '') &&
    order.items.length === 1 &&
    order.items[0].sku === cashDemoSku &&
    order.items[0].quantity === 1;
}
