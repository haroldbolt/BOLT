import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Order, Product, OrderActor } from '../types';

const directories: string[] = [];
const temporary = () => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bolt-orders-test-')); directories.push(dir); return dir; };
const previousDataDir = process.env.BOLT_DATA_DIR;
process.env.BOLT_DATA_DIR = temporary();
const { OrdersRepository } = await import('../lib/ordersRepository');
const { INITIAL_ORDERS, INITIAL_PRODUCTS, INITIAL_DRIVERS } = await import('../data/seedData');
let passed = 0;
function check(name: string, run: () => void) { run(); passed++; console.log(`PASS: ${name}`); }
const store = 'HUB_KENNEDY';
const actor: OrderActor = { role: 'BODEGA', id: 'OPERADOR-TEST', name: 'Prueba aislada' };
function fixture(id: string, qty = 1): Order {
  const order = structuredClone(INITIAL_ORDERS[0]);
  Object.assign(order, { id, orderNumber: id, storeId: store, isSplitOrder: false, childShipments: undefined, fulfillmentStatus: 'CONFIRMADO', driver: undefined, statusHistory: [], physicalReturnPending: false });
  order.items = [{ ...order.items[0], productId: INITIAL_PRODUCTS[0].id, quantity: qty }];
  return order;
}
function product(stock = 10): Product {
  const item = structuredClone(INITIAL_PRODUCTS[0]); item.stockByStore = { [store]: stock }; item.reservedStockByStore = { [store]: 0 }; return item;
}
const repo = () => new OrdersRepository({ dataDir: temporary(), initialOrders: [], initialDrivers: structuredClone(INITIAL_DRIVERS) });
try {
  check('un pedido de una unidad reserva exactamente una unidad', () => {
    const r = repo(), p = product(), o = fixture('UNA'); assert.equal(r.createOrder(o, [p]).success, true); assert.equal(p.reservedStockByStore[store], 1);
  });
  check('la última unidad puede reservarse una vez y el duplicado no vuelve a descontar', () => {
    const r = repo(), p = product(1), o = fixture('ULTIMA'); assert.equal(r.createOrder(o, [p]).success, true);
    assert.equal(r.createOrder(o, [p]).success, false); assert.equal(p.reservedStockByStore[store], 1);
  });
  check('líneas repetidas se suman antes de comprobar existencias', () => {
    const r = repo(), p = product(3), o = fixture('REPETIDAS', 2); o.items.push({ ...o.items[0] });
    assert.equal(r.createOrder(o, [p]).success, false); assert.equal(p.reservedStockByStore[store], 0); assert.equal(r.getAllOrders().length, 0);
  });
  check('líneas repetidas válidas aplican su suma una sola vez', () => {
    const r = repo(), p = product(4), o = fixture('REPETIDAS-OK', 2); o.items.push({ ...o.items[0] });
    assert.equal(r.createOrder(o, [p]).success, true); assert.equal(p.reservedStockByStore[store], 4);
  });
  for (const qty of [0, -1, 1.5, NaN, Infinity]) {
    check(`cantidad inválida ${String(qty)} no deja reserva huérfana`, () => {
      const r = repo(), p = product(), o = fixture(`INVALID-${String(qty)}`, qty);
      assert.equal(r.createOrder(o, [p]).success, false); assert.equal(p.reservedStockByStore[store], 0); assert.equal(r.getAllOrders().length, 0);
    });
  }
  check('pedido vacío se rechaza sin efectos', () => { const r = repo(), o = fixture('VACIO'); o.items = []; assert.equal(r.createOrder(o, [product()]).success, false); assert.equal(r.getAllOrders().length, 0); });
  check('producto desconocido en una segunda línea no reserva la primera', () => {
    const r = repo(), p = product(), o = fixture('DESCONOCIDO'); o.items.push({ ...o.items[0], productId: 'NO-EXISTE' });
    assert.equal(r.createOrder(o, [p]).success, false); assert.equal(p.reservedStockByStore[store], 0);
  });
  check('reservas inválidas no se convierten en cero para permitir una venta', () => {
    const r = repo(), p = product(); p.reservedStockByStore[store] = NaN;
    assert.equal(r.createOrder(fixture('RESERVA-INVALIDA'), [p]).success, false); assert(Number.isNaN(p.reservedStockByStore[store]));
  });
  check('asignar un conductor inexistente no sustituye por el primero', () => {
    const r = repo(), o = fixture('SIN-CONDUCTOR'); o.fulfillmentStatus = 'LISTO_PARA_DESPACHO'; r.createOrder(o);
    assert.equal(r.assignDriver(o.id, 'NO-EXISTE', actor).success, false); assert.equal(r.getOrderById(o.id)!.driver, undefined);
  });
  check('asignación con estado inválido no modifica al conductor', () => {
    const r = repo(), o = fixture('NO-LISTO'); r.createOrder(o);
    assert.equal(r.assignDriver(o.id, INITIAL_DRIVERS[0].id, actor).success, false); assert.equal(r.getOrderById(o.id)!.driver, undefined);
  });
  check('un cliente no puede cambiar conductor', () => {
    const r = repo(), o = fixture('ROL'); o.fulfillmentStatus = 'LISTO_PARA_DESPACHO'; r.createOrder(o);
    assert.equal(r.assignDriver(o.id, INITIAL_DRIVERS[0].id, { role: 'CLIENTE', name: 'Cliente' }).success, false); assert.equal(r.getOrderById(o.id)!.driver, undefined);
  });
  check('asignación autorizada conserva el conductor al recargar', () => {
    const dir = temporary(), r = new OrdersRepository({ dataDir: dir, initialOrders: [], initialDrivers: structuredClone(INITIAL_DRIVERS) }), o = fixture('ASIGNADO'); o.fulfillmentStatus = 'LISTO_PARA_DESPACHO'; r.createOrder(o);
    assert.equal(r.assignDriver(o.id, INITIAL_DRIVERS[0].id, actor).success, true);
    assert.equal(new OrdersRepository({ dataDir: dir }).getOrderById(o.id)!.driver!.id, INITIAL_DRIVERS[0].id);
  });
  check('devolver un hijo no libera mercancía de otro que sigue en camino', () => {
    const r = repo(), p = product(10), o = fixture('DEVOLUCION', 3); o.isSplitOrder = true; o.fulfillmentStatus = 'EN_CAMINO';
    o.childShipments = ['A', 'B'].map((suffix, index) => ({
      shipmentId: `HIJO-${suffix}`, shipmentIndex: index + 1, shipmentCount: 2, parentOrderId: o.id,
      items: [{ ...o.items[0], quantity: index === 0 ? 1 : 2 }], weightKg: 1, weightGrams: 1000, subtotal: 0, cashToCollect: 0,
      fulfillmentStatus: index === 0 ? 'CANCELADO' : 'EN_CAMINO', secretDeliveryCode: '0000', estimatedDeliveryMinutes: 20,
      timestamps: {}, physicalReturnPending: index === 0,
    }));
    r.createOrder(o, [p]); assert.equal(p.reservedStockByStore[store], 3);
    assert.equal(r.confirmPhysicalReturn(o.id, 'Prueba', [p], 'Inspección del hijo A', 'HIJO-A').success, true);
    assert.equal(p.reservedStockByStore[store], 2);
    const saved = r.getOrderById(o.id)!; assert.equal(saved.childShipments![1].fulfillmentStatus, 'EN_CAMINO'); assert.equal(saved.childShipments![1].physicalReturnConfirmedAt, undefined);
    assert.equal(r.confirmPhysicalReturn(o.id, 'Prueba', [p], undefined, 'HIJO-A').success, false); assert.equal(p.reservedStockByStore[store], 2);
  });
  check('el padre dividido no puede marcarse entregado saltándose hijos pendientes', () => {
    const r = repo(), o = fixture('PADRE-NO-ENTREGADO'); o.isSplitOrder = true; o.fulfillmentStatus = 'EN_CAMINO';
    o.childShipments = [{ shipmentId: 'HIJO-PENDIENTE', shipmentIndex: 1, shipmentCount: 1, parentOrderId: o.id, items: structuredClone(o.items), weightKg: 1, weightGrams: 1000, subtotal: 0, cashToCollect: 0, fulfillmentStatus: 'EN_CAMINO', secretDeliveryCode: '0000', estimatedDeliveryMinutes: 20, timestamps: {} }];
    r.createOrder(o);
    assert.equal(r.transitionStatus(o.id, 'ENTREGADO', actor, { deliveryCode: o.secretDeliveryCode }).success, false);
    assert.equal(r.getOrderById(o.id)!.childShipments![0].fulfillmentStatus, 'EN_CAMINO');
  });
  check('error de escritura se propaga y revierte la reserva y el pedido en memoria', () => {
    const r = repo(), p = product(), o = fixture('FALLO-DISCO');
    const originalRename = fs.renameSync;
    try {
      fs.renameSync = (() => { throw new Error('Fallo de disco de prueba'); }) as typeof fs.renameSync;
      assert.throws(() => r.createOrder(o, [p]), /Fallo de disco de prueba/);
    } finally { fs.renameSync = originalRename; }
    assert.equal(p.reservedStockByStore[store], 0); assert.equal(r.getOrderById(o.id), undefined); assert.equal(r.getAuditHistory(o.id).length, 0);
  });
  check('crear y asignar confirman cada operación con un único reemplazo atómico', () => {
    const r = repo(), o = fixture('UN-RENAME'); o.fulfillmentStatus = 'LISTO_PARA_DESPACHO';
    const originalRename = fs.renameSync;
    let writes = 0;
    try {
      fs.renameSync = ((...args: Parameters<typeof fs.renameSync>) => { writes++; return originalRename(...args); }) as typeof fs.renameSync;
      assert.equal(r.createOrder(o).success, true); assert.equal(writes, 1);
      writes = 0;
      assert.equal(r.assignDriver(o.id, INITIAL_DRIVERS[0].id, actor).success, true); assert.equal(writes, 1);
    } finally { fs.renameSync = originalRename; }
  });
  check('archivo corrupto no se sobrescribe con pedidos de demostración', () => {
    const dir = temporary(), file = path.join(dir, 'operations-state.json'); fs.writeFileSync(file, '{corrupto');
    assert.throws(() => new OrdersRepository({ dataDir: dir })); assert.equal(fs.readFileSync(file, 'utf8'), '{corrupto');
  });
  check('migración privada conserva pedidos existentes en el nuevo archivo único', () => {
    const dir = temporary(), order = fixture('LEGACY');
    fs.writeFileSync(path.join(dir, 'persisted-orders.json'), JSON.stringify([order]));
    const r = new OrdersRepository({ dataDir: dir, initialOrders: [], initialDrivers: [] });
    assert.equal(r.getOrderById(order.id)!.id, order.id); assert.equal(fs.existsSync(path.join(dir, 'operations-state.json')), true);
  });
  check('una instalación nueva no genera pedidos pagados ni repartidores de demostración', () => {
    const r = new OrdersRepository({ dataDir: temporary() });
    assert.equal(r.getAllOrders().length, 0);
    assert.equal(r.getAllDrivers().length, 0);
  });
  console.log(`RESERVAS/PERSISTENCIA: ${passed} comprobaciones aprobadas.`);
} finally {
  if (previousDataDir === undefined) delete process.env.BOLT_DATA_DIR; else process.env.BOLT_DATA_DIR = previousDataDir;
  for (const dir of directories) {
    if (path.dirname(path.resolve(dir)) !== path.resolve(os.tmpdir()) || !path.basename(dir).startsWith('bolt-orders-test-')) throw new Error('Ruta temporal no válida');
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
