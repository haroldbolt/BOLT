import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import source from '../data/brandDirectory.json';
import {catalogBrands, customerCatalog, matchesBrand, CATALOG_SECTIONS} from '../lib/brandDirectory';
import {BrandsView, BrandButton} from '../components/customer/BrandsView';
import {INITIAL_PRODUCTS} from '../data/seedData';
import type {Product, Store} from '../types';

let checks=0;
function test(name:string, fn:()=>void) {fn();checks++;console.log('PASS',name);}
const product=(id:string,brand:string,patch:Partial<Product>={}):Product=>({...structuredClone(INITIAL_PRODUCTS[0]),id,brand,status:'ACTIVE',bodegaIds:['HUB_SUBA'],...patch});
const suba={id:'HUB_SUBA'} as Store;
const acana=source.entries.find(e=>e.name==='ACANA')!;
test('Todo, Marcas; navegación separada de la categoría comercial Alimentos',()=>{
  assert.deepEqual(CATALOG_SECTIONS.slice(0,2),['Todo','Marcas']);assert.ok(!CATALOG_SECTIONS.includes('Alimentos'));
});
test('manifiesto verificable, IDs únicos y logos de la tienda Shopify',()=>{
  assert.equal(new Set(source.entries.map(e=>e.id)).size,source.entries.length);
  for(const entry of source.entries) {assert.equal(new URL(entry.source).hostname,'cultivacenter.com');if(entry.image)assert.equal(new URL(entry.image).hostname,'cultivacenter.com');}
  assert.ok(acana.image);assert.equal(source.entries.find(e=>e.name==='Adore')!.image,null);
});
test('vendor exacto normalizado; no coincide por nombre del producto ni por subcadena',()=>{
  assert.ok(matchesBrand(product('1','  ÁCANA  '),acana));assert.ok(!matchesBrand(product('2','Otra marca',{name:'ACANA alimento'}),acana));
  assert.ok(!matchesBrand(product('3','Acana diferente'),acana));
});
test('alias de vendor y filtros de etiquetas usan la referencia de Shopify',()=>{
  const alias=source.entries.find(e=>e.name==='Whole Bark')!;
  assert.ok(matchesBrand(product('4',alias.match.vendor!),alias));
  const tags={match:{tags:['Casa Holliday','Alimentos']}};
  assert.ok(matchesBrand(product('5','Holliday',{tags:['CASA HOLLIDAY','Alimentos']}),tags));
  assert.ok(!matchesBrand(product('6','Holliday',{tags:['Casa Holliday']}),tags));
});
test('inactivos y asociaciones de otra sede quedan fuera; no se pierden datos originales',()=>{
  const records=[product('active','Acana'),product('inactive','Simulación',{status:'INACTIVE'}),product('elsewhere','Acana',{bodegaIds:['HUB_KENNEDY']}),product('unlinked','Acana',{bodegaIds:[]})];
  const before=structuredClone(records);assert.deepEqual(customerCatalog(records,suba).map(p=>p.id),['active']);
  assert.equal(catalogBrands(records,suba).find(e=>e.name==='ACANA')!.count,1);assert.deepEqual(records,before);
});
test('marca real sin logo de Shopify conserva acceso textual y conteo',()=>{
  const entries=catalogBrands([product('1','Marca Nueva'),product('2','Marca Nueva')],suba);
  assert.equal(entries.length,1);assert.equal(entries[0].count,2);assert.equal(entries[0].image,null);
  const html=renderToStaticMarkup(<BrandButton entry={entries[0]} onSelect={()=>{}}/>);
  assert.match(html,/Ver productos de Marca Nueva/);assert.ok(!html.includes('<img'));
});
test('directorio muestra logos completos, botones accesibles y carga progresiva',()=>{
  const html=renderToStaticMarkup(<BrandsView entries={catalogBrands([product('1','Acana')])} onSelect={()=>{}}/>);
  for(const expected of ['Logo de ACANA','object-contain','loading="lazy"','type="button"','Busca tu marca','grid-cols-2','lg:grid-cols-5'])assert.ok(html.includes(expected),expected);
});
console.log(`${checks} brand checks passed`);
