import type {Product} from '../types';
import {usableProductImage} from './productImages';

export type ImageChange = {before:string;after:string};
export interface CatalogImagePatch {
  productId:string;
  image?:ImageChange;
  gallery?:{before:string[];after:string[]};
  variants?:Array<ImageChange & {variantId:string}>;
  source:string;
  checkedAt:string;
  reason:string;
}
export function imageMetadataPatch(product:Product, patch:CatalogImagePatch): Partial<Product> {
  const allowed=new Set(['productId','image','gallery','variants','source','checkedAt','reason']);
  if(Object.keys(patch).some(k=>!allowed.has(k)) || !patch.source || !patch.reason || !Number.isFinite(Date.parse(patch.checkedAt))) throw new Error('Parche de imágenes inválido o sin fuente/fecha.');
  const result:Partial<Product>={};
  const check=(current:string,change:ImageChange)=>{
    if(typeof change.before!=='string'||typeof change.after!=='string'||(change.after!==''&&!usableProductImage(change.after)))throw new Error('URL de imagen no admitida.');
    if(current!==change.before && current!==change.after)throw new Error('La imagen cambió desde la auditoría; revisa la edición más reciente.');
  };
  if(patch.image){check(product.image,patch.image);if(product.image!==patch.image.after)result.image=patch.image.after;}
  if(patch.gallery){
    if(!Array.isArray(patch.gallery.before)||!Array.isArray(patch.gallery.after)||patch.gallery.after.some(u=>!usableProductImage(u)))throw new Error('Galería inválida.');
    const current=JSON.stringify(product.gallery||[]),after=JSON.stringify(patch.gallery.after);
    if(current!==JSON.stringify(patch.gallery.before)&&current!==after)throw new Error('La galería cambió desde la auditoría.');
    if(current!==after)result.gallery=patch.gallery.after;
  }
  if(patch.variants){
    if(!Array.isArray(patch.variants)||new Set(patch.variants.map(v=>v.variantId)).size!==patch.variants.length)throw new Error('Variantes duplicadas o inválidas.');
    const photos={...(product.variantImages||{})};let changed=false;
    for(const change of patch.variants){
      const variant=product.presentaciones?.find(v=>v.varianteId===change.variantId);
      if(!variant)throw new Error('Variante no encontrada; no se pueden crear presentaciones desde imágenes.');
      check(variant.foto||'',change);
      if(variant.foto!==change.after){photos[change.variantId]=change.after;changed=true;}
    }
    if(changed)result.variantImages=photos;
  }
  return result;
}
