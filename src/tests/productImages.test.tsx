import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {ProductImage} from '../components/common/ProductImage';
import {CategoryCollageCard} from '../components/customer/CategoryCollageCard';
import {categoryImageCandidates,usableProductImage} from '../lib/productImages';
import {imageMetadataPatch,CatalogImagePatch} from '../lib/catalogImagePatch';
import {saleVariant} from '../lib/variantCommerce';
import {INITIAL_PRODUCTS} from '../data/seedData';
const photo='https://cdn.shopify.com/verified.png';
const product={...structuredClone(INITIAL_PRODUCTS[0]),id:'test-image',image:photo,status:'ACTIVE',gallery:[photo],presentaciones:[{varianteId:'test-v1',sku:'a',nombre:'15 kg',foto:photo,bodegaIds:['HUB_SUBA']},{varianteId:'test-v2',sku:'b',nombre:'3 kg',foto:photo,bodegaIds:['HUB_SUBA']}]};
let checks=0;function test(label:string,fn:()=>void){fn();checks++;console.log('PASS',label)}
test('sin foto y foto genérica: marcador accesible sin img ni fallback remoto',()=>{
 for(const src of ['',undefined,'https://images.unsplash.com/a','javascript:alert(1)']){const html=renderToStaticMarkup(<ProductImage src={src} alt="Producto"/>);assert.match(html,/Imagen por confirmar/);assert.ok(!html.includes('<img'));}
});
test('foto conserva empaque completo',()=>assert.match(renderToStaticMarkup(<ProductImage src={photo} className="object-cover"/>),/object-contain/));
test('categorías: activos, categoría correcta y URL únicas; no repite para completar',()=>{
 const list=[product,{...product,id:'duplicate'}, {...product,id:'archived',status:'ARCHIVED',image:'https://cdn.shopify.com/archived.png'},{...product,id:'wrong-category',category:'Snacks' as const},{...product,id:'empty',image:'',gallery:[]}];
 assert.equal(categoryImageCandidates(list,'Alimentos').length,1);
 const html=renderToStaticMarkup(<CategoryCollageCard title="Alimentos" category="Alimentos" products={list} count={99} onSelectCategory={()=>{}}/>);
 assert.equal((html.match(/<img/g)||[]).length,1);assert.match(html,/3 productos/);assert.match(html,/type="button"/);
});
test('categoría sin fotos mantiene acceso y conteo con icono neutro',()=>{const html=renderToStaticMarkup(<CategoryCollageCard title="Alimentos" category="Alimentos" products={[{...product,image:'',gallery:[]}]} count={1} onSelectCategory={()=>{}}/>);assert.match(html,/Explorar productos/);assert.match(html,/1 producto/);assert.ok(!html.includes('<img'));});
const patch:CatalogImagePatch={productId:product.id,variants:[{variantId:'test-v2',before:photo,after:''}],source:'fixture:photo-audit',checkedAt:new Date().toISOString(),reason:'Empaque de otra presentación'};
test('variante pendiente no hereda foto de otra presentación',()=>{const next={...product,...imageMetadataPatch(product,patch)};assert.equal(saleVariant(next,'test-v2').image,'');assert.equal(saleVariant(next,'test-v1').image,photo);});
test('no acepta cambios comerciales, URLs inseguras ni variantes ajenas',()=>{
 assert.throws(()=>imageMetadataPatch(product,{...patch,price:1} as any));
 assert.throws(()=>imageMetadataPatch(product,{...patch,image:{before:photo,after:'data:text/html,test'}}));
 assert.throws(()=>imageMetadataPatch(product,{...patch,variants:[{variantId:'unknown',before:'',after:photo}]}));
});
test('conflicto protege cambios recientes y reintento es idempotente',()=>{
 assert.throws(()=>imageMetadataPatch(product,{...patch,image:{before:'old',after:'https://cdn.shopify.com/new.png'}}));
 assert.deepEqual(imageMetadataPatch(product,{...patch,variants:[],image:{before:'old',after:photo}}),{});
});
const cwd=process.cwd(),tmp=fs.mkdtempSync(path.join(os.tmpdir(),'bolt-image-test-'));
try {
 process.chdir(tmp);fs.mkdirSync('src/data',{recursive:true});
 const {CatalogRepository}=await import('../lib/catalogRepository');const repo=new CatalogRepository();
 const created=repo.createProduct({...product,sku:'ISOLATED-IMAGE'}, {email:'test@invalid',name:'Test'}).product!;
 const before=structuredClone(created);const first={...patch,productId:created.id};
 assert.equal(repo.applyImagePatches([first],{email:'test@invalid',name:'Test'}).changed,1);
 const after=repo.getProductById(created.id)!;
 for(const k of ['price','stockByStore','reservedStockByStore','status','bodegaIds','sku'])assert.deepEqual((after as any)[k],(before as any)[k]);
 assert.equal(repo.applyImagePatches([first],{email:'test@invalid',name:'Test'}).changed,0);
 const restored=new CatalogRepository().getProductById(created.id)!;assert.equal(saleVariant(restored,'test-v2').image,'');assert.equal(restored.presentaciones![0].foto,photo);
 assert.equal(repo.getAuditLog(created.id).filter(x=>x.action==='SET_IMAGE').length,1);
 console.log('PASS persistencia, auditoría, reintento, variantes y datos comerciales conservados');checks++;
}finally{process.chdir(cwd);fs.rmSync(tmp,{recursive:true,force:true});}
console.log(`${checks} image checks passed`);
