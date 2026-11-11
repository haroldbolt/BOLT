/** Explicitly fictitious product/fleet fixtures; never writes the operational catalog. */
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup as render} from 'react-dom/server';
import {fixtureConfig,fixtureDrivers,fixtureProduct,fixtureExternalProvider} from './transportFixtures';
import {INITIAL_STORES} from '../data/seedData';
import {evaluateDeliveryQuote} from '../lib/deliveryService';
import {validateTransportConfig} from '../lib/transportPlanner';
import {BenefitProgressBar} from '../components/customer/BenefitProgressBar';
import {CartDrawer} from '../components/customer/CartDrawer';
const destination={address:'Calle 3 #78-20, Kennedy',coordinates:{lat:4.6365,lng:-74.1448},municipality:'Bogotá',locality:'Kennedy'};
for(const [subtotal,shipping] of [[59999,10000],[60000,0],[60001,0]]) {
 const product=fixtureProduct('TARIFF-FIXTURE',1000);product.price=subtotal;
 const config=fixtureConfig();const quote=evaluateDeliveryQuote({destination,items:[{productId:product.id,quantity:1}],requestedMode:'TURBO'},INITIAL_STORES,[product],[],{config,drivers:fixtureDrivers,orders:[]});
 assert.equal(quote.recommendedMode,'TURBO');assert.equal(quote.charges?.shipping,shipping);assert.equal(quote.charges?.serviceFee,0);assert.equal(quote.charges?.total,subtotal+shipping);assert.equal(quote.charges?.freeShippingFrom,60000);
 quote.confirmationToken='fixture';const html=render(<CartDrawer cartItems={[{product,quantity:1}]} currentStore={INITIAL_STORES[0]} isOpen onClose={()=>{}} onUpdateQuantity={()=>{}} onClearCart={()=>{}} onProceedToCheckout={()=>{}} deliveryQuote={quote}/>);
 assert.match(html,/Tarifa de servicio:/);assert.equal(html.split('¡GRATIS!').length-1,1);assert.equal(html.includes('Envío gratis'),shipping===0);
 console.log('PASS Turbo subtotal',subtotal,'shipping',shipping,'service 0');
}
const product=fixtureProduct('SPLIT-TARIFF',20000);product.price=20000;const config=fixtureConfig();
let quote=evaluateDeliveryQuote({destination,items:[{productId:product.id,quantity:3}],requestedMode:'TURBO'},INITIAL_STORES,[product],[],{config,drivers:fixtureDrivers,orders:[]});
assert.equal(quote.transportPlan?.shipments.length,2);assert.equal(quote.charges?.shipping,0);assert.equal(quote.charges?.total,60000);
product.price=19999;quote=evaluateDeliveryQuote({destination,items:[{productId:product.id,quantity:3}],requestedMode:'TURBO'},INITIAL_STORES,[product],[],{config,drivers:fixtureDrivers,orders:[]});assert.equal(quote.charges?.shipping,10000);assert.equal(quote.charges?.total,69997);
// A fallback to Programado must recalculate the approved scheduled tariff, not retain Turbo's threshold.
product.price=60000;const scheduled={...config,vehicles:config.vehicles.map(v=>({...v,modes:['PROGRAMADO'] as ('PROGRAMADO')[]}))};
quote=evaluateDeliveryQuote({destination,items:[{productId:product.id,quantity:1}],requestedMode:'TURBO'},INITIAL_STORES,[product],[],{config:scheduled,drivers:fixtureDrivers,orders:[]});
assert.equal(quote.recommendedMode,'PROGRAMADO');assert.equal(quote.charges?.shipping,4900);assert.equal(quote.charges?.freeShippingFrom,70000);assert.equal(quote.charges?.serviceFee,0);
const external=fixtureConfig();external.vehicles=[];external.externalProviders=[fixtureExternalProvider()];
quote=evaluateDeliveryQuote({destination,items:[{productId:product.id,quantity:1}],requestedMode:'TURBO'},INITIAL_STORES,[product],[],{config:external,drivers:fixtureDrivers,orders:[]});
assert.equal(quote.charges?.shipping,0);assert.equal(quote.transportPlan?.shipments[0].vehicle.externalOffer?.shippingCOP,8000);
for(const value of [-1,NaN,1.5]) {const bad=fixtureConfig();bad.pricing.turbo!.shipping=value;assert.throws(()=>validateTransportConfig(bad,fixtureDrivers,INITIAL_STORES.map(s=>s.id)));}
assert.ok(!render(<BenefitProgressBar subtotal={60000} threshold={60000}/>).includes('Agrega'));
console.log('PASS split tariff once, external costs retained, scheduled fallback, invalid tariff rejected, benefit threshold.');
