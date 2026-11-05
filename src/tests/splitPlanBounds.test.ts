import assert from 'node:assert/strict';
import { generateSplitDeliveryPlan } from '../lib/deliveryService';
import { INITIAL_PRODUCTS } from '../data/seedData';

let passed = 0;
const product = structuredClone(INITIAL_PRODUCTS[0]);
product.weightKg = 25;
const tiny = { ...structuredClone(product), id: 'QA-ONE-GRAM', weightKg: 0.001 };
function check(label: string, run: () => void) { run(); passed++; console.log(`PASS: ${label}`); }
check('cuatro empaques de 25 kg mantienen la frontera válida de cuatro motos', () => {
  const plan = generateSplitDeliveryPlan([{ productId: product.id, quantity: 4 }], [product], 10);
  assert.equal(plan.feasible, true);
  assert.equal(plan.shipmentCount, 4);
  assert.equal(plan.totalWeightGrams, 100000);
  assert.ok(plan.shipments.every(child => child.weightGrams === 25000));
});
check('un gramo sobre la capacidad simultánea va a Programado sin expandir un plan imposible', () => {
  const plan = generateSplitDeliveryPlan([{ productId: product.id, quantity: 4 }, { productId: tiny.id, quantity: 1 }], [product, tiny], 10);
  assert.equal(plan.totalWeightGrams, 100001);
  assert.equal(plan.feasible, false);
  assert.deepEqual(plan.shipments, []);
  assert.equal(plan.shipmentCount, 0);
});
check('una cotización de muchas unidades no crea miles de envíos hijos', () => {
  const plan = generateSplitDeliveryPlan([{ productId: product.id, quantity: 100000 }], [product], 10);
  assert.equal(plan.feasible, false);
  assert.equal(plan.totalWeightGrams, 2500000000);
  assert.deepEqual(plan.shipments, []);
});
check('no declara factibles cinco empaques indivisibles aunque sumen solo 100 kg', () => {
  const twenty = { ...product, weightKg: 20 };
  const plan = generateSplitDeliveryPlan([{ productId: twenty.id, quantity: 5 }], [twenty], 10);
  assert.equal(plan.totalWeightGrams, 100000);
  assert.equal(plan.feasible, false);
  assert.equal(plan.shipmentCount, 5);
  assert.ok(plan.shipments.every(child => child.weightKg === 20));
});
check('cantidades inválidas o importes fuera del rango entero se rechazan antes de expandir', () => {
  for (const quantity of [-1, 0, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER]) assert.throws(() => generateSplitDeliveryPlan([{ productId: product.id, quantity }], [product], 10), RangeError);
});
console.log(`SPLIT BOUNDS: ${passed} comprobaciones aprobadas.`);
