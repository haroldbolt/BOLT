import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Header } from '../components/customer/Header';
import { ProductCard } from '../components/customer/ProductCard';
import { ProductDetailModal } from '../components/customer/ProductDetailModal';
import { ProductCompareModal } from '../components/customer/ProductCompareModal';
import { CartDrawer } from '../components/customer/CartDrawer';
import { CheckoutModal } from '../components/customer/CheckoutModal';
import { OrderHistoryModal } from '../components/customer/OrderHistoryModal';
import { ScheduledDeliveryModal } from '../components/customer/ScheduledDeliveryModal';
import { OrderTracking } from '../components/customer/OrderTracking';
import { INITIAL_PRODUCTS, INITIAL_STORES } from '../data/seedData';
import { evaluateDeliveryQuote } from '../lib/deliveryService';
import type { CartItem, Product } from '../types';

let passed = 0;
function check(label: string, test: () => void) { test(); passed++; console.log('PASS: ' + label); }
const noop = () => {};
const store = structuredClone(INITIAL_STORES.find(value => value.id === 'HUB_KENNEDY')!);
const product: Product = { ...structuredClone(INITIAL_PRODUCTS[0]), id: 'QA-ADDRESS-SURFACE', name: 'Producto de ensayo de dirección', price: 20000, weightKg: 1,
  status: 'ACTIVE', presentaciones: [], stockByStore: { HUB_KENNEDY: 0 }, reservedStockByStore: { HUB_KENNEDY: 0 } };
const stocked = { ...product, stockByStore: { HUB_KENNEDY: 4 } };
const items: CartItem[] = [{ product: stocked, quantity: 1 }];
const quote = evaluateDeliveryQuote({ destination: { address: 'Dirección temporal para ensayo', coordinates: { lat: 4.6325, lng: -74.1520 } }, items: [{ productId: stocked.id, quantity: 1 }] }, [store], [stocked]);
const headerProps: React.ComponentProps<typeof Header> = { currentStore: store, allStores: [store], onSelectStore: noop,
  selectedCategory: 'Todo', onSelectCategory: noop, searchQuery: '', onSearchChange: noop,
  activeOrdersCount: 0, onOpenActiveOrders: noop, onNavigateToOperacion: noop, onOpenOrderHistory: noop,
  onOpenProfile: noop, onOpenNotifications: noop, onOpenAddressModal: noop };
const header = renderToStaticMarkup(React.createElement(Header, { ...headerProps, addressReady: false, deliveryAddressStatus: 'missing' }));
check('el encabezado sin dirección conserva el gancho de 25 minutos con cobertura explícita', () => {
  assert.match(header, /Turbo hasta 25 minutos/);
  assert.match(header, /En zonas habilitadas\. Confirma tu dirección\./);
  assert.match(header, /¿Dónde entregamos tu pedido\? Ingresa tu dirección/);
  assert.doesNotMatch(header, /Consulta la entrega para tu dirección/);
  assert.doesNotMatch(header, /Calle 3 #78-20|Apto 502|aprox\./);
});
const checkingHeader = renderToStaticMarkup(React.createElement(Header, { ...headerProps, addressReady: false, deliveryAddressStatus: 'checking', customerAddress: 'Destino elegido de ensayo', deliveryQuote: quote }));
check('restaurar dirección muestra validación y no anuncia una estimación antigua', () => {
  assert.match(checkingHeader, /Destino elegido de ensayo/);
  assert.match(checkingHeader, /Validando cobertura para tu dirección/);
  assert.match(checkingHeader, /Turbo hasta 25 minutos/);
  assert.doesNotMatch(checkingHeader, /aprox\./);
});
const scheduledHeader = renderToStaticMarkup(React.createElement(Header, { ...headerProps, addressReady: true,
  selectedDeliveryMode: 'PROGRAMADO', customerAddress: 'Destino elegido de ensayo', deliveryQuote: quote }));
check('Programado conserva el gancho pero identifica la modalidad activa sin ETA Turbo', () => {
  assert.match(scheduledHeader, /Turbo hasta 25 minutos/);
  assert.match(scheduledHeader, /Envío programado · Elige día y horario/);
  assert.doesNotMatch(scheduledHeader, /Entrega Turbo/);
});

const cardProps: React.ComponentProps<typeof ProductCard> = { product, quantityInCart: 0, onAddToCart: noop,
  onUpdateQuantity: noop, isFavorite: false, onToggleFavorite: noop, onOpenDetails: noop, selectedStoreId: store.id };
const card = renderToStaticMarkup(React.createElement(ProductCard, { ...cardProps, addressReady: false }));
check('una tarjeta sin dirección permite consultar y no declara agotados de una sede arbitraria', () => {
  assert.match(card, /title="Consulta disponibilidad"/);
  assert.match(card, /Consulta disponibilidad/);
  assert.doesNotMatch(card, /Agotado|Últimas|Disponible para Turbo|disabled=/);
});
const readyCard = renderToStaticMarkup(React.createElement(ProductCard, cardProps));
check('una sede ya confirmada conserva el bloqueo real de producto sin unidades', () => {
  assert.match(readyCard, /Agotado en esta sede/);
  assert.match(readyCard, /disabled=/);
});
const lowStockCard = renderToStaticMarkup(React.createElement(ProductCard, { ...cardProps, product: { ...stocked, stockByStore: { HUB_KENNEDY: 1 } }, addressReady: false }));
check('antes de confirmar no se muestran últimas unidades de Kennedy', () => assert.doesNotMatch(lowStockCard, /Últimas|Disponible para Turbo/));
const availableCard = renderToStaticMarkup(React.createElement(ProductCard, { ...cardProps, product: stocked, addressReady: true }));
check('el stock confirmado de una sede no se confunde con elegibilidad de entrega Turbo', () => {
  assert.match(availableCard, /Disponible en esta sede/);
  assert.doesNotMatch(availableCard, /Disponible para Turbo/);
});

const detail = renderToStaticMarkup(React.createElement(ProductDetailModal, { product, onClose: noop,
  quantityInCart: 0, onAddToCart: noop, onUpdateQuantity: noop, isFavorite: false, onToggleFavorite: noop,
  selectedStoreId: store.id, addressReady: false }));
check('el detalle solicita dirección y oculta las existencias de una sede no confirmada', () => {
  assert.match(detail, /Turbo hasta 25 minutos/);
  assert.match(detail, /Consulta disponibilidad/);
  assert.match(detail, /Confirmar dirección/);
  assert.doesNotMatch(detail, /Agotado|unidades en sede|disabled=/);
});
const compare = renderToStaticMarkup(React.createElement(ProductCompareModal, { isOpen: true, onClose: noop,
  compareProducts: [product], onRemoveProduct: noop, onClearAll: noop, cartQuantities: {}, onAddToCart: noop,
  onUpdateQuantity: noop, selectedStoreId: store.id, addressReady: false }));
check('el comparador permite consultar disponibilidad sin mostrar stock supuesto', () => {
  assert.match(compare, /Turbo hasta 25 minutos/);
  assert.match(compare, /Consulta disponibilidad/);
  assert.doesNotMatch(compare, /Agotado en sede|uds disponibles|disabled=/);
});

const cartProps: React.ComponentProps<typeof CartDrawer> = { isOpen: true, onClose: noop, cartItems: items,
  onUpdateQuantity: noop, onClearCart: noop, onProceedToCheckout: noop, currentStore: store };
const cart = renderToStaticMarkup(React.createElement(CartDrawer, { ...cartProps, addressReady: false }));
check('el carrito pendiente conserva líneas sin confirmar envío, total o sede', () => {
  assert.match(cart, /Producto de ensayo de dirección/);
  assert.match(cart, /Por confirmar con tu dirección/);
  assert.match(cart, /Confirmar dirección/);
  assert.match(cart, /Turbo hasta 25 minutos/);
  assert.doesNotMatch(cart, /4\.900|24\.900|Bolt Pets Kennedy/);
});
const readyCart = renderToStaticMarkup(React.createElement(CartDrawer, cartProps));
check('al confirmar dirección se conserva el total nuevo sin tarifa de servicio', () => {
  assert.match(readyCart, /24\.900/);
  assert.doesNotMatch(readyCart, /26\.400|Tarifa de servicio/);
});
const reviewCart = renderToStaticMarkup(React.createElement(CartDrawer, { ...cartProps, cartReviewMessage: 'Revisa las cantidades para tu nueva bodega.' }));
check('el carrito avisa que debe revisarse sin borrar las líneas conservadas', () => {
  assert.match(reviewCart, /role="status"/);
  assert.match(reviewCart, /Revisa las cantidades para tu nueva bodega\./);
  assert.match(reviewCart, /Producto de ensayo de dirección/);
});

const checkout = renderToStaticMarkup(React.createElement(CheckoutModal, { isOpen: true, onClose: noop,
  cartItems: items, currentStore: store, onOrderSuccess: noop, customerAddress: 'Destino de prueba',
  customerCoordinates: { lat: 4.6325, lng: -74.1520 }, onChangeAddressDetails: noop, deliveryQuote: quote,
  catalogReady: true, selectedMode: 'TURBO', addressReady: false, onChangeAddress: noop,
  cartReviewMessage: 'Un producto requiere revisar disponibilidad en esta dirección.' }));
check('el checkout ignora una cotización anterior mientras la dirección no está lista', () => {
  assert.match(checkout, /Confirma tu dirección para continuar/);
  assert.match(checkout, /disabled=/);
  assert.match(checkout, /Turbo hasta 25 minutos/);
  assert.doesNotMatch(checkout, /Sede confirmada:|4\.900|Pagar \$/);
});
check('el checkout conserva visible la advertencia del carrito para nueva dirección', () => {
  assert.match(checkout, /role="status"/);
  assert.match(checkout, /Un producto requiere revisar disponibilidad en esta dirección\./);
});

const historyProps: React.ComponentProps<typeof OrderHistoryModal> = { isOpen: true, onClose: noop, orders: [],
  products: [], onViewOrderTracking: noop, onReorder: noop, initialTab: 'profile', onChangeAddress: noop };
const emptyProfile = renderToStaticMarkup(React.createElement(OrderHistoryModal, historyProps));
check('el apartado de direcciones del perfil ya no presenta domicilios de ejemplo', () => {
  assert.match(emptyProfile, /Turbo hasta 25 minutos/);
  assert.match(emptyProfile, /Todavía no has confirmado una dirección/);
  assert.match(emptyProfile, /Agregar dirección/);
  assert.doesNotMatch(emptyProfile, /Calle 3 #78-20|Apto 502|Carrera 79A #2-05|Zona Kennedy/);
});
const confirmedProfile = renderToStaticMarkup(React.createElement(OrderHistoryModal, { ...historyProps,
  confirmedAddress: { address: 'Destino confirmado de ensayo', details: 'Torre de ensayo' } }));
check('el perfil muestra únicamente el domicilio elegido en el dispositivo', () => {
  assert.match(confirmedProfile, /Destino confirmado de ensayo/);
  assert.match(confirmedProfile, /Torre de ensayo/);
  assert.match(confirmedProfile, /Recordada en este dispositivo/);
  assert.match(confirmedProfile, /Cambiar dirección/);
  assert.doesNotMatch(confirmedProfile, /Casa \(Predeterminada\)|Oficina \/ Trabajo/);
});
const scheduled = renderToStaticMarkup(React.createElement(ScheduledDeliveryModal, { isOpen: true,
  onClose: noop, scheduledSlots: quote.scheduledSlots, onSelectSlot: noop, address: 'Destino programado de ensayo',
  localityName: 'Kennedy', assignment: quote.scheduledAssignment }));
check('el selector Programado mantiene 25 como oferta general y la franja como entrega del pedido', () => {
  assert.match(scheduled, /Turbo hasta 25 minutos/);
  assert.match(scheduled, /Entrega Programada/);
  assert.match(scheduled, /Elige cuándo recibir tu pedido/);
  assert.ok(quote.scheduledSlots.length > 0);
  assert.ok(scheduled.includes(quote.scheduledSlots[0].displayWindow));
  assert.doesNotMatch(scheduled, /Llega en aprox\./);
});
const emptyScheduled = renderToStaticMarkup(React.createElement(ScheduledDeliveryModal, { isOpen: true,
  onClose: noop, scheduledSlots: quote.scheduledSlots, onSelectSlot: noop, assignment: quote.scheduledAssignment }));
check('el selector Programado sin dirección no presenta una sede anterior como confirmada', () => {
  assert.match(emptyScheduled, /Turbo hasta 25 minutos/);
  assert.match(emptyScheduled, /Valida tu dirección en el mapa/);
  assert.doesNotMatch(emptyScheduled, /Sede confirmada:|Sede sugerida:/);
});
const loadingTracking = renderToStaticMarkup(React.createElement(OrderTracking, { orderId: 'QA-SURFACE-NO-REQUEST', onBack: noop }));
check('el seguimiento conserva los 25 minutos mientras carga sin inventar información del pedido', () => {
  assert.match(loadingTracking, /Turbo hasta 25 minutos/);
  assert.match(loadingTracking, /Cargando seguimiento en tiempo real/);
  assert.doesNotMatch(loadingTracking, /Sede confirmada|Llega en aprox\./);
});
console.log(`ADDRESS CUSTOMER SURFACES: ${passed} comprobaciones aprobadas; componentes reales con datos de ensayo.`);
