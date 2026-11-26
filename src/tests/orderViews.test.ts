import assert from 'node:assert/strict';
import { test } from 'node:test';
import { INITIAL_ORDERS, INITIAL_STORES } from '../data/seedData';
import { customerOrderDetail, customerOrderHistory, staffOrderDetail } from '../lib/orderViews';
import { boltAdminOrder } from '../lib/boltAdminRoutes';
import { buildCustomerTracking } from '../lib/customerTracking';
import { makeWarehouseAssignment } from '../lib/warehouseAssignment';
import type { ChildShipment, Order } from '../types';

function fixture() {
  const order: Order = structuredClone(INITIAL_ORDERS[0]);
  const store = { ...INITIAL_STORES[0], showAddressToCustomer: false };
  order.storeId = store.id;
  order.warehouseAssignment = makeWarehouseAssignment(order.id, { ...store, showAddressToCustomer:true });
  order.customerAccountId = 'private-owner';
  order.creationRequestFingerprint = 'private-checkout-match';
  order.creationRequestId = 'private-attempt';
  order.transportConfirmation = 'private-confirmation';
  order.prescriptionReview = {status:'APROBADA', reviewNotes:'private-medical-note'};
  order.deliveryReview = {status:'CONFIRMED',requestedAt:order.createdAt,reasonCode:'example',confirmationToken:'private-quote-token'};
  order.statusHistory = [{id:'status-1',orderId:order.id,newStatus:'EN_ALISTAMIENTO',previousStatus:'CONFIRMADO',
    timestamp:order.createdAt, actor:{role:'BODEGA',id:'private-staff-id'}, reason:'private-staff-reason', metadata:{ internal:'private-meta' }}];
  const child: ChildShipment = {
    shipmentId:'shipment-1', shipmentIndex:1, shipmentCount:1, parentOrderId:order.id, dispatchCode:'demo-E01',
    fulfillmentStatus:'EN_CAMINO', items:order.items, timestamps:order.timestamps, subtotal:order.totals.subtotal,
    cashToCollect:0, weightKg:1, weightGrams:1000, estimatedDeliveryMinutes:0, secretDeliveryCode:'fixture-child-pin',
  };
  order.isSplitOrder = true;
  order.childShipments = [child];
  order.secretDeliveryCode = 'fixture-parent-pin';
  // Future and historical private fields are deliberately present at several nesting levels.
  for (const record of [order, order.customer, order.deliveryAddress, order.deliveryAddress.coordinates,
    order.items[0], order.totals, order.payment, order.timestamps, child, order.statusHistory[0], order.statusHistory[0].actor,
    order.warehouseAssignment, order.warehouseAssignment.store]) {
    Object.assign(record, { extraInternalField:'private-unlisted-value' });
  }
  return { order, store, child };
}

test('el recibo y el historial conservan productos e importes y proyectan sólo los campos de cliente', () => {
  const { order, store, child } = fixture();
  const history = customerOrderHistory(order,store), detail = customerOrderDetail(order,store);
  assert.equal(history.totals.total, order.totals.total);
  assert.equal(history.items[0].sku, order.items[0].sku);
  assert.equal(history.deliveryAddress.address, order.deliveryAddress.address);
  assert.equal('customer' in history,false);
  assert.equal(detail.customer.phone,order.customer.phone);
  assert.equal(detail.childShipments?.[0].shipmentId,child.shipmentId);
  assert.equal(detail.childShipments?.[0].items[0].quantity,child.items[0].quantity);
  assert.equal(detail.statusHistory?.[0].id,'status-1'); // Needed for fulfillment notifications.
  assert.equal(detail.warehouse?.address,undefined);
  assert.equal(detail.warehouseAssignment?.store.address,undefined);
  for(const view of [history,detail]){
    const body=JSON.stringify(view);
    for(const field of ['customerAccountId','creationRequestId','creationRequestFingerprint','secretDeliveryCode',
      'confirmationToken','transportConfirmation','territoryInfo','reviewNotes','extraInternalField','private-staff-id','private-meta']){
      assert.ok(!body.includes(field),field);
    }
  }
});

test('el PIN de una compra dividida se publica sólo para el despacho en camino en el seguimiento de su titular', () => {
  const {order,store,child}=fixture();
  const track = (shipment?: ChildShipment) => buildCustomerTracking({order, store, child:shipment, maxAgeSeconds:60, simulation:false});
  const staff=staffOrderDetail(order,store);
  assert.equal(staff.prescriptionReview.reviewNotes,'private-medical-note');
  assert.equal(staff.statusHistory?.[0].actor.id,'private-staff-id');
  for(const view of [staff,boltAdminOrder(order),boltAdminOrder(order,true),track()]){
    const body=JSON.stringify(view);
    for(const field of ['secretDeliveryCode','extraInternalField','creationRequestFingerprint','private-meta','private-quote-token'])assert.ok(!body.includes(field),field);
  }
  assert.equal(track(child).secretDeliveryCode,child.secretDeliveryCode);
  for (const status of ['CONFIRMADO','REPARTIDOR_ASIGNADO','ENTREGADO','CANCELADO'] as const) {
    assert.equal(track({...child,fulfillmentStatus:status}).secretDeliveryCode,undefined);
  }
});
