import source from '../data/brandDirectory.json';
import type {MainCategory, Product, Store} from '../types';

// Navigation only: Marcas is not a product category or a change to inventory.
export type CatalogSection = MainCategory | 'Marcas';
export const CATALOG_SECTIONS: CatalogSection[] = ['Todo','Marcas','Perros','Gatos','Arenas','Snacks','Farmacia','Antipulgas','Higiene','Accesorios'];
export type BrandEntry = {id:string;name:string;group:string;image:string|null;source?:string;match:{vendor?:string;tags?:string[]};count:number};
export const normalizeBrand = (value:string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('es').replace(/[^a-z0-9]/g,'');

export function matchesBrand(product:Product, entry:Pick<BrandEntry,'match'>) {
  if(entry.match.vendor) return normalizeBrand(product.brand)===normalizeBrand(entry.match.vendor);
  const tags=new Set((product.tags||[]).map(normalizeBrand));
  return !!entry.match.tags?.length && entry.match.tags.every(tag=>tags.has(normalizeBrand(tag)));
}
export function customerCatalog(products:Product[], store?:Store|null) {
  return products.filter(p=>(!p.status||p.status==='ACTIVE') && (!store || !p.bodegaIds || p.bodegaIds.includes(store.id) || !!store.shopifyLocationGid && p.bodegaIds.includes(store.shopifyLocationGid)));
}
export function catalogBrands(products:Product[], store?:Store|null):BrandEntry[] {
  const visible=customerCatalog(products,store);
  const entries:BrandEntry[]=source.entries.map(entry=>({...entry,count:visible.filter(p=>matchesBrand(p,entry)).length})).filter(entry=>entry.count>0);
  // Keep every real catalog brand reachable, even when Shopify has no logo for it.
  const covered=new Set(visible.filter(p=>entries.some(entry=>matchesBrand(p,entry))).map(p=>p.id));
  const remaining=new Map<string,Product[]>();
  for(const product of visible.filter(p=>!covered.has(p.id))) {
    const key=normalizeBrand(product.brand);if(!key)continue;
    remaining.set(key,[...(remaining.get(key)||[]),product]);
  }
  for(const [key,items] of remaining) {
    const reference=source.entries.find(entry=>normalizeBrand(entry.name)===key);
    entries.push({id:`catalog-${key}`,name:items[0].brand,group:'Otras marcas',image:reference?.image||null,source:reference?.source,match:{vendor:items[0].brand},count:visible.filter(p=>normalizeBrand(p.brand)===key).length});
  }
  return entries;
}
