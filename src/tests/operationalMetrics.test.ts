import test from 'node:test';
import assert from 'node:assert/strict';
import { INITIAL_ORDERS } from '../data/seedData';
import type { ChildShipment, Order } from '../types';
import type { DispatchRun } from '../types/dispatch';
import { operationalMetrics } from '../lib/operationalMetrics';

const now = new Date('2026-11-22T06:30:00Z');
const confirmedAt = '2026-11-22T05:15:00Z';
function order(id: string, status: Order['fulfillmentStatus'], changes: Partial<Order> = {}): Order {
  return {
    ...structuredClone(INITIAL_ORDERS[0]), id, orderNumber:'CODE-'+id, assignmentId:'run-'+id,
    storeId:'HUB_SUBA', fulfillmentStatus:status, childShipments:undefined, isSplitOrder:false,
    timestamps:{confirmedAt}, createdAt:confirmedAt, totals:{...INITIAL_ORDERS[0].totals,total:50000},
    payment:{method:'CASH_ON_DELIVERY',status:'PENDIENTE'}, ...changes,
  };
}
function run(id: string, orderId: string, changes: Partial<DispatchRun> = {}): DispatchRun {
  return {id, orderId, code:'code-'+id, status:'DELIVERED', createdAt:now.getTime()-5000, deliveredAt:now.getTime()-50,
    cashDue:10000, cashCollected:10000, attempted:[], pinFailures:0, ...changes};
}
function shipment(shipmentId: string, status: Order['fulfillmentStatus']): ChildShipment {
  return {shipmentId, assignmentId:'run-'+shipmentId, fulfillmentStatus:status} as ChildShipment;
}

test('compra confirmada separada de recaudo, entrega parcial y pendientes con importes desconocidos', () => {
  const split = order('private-primary', 'EN_CAMINO', {childShipments:[shipment('first','ENTREGADO'),shipment('second','EN_CAMINO')],isSplitOrder:true});
  const pending = order('private-request','PENDIENTE_CONFIRMACION');
  const past = order('private-historical','ENTREGADO', {timestamps:{confirmedAt:'2026-11-22T04:59:00Z'},createdAt:'2026-11-22T04:59:00Z'});
  const failed = order('private-failed','CANCELADO',{payment:{method:'WOMPI_PSE',status:'RECHAZADO'}});
  const child = order('private-child','ENTREGADO',{parentOrderId:split.id});
  const collected = run('run-first', split.id, {shipmentId:'first'});
  const inTransit = run('run-second', split.id, {shipmentId:'second',status:'PICKED_UP',deliveredAt:undefined,cashCollected:0});
  const result = operationalMetrics({orders:[split,split,pending,past,failed,child],runs:[collected,inTransit,collected],demo:false,now});
  assert.deepEqual(result.orders,{total:4,awaitingConfirmation:1,delivered:1,partiallyDelivered:1,cancelled:1});
  assert.deepEqual(result.confirmedSalesToday,{date:'2026-11-22',timezone:'America/Bogota',orders:1,knownConfirmedCOP:50000,unknownAmounts:0});
  assert.deepEqual(result.cash,{verifiedCollectedCOP:10000,verifiedShipments:1,unverifiedDeliveredShipments:1,pendingShipments:1,awaitingConfirmationOrders:1});
  assert.equal(result.dispatches.delivered,1);
  assert.equal(result.dispatches.pickedUp,1);
  assert.equal(result.payments.RECHAZADO,1);
  assert.equal(result.payments.PENDIENTE,3);
  assert.doesNotMatch(JSON.stringify(result),/private-|run-first|@|HUB_SUBA|CODE-/);
});

test('cero verificado, cobros sin prueba y cotizaciones pendientes tienen semánticas distintas', () => {
  const closed = order('internal-closed','ENTREGADO',{payment:{method:'CASH_ON_DELIVERY',status:'APROBADO',cashSettled:true,cashToCollect:0}});
  const disputed = run(closed.assignmentId!,closed.id);
  for (const record of [
    {...disputed,deliveredAt:undefined}, {...disputed,deliveredAt:now.getTime()+1},
    {...disputed,cashCollected:4}, {...disputed,cashCollected:50001,cashDue:50001},
    {...disputed,shipmentId:'other'}, {...disputed,orderId:'other'}, {...disputed,status:'INCIDENT' as const},
  ]) {
    const m = operationalMetrics({orders:[closed],runs:[record],demo:false,now});
    assert.equal(m.cash.verifiedCollectedCOP,null);
    assert.equal(m.cash.unverifiedDeliveredShipments,1);
  }
  const zero = operationalMetrics({orders:[closed],runs:[{...disputed,cashCollected:0,cashDue:0}],demo:false,now});
  assert.equal(zero.cash.verifiedCollectedCOP,0);
  assert.equal(zero.cash.verifiedShipments,1);
  const missingPrice = order('missing','CONFIRMADO',{totals:{...closed.totals,total:NaN}});
  const m = operationalMetrics({orders:[missingPrice],runs:[],demo:false,now});
  assert.equal(m.confirmedSalesToday.knownConfirmedCOP,null);
  assert.equal(m.confirmedSalesToday.unknownAmounts,1);
  assert.equal(m.cash.pendingShipments,1);
});

test('simulación y productos semilla no se contabilizan como ventas ni pagos reales; incidencias y reembolsos conservan su estado', () => {
  const ordinary = order('live','CON_INCIDENCIA',{payment:{method:'WOMPI_CARD',status:'REEMBOLSADO'}});
  const synthetic = order('fixture','ENTREGADO',{creationRequestFingerprint:'SIMULATION'});
  const demoDelivery = order('review','ENTREGADO',{deliveryReview:{status:'SIMULATED',requestedAt:confirmedAt,reasonCode:'fixture'}});
  const provider = order('provider','ENTREGADO');
  const seed = order(INITIAL_ORDERS[0].id,'ENTREGADO');
  const runs = [run(synthetic.assignmentId!,synthetic.id),run(demoDelivery.assignmentId!,demoDelivery.id),run(provider.assignmentId!,provider.id,{external:{simulation:true} as DispatchRun['external']}),
    run(ordinary.assignmentId!,ordinary.id,{status:'SEARCH_EXHAUSTED',cashCollected:0,deliveredAt:undefined})];
  const orders = [ordinary, synthetic, demoDelivery, provider, seed];
  const result = operationalMetrics({orders,runs,now,demo:false});
  assert.deepEqual(result.tests,{orders:4,deliveredOrders:4,dispatches:3});
  assert.equal(result.orders.total,1);
  assert.equal(result.confirmedSalesToday.knownConfirmedCOP,0);
  assert.equal(result.cash.verifiedCollectedCOP,null);
  assert.equal(result.payments.REEMBOLSADO,1);
  assert.equal(result.dispatches.exhausted,1);
  const segregated = operationalMetrics({orders,runs,now,demo:true});
  assert.equal(segregated.orders.total,0);
  assert.equal(segregated.tests.orders,5);
  assert.equal(segregated.tests.dispatches,4);
});
