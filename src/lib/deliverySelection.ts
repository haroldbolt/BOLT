import type { DeliveryMode, Order } from '../types';
import type { DeliveryQuote, LatLng } from './deliveryService';

/** A scheduled quote has its own dispatch decision, even when Turbo is offered. */
export function deliveryStore(quote: DeliveryQuote | null | undefined, mode: DeliveryMode) {
  if (!quote) return undefined;
  if (mode === 'PROGRAMADO') {
    const assignment = quote.scheduledAssignment;
    if (!quote.availableModes.scheduled || !assignment?.storeId || assignment.storeId === 'HUB_CENTRO' ||
      ['SIN_COBERTURA', 'DIRECCION_PENDIENTE'].includes(assignment.status)) return undefined;
    return { id: assignment.storeId, name: assignment.storeName, confirmed: assignment.status === 'CONFIRMADA' };
  }
  const available = mode === 'TURBO' ? quote.availableModes.turbo : quote.availableModes.turboDividido;
  return available && quote.assignedStoreId ? { id: quote.assignedStoreId, name: quote.assignedStoreName, confirmed: true } : undefined;
}

export function availableDeliveryMode(quote: DeliveryQuote, current: DeliveryMode): DeliveryMode {
  if (current === 'PROGRAMADO' && quote.availableModes.scheduled) return current;
  if (current === 'TURBO' && quote.availableModes.turbo) return current;
  if (current === 'TURBO_DIVIDIDO' && quote.availableModes.turboDividido) return current;
  return quote.recommendedMode || current;
}

/** Price responses can only be reused for this exact delivery/cart context. */
export function deliveryPricingContext(input: {
  mode: DeliveryMode; storeId?: string; address: string; coordinates?: LatLng;
  items: Array<{ productId: string; quantity: number }>;
}) {
  return JSON.stringify([input.mode, input.storeId || null, input.address, input.coordinates?.lat ?? null,
    input.coordinates?.lng ?? null, input.items.map(item => [item.productId, item.quantity])]);
}

export const HISTORIC_LOCALITY = 'HISTORICO_SIN_CLASIFICACION';
export function scheduledOrderLocality(order: Order) {
  return order.scheduledDispatch?.localityCode && order.scheduledDispatch.localityName
    ? { code: order.scheduledDispatch.localityCode, name: order.scheduledDispatch.localityName }
    : { code: HISTORIC_LOCALITY, name: 'Histórico / sin clasificación' };
}
export function scheduledOrderWindow(order: Order) {
  const window = order.scheduledWindow;
  return window ? { id: window.windowId || `${window.startTime}-${window.endTime}`, name: window.displayWindow || `${window.startTime}–${window.endTime}` }
    : { id: 'SIN_FRANJA', name: 'Sin franja guardada' };
}

export function groupScheduledOrders(orders: Order[]) {
  const groups = new Map<string, { key: string; storeId: string; storeName: string; date: string;
    window: string; locality: string; status: string; count: number }>();
  for (const order of orders) {
    if (order.deliveryMode !== 'PROGRAMADO' || ['CANCELADO', 'ENTREGADO'].includes(order.fulfillmentStatus)) continue;
    const locality = scheduledOrderLocality(order);
    const window = scheduledOrderWindow(order);
    const date = order.scheduledWindow?.date || 'Sin fecha guardada';
    const status = order.scheduledDispatch?.status === 'CONFIRMADA' ? 'Confirmada' : 'Histórico / sin clasificación';
    const key = JSON.stringify([order.storeId, date, window.id, locality.code, status]);
    const group = groups.get(key);
    if (group) group.count++;
    else groups.set(key, { key, storeId: order.storeId, storeName: order.storeName, date, window: window.name,
      locality: locality.name, status, count: 1 });
  }
  return [...groups.values()].sort((a, b) => a.date.localeCompare(b.date) || a.storeName.localeCompare(b.storeName) || a.window.localeCompare(b.window) || a.locality.localeCompare(b.locality));
}
