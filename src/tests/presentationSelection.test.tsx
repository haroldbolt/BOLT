import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import type {Product} from '../types';
import type {DeliveryQuote} from '../lib/deliveryService';
import {selectedPresentation, presentationLabel, presentationAvailability, prospectiveItems} from '../lib/presentationSelection';
import {PresentationProvider} from '../components/customer/PresentationContext';
import {ProductCard} from '../components/customer/ProductCard';

// Isolated fixtures. No catalog, inventory, orders or Shopify writes.
const product={id:'fixture-product',name:'Fixture alimento',price:30000,sku:'P',image:'/parent.jpg',presentation:'3 kg',weightKg:3,stockByStore:{A:8},reservedStockByStore:{A:2},presentaciones:[
  {varianteId:'fixture-v1',nombre:'3 kg / Pollo',sku:'POLLO',price:30000,foto:'/pollo.jpg',stockByStore:{A:8},reservedStockByStore:{A:2},bodegaIds:['A']},
  {varianteId:'fixture-v2',nombre:'3 kg / Salmón',sku:'SALMON',price:45000,foto:'/salmon.jpg',stockByStore:{A:2,B:0},reservedStockByStore:{A:1},bodegaIds:['A','B']},
  {varianteId:'fixture-v3',nombre:'8 kg',sku:'EIGHT',price:0,foto:'',stockByStore:{A:6},reservedStockByStore:{},bodegaIds:['A']},
]} as unknown as Product;
const quote={assignedStoreId:'A',basketValidated:true,recommendedMode:'PROGRAMADO',availableModes:{turbo:false,turboDividido:false,scheduled:true},eligibilityStatus:'SCHEDULED_ONLY',message:'Programado',reasonCode:'SCHEDULED'} as DeliveryQuote;
let passed=0;const check=(name:string,fn:()=>void)=>{fn();passed++;console.log('PASS',name);};
const a=selectedPresentation(product,'fixture-v1')!, b=selectedPresentation(product,'fixture-v2')!;
check('Una presentación se selecciona automáticamente sin cambiar su ID',()=>assert.equal(selectedPresentation({...product,presentaciones:[product.presentaciones![0]]})!.variantId,'fixture-v1'));
check('Varias presentaciones: ninguna seleccionada inicialmente; ID inválido no cae a la primera',()=>{assert.equal(selectedPresentation(product),null);assert.equal(selectedPresentation(product,'invalid'),null);});
check('Selección conserva ID contractual, SKU, presentación, precio, imagen y stock propios',()=>{assert.equal(a.id,'fixture-product');assert.equal(b.id,'fixture-v2');assert.equal(b.sku,'SALMON');assert.equal(b.presentation,'3 kg / Salmón');assert.equal(b.price,45000);assert.equal(b.image,'/salmon.jpg');assert.equal(b.stockByStore.A,2);});
check('Igual peso con atributos diferentes mantiene ambas opciones',()=>{assert.equal(presentationLabel(product,'fixture-v1'),'3 kg / Pollo');assert.equal(presentationLabel(product,'fixture-v2'),'3 kg / Salmón');});
check('Nombres idénticos distinguidos por SKU o referencia estable',()=>{const p={...product,presentaciones:product.presentaciones!.map(v=>({...v,nombre:'3 kg'}))};assert.match(presentationLabel(p,'fixture-v2'),/SKU SALMON/);p.presentaciones.forEach(v=>v.sku='');assert.match(presentationLabel(p,'fixture-v2'),/Ref. fixture-v2/);});
check('Reservas descontadas y modalidad confirmada por servidor',()=>{assert.deepEqual(presentationAvailability(b,quote,false,true),{canAdd:true,message:'Disponible para Programado',available:1});});
check('Agotada en bodega aplicable, aun con stock en otra',()=>{const state=presentationAvailability(b,{...quote,assignedStoreId:'B'},false,true);assert.equal(state.canAdd,false);assert.equal(state.message,'Agotado en esta sede');});
check('Precio ausente/ilegible/cero conserva bloqueo, no muestra agotado',()=>{for(const price of [0,NaN,-1,undefined]){const state=presentationAvailability({...b,price} as Product,quote,false,true);assert.equal(state.canAdd,false);assert.equal(state.message,'Precio pendiente de confirmar');}});
check('Sin dirección, sede o respuesta: estado pendiente o reintento, nunca stock inventado',()=>{assert.match(presentationAvailability(b,null,true,false).message,/pendiente/);assert.match(presentationAvailability(b,null,true,true).message,/Verificando/);assert.match(presentationAvailability(b,null,false,true).message,/Reintenta/);assert.equal(presentationAvailability(b,{...quote,assignedStoreId:undefined,message:''},false,true).message,'Sede pendiente de confirmar');});
check('Respuesta operativa rechazada no conserva Turbo antiguo',()=>{const state=presentationAvailability(b,{...quote,recommendedMode:null,availableModes:{turbo:true,turboDividido:false,scheduled:false},message:'Franja sin cupo'},false,true);assert.equal(state.canAdd,false);assert.equal(state.message,'Franja sin cupo');});
check('Cambio de presentación no modifica líneas existentes y suma al ID exacto',()=>{const items=[{productId:a.id,quantity:1}];const second=prospectiveItems(items,b);assert.equal(second.length,2);assert.deepEqual(items,[{productId:a.id,quantity:1}]);assert.deepEqual(prospectiveItems(second,b),[{productId:a.id,quantity:1},{productId:b.id,quantity:2}]);});
check('Tarjeta accesible sin contador genérico ni precio agrupado como selección',()=>{const html=renderToStaticMarkup(<PresentationProvider quantities={{}} request={{destination:{address:'Fixture',coordinates:{lat:4,lng:-74}}}}><ProductCard product={product} quantityInCart={0} onAddToCart={()=>{}} onUpdateQuantity={()=>{}} isFavorite={false} onToggleFavorite={()=>{}} onOpenDetails={()=>{}} selectedStoreId="A" /></PresentationProvider>);assert.equal((html.match(/type="radio"/g)||[]).length,3);assert.match(html,/Selecciona una presentación/);assert.match(html,/3 kg \/ Pollo/);assert.match(html,/3 kg \/ Salmón/);assert.ok(!html.includes('3 variantes'));assert.ok(!html.includes('checked=""'));});
console.log(`${passed} presentation checks passed`);
