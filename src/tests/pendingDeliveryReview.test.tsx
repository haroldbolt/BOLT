import {PushNotificationService} from '../lib/notifications';
import {makeWarehouseAssignment} from '../lib/warehouseAssignment';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup as render} from 'react-dom/server';
import {CartDrawer} from '../components/customer/CartDrawer';
import {CheckoutModal} from '../components/customer/CheckoutModal';
import {PendingDeliveryReceipt} from '../components/customer/PendingDeliveryReceipt';
import {OrderConfirmation} from '../components/customer/OrderConfirmation';
import {OrderDeliveryTime} from '../components/customer/OrderDeliveryTime';
import type {CustomerTrackingTiming} from '../types/customerTracking';
import {formatCOP} from '../lib/formatters';
import {getCheckoutPreviewOrder} from '../lib/checkoutPreview';
import {fixtureProduct,fixtureConfig,fixtureDrivers} from './transportFixtures';
import {INITIAL_STORES} from '../data/seedData';
import {evaluateDeliveryQuote} from '../lib/deliveryService';
import {REVIEW_MESSAGE} from '../lib/checkoutReadiness';
import {pendingDeliveryOrder} from '../lib/pendingDeliveryOrder';
const product=fixtureProduct('REVIEW-15KG',15000);delete product.transport;
const destination={address:'Calle 3 #78-20, Kennedy',coordinates:{lat:4.6365,lng:-74.1448},municipality:'Bogotá',locality:'Kennedy'};
const quote=evaluateDeliveryQuote({destination,items:[{productId:product.id,quantity:2}]},INITIAL_STORES,[product],[],{config:fixtureConfig(),drivers:fixtureDrivers,orders:[]});
assert.equal(quote.reasonCode,'TRANSPORT_DATA_PENDING');assert.equal(quote.transportPlan?.feasible,false);quote.reviewRequestToken='isolated-receipt-token';quote.message=REVIEW_MESSAGE;
const props={cartItems:[{product,quantity:2}],currentStore:INITIAL_STORES[0],isOpen:true,onClose:()=>{},deliveryQuote:quote};
const cart=render(<CartDrawer {...props} onUpdateQuantity={()=>{}} onClearCart={()=>{}} onProceedToCheckout={()=>{}}/>);
assert.equal(cart.split(REVIEW_MESSAGE).length-1,1);assert.ok(!cart.includes('Faltan peso'));assert.equal(cart.split('¡GRATIS!').length-1,1,'Only service is free; transport remains unconfirmed');assert.match(cart,/>Continuar con el pedido</);assert.ok(!/<button[^>]* disabled=""[^>]*>[^]*?Continuar con el pedido/.test(cart));
const checkout=render(<CheckoutModal {...props} customerAddress={destination.address} customerCoordinates={destination.coordinates} onOrderSuccess={()=>{}}/>);
assert.equal(checkout.split(REVIEW_MESSAGE).length-1,1);assert.match(checkout,/Enviar solicitud sin cobro/);assert.doesNotMatch(checkout,/name="paymentMethod"/);assert.ok(!checkout.includes('Faltan peso'));assert.ok(!checkout.includes('~25'));assert.equal(checkout.split('¡GRATIS!').length-1,1,'Only service is free');
const receipt=pendingDeliveryOrder({items:[{productId:product.id,quantity:2,price:product.price,name:product.name,presentation:product.presentation,sku:product.sku,brand:product.brand,image:product.image,weightKg:15,requiresPrescription:false}],customer:{name:'Fixture',phone:'0000000000',email:'fixture@example.invalid',isGuest:true},address:{...destination,details:'',porteriaPolicy:'DEJAR_EN_PORTERIA'},store:INITIAL_STORES[0],creationRequestId:'fixture',creationRequestFingerprint:'fixture'});
assert.equal(receipt.fulfillmentStatus,'PENDIENTE_CONFIRMACION');assert.equal(receipt.payment.status,'PENDIENTE');assert.equal(receipt.payment.cashToCollect,0);assert.equal(receipt.deliveryMode,undefined);assert.equal(receipt.transportLoad,undefined);assert.equal(receipt.childShipments,undefined);
const html=render(<PendingDeliveryReceipt order={receipt} onBack={()=>{}} onRefresh={()=>{}} onCancel={()=>{}} cancelling={false} error={null}/>);assert.ok(!html.includes(receipt.secretDeliveryCode));assert.match(html,/Solicitud recibida/);assert.ok(!html.includes('0 kg'));
console.log('PASS pending review UI: one notice, continue enabled, request without payment/ETA, private receipt without PIN or invented capacity.');

const actions={onTrack:()=>{},onContinue:()=>{}};
const pendingSummary=render(<OrderConfirmation order={receipt} {...actions}/>);
assert.match(pendingSummary,/Recibimos tu pedido/);
assert.match(pendingSummary,/Subtotal de productos/);
assert.match(pendingSummary,/Total final.*Por confirmar/);
assert.match(pendingSummary,/Sin cobro por ahora/);
assert.match(pendingSummary,/Ver mi pedido/);
assert.doesNotMatch(pendingSummary,/Pedido confirmado|Entrega programada|Tiempo estimado|Gratis/);

const confirmedSummary=render(<OrderConfirmation order={getCheckoutPreviewOrder('confirmado')} {...actions}/>);
assert.match(confirmedSummary,/Pedido confirmado/);
assert.match(confirmedSummary,/Total del pedido/);
assert.match(confirmedSummary,/Entrega programada/);
assert.match(confirmedSummary,/Pendiente · Pago contra entrega/);
assert.doesNotMatch(confirmedSummary,/Costo y horario por confirmar/);
console.log('PASS post-checkout receipt distinguishes confirmed delivery with cash on delivery from an uncharged request.');

const simulatedOrder=getCheckoutPreviewOrder('confirmado');
const simulatedSummary=render(<OrderConfirmation order={{...simulatedOrder,demoCustomerCheckout:true,payment:{...simulatedOrder.payment,cashToCollect:0}}} {...actions}/>);
assert.match(simulatedSummary,/Pedido de prueba sin cobro/);
assert.match(simulatedSummary,/Total de prueba/);
assert.ok(simulatedSummary.includes(`Total a cobrar: ${formatCOP(0)}`));
assert.match(simulatedSummary,/Ver mi pedido/);
assert.doesNotMatch(simulatedSummary,/Pago contra entrega/);
console.log('PASS simulated checkout receipt shows the actual zero collection separately from the simulated order total.');

const notifications=new PushNotificationService({getItem:()=>null,setItem:()=>{}});receipt.warehouseAssignment=makeWarehouseAssignment(receipt.id,INITIAL_STORES[0]);assert.equal(notifications.notifyWarehouseAssignment(receipt),null);receipt.deliveryReview!.status='CONFIRMED';assert.ok(notifications.notifyWarehouseAssignment(receipt));

const readyAt = '2026-11-25T16:30:00.000Z';
const now = Date.parse(readyAt) + 60_000;
const timing: CustomerTrackingTiming = {
  serverTime: new Date(now).toISOString(), startedAt: readyAt,
  dueAt: new Date(Date.parse(readyAt) + 25 * 60_000).toISOString(), source: 'VERIFIED_QUOTE',
  stages: { confirmedAt: '2026-11-25T16:00:00.000Z', prepStartedAt: '2026-11-25T16:05:00.000Z',
    prepCompletedAt: readyAt, assignedAt: null, pickedUpAt: null, deliveredAt: null, cancelledAt: null },
};
for (const status of ['CONFIRMADO', 'EN_ALISTAMIENTO'] as const) {
  const waiting = render(<OrderDeliveryTime mode="TURBO" status={status} timing={timing} now={now} />);
  assert.match(waiting, /cuando la sede marque tu pedido como listo/);
  assert.doesNotMatch(waiting, /<time\b|\d+:\d+/);
}
for (const mode of ['TURBO','TURBO_DIVIDIDO'] as const) {
  const running = render(<OrderDeliveryTime mode={mode} status="LISTO_PARA_DESPACHO" timing={timing} now={now} />);
  assert.match(running, /<time\b[^>]*>24:00<\/time>/);
}
for (const status of ['CANCELADO', 'ENTREGADO'] as const) {
  const stop = new Date(Date.parse(readyAt) + 30_000).toISOString();
  const stopped = { ...timing, stages: { ...timing.stages, [status === 'ENTREGADO' ? 'deliveredAt' : 'cancelledAt']: stop } };
  const finished = render(<OrderDeliveryTime mode="TURBO" status={status} timing={stopped} now={now} />);
  assert.doesNotMatch(finished, /<time\b|Tiempo estimado restante/);
  assert.match(finished, /00:30/);
}
const turboSummary = render(<OrderConfirmation order={{...simulatedOrder, deliveryMode:'TURBO', fulfillmentStatus:'EN_ALISTAMIENTO'}} {...actions} />);
assert.match(turboSummary, /cuando la sede marque tu pedido como listo/);
assert.doesNotMatch(turboSummary, /Tiempo estimado:|\d+ min/);
const scheduledTime = render(<OrderDeliveryTime mode="PROGRAMADO" status="LISTO_PARA_DESPACHO"
  timing={{...timing,source:'BOOKED_WINDOW'}} scheduledWindow={simulatedOrder.scheduledWindow} now={now} />);
assert.match(scheduledTime, /Entrega programada/);
assert.doesNotMatch(scheduledTime, /Tiempo Turbo|<time\b/);
console.log('PASS tracking UI waits for readiness, renders Turbo countdown only while active and keeps scheduled windows.');
