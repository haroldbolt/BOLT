import crypto from 'node:crypto';
import type {Order, OrderItem, DeliveryMode, Store} from '../types';
/** Existing order storage/state machine; no dispatch, payment, ETA or physical measurements invented. */
export function pendingDeliveryOrder(input:{items:OrderItem[];customer:Order['customer'];address:Order['deliveryAddress'];store:Store;requestedMode?:DeliveryMode;creationRequestId:string;creationRequestFingerprint:string;customerAccountId?:string}):Order {
  const at=new Date().toISOString(),id=`ORD-${crypto.randomUUID()}`;
  const subtotal=input.items.reduce((sum,item)=>sum+item.price*item.quantity,0);
  return {
    id,orderNumber:id,createdAt:at,creationRequestId:input.creationRequestId,creationRequestFingerprint:input.creationRequestFingerprint,
    ...(input.customerAccountId?{customerAccountId:input.customerAccountId}:{}),
    storeId:input.store.id,storeName:input.store.name,customer:input.customer,deliveryAddress:input.address,items:input.items,
    deliveryReview:{status:'PENDING',reasonCode:'TRANSPORT_DATA_PENDING',requestedAt:at,requestedMode:input.requestedMode},
    // Zero charges are not a free-shipping quote. The review UI displays them as unconfirmed.
    totals:{subtotal,discount:0,shipping:0,serviceFee:0,tip:0,total:subtotal,totalWeightKg:null},
    payment:{method:'CASH_ON_DELIVERY',status:'PENDIENTE',cashToCollect:0,cashSettled:false},
    prescriptionReview:{status:input.items.some(i=>i.requiresPrescription)?'PENDIENTE_REVISION':'NO_REQUIERE'},
    fulfillmentStatus:'PENDIENTE_CONFIRMACION',secretDeliveryCode:crypto.randomInt(1000,10000).toString(),
    estimatedDeliveryMinutes:0,originalPromiseWindow:{start:'',end:''},timestamps:{},
  };
}
