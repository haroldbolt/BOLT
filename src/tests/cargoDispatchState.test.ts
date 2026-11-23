import assert from 'node:assert/strict';
import test from 'node:test';
import { DispatchService } from '../lib/dispatchService';
import type { DispatchProvider } from '../lib/dispatchProviders';
import type { OrdersRepository } from '../lib/ordersRepository';
import { newDispatchState, type DispatchRun } from '../types/dispatch';
import { DEFAULT_TRANSPORT_CONFIG } from '../types/transport';
import type { Order } from '../types';
import { INITIAL_ORDERS } from '../data/seedData';
import { operationalMetrics } from '../lib/operationalMetrics';

function stateOnly(provider?: DispatchProvider) {
  const state = newDispatchState();
  const run: DispatchRun = {
    id: 'dispatch-stable-id',
    orderId: 'reference-only',
    code: 'dispatch-public-code',
    status: 'SEARCHING',
    createdAt: 1,
    attempted: ['provider:rappi-cargo'],
    cashDue: 35_000,
    cashCollected: 0,
    pinFailures: 0,
    external: {
      key: 'dispatch-stable-id',
      reference: 'provider-reference',
      providerId: 'rappi-cargo',
      status: 'UNKNOWN',
      quoteId: 'quote',
      costCOP: 3_000,
      startedAt: 1,
      updatedAt: 1,
      simulation: false,
    },
  };
  state.runs[run.id] = run;
  const order: Order = {
    ...structuredClone(INITIAL_ORDERS[0]), id: run.orderId, assignmentId: run.id,
    fulfillmentStatus: 'LISTO_PARA_DESPACHO', childShipments: undefined,
    payment: { method: 'CASH_ON_DELIVERY', status: 'PENDIENTE', cashToCollect: run.cashDue, cashSettled: false },
  };
  const repo = {
    dispatchState: state,
    getOrderById: (id: string) => id === order.id ? order : undefined,
    transaction: (work: () => unknown) => work(),
  } as unknown as OrdersRepository;
  const service = new DispatchService({
    repo, stores: () => [], products: () => [], transport: () => DEFAULT_TRANSPORT_CONFIG,
    providers: provider ? [provider] : [], now: () => 10_000,
  });
  return { service, run, order };
}

test('Cargo reporta entrega sin registrar recaudo ni cambiar el estado de la compra', () => {
  const { service, run, order } = stateOnly();
  service.applyExternal(run.id, 'otra-referencia', { status: 'ASSIGNED', stage: 'DELIVERED' });
  assert.equal(run.external?.providerStage, undefined);
  service.applyExternal(run.id, run.id, { status: 'ACCEPTED', stage: 'DELIVERED' });
  service.applyExternal(run.id, run.id, { status: 'CANCELLED' });
  assert.equal(run.external?.providerStage, 'DELIVERED');
  assert.notEqual(run.external?.status, 'CANCELLED');
  assert.equal(run.cashCollected, 0);
  assert.equal(run.deliveredAt, undefined);
  assert.throws(() => service.confirmCargoDelivery(run.id, '1234', 35_000, '', 'coord'), /comprobante/);
  assert.throws(() => service.recordCargoSettlement(run.id, 'recibo-aislado', 35_000, 0, 'coord'), /liquidación verificada/);
  assert.equal(order.fulfillmentStatus, 'LISTO_PARA_DESPACHO');
  assert.equal(order.payment.cashToCollect, 35_000);
  assert.equal(order.payment.cashSettled, false);
  assert.equal(run.external?.bankReceipt, undefined);
  assert.equal(operationalMetrics({orders:[order],runs:[run],demo:false}).cash.verifiedCollectedCOP, null);
});

test('respuesta desconocida se reconcilia por la referencia estable de BOLT', async () => {
  const references: string[] = [];
  const provider: DispatchProvider = {
    id: 'rappi-cargo', name: 'Rappi Cargo', simulation: false,
    capabilities: { status: true, quote: true, request: true, cancel: true, cashCollection: true },
    quote: async () => null,
    request: async () => assert.fail('La conciliación no debe volver a solicitar un repartidor'),
    status: async reference => { references.push(reference); return { status: 'UNKNOWN' }; },
    cancel: async () => assert.fail('La conciliación no debe cancelar un despacho'),
  };
  const { service, run } = stateOnly(provider);
  await Promise.all([service.reconcile(run.id), service.reconcile(run.id)]);
  assert.deepEqual(references, [run.id]);
  assert.equal(run.external?.status, 'UNKNOWN');
});
