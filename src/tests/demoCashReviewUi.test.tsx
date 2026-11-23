import assert from 'node:assert/strict';
import { renderToStaticMarkup as render } from 'react-dom/server';
import { CheckoutModal } from '../components/customer/CheckoutModal';
import { OrderConfirmation } from '../components/customer/OrderConfirmation';
import { INITIAL_STORES } from '../data/seedData';
import { getCheckoutPreviewOrder } from '../lib/checkoutPreview';
import { cashReviewContext, cashReviewProduct, cashReviewStores } from '../lib/demoCashReview';
import { evaluateDeliveryQuote } from '../lib/deliveryService';
import { enrichDestination } from '../lib/serverGeography';
import { formatCOP } from '../lib/formatters';
import { saleVariant } from '../lib/variantCommerce';
import { fixtureConfig } from './transportFixtures';

const product = cashReviewProduct();
const cart = [{ product: saleVariant(product, product.id), quantity: 1 }];
const items = [{ productId: product.id, quantity: 1 }];
const stores = cashReviewStores(INITIAL_STORES);
assert.equal(stores.length, 3);
const transport = cashReviewContext(INITIAL_STORES, { config: fixtureConfig(), orders: [], drivers: [] });
for (const store of stores) {
  for (const mode of ['TURBO','PROGRAMADO'] as const) {
    const request = { destination: enrichDestination(store.destination), items, requestedMode: mode };
    let quote = evaluateDeliveryQuote(request, INITIAL_STORES, [product], [], transport);
    const slot = mode === 'PROGRAMADO' ? quote.scheduledSlots.find(s => !s.cutoffPassed && s.availableCapacity > 0) : undefined;
    if (mode === 'PROGRAMADO') {
      assert.ok(slot, store.id + ' debe contar con una franja de prueba.');
      quote = evaluateDeliveryQuote({...request, scheduledWindow: slot}, INITIAL_STORES, [product], [], transport);
    }
    assert.equal(quote.assignedStoreId, store.id);
    assert.equal(quote.recommendedMode, mode);
    assert.ok(quote.basketValidated);
    const props = { isOpen: true, onClose() {}, currentStore: null, cartItems: cart, deliveryQuote: quote,
      customerAddress: store.destination.address, customerCoordinates: store.destination.coordinates,
      onOrderSuccess() {}, selectedMode: mode, selectedScheduledWindow: slot };
    const view = render(<CheckoutModal {...props} demoCashReview />);
    assert.ok(view.includes('Recaudo $0') && view.includes('Total de prueba:'));
    assert.ok(view.includes('checkout@rdi.invalid') && view.includes(store.destination.address));
    assert.ok(view.includes('Efectivo contra entrega') && view.includes('PSE') && view.includes('No disponible'));
    assert.ok(view.includes('Entrega Turbo') && view.includes('Envío Programado'));
    const regular = render(<CheckoutModal {...props} />);
    assert.ok(!regular.includes('checkout@rdi.invalid') && !regular.includes('Recaudo $0'));
    const order = getCheckoutPreviewOrder('confirmado');
    const receipt = render(<OrderConfirmation order={{...order, storeName: store.name, demoCustomerCheckout: true,
      deliveryMode: mode, scheduledWindow: slot, payment: {...order.payment, cashToCollect: 0}}} onContinue={() => {}} onTrack={() => {}} />);
    assert.ok(receipt.includes(store.name) && receipt.includes('Total a cobrar: ' + formatCOP(0)));
    console.log('PASS', store.id, mode, 'checkout en efectivo y comprobante de simulación');
  }
}
