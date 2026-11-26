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
      const stage = (item: Pick<Order, 'fulfillmentStatus' | 'assignmentId' | 'timestamps'>) => {
        const run = item.assignmentId ? this.repo.dispatchState.runs[item.assignmentId] : undefined;
        return [item.fulfillmentStatus, item.timestamps?.prepCompletedAt, item.assignmentId,
          run?.status, run?.driverId, run?.providerId];
      };
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
    // Every frame after the authorized handshake requires a current grant. A stalled
    // authorizer must not keep an idle subscription alive past the revocation window.
    let checking = false;
    let pending: 'changed' | 'heartbeat' | undefined;
    const ended = () => res.destroyed || res.writableEnded;
    const close = () => { if (!ended()) res.end(); };
    const send = async (kind: 'changed' | 'heartbeat') => {
      if (ended()) return;
      if (pending !== 'changed') pending = kind;
      if (checking) return;
      checking = true;
      try {
        while (pending && !ended()) {
          const frame = pending === 'changed' ? 'data: changed\n\n' : ': heartbeat\n\n';
          pending = undefined;
          const deadline = setTimeout(close, 5_000);
          try {
            if (!(await authorized()) || ended() || !res.write(frame)) {
              close();
              return;
            }
          } finally {
            clearTimeout(deadline);
          }
        }
      } catch { close(); }
      finally { checking = false; }
    };
    const changed: Listener = changes => {
      if (changes.some(matches)) void send('changed');
    };
    this.listeners.add(changed);
    res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'private, no-store, no-transform', 'X-Accel-Buffering': 'no' });
    res.flushHeaders();
    res.write(': connected\n\n');
    const heartbeat = setInterval(() => { void send('heartbeat'); }, 10_000);
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
