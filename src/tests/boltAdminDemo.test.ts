import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { INITIAL_STORES } from '../data/seedData';
import { DEFAULT_TRANSPORT_CONFIG } from '../types/transport';
import {
  activateBoltAdminDemoProduct,
  boltAdminDemoProduct,
  boltAdminDemoReviewContext,
  createBoltAdminDemoOrder,
  isBoltAdminDemoOrder,
  BOLT_ADMIN_DEMO_STORE_ID,
} from '../lib/boltAdminDemo';
import { CatalogOperations } from '../lib/catalogOperations';
import { evaluateDeliveryQuote } from '../lib/deliveryService';
import { DispatchService } from '../lib/dispatchService';
import { OrdersRepository } from '../lib/ordersRepository';
import { enrichDestination } from '../lib/serverGeography';

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bolt-admin-order-fixture-'));
try {
  fs.writeFileSync(path.join(directory, 'persisted-orders.json'), '[]');
  fs.writeFileSync(path.join(directory, 'persisted-drivers.json'), '[]');
  const orders = new OrdersRepository({ dataDir: directory });
  const catalog = new CatalogOperations({
    file: path.join(directory, 'catalog.json'),
    products: () => [boltAdminDemoProduct()],
    stores: () => INITIAL_STORES,
    orders: () => orders.getAllOrders(),
  });
  catalog.initializeOrderTracking();
  let time = Date.now();
  const dispatch = new DispatchService({
    repo: orders,
    stores: () => INITIAL_STORES,
    products: () => catalog.getSalesProducts(),
    transport: () => structuredClone(DEFAULT_TRANSPORT_CONFIG),
    now: () => time,
    simulation: true,
    holdDispatch: isBoltAdminDemoOrder,
  });
  const store = INITIAL_STORES.find(item => item.id === BOLT_ADMIN_DEMO_STORE_ID);
  assert.ok(store);
  const requestId = 'fixture-idempotency-key';
  const submit = () => createBoltAdminDemoOrder({ requestId, catalog: catalog.getSalesProducts(), store, dispatch });
  const order = submit();
  assert.equal(submit().id, order.id);
  assert.equal(orders.getAllOrders().length, 1);
  assert.equal(order.fulfillmentStatus, 'PENDIENTE_CONFIRMACION');
  assert.equal(order.deliveryReview?.requestedMode, 'PROGRAMADO');
  assert.equal(order.payment.cashToCollect, 0);
  assert.ok(dispatch.authorizeGuest(order.id, dispatch.guestToken(order)));
  assert.deepEqual(orders.dispatchState.runs, {});
  const [stock] = catalog.getSalesProducts();
  assert.equal(stock.status, 'INACTIVE');
  assert.equal(stock.stockByStore[store.id], 100);
  assert.equal(stock.reservedStockByStore[store.id], 2);

  const active = activateBoltAdminDemoProduct(order, stock);
  const reviewCatalog = [{ ...active, reservedStockByStore: { [store.id]: 0 } }];
  const context = { config: structuredClone(DEFAULT_TRANSPORT_CONFIG), drivers: [], orders: [] };
  const unmarked = { ...order, creationRequestFingerprint: 'another-order' };
  assert.equal(activateBoltAdminDemoProduct(unmarked, stock), stock);
  assert.equal(boltAdminDemoReviewContext(unmarked, context), context);
  const quote = evaluateDeliveryQuote({
    destination: enrichDestination(order.deliveryAddress),
    items: order.items,
    requestedMode: 'PROGRAMADO',
  }, INITIAL_STORES, reviewCatalog, [], boltAdminDemoReviewContext(order, context));
  assert.equal(quote.assignedStoreId, store.id, quote.message);
  assert.equal(quote.recommendedMode, 'PROGRAMADO');
  assert.ok(quote.transportPlan?.feasible);
  assert.ok(quote.transportWindow);
  assert.equal(context.config.vehicles.length, 0);
  const confirmed = dispatch.confirmPendingOrder(order.id, {
    ...order,
    fulfillmentStatus: 'CONFIRMADO',
    deliveryMode: 'PROGRAMADO',
    scheduledWindow: quote.transportWindow,
    transportLoad: quote.transportPlan.shipments[0],
    transportConfirmation: 'demo-quote',
  }, 'demo-suba', 'Simulación: cliente acepta la franja y los costos.');
  assert.equal(confirmed.order?.id, order.id);
  assert.equal(confirmed.order?.fulfillmentStatus, 'CONFIRMADO');
  assert.equal(catalog.getSalesProducts()[0].reservedStockByStore[store.id], 2);
  assert.ok(dispatch.authorizeGuest(order.id, dispatch.guestToken(order)));
  const actor = { role: 'ADMINISTRADOR' as const, id: 'demo-suba' };
  for (const status of ['EN_ALISTAMIENTO', 'LISTO_PARA_DESPACHO'] as const) {
    assert.ok(orders.transitionStatus(order.id, status, actor).success);
  }
  time = Date.parse(quote.transportWindow.date + 'T' + quote.transportWindow.startTime + ':00-05:00') + 1000;
  await dispatch.search(order.assignmentId!);
  assert.equal(orders.dispatchState.runs[order.assignmentId!].status, 'PENDING');
  assert.deepEqual(orders.dispatchState.offers, {});

  const submitTurbo = (key: string) => createBoltAdminDemoOrder({
    requestId: key, requestedMode: 'TURBO', catalog: catalog.getSalesProducts(), store, dispatch,
  });
  assert.throws(() => submitTurbo(requestId), /solicitud ya fue utilizada con otros datos/);
  const turboKey = 'fixture-turbo-idempotency-key';
  const turbo = submitTurbo(turboKey);
  assert.equal(submitTurbo(turboKey).id, turbo.id);
  assert.equal(orders.getAllOrders().length, 2);
  assert.equal(turbo.deliveryReview?.requestedMode, 'TURBO');
  assert.equal(turbo.fulfillmentStatus, 'PENDIENTE_CONFIRMACION');
  assert.equal(turbo.scheduledWindow, undefined);
  assert.equal(turbo.payment.cashToCollect, 0);
  assert.deepEqual(Object.keys(orders.dispatchState.runs), [order.assignmentId]);
  console.log('PASS: pedidos de prueba Turbo y Programado en Suba, idempotencia, seguimiento privado, reservas y despacho simulado retenido.');
} finally {
  fs.rmSync(directory, { recursive: true, force: true });
}
