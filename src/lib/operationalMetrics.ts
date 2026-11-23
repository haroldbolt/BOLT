import { INITIAL_ORDERS } from '../data/seedData';
import type { ChildShipment, Order } from '../types';
import type { DispatchRun } from '../types/dispatch';
import { isBoltAdminDemoOrder } from './boltAdminDemo';
import { buildBoltAdminSalesReport } from './boltAdminSales';

const seedOrders = new Set(INITIAL_ORDERS.map(order => order.id));
const isMoney = (amount: unknown): amount is number => Number.isSafeInteger(amount) && Number(amount) >= 0;

function provenCollection(run: DispatchRun | undefined, order: Order, shipment: Order | ChildShipment, now: number) {
  if (!run || run.orderId !== order.id || run.shipmentId !== ('shipmentId' in shipment ? shipment.shipmentId : undefined) ||
      run.status !== 'DELIVERED' || shipment.fulfillmentStatus !== 'ENTREGADO' ||
      !Number.isFinite(run.deliveredAt) || !Number.isFinite(run.createdAt) ||
      run.deliveredAt! < run.createdAt || run.deliveredAt! > now ||
      !isMoney(run.cashCollected) || run.cashCollected !== run.cashDue) return null;
  return run.cashCollected;
}

/** Read-only snapshots of canonical records. Amounts are COP; daily sales follow BOLT Admin's Bogotá calendar. */
export function operationalMetrics({orders, runs, demo, now = new Date()}: {
  orders: readonly Order[]; runs: readonly DispatchRun[]; demo: boolean; now?: Date;
}) {
  const purchases = new Map<string, Order>();
  for (const order of orders) if (!order.parentOrderId && !purchases.has(order.id)) purchases.set(order.id, order);

  const byRun = new Map(runs.map(run => [run.id, run]));
  const testIds = new Set<string>();
  const simulatedProviderOrders = new Set(runs.filter(run => run.external?.simulation).map(run => run.orderId));
  for (const order of purchases.values()) {
    if (demo || seedOrders.has(order.id) || order.creationRequestFingerprint === 'SIMULATION' ||
        order.deliveryReview?.status === 'SIMULATED' || simulatedProviderOrders.has(order.id) || isBoltAdminDemoOrder(order)) testIds.add(order.id);
  }

  const live = [...purchases.values()].filter(order => !testIds.has(order.id));
  const stores = [...new Set(live.map(order => order.storeId))].map(id => ({id, name:id}));
  const today = (values: Order[]) => buildBoltAdminSalesReport({
    period:'today', stores, orders:values, catalog:[], runs:[], demo:false, now,
  });
  const sales = today(live);
  const missingTotals = live.filter(order => !isMoney(order.totals.total));
  const unknownAmounts = missingTotals.length ? today(missingTotals).summary.orderCount : 0;

  const ordersCount = {total:live.length, awaitingConfirmation:0, delivered:0, partiallyDelivered:0, cancelled:0};
  const paymentStates = {PENDIENTE:0, APROBADO:0, RECHAZADO:0, REEMBOLSADO:0, unknown:0};
  const dispatches = {total:0, pending:0, assigned:0, pickedUp:0, delivered:0, cancelled:0, incidents:0, exhausted:0, providerResultUnknown:0};
  const tests = {orders:testIds.size, deliveredOrders:0, dispatches:0};
  for (const id of testIds) if (purchases.get(id)?.fulfillmentStatus === 'ENTREGADO') tests.deliveredOrders++;
  for (const run of byRun.values()) {
    if (!purchases.has(run.orderId)) continue;
    if (testIds.has(run.orderId)) { tests.dispatches++; continue; }
    dispatches.total++;
    if (run.external?.status === 'UNKNOWN') dispatches.providerResultUnknown++;
    switch (run.status) {
      case 'PENDING': case 'SEARCHING': case 'OFFER_PENDING': dispatches.pending++; break;
      case 'ASSIGNED': dispatches.assigned++; break;
      case 'PICKED_UP': dispatches.pickedUp++; break;
      case 'DELIVERED': dispatches.delivered++; break;
      case 'CANCELLED': dispatches.cancelled++; break;
      case 'INCIDENT': dispatches.incidents++; break;
      case 'SEARCH_EXHAUSTED': dispatches.exhausted++; break;
    }
  }

  const cash = {verifiedCollectedCOP:null as number | null, verifiedShipments:0, unverifiedDeliveredShipments:0, pendingShipments:0, awaitingConfirmationOrders:0};
  for (const order of live) {
    const pending = order.fulfillmentStatus === 'PENDIENTE_CONFIRMACION' || order.deliveryReview?.status === 'PENDING';
    const shipments = order.childShipments?.length ? order.childShipments : [order];
    const delivered = shipments.filter(s => s.fulfillmentStatus === 'ENTREGADO').length;
    if (pending) ordersCount.awaitingConfirmation++;
    if (order.fulfillmentStatus === 'CANCELADO') ordersCount.cancelled++;
    if (order.fulfillmentStatus === 'ENTREGADO') ordersCount.delivered++;
    if (delivered > 0 && delivered < shipments.length) ordersCount.partiallyDelivered++;
    if (Object.hasOwn(paymentStates, order.payment.status)) paymentStates[order.payment.status]++;
    else paymentStates.unknown++;
    if (order.payment.method !== 'CASH_ON_DELIVERY') continue;
    if (pending) { cash.awaitingConfirmationOrders++; continue; }

    const evidence = [];
    const seenRuns = new Set<string>();
    for (const shipment of shipments) {
      if (shipment.fulfillmentStatus === 'CANCELADO') continue;
      if (shipment.fulfillmentStatus !== 'ENTREGADO') { cash.pendingShipments++; continue; }
      const id = shipment.assignmentId;
      const amount = id && !seenRuns.has(id) ? provenCollection(byRun.get(id), order, shipment, now.getTime()) : null;
      if (amount == null) { cash.unverifiedDeliveredShipments++; continue; }
      seenRuns.add(id!);
      evidence.push(amount);
    }
    if (!evidence.length) continue;
    const collected = evidence.reduce((sum, amount) => sum + amount, 0);
    if (!isMoney(collected) || !isMoney(order.totals.total) || collected > order.totals.total) {
      cash.unverifiedDeliveredShipments += evidence.length;
      continue;
    }
    cash.verifiedShipments += evidence.length;
    cash.verifiedCollectedCOP = (cash.verifiedCollectedCOP ?? 0) + collected;
  }

  return {
    asOf:now.toISOString(), confirmedSalesToday:{
      date:sales.from, timezone:'America/Bogota', orders:sales.summary.orderCount,
      knownConfirmedCOP:unknownAmounts && unknownAmounts === sales.summary.orderCount ? null : sales.summary.confirmedCOP, unknownAmounts,
    },
    orders:ordersCount, payments:paymentStates, cash, dispatches, tests,
  };
}
