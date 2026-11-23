// Only the disposable checkout server loads this module, before any provider SDK.
import { appendFileSync } from 'node:fs';
import { Socket } from 'node:net';

function forbid() {
  appendFileSync(process.env.BOLT_TEST_EGRESS_LOG, 'outbound connection blocked\n', { mode: 0o600 });
  throw Error('El servidor de la prueba de checkout no puede abrir conexiones de red salientes.');
}

globalThis.fetch = async (input, init) => {
  const log = process.env.BOLT_TEST_CARGO_LOG;
  const url = new URL(String(input));
  const prefix = '/api/cargo-api-gateway/v3/';
  if (!log || url.origin !== 'https://services.grability.rappi.com' || !url.pathname.startsWith(prefix) ||
      url.search || init?.method !== 'POST') return forbid();
  // Fixture responses are produced in process. All socket connections still go through the guard below.
  const operation = url.pathname.slice(prefix.length).replace(/\/$/, '');
  const body = JSON.parse(init.body);
  const reference = body.order_id || body.external_order_id;
  const response = {
    'order-validate': { active: true, service_delivery: 'IMMEDIATE_DELIVERY', estimated_price: 7500, trip_distance: 1, eta_for_immediate_delivery: 5 },
    'order-create': { external_order_id: reference, cargo_order_id: 1 },
    'order-status': { external_order_id: reference, state: 'finding_courier' },
  };
  if (!Object.hasOwn(response, operation)) return forbid();
  appendFileSync(log, JSON.stringify({ operation, reference }) + '\n', { mode: 0o600 });
  return Response.json(response[operation], { status: operation === 'order-status' ? 200 : 201 });
};
const connect = Socket.prototype.connect;
Socket.prototype.connect = function (...args) {
  const first = Array.isArray(args[0]) ? args[0][0] : args[0];
  if (typeof first === 'object' && first?.path && first.port === undefined) {
    return connect.apply(this, args); // Unix-domain IPC used by the local Node tooling.
  }
  return forbid();
};
