import type {DeliveryQuote} from './deliveryService';

/** A request is not a transport confirmation. These states never authorize dispatch. */
export function canRequestDeliveryReview(quote?:DeliveryQuote|null) {
  return !!quote?.reviewRequestToken && quote.reasonCode==='TRANSPORT_DATA_PENDING' && quote.inventoryValidated===true;
}
export function hasConfirmedDeliveryQuote(quote?:DeliveryQuote|null) {
  return !!quote?.confirmationToken && !!quote.basketValidated && !!quote.transportPlan?.feasible && !!quote.charges;
}
export const REVIEW_MESSAGE='Puedes enviar tu pedido para que la sede confirme la entrega. No se realizará ningún cobro ni se reservará un horario hasta confirmar contigo el costo y la disponibilidad.';
export function deliveryStatusMessage(quote:DeliveryQuote) {
  return canRequestDeliveryReview(quote) ? REVIEW_MESSAGE : quote.message;
}
