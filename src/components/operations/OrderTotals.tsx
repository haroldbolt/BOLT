import React from 'react';
import type { Order } from '../../types';
import { formatCOP } from '../../lib/formatters';

/** Display the saved invoice; historical amounts are never recalculated. */
export function OrderTotals({ totals }: { totals: Order['totals'] }) {
  return <dl className="ba-totals">
    <div><dt>Productos</dt><dd>{formatCOP(totals.subtotal)}</dd></div>
    <div><dt>Descuento</dt><dd>−{formatCOP(totals.discount)}</dd></div>
    <div><dt>Envío</dt><dd>{formatCOP(totals.shipping)}</dd></div>
    {totals.serviceFee > 0 && <div><dt>Servicio</dt><dd>{formatCOP(totals.serviceFee)}</dd></div>}
    <div><dt>Propina</dt><dd>{formatCOP(totals.tip)}</dd></div>
    <div><dt>Total</dt><dd><strong>{formatCOP(totals.total)}</strong></dd></div>
  </dl>;
}
