/** Regression for the COP 490000 checkout showing an unknown shipping price despite a priced Turbo tariff. */
import React from 'react';
import assert from 'node:assert/strict';
import {renderToStaticMarkup as render} from 'react-dom/server';
import {CheckoutModal} from '../components/customer/CheckoutModal';
import {CartDrawer} from '../components/customer/CartDrawer';
import {canRequestDeliveryReview,hasConfirmedDeliveryQuote,visibleDeliveryCharges} from '../lib/checkoutReadiness';
import {evaluateDeliveryQuote} from '../lib/deliveryService';
import {fixtureConfig,fixtureDrivers,fixtureProduct} from './transportFixtures';
import {INITIAL_STORES} from '../data/seedData';
const destination={address:'Calle 3 #78-20, Kennedy',coordinates:{lat:4.6365,lng:-74.1448},municipality:'Bogotá',locality:'Kennedy'};
for(const subtotal of [59999,60000,490000]) {
 const quantity=subtotal===490000?2:1;const product=fixtureProduct('PENDING-PRICE',15000);product.price=subtotal/quantity;delete product.transport;
 const quote=evaluateDeliveryQuote({destination,items:[{productId:product.id,quantity}],requestedMode:'TURBO'},INITIAL_STORES,[product],[],{config:fixtureConfig(),drivers:fixtureDrivers,orders:[]});
 assert.equal(quote.reasonCode,'TRANSPORT_DATA_PENDING');assert.equal(quote.charges?.mode,'TURBO');quote.reviewRequestToken='isolated-fixture';
 assert.ok(canRequestDeliveryReview(quote));assert.equal(hasConfirmedDeliveryQuote(quote),false);assert.equal(quote.transportPlan?.feasible,false);
 assert.equal(visibleDeliveryCharges(quote,subtotal)?.shipping,subtotal<60000?10000:0);
 const props={cartItems:[{product,quantity}],currentStore:INITIAL_STORES[0],isOpen:true,onClose:()=>{},deliveryQuote:quote};
 const checkout=render(<CheckoutModal {...props} selectedMode="TURBO" customerAddress={destination.address} customerCoordinates={destination.coordinates} onOrderSuccess={()=>{}}/>);
 const cart=render(<CartDrawer {...props} onUpdateQuantity={()=>{}} onClearCart={()=>{}} onProceedToCheckout={()=>{}}/>);
 for(const html of [checkout,cart])assert.equal(html.includes('Envío gratis'),subtotal>=60000);
 assert.match(checkout,/Enviar solicitud sin cobro/);assert.ok(!checkout.includes('Método de Pago'));assert.ok(!checkout.includes('~25'));assert.ok(checkout.includes('Por confirmar'),'Final delivery still needs acceptance');
 assert.equal(visibleDeliveryCharges(quote,subtotal+1),undefined,'Stale subtotal cannot show a previous tariff');
 assert.equal(visibleDeliveryCharges({...quote,reviewRequestToken:undefined},subtotal),undefined);
 assert.equal(visibleDeliveryCharges({...quote,charges:undefined},subtotal),undefined);
 // Never label an authoritative scheduled tariff as Turbo because of an old client choice.
 const scheduled={...quote,charges:{...quote.charges!,mode:'PROGRAMADO' as const,shipping:4900}};
 const scheduledHtml=render(<CheckoutModal {...props} deliveryQuote={scheduled} selectedMode="TURBO" onOrderSuccess={()=>{}}/>);
 assert.match(scheduledHtml,/Envío \(Programado\)/);assert.ok(!scheduledHtml.includes('Envío (Turbo)'));assert.ok(!scheduledHtml.includes('Envío gratis'));
 console.log('PASS pending checkout/cart subtotal',subtotal,'priced shipping displayed, delivery stays unconfirmed');
}
