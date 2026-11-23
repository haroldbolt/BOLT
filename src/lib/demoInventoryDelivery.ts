import type { Order } from '../types';

export function isDemoInventoryDeliveryOrder(order: Order): boolean {
  const item = order.items[0];
  return order.storeId === 'HUB_SUBA' &&
    order.customer.isGuest &&
    order.customer.email === 'prueba-entrega-suba@example.invalid' &&
    !order.customerAccountId &&
    /^[a-f0-9]{64}$/.test(order.creationRequestFingerprint ?? '') &&
    order.items.length === 1 &&
    item.productId === 'gid://shopify/ProductVariant/48875669717272' &&
    item.quantity === 1 &&
    order.deliveryReview?.requestedMode === 'PROGRAMADO' &&
    !order.isSplitOrder && !order.childShipments?.length &&
    !order.driver && !order.transportLoad && !order.timestamps.pickedUpAt &&
    order.payment.status === 'PENDIENTE' &&
    order.payment.cashToCollect === 0 && !order.payment.transactionId;
}
