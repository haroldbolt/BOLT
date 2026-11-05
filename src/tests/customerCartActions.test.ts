import assert from 'node:assert/strict';
import { addCustomerCartLines, reconcileCustomerCart } from '../lib/customerCartActions';
import type { CartItem, Product } from '../types';

let passed = 0;
function check(label: string, action: () => void) { action(); passed++; console.log('PASS: ' + label); }
function product(id: string, extra: Partial<Product> = {}): Product {
  return { id, sku: id, name: 'Producto ' + id, brand: 'Ensayo', species: 'Gato', category: 'Alimentos',
    requiresPrescription: false, storageCondition: 'TEMPERATURA_AMBIENTE', temperatureColdChain: false,
    price: 20000, presentation: '3 kg', weightKg: 3, image: 'ensayo.webp', description: 'Solo ensayo',
    stockByStore: { HUB_KENNEDY: 5, HUB_SUBA: 1 }, reservedStockByStore: { HUB_KENNEDY: 1, HUB_SUBA: 0 },
    rating: 0, reviewsCount: 0, tags: [], status: 'ACTIVE', ...extra };
}
const first = product('A');
const line = (p = first, quantity = 1): CartItem => ({ product: structuredClone(p), quantity });

check('el cambio de bodega conserva las líneas y cantidades, e informa disponibilidad insuficiente', () => {
  const original = [line(first, 3)];
  const result = reconcileCustomerCart(original, [first], 'HUB_SUBA');
  assert.equal(result.items.length, 1); assert.equal(result.items[0].quantity, 3);
  assert.ok(result.issues.some(issue => /dispone de 1/.test(issue)));
  assert.equal(original[0].product.stockByStore.HUB_KENNEDY, 5);
});
check('un producto faltante se conserva visualmente y se marca como no vendible', () => {
  const original = [line(first, 2)];
  const result = reconcileCustomerCart(original, [], 'HUB_SUBA');
  assert.equal(result.items[0].product.name, first.name); assert.equal(result.items[0].quantity, 2);
  assert.equal(result.items[0].product.status, 'ARCHIVED');
  assert.deepEqual(result.items[0].product.stockByStore, {});
  assert.deepEqual(result.items[0].product.reservedStockByStore, {});
  assert.match(result.issues[0], /ya no está disponible/);
  assert.equal(original[0].product.status, 'ACTIVE');
});
check('actualizar el catálogo conserva la cantidad y muestra el cambio de precio', () => {
  const fresh = product('A', { price: 23000, weightKg: 3.1 });
  const result = reconcileCustomerCart([line(first, 2)], [fresh], 'HUB_KENNEDY');
  assert.equal(result.items[0].quantity, 2); assert.equal(result.items[0].product.price, 23000);
  assert.equal(result.items[0].product.weightKg, 3.1);
  assert.ok(result.issues.some(issue => /precio.*cambió/.test(issue)));
  assert.deepEqual(result.priceChanges, result.issues.filter(issue => /precio.*cambió/.test(issue)));
  const refreshedAgain = reconcileCustomerCart(result.items, [fresh], 'HUB_KENNEDY');
  assert.deepEqual(refreshedAgain.issues, []);
  assert.deepEqual(refreshedAgain.priceChanges, [], 'No inventa otro cambio si el precio permanece igual');
});
check('precio y peso pendientes se notifican sin borrar el producto', () => {
  const result = reconcileCustomerCart([line()], [product('A', { price: 0, weightKg: 0 })], 'HUB_KENNEDY');
  assert.equal(result.items[0].quantity, 1);
  assert.ok(result.issues.some(issue => /precio pendiente/.test(issue)));
  assert.ok(result.issues.some(issue => /peso pendiente/.test(issue)));
});
check('stock y reservas frescos se leen únicamente de la sede elegida', () => {
  const p = product('A', { stockByStore: { HUB_KENNEDY: 100, HUB_SUBA: 2 }, reservedStockByStore: { HUB_SUBA: 2 } });
  const result = addCustomerCartLines([], [{ productId: 'A', quantity: 1 }], [p], 'HUB_SUBA');
  assert.deepEqual(result.items, []); assert.ok(result.issues.length);
  assert.equal(p.stockByStore.HUB_KENNEDY, 100); assert.equal(p.reservedStockByStore.HUB_SUBA, 2);
});
check('solicitudes duplicadas se consolidan y se rechazan enteras si exceden disponibles', () => {
  const result = addCustomerCartLines([], [{ productId: 'A', quantity: 3 }, { productId: 'A', quantity: 2 }], [first], 'HUB_KENNEDY');
  assert.deepEqual(result.items, []); assert.ok(result.issues.some(issue => /las 5 unidades/.test(issue)));
});
check('solicitudes válidas suman a la línea existente sin duplicarla ni reservar stock', () => {
  const cart = [line()]; const before = JSON.stringify({ cart, first });
  const result = addCustomerCartLines(cart, [{ productId: 'A', quantity: 1 }, { productId: 'A', quantity: 2 }], [first], 'HUB_KENNEDY');
  assert.equal(result.items.length, 1); assert.equal(result.items[0].quantity, 4); assert.deepEqual(result.issues, []);
  assert.deepEqual(result.priceChanges, []);
  assert.equal(JSON.stringify({ cart, first }), before);
});
check('una solicitud excedida no se recorta ni se agrega parcialmente al carrito existente', () => {
  const result = addCustomerCartLines([line(first, 2)], [{ productId: 'A', quantity: 3 }], [first], 'HUB_KENNEDY');
  assert.equal(result.items[0].quantity, 2); assert.ok(result.issues.length);
});
check('cada producto de una colección se valida por separado sin inventar faltantes', () => {
  const b = product('B');
  const result = addCustomerCartLines([], [{ productId: 'A', quantity: 1 }, { productId: 'B', quantity: 1 }, { productId: 'NO-EXISTE', quantity: 2 }], [first, b], 'HUB_KENNEDY');
  assert.deepEqual(result.items.map(item => item.product.id), ['A', 'B']); assert.equal(result.issues.length, 1);
});
check('cantidades cero, negativas, fraccionarias, infinitas y de texto no se agregan', () => {
  for (const quantity of [0, -1, 1.5, Infinity, NaN, '2', Number.MAX_SAFE_INTEGER + 1]) {
    const result = addCustomerCartLines([], [{ productId: 'A', quantity } as any], [first], 'HUB_KENNEDY');
    assert.deepEqual(result.items, []); assert.ok(result.issues.length);
  }
});
check('una línea duplicada inválida rechaza todo el grupo de ese producto', () => {
  const result = addCustomerCartLines([], [{ productId: 'A', quantity: 1 }, { productId: 'A', quantity: -1 }], [first], 'HUB_KENNEDY');
  assert.deepEqual(result.items, []); assert.ok(result.issues.length);
});
check('la identidad de una presentación se resuelve exactamente y no por nombre o padre', () => {
  const variant = product('VARIANTE-B', { name: first.name, price: 35000 });
  const result = addCustomerCartLines([], [{ productId: 'VARIANTE-B', quantity: 1 }], [first, variant], 'HUB_KENNEDY');
  assert.equal(result.items[0].product.id, 'VARIANTE-B'); assert.equal(result.items[0].product.price, 35000);
});
check('las salidas no comparten mapas mutables con el catálogo ni las entradas', () => {
  const cart = [line()];
  const reconciled = reconcileCustomerCart(cart, [first], 'HUB_KENNEDY');
  reconciled.items[0].product.stockByStore.HUB_KENNEDY = 0;
  assert.equal(first.stockByStore.HUB_KENNEDY, 5); assert.equal(cart[0].product.stockByStore.HUB_KENNEDY, 5);
  const added = addCustomerCartLines([], [{ productId: 'A', quantity: 1 }], [first], 'HUB_KENNEDY');
  added.items[0].product.reservedStockByStore.HUB_KENNEDY = 100;
  assert.equal(first.reservedStockByStore.HUB_KENNEDY, 1);
  const changed = addCustomerCartLines(cart, [{ productId: 'A', quantity: 1 }], [product('A', { price: 24000 })], 'HUB_KENNEDY');
  assert.equal(changed.priceChanges.length, 1);
  assert.ok(changed.issues.includes(changed.priceChanges[0]));
  assert.match(changed.priceChanges[0], /precio.*cambió/);
});
check('líneas existentes duplicadas conservan su cantidad pero se comprueban sumadas', () => {
  const result = reconcileCustomerCart([line(first, 3), line(first, 2)], [first], 'HUB_KENNEDY');
  assert.deepEqual(result.items.map(item => item.quantity), [3, 2]);
  assert.ok(result.issues.some(issue => /Solicitaste 5/.test(issue)));
});
check('datos inválidos de inventario o estado inactivo no habilitan nuevas unidades', () => {
  for (const p of [product('A', { status: 'ARCHIVED' }), product('A', { price: 0 }), product('A', { weightKg: NaN }),
    product('A', { stockByStore: { HUB_KENNEDY: Infinity } }), product('A', { reservedStockByStore: { HUB_KENNEDY: -1 } })]) {
    const result = addCustomerCartLines([], [{ productId: 'A', quantity: 1 }], [p], 'HUB_KENNEDY');
    assert.deepEqual(result.items, []); assert.ok(result.issues.length);
  }
});

console.log(`CARRITO POR DIRECCIÓN: ${passed} comprobaciones aprobadas; datos de ensayo sin reservas ni pedidos.`);
