import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { CartDrawer } from '../components/customer/CartDrawer';
import { CheckoutModal, isCurrentCheckoutPrice } from '../components/customer/CheckoutModal';
import { OrderTotals } from '../components/operations/OrderTotals';
import { StoredOrderBreakdown } from '../components/customer/OrderTracking';
import { INITIAL_PRODUCTS, INITIAL_STORES } from '../data/seedData';
import { evaluateDeliveryQuote } from '../lib/deliveryService';
import { NEW_ORDER_DELIVERY_OPTIONS, isNewOrderPorteriaPolicy } from '../lib/checkoutPolicy';
import { formatCOP } from '../lib/formatters';
import type { CartItem, Order } from '../types';

let passed = 0;
function check(label: string, run: () => void) { run(); passed++; console.log('PASS: ' + label); }
const store = structuredClone(INITIAL_STORES.find(store => store.id === 'HUB_KENNEDY')!);
const product = { ...structuredClone(INITIAL_PRODUCTS[0]), price: 20000, weightKg: 1, status: 'ACTIVE',
  stockByStore: { HUB_KENNEDY: 10 }, reservedStockByStore: { HUB_KENNEDY: 0 }, bodegaIds: ['HUB_KENNEDY'],
  inventoryVerifiedByStore: { HUB_KENNEDY: true }, presentaciones: [] };
const items: CartItem[] = [{ product, quantity: 1 }];
const noOperation = () => {};
const quote = evaluateDeliveryQuote({ destination: { address: 'Punto de ensayo Kennedy', coordinates: { lat: 4.6325, lng: -74.1520 } }, items: [{ productId: product.id, quantity: 1 }] }, [store], [product]);

check('la política de nueva compra permite llamar y portería, manteniendo subir fuera del formulario', () => {
  assert.deepEqual(NEW_ORDER_DELIVERY_OPTIONS.map(option => option.value).sort(), ['DEJAR_EN_PORTERIA', 'LLAMAR_AL_LLEGAR']);
  assert.equal(isNewOrderPorteriaPolicy('SUBIR_A_PUERTA'), false);
  assert.equal(isNewOrderPorteriaPolicy('LLAMAR_AL_LLEGAR'), true);
  assert.equal(isNewOrderPorteriaPolicy('DEJAR_EN_PORTERIA'), true);
  assert.equal(isNewOrderPorteriaPolicy(undefined), false);
});
const cart = renderToStaticMarkup(React.createElement(CartDrawer, { isOpen: true, onClose: noOperation,
  cartItems: items, onUpdateQuantity: noOperation, onClearCart: noOperation, onProceedToCheckout: noOperation, currentStore: store }));
check('el carrito muestra $24.900 y no cobra servicio ni embalaje adicional', () => {
  assert.match(cart, /24\.900/);
  assert.doesNotMatch(cart, /26\.400/);
  assert.doesNotMatch(cart, /Tarifa de servicio|servicio y embalaje/i);
});
const checkout = renderToStaticMarkup(React.createElement(CheckoutModal, {
  isOpen: true, onClose: noOperation, cartItems: items, currentStore: store,
  onOrderSuccess: noOperation, customerAddress: 'Punto de ensayo Kennedy', customerAddressDetails: '',
  customerCoordinates: { lat: 4.6325, lng: -74.1520 }, onChangeAddressDetails: noOperation,
  deliveryQuote: quote, catalogReady: true, selectedMode: 'TURBO',
}));
check('el checkout renderizado ofrece las dos instrucciones y retira subir al apartamento', () => {
  assert.match(checkout, />Llamar al llegar</);
  assert.match(checkout, />Dejar en porter[ií]a</);
  assert.doesNotMatch(checkout, /Subir al apto|Subir al apartamento|SUBIR_A_PUERTA/);
});
check('el checkout conserva la propina y espera el total del servidor sin tarifa de servicio', () => {
  assert.match(checkout, /Propina repartidor:/);
  assert.match(checkout, /2\.000/);
  assert.match(checkout, /Por verificar/);
  assert.doesNotMatch(checkout, /28\.400/);
  assert.doesNotMatch(checkout, /26\.400/);
  assert.doesNotMatch(checkout, /Tarifa de servicio|Servicio y embalaje/i);
});

const currentPrice = { subtotal: 20000, discount: 0, shipping: 4900, serviceFee: 0, total: 24900 };
check('la cotización vigente sin servicio se puede utilizar', () => assert.equal(isCurrentCheckoutPrice(currentPrice), true));
check('una cotización almacenada con la tarifa anterior no se puede utilizar', () => {
  assert.equal(isCurrentCheckoutPrice({ ...currentPrice, serviceFee: 1500, total: 26400 }), false);
  assert.equal(isCurrentCheckoutPrice({ ...currentPrice, total: 26400 }), false);
});
check('los ceros válidos de descuentos y envío gratuito no recuperan una tarifa predeterminada', () => {
  assert.equal(isCurrentCheckoutPrice({ subtotal: 70000, discount: 35000, shipping: 0, serviceFee: 0, total: 35000 }), true);
  assert.equal(isCurrentCheckoutPrice({ subtotal: 70000, discount: 70000, shipping: 0, serviceFee: 0, total: 0 }), true);
  assert.equal(isCurrentCheckoutPrice({ ...currentPrice, total: NaN }), false);
});

const previous: Order['totals'] = { subtotal: 20000, discount: 0, shipping: 4900, serviceFee: 1500, tip: 2000, total: 28400, totalWeightKg: 1 };
const oldBreakdown = renderToStaticMarkup(React.createElement(OrderTotals, { totals: previous }));
check('administración conserva el servicio y el total guardados de una factura anterior', () => {
  assert.match(oldBreakdown, /<dt>Servicio<\/dt>/);
  assert.match(oldBreakdown, /1\.500/);
  assert.ok(oldBreakdown.includes('<strong>' + formatCOP(previous.total) + '</strong>'));
});
const newTotals = { ...previous, serviceFee: 0, total: 26900 };
const newBreakdown = renderToStaticMarkup(React.createElement(OrderTotals, { totals: newTotals }));
check('administración muestra propina y total nuevo sin una fila de servicio', () => {
  assert.doesNotMatch(newBreakdown, /<dt>Servicio<\/dt>/);
  assert.match(newBreakdown, /<dt>Propina<\/dt>/);
  assert.match(newBreakdown, /2\.000/);
  assert.ok(newBreakdown.includes('<strong>' + formatCOP(newTotals.total) + '</strong>'));
  assert.equal(previous.serviceFee, 1500);
  assert.equal(previous.total, 28400);
});
const previousSnapshot = JSON.stringify(previous);
const oldCustomerBreakdown = renderToStaticMarkup(React.createElement(StoredOrderBreakdown, { totals: previous }));
check('el cliente ve el servicio y total guardados de su pedido anterior', () => {
  assert.match(oldCustomerBreakdown, /<dt>Servicio:<\/dt>/);
  assert.match(oldCustomerBreakdown, /1\.500/);
  assert.match(oldCustomerBreakdown, /<dt>Propina:<\/dt>/);
  assert.ok(oldCustomerBreakdown.includes(formatCOP(previous.total)));
  assert.equal(JSON.stringify(previous), previousSnapshot);
});
const newCustomerBreakdown = renderToStaticMarkup(React.createElement(StoredOrderBreakdown, { totals: newTotals }));
check('el cliente ve su nuevo total y propina sin servicio ni recalcular el histórico', () => {
  assert.doesNotMatch(newCustomerBreakdown, /<dt>Servicio:<\/dt>/);
  assert.match(newCustomerBreakdown, /<dt>Propina:<\/dt>/);
  assert.match(newCustomerBreakdown, /2\.000/);
  assert.ok(newCustomerBreakdown.includes(formatCOP(newTotals.total)));
  assert.doesNotMatch(newCustomerBreakdown, /28\.400/);
  assert.equal(JSON.stringify(previous), previousSnapshot);
});
console.log(`CHECKOUT POLICY VIEWS: ${passed} comprobaciones aprobadas; renderizado de componentes sin navegador.`);
