import type {DeliveryQuote} from './deliveryService';

/** A request is not a transport confirmation. These states never authorize dispatch. */
export function canRequestDeliveryReview(quote?:DeliveryQuote|null) {
  return !!quote?.reviewRequestToken && quote.reasonCode==='TRANSPORT_DATA_PENDING' && quote.inventoryValidated===true;
}
export function hasConfirmedDeliveryQuote(quote?:DeliveryQuote|null) {
  return !!quote?.confirmationToken && !!quote.basketValidated && !!quote.transportPlan?.feasible && !!quote.charges;
}
/** A server-priced tariff can be shown before capacity confirmation; it never authorizes dispatch. */
export function visibleDeliveryCharges(quote:DeliveryQuote|null|undefined, subtotal:number) {
  const charges=quote?.charges;
  if(!charges || charges.subtotal!==subtotal ||
    ![charges.subtotal,charges.shipping,charges.serviceFee,charges.total].every(value=>Number.isFinite(value)&&value>=0) ||
    Math.abs(charges.total-(charges.subtotal+charges.shipping+charges.serviceFee))>0.001) return undefined;
  if(hasConfirmedDeliveryQuote(quote) || (canRequestDeliveryReview(quote) && !!charges.mode)) return charges;
  return undefined;
}
export const REVIEW_MESSAGE='Puedes enviar tu pedido para que la sede confirme la entrega. No se realizará ningún cobro ni se reservará un horario. Cualquier cambio en la modalidad o el costo requerirá tu aceptación.';
export function deliveryStatusMessage(quote:DeliveryQuote) {
  return canRequestDeliveryReview(quote) ? REVIEW_MESSAGE : quote.message;
}
