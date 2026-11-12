import type { Order, Product, Store } from '../types';
import type { DispatchRun } from '../types/dispatch';
import { getBogotaTime } from './deliveryService';

export type SalesPeriod = 'today' | '7d' | '30d';

export interface BoltAdminSalesReport {
  period: SalesPeriod;
  updatedAt: string;
  from: string;
  to: string;
  demo: boolean;
  summary: { orderCount: number; confirmedCOP: number; collectedCOP: number; units: number; averageOrderCOP: number };
  series: { key: string; label: string; orderCount: number; confirmedCOP: number }[];
  stores: { id: string; name: string; orderCount: number; confirmedCOP: number; collectedCOP: number }[];
  products: { id: string; name: string; units: number; previousUnits: number; revenueCOP: number; changePercent: number | null }[];
}

const hour = 60 * 60_000;
const day = 24 * hour;
const periodDays: Record<SalesPeriod, number> = { today: 1, '7d': 7, '30d': 30 };

function orderConfirmedAt(order: Order) {
  const candidates = [order.timestamps?.confirmedAt, order.deliveryReview?.confirmedAt, order.createdAt];
  for (const value of candidates) {
    const parsed = value ? Date.parse(value) : NaN;
    if (Number.isFinite(parsed)) return parsed;
  }
  return NaN;
}

export function buildBoltAdminSalesReport({ period, stores, orders, catalog, runs, demo, now = new Date() }: {
  period: SalesPeriod;
  stores: readonly Pick<Store, 'id' | 'name'>[];
  orders: readonly Order[];
  catalog: readonly Pick<Product, 'id' | 'name' | 'parentProductId'>[];
  runs: readonly Pick<DispatchRun, 'orderId' | 'cashCollected' | 'status' | 'deliveredAt'>[];
  demo: boolean;
  now?: Date;
}): BoltAdminSalesReport {
  const nowMs = now.getTime();
  const { dateString: today, hour: currentHour } = getBogotaTime(now);
  const todayStart = Date.parse(`${today}T00:00:00-05:00`);
  const days = periodDays[period];
  const start = todayStart - (days - 1) * day;
  // Compare the same elapsed part of each period, including the current partial day.
  const previousStart = start - days * day;
  const previousEnd = nowMs - days * day;
  const dateKey = (timestamp: number) => getBogotaTime(new Date(timestamp)).dateString;
  const series = Array.from({ length: period === 'today' ? currentHour + 1 : days }, (_, index) => {
    if (period === 'today') {
      const label = `${String(index).padStart(2, '0')}:00`;
      return { key: `${today}T${label}`, label, orderCount: 0, confirmedCOP: 0 };
    }
    const key = dateKey(start + index * day);
    return { key, label: `${key.slice(8)}/${key.slice(5, 7)}`, orderCount: 0, confirmedCOP: 0 };
  });

  const storeTotals = new Map(stores.map(({ id, name }) => [id, { id, name, orderCount: 0, confirmedCOP: 0, collectedCOP: 0 }]));
  const productTotals = new Map<string, { id: string; name: string; units: number; revenueCOP: number }>();
  const previousUnits = new Map<string, number>();
  const catalogBySaleId = new Map(catalog.map(product => [product.id, product]));
  const collectionsByOrder = new Map<string, number>();
  const summary = { orderCount: 0, confirmedCOP: 0, collectedCOP: 0, units: 0, averageOrderCOP: 0 };
  const counted = new Set<string>();

  // A delivered run records the PIN and exact payment validation. Legacy
  // cashSettled flags and driver-level settlement receipts do not prove the amount per order.
  if (!demo) {
    for (const run of runs) {
      if (run.status !== 'DELIVERED' || run.deliveredAt === undefined || run.deliveredAt > nowMs ||
          !Number.isFinite(run.deliveredAt) || !Number.isSafeInteger(run.cashCollected) || run.cashCollected <= 0) continue;
      collectionsByOrder.set(run.orderId, (collectionsByOrder.get(run.orderId) ?? 0) + run.cashCollected);
    }
  }

  for (const order of orders) {
    const store = storeTotals.get(order.storeId);
    if (!store || order.parentOrderId || counted.has(order.id) || order.fulfillmentStatus === 'CANCELADO' ||
        order.fulfillmentStatus === 'PENDIENTE_CONFIRMACION' || order.deliveryReview?.status === 'PENDING' ||
        order.payment.status === 'REEMBOLSADO' || order.payment.status === 'RECHAZADO') continue;
    const timestamp = orderConfirmedAt(order);
    const current = timestamp >= start && timestamp <= nowMs;
    const previous = timestamp >= previousStart && timestamp <= previousEnd;
    if (!current && !previous) continue;
    counted.add(order.id);

    if (current) {
      const total = Number.isSafeInteger(order.totals.total) && order.totals.total > 0 ? order.totals.total : 0;
      const collected = order.payment.method === 'CASH_ON_DELIVERY' ? Math.min(total, collectionsByOrder.get(order.id) ?? 0) : 0;
      summary.orderCount++;
      summary.confirmedCOP += total;
      summary.collectedCOP += collected;
      store.orderCount++;
      store.confirmedCOP += total;
      store.collectedCOP += collected;
      const bucket = series[Math.floor((timestamp - start) / (period === 'today' ? hour : day))];
      bucket.orderCount++;
      bucket.confirmedCOP += total;
    }

    for (const item of order.items) {
      if (!Number.isSafeInteger(item.quantity) || item.quantity <= 0) continue;
      const catalogItem = catalogBySaleId.get(item.productId);
      const id = catalogItem?.parentProductId ?? item.productId;
      if (previous) {
        previousUnits.set(id, (previousUnits.get(id) ?? 0) + item.quantity);
        continue;
      }
      const product = productTotals.get(id) ?? { id, name: catalogItem?.name ?? item.name, units: 0, revenueCOP: 0 };
      product.units += item.quantity;
      if (Number.isSafeInteger(item.price) && item.price > 0) product.revenueCOP += item.price * item.quantity;
      productTotals.set(id, product);
      summary.units += item.quantity;
    }
  }

  summary.averageOrderCOP = summary.orderCount > 0 ? Math.round(summary.confirmedCOP / summary.orderCount) : 0;
  const products = [...productTotals.values()].map(product => {
    const prior = previousUnits.get(product.id) ?? 0;
    return { ...product, previousUnits: prior, changePercent: prior > 0 ? Math.round(100 * (product.units - prior) / prior) : null };
  }).sort((a, b) => b.units - a.units || b.revenueCOP - a.revenueCOP || a.name.localeCompare(b.name, 'es-CO') || a.id.localeCompare(b.id));
  return { period, updatedAt: now.toISOString(), from: dateKey(start), to: today, demo, summary, series, stores: [...storeTotals.values()], products: products.slice(0, 10) };
}
