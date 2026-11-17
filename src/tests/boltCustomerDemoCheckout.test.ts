import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { INITIAL_STORES } from '../data/seedData';
import { DEFAULT_TRANSPORT_CONFIG } from '../types/transport';
import {
  activateBoltAdminDemoProduct,
  BOLT_ADMIN_DEMO_STORE_ID,
  boltAdminDemoProduct,
  boltAdminDemoReviewContext,
  boltCustomerDemoCheckout,
  boltCustomerDemoVehicle,
  createBoltAdminDemoOrder,
  isBoltAdminDemoOrder,
  isBoltCustomerDemoDriver,
  isBoltCustomerDemoOrder,
} from '../lib/boltAdminDemo';
import { createCustomerDemoDispatch } from '../lib/boltCustomerDemoDispatch';
import { CatalogOperations } from '../lib/catalogOperations';
import { evaluateDeliveryQuote } from '../lib/deliveryService';
import { DispatchService } from '../lib/dispatchService';
import { OrdersRepository } from '../lib/ordersRepository';
import { enrichDestination } from '../lib/serverGeography';
import { LocalSimulationProvider } from '../lib/dispatchSimulation';

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bolt-customer-demo-checkout-'));
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
  const provider = new LocalSimulationProvider(() => { throw Error('Provider must never be called'); });
  let providerCalls = 0;
  provider.quote = async () => {
    providerCalls++;
    return null;
  };
  const dispatch = new DispatchService({
    repo: orders,
    stores: () => INITIAL_STORES,
    products: () => catalog.getSalesProducts(),
    transport: () => structuredClone(DEFAULT_TRANSPORT_CONFIG),
    simulation: true,
    providers: [provider],
    holdDispatch: order => isBoltAdminDemoOrder(order) && !scenarioDispatch.isStarting(order.id),
    simulationVehicle: boltCustomerDemoVehicle,
    isSimulationDriver: isBoltCustomerDemoDriver,
  });
  const scenarioDispatch = createCustomerDemoDispatch(orders, dispatch, () => INITIAL_STORES);
  const store = INITIAL_STORES.find(item => item.id === BOLT_ADMIN_DEMO_STORE_ID);
  assert.ok(store);
  const listing = boltCustomerDemoCheckout(catalog.getSalesProducts(), store);
  assert.equal(listing.items[0].quantity, 1);
  assert.equal(listing.storeId, 'HUB_SUBA');
  assert.equal(listing.cashToCollect, 0);
  assert.equal(orders.getAllOrders().length, 0);

  const requestId = crypto.randomUUID();
  const submit = (key: string = requestId) => createBoltAdminDemoOrder({ requestId: key, origin: 'customer', catalog: catalog.getSalesProducts(), store, dispatch });
  assert.throws(() => submit('predictable'), /identificador válido/);
  const order = submit();
  assert.ok(isBoltCustomerDemoOrder(order));
  assert.equal(submit().id, order.id);
  assert.equal(orders.getAllOrders().length, 1);
  assert.equal(order.fulfillmentStatus, 'PENDIENTE_CONFIRMACION');
  assert.deepEqual(orders.dispatchState.runs, {});
  const guestToken = dispatch.guestToken(order);
  assert.ok(dispatch.authorizeGuest(order.id, guestToken));
  assert.equal(dispatch.authorizeGuest(order.id, order.purchaseCode), false);
  const product = () => catalog.getSalesProducts()[0];
  assert.equal(product().stockByStore[store.id], 100);
  assert.equal(product().reservedStockByStore.HUB_SUBA, 1);
  assert.ok(Object.entries(product().reservedStockByStore).every(([id, count]) => id === 'HUB_SUBA' || count === 0));

  const actor = { role: 'BODEGA' as const, id: 'demo-suba' };
  await assert.rejects(scenarioDispatch.start(order, actor), /Confirma primero/);
  const quote = evaluateDeliveryQuote({
    destination: enrichDestination(order.deliveryAddress),
    items: order.items,
    requestedMode: 'TURBO',
  }, INITIAL_STORES, [activateBoltAdminDemoProduct(order, product())], [], boltAdminDemoReviewContext(order, {
    config: structuredClone(DEFAULT_TRANSPORT_CONFIG), drivers: [], orders: [],
  }));
  assert.equal(quote.assignedStoreId, 'HUB_SUBA', quote.message);
  assert.equal(quote.recommendedMode, 'TURBO', quote.message);
  assert.ok(quote.charges && quote.transportPlan?.feasible && quote.transportPlan.shipments.length === 1);
  const eta = quote.estimatedMinutes ?? 25;
  const confirmedAt = new Date().toISOString();
  dispatch.confirmPendingOrder(order.id, {
    ...order,
    fulfillmentStatus: 'CONFIRMADO',
    deliveryMode: 'TURBO',
    payment: { ...order.payment, cashToCollect: 0 },
    transportLoad: quote.transportPlan.shipments[0],
    transportConfirmation: 'demo-quote',
    estimatedDeliveryMinutes: eta,
    originalPromiseWindow: {
      start: confirmedAt,
      end: new Date(Date.now() + eta * 60_000).toISOString(),
    },
    timestamps: { confirmedAt },
  }, actor.id, 'Simulación: cliente acepta entrega de prueba sin cobro.', actor);
  await dispatch.tick();
  const run = orders.dispatchState.runs[order.assignmentId!];
  assert.equal(run.status, 'PENDING');
  assert.equal(run.cashDue, 0);

  const [started, retried] = await Promise.all([scenarioDispatch.start(order, actor), scenarioDispatch.start(order, actor)]);
  assert.equal(started.id, order.id);
  assert.equal(started.fulfillmentStatus, 'EN_CAMINO');
  assert.equal(retried.assignmentId, run.id);
  assert.equal((await scenarioDispatch.start(order, actor)).assignmentId, run.id);
  assert.equal(orders.getAllOrders().length, 1);
  assert.equal(Object.keys(orders.dispatchState.runs).length, 1);
  assert.equal(Object.keys(orders.dispatchState.offers).length, 1);
  assert.equal(run.status, 'PICKED_UP');
  assert.equal(run.providerId, 'OWN');
  assert.equal(providerCalls, 0);
  assert.equal(run.cashCollected, 0);
  assert.ok(run.driverId && isBoltCustomerDemoDriver(run.driverId));
  assert.equal(orders.getLatestTelemetry(order.id)?.driverId, run.driverId);
  assert.equal(product().reservedStockByStore.HUB_SUBA, 1);
  assert.ok(Object.entries(product().reservedStockByStore).every(([id, count]) => id === 'HUB_SUBA' || count === 0));
  assert.equal(product().stockByStore[store.id], 100);
  assert.ok(dispatch.authorizeGuest(order.id, guestToken));

  const restarted = new OrdersRepository({ dataDir: directory });
  assert.equal(restarted.getOrderById(order.id)?.fulfillmentStatus, 'EN_CAMINO');
  assert.equal(restarted.dispatchState.runs[run.id].cashDue, 0);
  assert.equal(restarted.getLatestTelemetry(order.id)?.assignmentId, run.id);
  console.log('PASS: prueba BOLT Cliente de $0, reserva en Suba, confirmación, despacho propio y GPS; reintentos y reinicio sin duplicaciones.');
} finally {
  fs.rmSync(directory, { recursive: true, force: true });
}
