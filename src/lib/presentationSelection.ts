import type { Product } from '../types';
import type { DeliveryQuote, QuoteRequest } from './deliveryService';
import { saleVariant } from './variantCommerce';

export const hasSalePrice = (p: Product) => Number.isFinite(p.price) && p.price > 0;

// An invalid or absent choice must never silently become the first variant.
export function selectedPresentation(product: Product, id?: string): Product | null {
  const variants = product.presentaciones || [];
  if (!variants.length) return product;
  const choice = id || (variants.length === 1 ? variants[0].varianteId : undefined);
  return variants.some(v => v.varianteId === choice) ? saleVariant(product, choice) : null;
}

export {presentationLabel} from './variantCommerce';

export function prospectiveItems(items: NonNullable<QuoteRequest['items']>, selected: Product) {
  const existing = items.find(i => i.productId === selected.id);
  return existing ? items.map(i => i === existing ? {...i, quantity:i.quantity + 1} : i) : [...items, {productId:selected.id,quantity:1}];
}

export function presentationAvailability(selected: Product | null, quote: DeliveryQuote | null, pending: boolean, hasDestination: boolean) {
  if (!selected) return {canAdd:false, message:'Selecciona una presentación'};
  if (!hasSalePrice(selected)) return {canAdd:false, message:'Precio pendiente de confirmar'};
  if (!hasDestination) return {canAdd:false, message:'Disponibilidad pendiente: confirma tu dirección'};
  if (pending) return {canAdd:false, message:'Verificando disponibilidad y entrega…'};
  if (!quote) return {canAdd:false, message:'No se pudo verificar la entrega. Reintenta.'};
  if (quote.reasonCode === 'LOCALITY_UNRESOLVED' || quote.eligibilityStatus === 'ADDRESS_NEEDS_CONFIRMATION') return {canAdd:false,message:quote.message};
  const store = quote.assignedStoreId;
  if (!store) return {canAdd:false,message:quote.message || 'Sede pendiente de confirmar'};
  // A missing association is distinct from an explicit zero. Never use the phone location or a default store.
  if (!Object.hasOwn(selected.stockByStore, store)) return {canAdd:false,message:'Presentación no disponible en la sede asignada'};
  const available = Math.max(0, selected.stockByStore[store] - (selected.reservedStockByStore[store] || 0));
  if (!available) return {canAdd:false,message:'Agotado en esta sede', available};
  const modes = quote.availableModes;
  const mode = quote.recommendedMode;
  const canAdd = quote.basketValidated && (mode==='PROGRAMADO' ? modes.scheduled : mode==='TURBO' ? modes.turbo : mode==='TURBO_DIVIDIDO' ? modes.turboDividido : false);
  const message = canAdd ? mode==='TURBO' ? 'Disponible para Turbo' : mode==='TURBO_DIVIDIDO' ? 'Disponible para Turbo dividido' : 'Disponible para Programado' : quote.message;
  return {canAdd, message, available};
}
