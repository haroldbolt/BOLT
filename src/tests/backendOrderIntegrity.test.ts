import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';
import type { Order, OrderItem } from '../types';
import { INITIAL_ORDERS } from '../data/seedData';
import { fixtureProduct } from './transportFixtures';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bolt-inventory-readiness-'));
process.env.BOLT_DATA_DIR = path.join(root, 'singleton');
const { OrdersRepository } = await import('../lib/ordersRepository');
after(() => fs.rmSync(root, { recursive: true, force: true }));

function fixture() {
  const dataDir = fs.mkdtempSync(path.join(root, 'fixture-'));
  const repo = new OrdersRepository({ dataDir });
  const product = fixtureProduct('BACKEND-INVENTORY', 2000);
  const storeId = 'HUB_SUBA';
  product.stockByStore = { [storeId]: 4 };
  product.reservedStockByStore = { [storeId]: 1 };
  const item: OrderItem = {
    ...structuredClone(INITIAL_ORDERS[0].items[0]),
    productId: product.id, name: product.name, price: product.price,
    quantity: 1, sku: product.sku, requiresPrescription: false,
  };
  const order: Order = {
    ...structuredClone(INITIAL_ORDERS[0]),
    id: 'INVENTORY-TEST',
    orderNumber: 'INVENTORY-TEST',
    storeId,
    items: [item],
    fulfillmentStatus: 'CONFIRMADO',
    isSplitOrder: false,
    childShipments: undefined,
  };
  return { repo, order, product, item, storeId, dataDir };
}

test('duplicate order lines share the same available stock', () => {
  const { repo, order, product, item, storeId } = fixture();
  order.items = [{ ...item, quantity: 2 }, { ...item, quantity: 2 }];
  const before = repo.getAllOrders().length;
  const result = repo.createOrder(order, [product]);
  assert.equal(result.success, false, 'four units cannot be reserved against three available');
  assert.equal(product.reservedStockByStore[storeId], 1);
  assert.equal(repo.getAllOrders().length, before);
  assert.equal(repo.getOrderById(order.id), undefined);
});

test('negative, fractional and unsafe quantities are rejected before reserving', () => {
  const { repo, order, product, item, storeId } = fixture();
  for (const quantity of [-1, 0, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    order.items = [{ ...item, quantity }];
    assert.equal(repo.createOrder(order, [product]).success, false);
    assert.equal(repo.getOrderById(order.id), undefined);
    assert.equal(product.reservedStockByStore[storeId], 1);
  }
});

test('a failed dispatch transaction rolls back order and external reservation together', () => {
  const { repo, order, product, storeId } = fixture();
  assert.throws(() => repo.transaction(() => {
    const result = repo.createOrder(order, [product]);
    assert.equal(result.success, true);
    throw Error('simulated dispatch registration failure');
  }), /simulated dispatch registration failure/);
  assert.equal(repo.getOrderById(order.id), undefined);
  assert.equal(product.reservedStockByStore[storeId], 1);
});

test('valid duplicate quantities consume the total exactly once on an idempotent retry', () => {
  const { repo, order, product, item, storeId } = fixture();
  order.items = [{ ...item, quantity: 1 }, { ...item, quantity: 2 }];
  order.creationRequestId = 'IDEMPOTENT-RESERVATION';
  order.creationRequestFingerprint = 'SAME-PURCHASE';
  assert.equal(repo.transaction(() => repo.createOrder(order, [product])).success, true);
  assert.equal(repo.transaction(() => repo.createOrder(order, [product])).success, true);
  assert.equal(product.reservedStockByStore[storeId], 4);
});


test('pending and rejected prescriptions block preparation or readiness until a review is stored', () => {
  const { repo, order, product, dataDir } = fixture();
  order.items[0].requiresPrescription = true;
  order.prescriptionReview = { status: 'PENDIENTE_REVISION' };
  assert(repo.createOrder(order, [product]).success);
  const admin = { role: 'ADMINISTRADOR' as const, id: 'RX-REVIEWER' };
  const blocked = repo.transitionStatus(order.id, 'EN_ALISTAMIENTO', admin);
  assert.equal(blocked.code, 409);
  assert.equal(repo.getOrderById(order.id)?.fulfillmentStatus, 'CONFIRMADO');

  const documentUrl = 'https://example.invalid/formula.pdf';
  assert(repo.updatePrescriptionReview(order.id, { status: 'PENDIENTE_REVISION', documentUrl }).success);
  assert(repo.updatePrescriptionReview(order.id, { status: 'APROBADA', reviewedBy: admin.id }).success);
  const restarted = new OrdersRepository({ dataDir });
  assert.deepEqual(restarted.getOrderById(order.id)?.prescriptionReview, {
    status: 'APROBADA', documentUrl, reviewedBy: admin.id,
  });
  assert(restarted.transitionStatus(order.id, 'EN_ALISTAMIENTO', admin).success);

  assert(restarted.updatePrescriptionReview(order.id, { status: 'RECHAZADA', reviewedBy: admin.id }).success);
  assert.equal(restarted.transitionStatus(order.id, 'LISTO_PARA_DESPACHO', admin).code, 409);
  assert(restarted.transitionStatus(order.id, 'CANCELADO', admin).success);
  const closed = restarted.updatePrescriptionReview(order.id, { status: 'APROBADA' });
  assert(!closed.success);
  assert.equal(closed.code, 409);
  assert.equal(restarted.getOrderById(order.id)?.prescriptionReview.status, 'RECHAZADA');
});

test('a damaged historical order file stays intact for recovery', () => {
  const dataDir = fs.mkdtempSync(path.join(root, 'damaged-'));
  const file = path.join(dataDir, 'persisted-orders.json');
  fs.writeFileSync(file, 'truncated');
  assert.throws(() => new OrdersRepository({dataDir}), /recuperar/);
  assert.equal(fs.readFileSync(file, 'utf8'), 'truncated');
});
