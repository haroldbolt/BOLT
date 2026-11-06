import type { Order, Store, WarehouseAssignmentEvent } from '../types';

export function describeWarehouse(store?: Store | null) {
  if(!store) return undefined;
  return {id:store.id,name:store.name,customerName:store.customerName || store.name,address:store.showAddressToCustomer === false ? undefined : store.address};
}

// Uses saved server snapshot first; ID resolution is only for historical orders.
export function resolveOrderWarehouse(order: Pick<Order,'storeId'|'warehouseAssignment'|'warehouse'>, stores: Store[] = []) {
  const event=order.warehouseAssignment;
  if(event?.store.id && event.store.id===order.storeId) return event.store;
  if(order.warehouse?.id===order.storeId) return order.warehouse;
  return describeWarehouse(stores.find(s=>s.id===order.storeId));
}

export function assignmentMessage(event: WarehouseAssignmentEvent): string {
  return event.kind==='CHANGED'
    ? `La sede asignada a tu pedido cambió a ${event.store.customerName}.`
    : `Tu pedido será preparado y despachado desde nuestra sede de ${event.store.customerName}.`;
}

export function makeWarehouseAssignment(orderId:string, store:Store, previous?:WarehouseAssignmentEvent, timestamp=new Date().toISOString()): WarehouseAssignmentEvent {
  if(previous?.store.id===store.id) return previous;
  const revision=(previous?.revision || 0)+1;
  return {id:`warehouse:${orderId}:${revision}`,revision,kind:previous?'CHANGED':'ASSIGNED',timestamp,store:describeWarehouse(store)!};
}
