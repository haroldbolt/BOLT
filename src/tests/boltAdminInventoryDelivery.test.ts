import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { INITIAL_STORES } from '../data/seedData';
import type { OrderActor, OrderItem } from '../types';
import { DEFAULT_TRANSPORT_CONFIG } from '../types/transport';
import { CatalogOperations } from '../lib/catalogOperations';
import { DispatchService } from '../lib/dispatchService';
import { localCatalogService } from '../lib/localCatalogService';
import { OrdersRepository } from '../lib/ordersRepository';
import { pendingDeliveryOrder } from '../lib/pendingDeliveryOrder';

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bolt-demo-inventory-delivery-'));
try {
  const stores = INITIAL_STORES.filter(store => store.isActive);
  const suba = stores.find(store => store.id === 'HUB_SUBA');
  assert.ok(suba);
  for (const id of ['HUB_KENNEDY', 'HUB_ALAMOS', 'HUB_CENTRO']) assert.ok(stores.some(store => store.id === id));
  fs.writeFileSync(path.join(directory, 'persisted-orders.json'), '[]');
  fs.writeFileSync(path.join(directory, 'persisted-drivers.json'), '[]');
  let repository = new OrdersRepository({ dataDir: directory });
  const productId = 'gid://shopify/Product/9400676647192';
  const variantId = 'gid://shopify/ProductVariant/48875669717272';
  const product = localCatalogService.getAllGroupedProducts().find(item => item.id === productId);
  assert.ok(product);
  const catalogOptions = {
    file: path.join(directory, 'catalog.json'),
    products: () => [product],
    stores: () => stores,
    orders: () => repository.getAllOrders(),
    demo: true,
  };
  let catalog = new CatalogOperations(catalogOptions);
  catalog.initializeOrderTracking();
  const actor: OrderActor = { id: 'demo-admin', name: 'Administración de prueba', role: 'ADMINISTRADOR' };
  const stockActor = { id: actor.id, name: 'Administración de prueba', email: 'admin@example.invalid' };
  catalog.initializeDemoInventory(stockActor);
  const dispatch = new DispatchService({
    repo: repository,
    stores: () => stores,
    products: () => catalog.getSalesProducts(),
    transport: () => structuredClone(DEFAULT_TRANSPORT_CONFIG),
    simulation: true,
  });
  const variant = () => {
    const sale = catalog.getSalesProducts().find(item => item.id === variantId);
    assert.ok(sale);
    return sale;
  };
  const sale = variant();
  assert.equal(sale.presentation, '15 kg');
  const item: OrderItem = {
    productId: sale.id, sku: sale.sku, name: sale.name, brand: sale.brand,
    presentation: sale.presentation, price: sale.price, quantity: 1, image: sale.image,
    weightKg: sale.weightKg, requiresPrescription: sale.requiresPrescription,
  };
  function submit(key: string, email: string) {
    const pending = pendingDeliveryOrder({
      items: [item], store: suba!, requestedMode: 'PROGRAMADO',
      customer: { name: 'Cliente de prueba', email, phone: '0000000000', isGuest: true },
      address: {
        address: 'Destino simulado', coordinates: { lat: 4.731531, lng: -74.041785 }, locality: 'Usaquén',
        details: '', porteriaPolicy: 'SUBIR_A_PUERTA',
      },
      creationRequestId: key, creationRequestFingerprint: 'c'.repeat(64),
    });
    const result = dispatch.createOrder(pending, catalog.getSalesProducts(), suba);
    assert.equal(result.success, true, result.error);
    assert.ok(result.order);
    return result.order;
  }
  function balances() {
    const {stockByStore, reservedStockByStore} = variant();
    return Object.fromEntries(stores.map(({ id }) => {
      const stock = stockByStore[id] ?? 0;
      const reserved = reservedStockByStore[id] ?? 0;
      return [id, [stock, reserved, stock - reserved]];
    }));
  }
  const existing = submit('preexisting-guest-reservation', 'reserva-existente@example.invalid');
  const before = balances();
  assert.deepEqual(before.HUB_SUBA, [100, 1, 99]);
  for (const [storeId, balance] of Object.entries(before)) {
    if (storeId !== 'HUB_SUBA') assert.deepEqual(balance, [100, 0, 100]);
  }

  const order = submit('demo-delivery-agility-15kg', 'prueba-entrega-suba@example.invalid');
  const code = order.purchaseCode;
  assert.ok(code);
  assert.ok(dispatch.authorizeGuest(order.id, dispatch.guestToken(order)));
  assert.deepEqual(balances(), { ...before, HUB_SUBA: [100, 2, 98] });
  assert.equal(repository.completeDemoInventoryDelivery(existing.id, actor).success, false);
  assert.equal(repository.completeDemoInventoryDelivery(order.id, { role: 'CLIENTE' }).success, false);
  assert.equal(repository.transitionStatus(order.id, 'ENTREGADO', actor).success, false);
  assert.deepEqual(balances(), { ...before, HUB_SUBA: [100, 2, 98] });

  const paidBefore = structuredClone(order.payment);
  const delivered = repository.completeDemoInventoryDelivery(order.id, actor);
  assert.equal(delivered.success, true, delivered.error);
  assert.equal(delivered.order?.fulfillmentStatus, 'ENTREGADO');
  assert.equal(delivered.order?.purchaseCode, code);
  assert.equal(delivered.order?.deliveryReview?.status, 'SIMULATED');
  assert.equal(delivered.order?.payment.cashToCollect, 0);
  assert.equal(delivered.order?.payment.status, paidBefore.status);
  assert.equal(delivered.order?.payment.transactionId, undefined);
  assert.deepEqual(repository.dispatchState.runs, {});
  assert.equal(repository.getOrderById(existing.id)?.fulfillmentStatus, 'PENDIENTE_CONFIRMACION');
  assert.deepEqual(balances(), { ...before, HUB_SUBA: [99, 1, 98] });

  assert.equal(repository.completeDemoInventoryDelivery(order.id, actor).success, true);
  assert.equal(repository.getOrderById(order.id)?.statusHistory?.filter(event => event.newStatus === 'ENTREGADO').length, 1);
  assert.deepEqual(balances(), { ...before, HUB_SUBA: [99, 1, 98] });
  repository = new OrdersRepository({ dataDir: directory });
  catalog = new CatalogOperations(catalogOptions);
  assert.equal(repository.getOrderById(order.id)?.fulfillmentStatus, 'ENTREGADO');
  assert.deepEqual(balances(), { ...before, HUB_SUBA: [99, 1, 98] });
  const current = variant();
  catalog.edit(productId, {
    variantId, stockByStore: { HUB_SUBA: 100 }, expectedRevision: current.commerceRevision,
    reason: 'Reposición de una unidad tras la entrega simulada',
  }, stockActor);
  assert.deepEqual(balances(), before);
  assert.equal(repository.getOrderById(order.id)?.fulfillmentStatus, 'ENTREGADO');
  const reloaded = new CatalogOperations(catalogOptions);
  assert.equal(reloaded.getSalesProducts().find(item => item.id === variantId)?.stockByStore.HUB_SUBA, 100);
  console.log('PASS: la entrega de prueba de Agility Gold 15 kg descuenta solo en Suba, conserva el cobro en cero y permite reponer el saldo.');
} finally {
  fs.rmSync(directory, { recursive: true, force: true });
}

