import type {Product} from '../types';

// Reviewed BOLT/Shopify pairs. The preferred product can offer other variants;
// only the exact equivalent presentation can replace a redundant storefront card.
const redundantCards = [
  {id:'prod-nexgard-spectra-m',sku:'FAR-NX-SPEC-715',preferred:'gid://shopify/Product/9496657363224',variant:'gid://shopify/ProductVariant/49141673722136'},
  {id:'prod-simparica-trio-s',sku:'FAR-SIMP-TRIO-S',preferred:'gid://shopify/Product/9512533786904',variant:'gid://shopify/ProductVariant/49200388309272'},
  {id:'prod-bravecto-1020',sku:'FAR-BRAV-1020',preferred:'gid://shopify/Product/9439680037144',variant:'gid://shopify/ProductVariant/49232740843800'},
] as const;

export function withoutRedundantCatalogCards(products:Product[], storeId?:string):Product[] {
  const visibleIds = new Map(products.map(product=>[product.id,product]));
  const suppressed = new Set<string>();
  for(const pair of redundantCards) {
    const legacy=visibleIds.get(pair.id);
    const preferred=visibleIds.get(pair.preferred);
    if(!legacy || legacy.sku!==pair.sku || (legacy.presentaciones?.length || 0)>1 ||
      !preferred || (preferred.status && preferred.status!=='ACTIVE')) continue;
    const option=preferred.presentaciones?.find(item=>item.varianteId===pair.variant);
    if(!option || typeof option.price!=='number' || !Number.isFinite(option.price) || option.price<=0 || !option.stockByStore) continue;
    const stocks=option.stockByStore;
    const isAvailable=(id:string)=>stocks[id]-(option.reservedStockByStore?.[id] || 0)>0;
    const legacyOnlyStores=Object.keys(legacy.stockByStore).filter(id=>legacy.stockByStore[id]>(legacy.reservedStockByStore[id] || 0));
    const canReplace=storeId ? isAvailable(storeId) : Object.keys(stocks).some(isAvailable) && legacyOnlyStores.every(isAvailable);
    if(canReplace) suppressed.add(legacy.id);
  }
  // A display projection only; never remove the product from inventory, history or cart lookup.
  return products.filter(product=>!suppressed.has(product.id));
}
