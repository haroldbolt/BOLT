import type {
  ChildShipment, GPSTelemetry, Order, OrderActor, OrderItem, OrderStatusHistoryEntry, ScheduledDeliveryWindow, Store,
} from '../types';
import { resolveOrderWarehouse } from './warehouseAssignment';

// Copy named fields from this record, including when the persisted record has newer or legacy fields.
function fields<T, K extends keyof T>(record: T, ...keys: K[]): Pick<T, K> {
  const result = {} as Pick<T, K>;
  for (const key of keys) {
    if (record[key] !== undefined) result[key] = record[key];
  }
  return result;
}

export const staffTelemetry = (point: GPSTelemetry) => fields(point, 'pointId', 'orderId', 'shipmentId', 'driverId',
  'assignmentId', 'tripId', 'latitude', 'longitude', 'accuracy', 'heading', 'speed', 'batteryLevel', 'timestamp', 'sequenceNumber');

export const visibleItem = (item: OrderItem) => fields(item, 'productId', 'sku', 'name', 'brand', 'presentation', 'price', 'quantity', 'image', 'weightKg', 'requiresPrescription');
export const visibleTotals = (totals: Order['totals']) => fields(totals, 'subtotal', 'discount', 'shipping', 'serviceFee', 'tip', 'total', 'totalWeightKg');
export const visibleTimestamps = (times: Order['timestamps']) => times && fields(times, 'confirmedAt', 'prepStartedAt', 'prepCompletedAt', 'assignedAt', 'pickedUpAt', 'deliveredAt', 'cancelledAt');
export const visibleCustomer = (customer: Order['customer']) => fields(customer, 'name', 'phone', 'email', 'isGuest');
export const visibleActor = (actor: OrderActor) => actor && fields(actor, 'id', 'name', 'role');
export const visibleWindow = (slot?: ScheduledDeliveryWindow) => slot && fields(slot, 'slotId', 'windowId', 'windowName', 'date', 'dateLabel', 'startTime', 'endTime', 'displayWindow', 'displayWindowShort');
export const visibleCoordinates = (point?: {lat: number; lng: number}) => point && fields(point, 'lat', 'lng');

export function visibleDestination(address: Order['deliveryAddress']) {
  return {
    ...fields(address, 'address', 'details', 'porteriaPolicy', 'municipality', 'locality', 'neighborhood'),
    coordinates: visibleCoordinates(address.coordinates),
  };
}

export function orderWarehouse(order: Order, store?: Store) {
  const saved = resolveOrderWarehouse(order, store ? [store] : []);
  const warehouse = saved && {
    ...fields(saved, 'id', 'name', 'customerName'),
    address: store?.showAddressToCustomer === false ? undefined : saved.address,
  };
  const event = order.warehouseAssignment;
  return {
    warehouse,
    warehouseAssignment: warehouse && event?.store.id === warehouse.id
      ? { ...fields(event, 'id', 'revision', 'kind', 'timestamp'), store: warehouse }
      : undefined,
  };
}

// History can be rendered without contact details, fulfillment internals or delivery codes.
export function customerOrderHistory(order: Order, store?: Store) {
  const warehouse = orderWarehouse(order, store);
  return {
    ...fields(order, 'id', 'orderNumber', 'purchaseCode', 'createdAt', 'storeId', 'fulfillmentStatus', 'deliveryMode', 'isSplitOrder'),
    ...warehouse,
    storeName: warehouse.warehouse?.name || order.storeName,
    scheduledWindow: visibleWindow(order.scheduledWindow),
    deliveryAddress: fields(order.deliveryAddress, 'address', 'details'),
    items: order.items.map(visibleItem),
    totals: visibleTotals(order.totals),
  };
}

function visibleShipment(shipment: ChildShipment) {
  return {
    ...fields(shipment, 'dispatchCode', 'storeId', 'shipmentId', 'shipmentIndex', 'shipmentCount', 'parentOrderId', 'childOrderId',
      'weightKg', 'weightGrams', 'subtotal', 'cashToCollect', 'fulfillmentStatus', 'estimatedDeliveryMinutes'),
    items: shipment.items.map(visibleItem),
    timestamps: visibleTimestamps(shipment.timestamps),
  };
}

export function customerOrderDetail(order: Order, store?: Store) {
  return {
    ...customerOrderHistory(order, store),
    ...fields(order, 'parentOrderId', 'dispatchCode', 'shipmentId', 'shipmentCount', 'shipmentIndex', 'estimatedDeliveryMinutes'),
    timestamps: visibleTimestamps(order.timestamps),
    statusHistory: order.statusHistory?.filter(entry => entry.orderId === order.id)
      .map(entry => fields(entry, 'id', 'orderId', 'shipmentId', 'previousStatus', 'newStatus', 'timestamp')),
    originalPromiseWindow: order.originalPromiseWindow && fields(order.originalPromiseWindow, 'start', 'end'),
    childShipments: order.childShipments?.map(visibleShipment),
    customer: visibleCustomer(order.customer),
    deliveryAddress: visibleDestination(order.deliveryAddress),
    payment: fields(order.payment, 'method', 'status', 'cashToCollect', 'cashSettled'),
    deliveryReview: order.deliveryReview && fields(order.deliveryReview, 'status', 'requestedAt', 'requestedMode', 'confirmedAt'),
    prescriptionReview: order.prescriptionReview && fields(order.prescriptionReview, 'status', 'documentName', 'uploadedAt', 'reviewedAt'),
  };
}

export function staffHistory(entries?: OrderStatusHistoryEntry[]) {
  return entries?.map(entry => ({
    ...fields(entry, 'id', 'orderId', 'shipmentId', 'previousStatus', 'newStatus', 'timestamp', 'reason'),
    actor: visibleActor(entry.actor),
  }));
}

function staffItem(item: OrderItem) {
  return { ...visibleItem(item), ...fields(item, 'picked', 'verifiedLot') };
}

export function staffShipment(shipment: ChildShipment) {
  return {
    ...visibleShipment(shipment),
    ...fields(shipment, 'assignmentId', 'tripId', 'physicalReturnPending', 'physicalReturnConfirmedAt', 'physicalReturnConfirmedBy', 'cancelReason'),
    driver: shipment.driver && fields(shipment.driver, 'id', 'name', 'phone', 'vehiclePlate', 'vehicleType', 'rating', 'photo'),
    statusHistory: staffHistory(shipment.statusHistory),
    items: shipment.items.map(staffItem),
  };
}

export function staffOrderDetail(order: Order, store?: Store) {
  return {
    ...customerOrderDetail(order, store),
    ...fields(order, 'assignmentId', 'tripId', 'physicalReturnPending', 'physicalReturnConfirmedAt', 'physicalReturnConfirmedBy', 'cancelReason'),
    driver: order.driver && fields(order.driver, 'id', 'name', 'phone', 'vehiclePlate', 'vehicleType', 'rating', 'photo'),
    items: order.items.map(staffItem),
    childShipments: order.childShipments?.map(staffShipment),
    payment: fields(order.payment, 'method', 'status', 'cashToCollect', 'transactionId', 'cashSettled'),
    deliveryReview: order.deliveryReview && fields(order.deliveryReview, 'status', 'requestedAt', 'requestedMode', 'confirmedAt', 'reasonCode', 'confirmedBy', 'customerAgreementReference'),
    prescriptionReview: order.prescriptionReview && fields(order.prescriptionReview, 'status', 'documentUrl', 'documentName', 'uploadedAt', 'reviewedBy', 'reviewedAt', 'reviewNotes', 'vetName', 'vetLicense'),
    statusHistory: staffHistory(order.statusHistory),
    incidents: order.incidents?.map(i => fields(i, 'id', 'type', 'description', 'createdAt', 'resolved', 'notes')),
  };
}
