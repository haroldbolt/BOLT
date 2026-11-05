import type { NewOrderPorteriaPolicy } from '../types';

/** Instructions available when a new order is created. Historical orders retain their own value. */
export const NEW_ORDER_DELIVERY_OPTIONS = [
  { value: 'LLAMAR_AL_LLEGAR', label: 'Llamar al llegar' },
  { value: 'DEJAR_EN_PORTERIA', label: 'Dejar en portería' },
] as const satisfies ReadonlyArray<{ value: NewOrderPorteriaPolicy; label: string }>;

/** New carts and orders have no additional service fee. Existing totals are never recomputed. */
export const NEW_ORDER_SERVICE_FEE = 0;

export function isNewOrderPorteriaPolicy(value: unknown): value is NewOrderPorteriaPolicy {
  return typeof value === 'string' && NEW_ORDER_DELIVERY_OPTIONS.some(option => option.value === value);
}
