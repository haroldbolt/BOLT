import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { DispatchProvider, ProviderShipmentContext } from '../lib/dispatchProviders';
import { RappiCargoProvider, type RappiCargoSite } from '../lib/rappiCargoProvider';
import { configureRappiCargo } from '../lib/rappiCargoConfig';

const storeIds = ['HUB_SUBA', 'HUB_ALAMOS', 'HUB_KENNEDY'];
const now = Date.UTC(2026, 10, 17, 15);
const reference = 'mock-cargo-reference';
const token = 'mock-token-used-only-by-injected-fetch';
const shipped: ProviderShipmentContext = {
  destination: { address: 'Dirección ficticia para validar el formato', city: 'Bogotá', coordinates: { lat: 4.763, lng: -74.08 } },
  customer: { name: 'Cliente Ficticio', email: 'cliente@example.invalid', phone: '+57 300 000 0000' },
  items: [{ productId: 'synthetic-sku', name: 'Artículo simulado', quantity: 2, unitPriceCOP: 10_000 }],
  totalValueCOP: 20_000,
  hasRestrictedItems: false,
};
const validate = {
  active: true,
  service_delivery: 'IMMEDIATE_DELIVERY',
  eta_for_immediate_delivery: 12,
  trip_distance: 2,
  estimated_price: 7500,
};
const quoteInput = { dispatchId: 'mock-run', storeId: 'HUB_SUBA', mode: 'TURBO', cashCOP: 30_000, shipment: shipped };

const measuredVehicle = { vehicleType: 'BIKE' as const, maxLoadGrams: 30_000, cargoDimensionsCm: [80, 50, 50], maxVolumeCm3: 200_000, packagingGrams: 500 };
const productionSettings = {
  cashCollectionApproved: true,
  cashApprovalReference: 'referencia-escenario-unitario',
  maxCashCOP: 50_000,
  externalBudgetCOP: 10_000,
  sites: { HUB_SUBA: { ...measuredVehicle, pickingPointId: 123 }, HUB_ALAMOS: { ...measuredVehicle, pickingPointId: 124 }, HUB_KENNEDY: { ...measuredVehicle, pickingPointId: 'kennedy-mock' } },
};

type MockRequest = { endpoint: string; payload: Record<string, unknown> };
function fixture(answer: (request: MockRequest) => Response) {
  const traffic: MockRequest[] = [];
  const fetch: typeof globalThis.fetch = async (url, options) => {
    const endpoint = String(url).replace('https://services.grability.rappi.com/api/cargo-api-gateway/v3/', '').replace(/\/$/, '');
    assert.ok(['order-validate', 'order-create', 'order-status', 'order-cancel'].includes(endpoint));
    assert.equal(options?.method, 'POST');
    assert.equal(options?.redirect, 'error');
    assert.equal(new Headers(options?.headers).get('user-token'), token);
    const request = { endpoint, payload: JSON.parse(String(options?.body)) };
    traffic.push(request);
    return answer(request);
  };
  const sites: Record<string, RappiCargoSite> = Object.fromEntries(Object.entries(productionSettings.sites).map(([storeId, site]) => [storeId, {
    pickingPointId: site.pickingPointId,
    vehicleType: site.vehicleType,
    vehicle: { driverId: 'sim-cargo-' + storeId, storeIds: [storeId], enabled: true, modes: ['TURBO'], scheduledSlots: [], maxLoadGrams: site.maxLoadGrams,
      cargoDimensionsCm: [80, 50, 50], maxVolumeCm3: site.maxVolumeCm3, packagingGrams: site.packagingGrams },
  }]));
  return { provider: new RappiCargoProvider({ token, sites, maxCashCOP: productionSettings.maxCashCOP, fetch, now: () => now }), traffic };
}

test('respeta la activación por convenio y exige un punto y capacidad de cada sede', () => {
  const env = { BOLT_RAPPI_CARGO_ENABLED: '1', BOLT_RAPPI_CARGO_USER_TOKEN: token, BOLT_RAPPI_CARGO_SETTINGS: JSON.stringify(productionSettings) };
  assert.equal(configureRappiCargo({}, storeIds), undefined);
  const live = configureRappiCargo(env, storeIds);
  assert.ok(live);
  assert.equal(live.provider.simulation, false);
  assert.equal(live.externalBudgetCOP, 10_000);
  for (const storeId of storeIds) {
    assert.equal(live.provider.supports(storeId, 'TURBO', 49_000), true);
    const vehicle = live.provider.vehicleFor(storeId, 'TURBO', 49_000);
    assert.deepEqual(vehicle?.storeIds, [storeId]);
    vehicle!.storeIds.length = 0;
    assert.deepEqual(live.provider.vehicleFor(storeId, 'TURBO', 49_000)?.storeIds, [storeId]);
    assert.equal(live.provider.vehicleFor(storeId, 'PROGRAMADO', 49_000), undefined);
  }
  for (const settings of [
    { ...productionSettings, cashCollectionApproved: false },
    { ...productionSettings, sites: { ...productionSettings.sites, HUB_ALAMOS: { ...measuredVehicle, pickingPointId: 123 } } },
    { ...productionSettings, sites: { HUB_SUBA: productionSettings.sites.HUB_SUBA } },
    { ...productionSettings, sites: { ...productionSettings.sites, HUB_ALAMOS: { ...measuredVehicle, pickingPointId: 124, maxVolumeCm3: 300_000 } } },
  ]) {
    assert.throws(() => configureRappiCargo({ ...env, BOLT_RAPPI_CARGO_SETTINGS: JSON.stringify(settings) }, storeIds), /aprobación de efectivo/);
  }
});

test('valida CASH por sede sin contratar y envía exactamente el saldo calculado por BOLT', async () => {
  const { provider, traffic } = fixture(() => Response.json(validate, { status: 201 }));
  const quote = await provider.quote(quoteInput);
  assert.ok(quote);
  assert.equal(quote.canCollectCash, true);
  assert.equal(quote.deliveryEtaSeconds, 720);
  assert.equal(quote.estimate.seconds, undefined);
  assert.equal(quote.costCOP, 7500);
  assert.deepEqual(traffic.map(request => request.endpoint), ['order-validate']);
  const [{ payload }] = traffic;
  assert.equal(payload.total_value, 30_000);
  assert.equal(payload.user_tip, 0);
  assert.equal(payload.payment_method, 'CASH');
  assert.equal((payload.client_info as Record<string, unknown>).phone, '3000000000');
  assert.equal((payload.action_points as Record<string, unknown>[])[0].picking_point_id, 123);
  const alternate = await provider.quote({ ...quoteInput, storeId: 'HUB_KENNEDY' });
  assert.ok(alternate);
  assert.equal((traffic[1].payload.action_points as Record<string, unknown>[])[0].external_picking_point_id, 'kennedy-mock');
});

test('descarta Programado, efectivo sobre el límite, contacto incompleto, prescripción y sedes ajenas localmente', async () => {
  const { provider, traffic } = fixture(() => { assert.fail('No debe contactar al proveedor'); });
  for (const input of [
    { ...quoteInput, mode: 'PROGRAMADO' },
    { ...quoteInput, cashCOP: 50_001 },
    { ...quoteInput, cashCOP: 0 },
    { ...quoteInput, storeId: 'HUB_OTRA' },
    { ...quoteInput, shipment: { ...shipped, customer: undefined } },
    { ...quoteInput, shipment: { ...shipped, hasRestrictedItems: true } },
  ]) assert.equal(await provider.quote(input), null);
  assert.deepEqual(traffic, []);
});

test('retiene una respuesta de validación no concluyente, con recargos o fuera de Turbo', async () => {
  for (const response of [
    { ...validate, service_delivery: 'SCHEDULED_DELIVERY' },
    { ...validate, estimated_price: undefined },
    { ...validate, rain_charge: 1000 },
    { ...validate, high_demand_charge: true },
  ]) {
    const { provider, traffic } = fixture(() => Response.json(response, { status: 201 }));
    assert.equal(await provider.quote(quoteInput), null);
    assert.deepEqual(traffic.map(request => request.endpoint), ['order-validate']);
  }
});

test('vincula cotización a sede, despacho, contacto e importe; una aceptación no asigna repartidor', async () => {
  const { provider, traffic } = fixture(({ endpoint }) => endpoint === 'order-validate'
    ? Response.json(validate, { status: 201 })
    : Response.json({ external_order_id: reference, cargo_order_id: 1 }, { status: 201 }));
  const quote = await provider.quote(quoteInput);
  assert.ok(quote);
  const request = { ...quoteInput, quote, idempotencyKey: reference };
  for (const invalid of [
    { ...request, dispatchId: 'other-run' },
    { ...request, cashCOP: 45_000 },
    { ...request, shipment: { ...shipped, customer: { ...shipped.customer!, phone: '3000001234' } } },
    { ...request, quote: { ...quote, expiresAt: now } },
  ]) assert.equal((await provider.request(invalid)).status, 'REJECTED');
  assert.deepEqual(await provider.request(request), { status: 'ACCEPTED', reference });
  assert.deepEqual(traffic.map(({ endpoint }) => endpoint), ['order-validate', 'order-create']);
  assert.equal(traffic[1].payload.order_id, reference);
});

test('consulta la misma referencia tras un timeout y no crea otro despacho', async () => {
  const { provider, traffic } = fixture(({ endpoint }) => {
    if (endpoint === 'order-validate') return Response.json(validate, { status: 201 });
    if (endpoint === 'order-create') throw new DOMException('simulated timeout', 'TimeoutError');
    return Response.json({ external_order_id: 'unrelated-reference', state: 'in_progress' }, { status: 200 });
  });
  const quote = await provider.quote(quoteInput);
  assert.ok(quote);
  const request: Parameters<DispatchProvider['request']>[0] = { ...quoteInput, quote, idempotencyKey: reference };
  assert.deepEqual(await provider.request(request), { status: 'UNKNOWN', reference });
  assert.deepEqual(traffic.map(({ endpoint }) => endpoint), ['order-validate', 'order-create', 'order-status']);
  assert.deepEqual(traffic[2].payload, { external_order_id: reference });
});

test('distingue la entrega de una incidencia y preserva la evidencia de custodia en una cancelación', async () => {
  const { provider, traffic } = fixture(() => Response.json({ external_order_id: reference, state: 'pending_review' }));
  assert.deepEqual(await provider.cancel(reference), { status: 'ASSIGNED', stage: 'FAILED', reference });
  assert.deepEqual(traffic.map(({ endpoint }) => endpoint), ['order-status']);
});

test('un estado de entrega de Cargo no acredita efectivo ni liquidación bancaria', async () => {
  const { provider } = fixture(() => Response.json({
    external_order_id: reference,
    state: 'delivered_to_user',
    payment_method: 'CASH',
    collect_cash: 30_000,
    delivered_at: new Date(now).toISOString(),
  }));
  assert.deepEqual(await provider.status(reference), { status: 'ASSIGNED', stage: 'DELIVERED', reference });
});

test('una cancelación inconcluyente conserva el bloqueo del despacho', async () => {
  let calls = 0;
  const { provider, traffic } = fixture(({ endpoint }) => {
    calls++;
    if (endpoint === 'order-cancel') return Response.json({ successfull: false }, { status: 201 });
    return Response.json({ external_order_id: reference, state: calls === 1 ? 'finding_courier' : 'canceled' });
  });
  assert.deepEqual(await provider.cancel(reference), { status: 'UNKNOWN', reference });
  assert.deepEqual(traffic.map(({ endpoint }) => endpoint), ['order-status', 'order-cancel', 'order-status']);
});
