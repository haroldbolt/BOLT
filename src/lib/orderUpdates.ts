import type { Response } from 'express';
import type { Order } from '../types';
import type { OrdersRepository } from './ordersRepository';

type Change = { order: Order; previousStoreId?: string };
type Listener = (changes: Change[]) => void;

/** Invalidation only. Each panel reads the actual data through its authorized snapshot endpoint. */
export class OrderUpdates {
  private listeners = new Set<Listener>();
  private previous = new Map<string, { storeId: string; version: string }>();
  private unsubscribe?: () => void;

  constructor(private readonly repo: OrdersRepository) {}

  private readChanges(): Change[] {
    const changes: Change[] = [];
    for (const order of this.repo.getAllOrders()) {
      const stage = (item: Pick<Order, 'fulfillmentStatus' | 'assignmentId' | 'timestamps'>) => [
        item.fulfillmentStatus, item.timestamps?.prepCompletedAt,
        item.assignmentId && this.repo.dispatchState.runs[item.assignmentId]?.status,
      ];
      const version = JSON.stringify([order.storeId, order.statusHistory?.length, order.deliveryReview?.status,
        stage(order), order.childShipments?.map(stage)]);
      const old = this.previous.get(order.id);
      if (old?.version === version) continue;
      this.previous.set(order.id, { storeId: order.storeId, version });
      changes.push({ order, previousStoreId: old?.storeId });
    }
    return changes;
  }

  stream(res: Response, matches: (change: Change) => boolean, authorized: () => boolean | Promise<boolean>) {
    if (!this.listeners.size) {
      this.readChanges();
      this.unsubscribe = this.repo.onCommit(() => {
        const changes = this.readChanges();
        if (changes.length) for (const listener of this.listeners) listener(changes);
      });
    }
    let checking = false;
    const changed = async (changes: Change[]) => {
      if (checking || res.destroyed || !changes.some(matches)) return;
      checking = true;
      try {
        if (!(await authorized())) { res.end(); return; }
        if (!res.destroyed && !res.writableEnded && !res.write('data: changed\n\n')) res.end();
      } catch { res.end(); }
      finally { checking = false; }
    };
    this.listeners.add(changed);
    res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'private, no-store, no-transform', 'X-Accel-Buffering': 'no' });
    res.flushHeaders();
    res.write(': connected\n\n');
    const heartbeat = setInterval(() => { if (!res.write(': heartbeat\n\n')) res.end(); }, 15_000);
    const renew = setTimeout(() => res.end(), 120_000);
    res.once('close', () => {
      clearInterval(heartbeat);
      clearTimeout(renew);
      this.listeners.delete(changed);
      if (!this.listeners.size) {
        this.unsubscribe?.();
        this.previous.clear();
      }
    });
  }
}
