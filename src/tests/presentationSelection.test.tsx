import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import type {Product} from '../types';
import type {DeliveryQuote} from '../lib/deliveryService';
import {selectedPresentation, presentationLabel, presentationAvailability, prospectiveItems} from '../lib/presentationSelection';
import {PresentationProvider} from '../components/customer/PresentationContext';
import {ProductCard} from '../components/customer/ProductCard';
import {presentationChip, productDescription} from '../lib/presentationDisplay';
import verifiedPresentations from '../data/verifiedPresentations.json';

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
check('Tarjeta accesible sin contador genérico ni precio agrupado como selección',()=>{const html=renderToStaticMarkup(<PresentationProvider quantities={{}} request={{destination:{address:'Fixture',coordinates:{lat:4,lng:-74}}}}><ProductCard product={product} quantityInCart={0} onAddToCart={()=>{}} onUpdateQuantity={()=>{}} isFavorite={false} onToggleFavorite={()=>{}} onOpenDetails={()=>{}} selectedStoreId="A" /></PresentationProvider>);assert.equal((html.match(/type="radio"/g)||[]).length,3);assert.match(html,/Selecciona una presentación/);assert.match(html,/3 kg, Pollo/);assert.match(html,/3 kg, Salmón/);assert.ok(!html.includes('3 variantes'));assert.ok(!html.includes('checked=""'));});
check('Chips muestran cantidades reales sin nombres de empaques ni conversión de unidades',()=>{
  for(const [raw,expected] of [
    ['Bulto 15 Kg','15 kg'],['Bolsa 3 Kg','3 kg'],['Frasco gotero 15 ml','15 ml'],
    ['Caja x 1 Tableta Masticable','1 u'],['Paquete x 100 Toallitas','100 u'],
    ['Caja x 30 Sobres de 1 g','30 × 1 g'],['Pack x 4 Tubos (56 g)','4 u (56 g)'],
    ['Caja x 1 Comprimido (3 Meses)','1 u'],['3,6 mg x 10 tabletas','3,6 mg × 10 u'],
    ['25 x 6,5 x 7,5 cm','25 × 6,5 × 7,5 cm'],['7.5-15 Kg','7.5–15 kg'],
    ['Talla M Ajustable (10 a 22 Kg)','M (10–22 kg)'],['Caja','Cantidad por confirmar'],
  ])assert.equal(presentationChip({...product,presentaciones:[],presentation:raw}).label,expected);
});
check('Cantidades iguales conservan atributos diferenciadores sin modificar el catálogo',()=>{
  const snapshot=JSON.stringify(product);
  assert.deepEqual(presentationChip(product,'fixture-v1'),{label:'3 kg',detail:'Pollo'});
  assert.deepEqual(presentationChip(product,'fixture-v2'),{label:'3 kg',detail:'Salmón'});
  const same={...product,presentaciones:product.presentaciones!.map(v=>({...v,nombre:'Bolsa 3 kg'}))};
  assert.deepEqual(presentationChip(same,'fixture-v2'),{label:'3 kg',detail:'SKU SALMON'});
  const flavor={...product,presentaciones:product.presentaciones!.map(v=>v.varianteId==='fixture-v1'?{...v,nombre:'3 kg / Mix'}:v)};
  assert.deepEqual(presentationChip(flavor,'fixture-v1'),{label:'3 kg',detail:'Mix'});
  assert.equal(JSON.stringify(product),snapshot);
});
check('Los datos legibles ya registrados se reconocen sin inventar cantidades',()=>{
  const fixtures = [
    ['60 Capsulas','60 cápsulas'],['1 unidad','1 u'],['30 sob','30 u'],['50 W','50 W'],
    ['3 Onzas','3 oz'],['7"','7 in'],['Pelo Largo','Pelo largo'],
    ['Disfraz para Perro la sirenita A&B talla S','S'],
    ['0 / 0','Cantidad por confirmar'],['0 kg','Cantidad por confirmar'],['Default Title','Cantidad por confirmar'],
  ];
  for(const [raw,expected] of fixtures){
    assert.equal(presentationChip({...product,presentaciones:[],presentation:raw}).label,expected);
  }
  assert.equal(presentationChip({...product,category:'Accesorios',presentaciones:[],presentation:'Único'}).label,'Presentación única');
  assert.equal(presentationChip({...product,category:'Farmacia',presentaciones:[],presentation:'Único'}).label,'Cantidad por confirmar');
  const incomplete={...product,presentaciones:product.presentaciones!.map((v,index)=>index===1?{...v,nombre:''}:v)};
  assert.equal(presentationChip(incomplete,'fixture-v2').label,'Cantidad por confirmar');
});
check('Revolution muestra el contenido verificado en la ficha y conserva los datos de venta',()=>{
  const variantId='gid://shopify/ProductVariant/49200712810776';
  const correction=verifiedPresentations[variantId];
  const variant={...product.presentaciones![0],varianteId:variantId,nombre:'Default Title'};
  const revolution={...product,id:correction.productId,description:correction.description.before,presentaciones:[variant]};
  const chip=presentationChip(revolution,variantId);
  const selected=selectedPresentation(revolution,variantId);
  assert.equal(chip.label,'1 pipeta de 0,25 ml');
  assert.equal(selected?.presentation,chip.label);
  assert.equal(selected?.sku,variant.sku);
  assert.equal(selected?.price,variant.price);
  assert.equal(selected?.image,variant.foto);
  assert.deepEqual(selected?.stockByStore,variant.stockByStore);
  assert.match(productDescription(revolution),/0,25 ml/);
  assert.equal(productDescription({...revolution,description:'Descripción editada'}),'Descripción editada');
  const edited={...revolution,presentaciones:[{...variant,nombre:'2 unidades'}]};
  assert.equal(presentationChip(edited,variantId).label,'2 u');
  assert.equal(presentationChip({...revolution,id:'another-product'},variantId).label,'Cantidad por confirmar');
});
console.log(`${passed} presentation checks passed`);
