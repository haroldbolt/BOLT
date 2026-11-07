import type {Product} from '../types';
import type {DeliveryQuote, QuoteRequest} from './deliveryService';
import {hasSalePrice, presentationAvailability, prospectiveItems} from './presentationSelection';

// One in-flight cart action across duplicate cards, categories and the detail sheet.
export class CartActionGate {
  private busy=false;
  async run(action:()=>Promise<void>):Promise<boolean> {
    if(this.busy) return false;
    this.busy=true;
    try {await action();return true;} finally {this.busy=false;}
  }
}

export function optionStock(product:Product, storeId?:string):'pending'|'unavailable'|'out'|'available' {
  if(!storeId) return 'pending';
  if(!Object.hasOwn(product.stockByStore,storeId)) return 'unavailable';
  return product.stockByStore[storeId]-(product.reservedStockByStore[storeId] || 0)>0 ? 'available' : 'out';
}

export function validOffer(product:Product | null) {
  if(!product || !hasSalePrice(product) || !Number.isFinite(product.originalPrice) || product.originalPrice!<=product.price) return null;
  const percent=Math.round((1-product.price/product.originalPrice!)*100);
  return {originalPrice:product.originalPrice!,percent:percent>0 ? percent : undefined};
}

export async function validateCartAddition({product,request,quote,isCurrent,commit}: {
  product:Product; request:QuoteRequest; quote:(request:QuoteRequest)=>Promise<DeliveryQuote>;
  isCurrent:()=>boolean; commit:(product:Product)=>void;
}) {
  if(!hasSalePrice(product)) throw new Error('Precio pendiente de confirmar');
  const result=await quote({...request,items:prospectiveItems(request.items || [],product)});
  if(!isCurrent()) throw new Error('Tu selección o carrito cambió. Revisa y vuelve a agregar.');
  const available=presentationAvailability(product,result,false,!!request.destination.address.trim());
  if(!available.canAdd) throw new Error(available.message);
  commit(product);
}
