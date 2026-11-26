import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { setImmediate as flush } from 'node:timers/promises';
import type { Response } from 'express';
import type { Order } from '../types';
import { OrderUpdates } from '../lib/orderUpdates';
import type { OrdersRepository } from '../lib/ordersRepository';

class TestStream extends EventEmitter {
  readonly frames: string[] = [];
  writableEnded = false;
  destroyed = false;
  set() {}
  flushHeaders() {}
  write(frame: string) {
    this.frames.push(frame);
    return true;
  }
  end() {
    this.writableEnded = true;
    this.emit('close');
  }
}

function fixture() {
  const order = { id: 'review-order', storeId: 'review-store', assignmentId: 'review-run' } as Order;
  const run = { status: 'ASSIGNED', driverId: 'review-a' };
  let notify: (() => void) | undefined;
  const repository = {
    getAllOrders: () => [order],
    dispatchState: { runs: { 'review-run': run } },
    onCommit(callback: () => void) {
      notify = callback;
      return () => { notify = undefined; };
    },
  };
  return { updates: new OrderUpdates(repository as unknown as OrdersRepository), run, commit: () => notify?.() };
}

test('un canal inactivo solo recibe latidos con acceso vigente', async t => {
  t.mock.timers.enable({ apis: ['setInterval', 'setTimeout'] });
  const { updates } = fixture();
  const output = new TestStream();
  let allowed = true;
  updates.stream(output as unknown as Response, () => true, () => allowed);
  t.mock.timers.tick(10_000);
  await flush();
  assert.deepEqual(output.frames, [': connected\n\n', ': heartbeat\n\n']);
  allowed = false;
  t.mock.timers.tick(10_000);
  await flush();
  assert.equal(output.writableEnded, true);
  assert.equal(output.frames.length, 2);
});

test('una autorización sin respuesta cierra el canal en un máximo de quince segundos', async t => {
  t.mock.timers.enable({ apis: ['setInterval', 'setTimeout'] });
  const { updates } = fixture(), output = new TestStream();
  let finish!: (authorized: boolean) => void;
  updates.stream(output as unknown as Response, () => true, () => new Promise<boolean>(resolve => { finish = resolve; }));
  t.mock.timers.tick(10_000);
  t.mock.timers.tick(5_000);
  assert.equal(output.writableEnded, true);
  finish(true);
  await flush();
  assert.deepEqual(output.frames, [': connected\n\n']);
});

test('cambios simultáneos se revalidan y una reasignación solo anuncia un cambio', async t => {
  t.mock.timers.enable({ apis: ['setInterval', 'setTimeout'] });
  const { updates, run, commit } = fixture(), output = new TestStream(), other = new TestStream();
  let firstCheck!: (authorized: boolean) => void;
  let attempts = 0;
  const inScope = (change: { order: Order }) => change.order.storeId === 'review-store';
  updates.stream(output as unknown as Response, inScope, () => {
    attempts++;
    return attempts === 1 ? new Promise<boolean>(resolve => { firstCheck = resolve; }) : false;
  });
  updates.stream(other as unknown as Response, change => !inScope(change), () => true);
  run.driverId = 'review-b';
  commit();
  run.driverId = 'review-c';
  commit();
  firstCheck(true);
  await flush();
  assert.equal(attempts, 2);
  assert.deepEqual(output.frames, [': connected\n\n', 'data: changed\n\n']);
  assert.equal(output.writableEnded, true);
  assert.deepEqual(other.frames, [': connected\n\n']);
  other.end();
});
