import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ProviderShipmentContext } from '../lib/dispatchProviders';
import { RappiCargoSandboxProvider } from '../lib/rappiCargoProvider';
import { configureRappiCargoSandbox } from '../lib/rappiCargoSandboxConfig';
import type { TransportVehicle } from '../types/transport';

const now = Date.UTC(2026, 10, 16, 15);
const token = 'sandbox-token-not-a-real-credential';
const driverReference = 'rappi-bolt-test-001';
const testClient = {
  firstName: 'Prueba',
  lastName: 'BOLT',
  email: 'rappi-qa@example.com',
  phone: '3000000000',
};
const vehicle: TransportVehicle = {
  driverId: 'rappi-sandbox-bike',
  storeIds: ['suba'],
  enabled: true,
  modes: ['TURBO'],
  maxLoadGrams: 25000,
  cargoDimensionsCm: [60, 45, 45],
  maxVolumeCm3: 121500,
  packagingGrams: 500,
  scheduledSlots: [],
};
const shipment: ProviderShipmentContext = {
  destination: {
    address: 'Dirección ficticia de la prueba',
    city: 'Bogotá',
    coordinates: { lat: 4.763, lng: -74.080 },
    details: 'Puerta ficticia',
  },
  items: [{ productId: 'sandbox-item', name: 'Producto de prueba', quantity: 2, unitPriceCOP: 6500 }],
  totalValueCOP: 13000,
  hasRestrictedItems: false,
};
const quoteInput = { dispatchId: 'test-dispatch', storeId: 'suba', mode: 'TURBO', cashCOP: 0, shipment };
const validateResponse = {
  active: true,
  service_delivery: 'IMMEDIATE_DELIVERY',
  eta_for_immediate_delivery: 25,
  trip_distance: 2,
  estimated_price: 8500,
};

type MockRequest = {
  url: URL;
  method?: string;
  redirect?: RequestRedirect;
  headers: Headers;
  body: Record<string, unknown>;
};
type MockResponse = (request: MockRequest) => Response;

function makeProvider(reply: MockResponse) {
  const requests: MockRequest[] = [];
  const mockFetch: typeof fetch = async (input, init) => {
    const request = {
      url: new URL(String(input)),
      method: init?.method,
      redirect: init?.redirect,
      headers: new Headers(init?.headers),
      body: JSON.parse(String(init?.body)),
    };
    requests.push(request);
    return reply(request);
  };
  const config = { token, pickingPoints: { suba: 'sandbox-picking-point' }, vehicle, vehicleType: 'BIKE' as const, testClient, fetch: mockFetch, now: () => now };
  return { provider: new RappiCargoSandboxProvider(config), requests, config };
}

function assertSandboxTraffic(requests: MockRequest[], paths: string[]) {
  const base = 'https://microservices.dev.rappi.com/api/cargo-api-gateway';
  assert.deepEqual(requests.map(({ url }) => url.href), paths.map(path => `${base}/v3/order-${path}`));
  for (const { method, redirect, headers } of requests) {
    assert.equal(method, 'POST');
    assert.equal(redirect, 'error');
    assert.equal(headers.get('user-token'), token);
    assert.match(headers.get('Content-Type') ?? '', /application\/json/);
  }
}

test('valida exclusivamente en Cargo Dev y distingue ETA de entrega de recogida', async () => {
  const { provider, requests } = makeProvider(() => Response.json(validateResponse, { status: 201 }));
  const result = await provider.quote(quoteInput);

  assert.ok(result);
  assert.equal(result.costCOP, 8500);
  assert.equal(result.deliveryEtaSeconds, 1500);
  assert.equal(result.estimate.kind, 'GEOGRAPHIC');
  assert.equal(result.estimate.meters, 2000);
  assert.equal(result.estimate.seconds, undefined);
  assert.equal(result.canCollectCash, false);
  assert.equal(provider.sandboxOnly, true);
  assertSandboxTraffic(requests, ['validate']);
  assert.deepEqual(requests[0].body.action_points, [
    {
      external_picking_point_id: 'sandbox-picking-point',
      action_type: 'PICK_UP',
      location_type: 'STORE',
      products: [{ product_id: 'sandbox-item', name: 'Producto de prueba', units: 2, unit_price: 6500 }],
    },
    { action_type: 'DROP_OFF', location_type: 'CLIENT', products: [] },
  ]);
  assert.deepEqual(requests[0].body.client_info, {
    email: testClient.email,
    phone: testClient.phone,
    phone_country_code: '57',
    first_name: testClient.firstName,
    last_name: testClient.lastName,
    address: shipment.destination.address,
    city: shipment.destination.city,
    ...shipment.destination.coordinates,
    complement: shipment.destination.details,
  });
});

test('descarta programas, recaudo, artículos restringidos y sedes sin picking point sin consultar a Rappi', async () => {
  const { provider, requests } = makeProvider(() => Response.json(validateResponse, { status: 201 }));
  const cases = [
    { ...quoteInput, mode: 'PROGRAMADO' },
    { ...quoteInput, cashCOP: 5000 },
    { ...quoteInput, shipment: { ...shipment, hasRestrictedItems: true } },
    { ...quoteInput, storeId: 'missing-store' },
    { ...quoteInput, shipment: undefined },
  ];
  for (const input of cases) {
    assert.equal(await provider.quote(input), null);
  }
  assert.deepEqual(requests, []);
});

test('rechaza ofertas sin cobertura inmediata, con datos incompletos o con recargos', async () => {
  const cases = [
    { active: false },
    { service_delivery: 'SCHEDULED_DELIVERY' },
    { estimated_price: undefined },
    { estimated_price: 0 },
    { estimated_price: -100 },
    { estimated_price: '8500' },
    { eta_for_immediate_delivery: undefined },
    { eta_for_immediate_delivery: -1 },
    { trip_distance: undefined },
    { trip_distance: -1 },
    { rain_charge: 1000 },
    { raining_charge: true },
    { high_demand_charge: 2000 },
  ];
  for (const fields of cases) {
    const { provider, requests } = makeProvider(() => Response.json({ ...validateResponse, ...fields }, { status: 201 }));
    assert.equal(await provider.quote(quoteInput), null, JSON.stringify(fields));
    assertSandboxTraffic(requests, ['validate']);
  }
});

test('usa una referencia idempotente de BOLT y no interpreta la aceptación como asignación', async () => {
  const { provider, requests } = makeProvider(({ url, body }) => {
    if (url.pathname.endsWith('order-validate')) return Response.json(validateResponse, { status: 201 });
    return Response.json({
      cargo_order_id: 123,
      rappi_order_id: 124,
      external_order_id: body.order_id,
    }, { status: 201 });
  });
  const quote = await provider.quote(quoteInput);
  assert.ok(quote);
  const result = await provider.request({ idempotencyKey: driverReference, quote, dispatchId: quoteInput.dispatchId, shipment });

  assert.equal(result.status, 'ACCEPTED');
  assert.equal(result.reference, driverReference);
  assert.equal(result.driver, undefined);
  assertSandboxTraffic(requests, ['validate', 'create']);
  assert.equal(requests[1].body.order_id, driverReference);
});

test('rechaza enviar una cotización vencida, ajena o que corresponde a otro destino', async () => {
  const { provider, requests } = makeProvider(() => Response.json(validateResponse, { status: 201 }));
  const quote = await provider.quote(quoteInput);
  assert.ok(quote);
  const input = { idempotencyKey: driverReference, quote, dispatchId: quoteInput.dispatchId, shipment };
  const cases = [
    { ...input, quote: { ...quote, expiresAt: now } },
    { ...input, quote: { ...quote, providerId: 'other-provider' } },
    { ...input, shipment: { ...shipment, destination: { ...shipment.destination, address: 'Otra dirección de prueba' } } },
  ];
  for (const stale of cases) {
    assert.equal((await provider.request(stale)).status, 'REJECTED');
  }
  assertSandboxTraffic(requests, ['validate']);
});

test('concilia un ID duplicado consultando el pedido que ya existe', async () => {
  const { provider, requests } = makeProvider(({ url }) => {
    if (url.pathname.endsWith('order-validate')) return Response.json(validateResponse, { status: 201 });
    if (url.pathname.endsWith('order-create')) return Response.json({ code: 'ALREADY_EXTERNAL_ORDER_ID' }, { status: 409 });
    return Response.json({ state: 'in_progress', external_order_id: driverReference }, { status: 200 });
  });
  const quote = await provider.quote(quoteInput);
  assert.ok(quote);
  const result = await provider.request({ idempotencyKey: driverReference, quote, dispatchId: quoteInput.dispatchId, shipment });

  assert.equal(result.status, 'ASSIGNED');
  assert.equal(result.reference, driverReference);
  assertSandboxTraffic(requests, ['validate', 'create', 'status']);
  assert.deepEqual(requests[2].body, { external_order_id: driverReference });
});

test('un timeout de creación sin conciliación concluyente conserva el resultado desconocido', async () => {
  const { provider, requests } = makeProvider(({ url }) => {
    if (url.pathname.endsWith('order-validate')) return Response.json(validateResponse, { status: 201 });
    if (url.pathname.endsWith('order-create')) throw new DOMException('Timeout de prueba', 'TimeoutError');
    return Response.json({ code: 'ORDER_NOT_FOUND' }, { status: 404 });
  });
  const quote = await provider.quote(quoteInput);
  assert.ok(quote);
  const result = await provider.request({ idempotencyKey: driverReference, quote, dispatchId: quoteInput.dispatchId, shipment });

  assert.equal(result.status, 'UNKNOWN');
  assert.equal(result.reference, driverReference);
  assertSandboxTraffic(requests, ['validate', 'create', 'status']);
  assert.deepEqual(requests[2].body, { external_order_id: driverReference });
});

test('no atribuye a este pedido el estado de una referencia externa diferente', async () => {
  const { provider, requests } = makeProvider(() => Response.json({
    state: 'delivered_to_user', external_order_id: 'other-order',
  }, { status: 200 }));
  assert.deepEqual(await provider.status(driverReference), { status: 'UNKNOWN', reference: driverReference });
  assertSandboxTraffic(requests, ['status']);
});

test('incluye al conductor solo si la referencia coincide y Cargo devuelve un identificador válido', async () => {
  let courier = { id: 123, first_name: 'Conductor', last_name: 'de prueba' };
  const { provider, requests } = makeProvider(() => Response.json({
    state: 'in_progress',
    external_order_id: driverReference,
    storeKeeper: courier,
  }, { status: 200 }));
  const assigned = await provider.status(driverReference);
  assert.deepEqual(assigned, {
    status: 'ASSIGNED',
    reference: driverReference,
    driver: { id: '123', name: 'Conductor de prueba' },
  });
  courier = { ...courier, id: 0 };
  assert.equal((await provider.status(driverReference)).driver, undefined);
  assertSandboxTraffic(requests, ['status', 'status']);
});

test('mapea recogida y evita cancelar directamente cuando ya se recogió el pedido', async () => {
  const { provider, requests } = makeProvider(() => Response.json({
    state: 'on_the_route', external_order_id: driverReference,
  }, { status: 200 }));
  const result = await provider.cancel(driverReference);
  assert.equal(result.status, 'ASSIGNED');
  assert.equal(result.stage, 'PICKED_UP');
  assertSandboxTraffic(requests, ['status']);
});

test('comprueba el estado remoto antes y después de solicitar una cancelación', async () => {
  let state = 'in_progress';
  const { provider, requests } = makeProvider(({ url }) => {
    if (url.pathname.endsWith('order-cancel')) {
      state = 'canceled';
      return Response.json({ successfull: true }, { status: 201 });
    }
    return Response.json({ state, external_order_id: driverReference }, { status: 200 });
  });
  const cancelled = await provider.cancel(driverReference);
  assert.equal(cancelled.status, 'CANCELLED');
  assert.equal(cancelled.reference, driverReference);
  assertSandboxTraffic(requests, ['status', 'cancel', 'status']);
  assert.equal(requests[1].body.external_order_id, driverReference);
  assert.equal(requests[1].body.partner_cancelation_reason, 'WILL_USE_OTHER_PROVIDER');
});

test('una cancelación sin confirmación no prueba que el repartidor no haya recogido', async () => {
  let state = 'in_progress';
  const { provider, requests } = makeProvider(({ url }) => {
    if (url.pathname.endsWith('order-cancel')) {
      state = 'canceled';
      return Response.json({ successfull: false }, { status: 201 });
    }
    return Response.json({ state, external_order_id: driverReference }, { status: 200 });
  });
  assert.deepEqual(await provider.cancel(driverReference), { status: 'UNKNOWN', reference: driverReference });
  assert.deepEqual(await provider.cancel(driverReference), { status: 'UNKNOWN', reference: driverReference });
  assertSandboxTraffic(requests, ['status', 'cancel', 'status', 'status']);
});

test('rechaza configuración de sandbox sin credencial o sin número de pruebas colombiano', () => {
  const { config, requests } = makeProvider(() => Response.json(validateResponse, { status: 201 }));
  assert.throws(() => new RappiCargoSandboxProvider({ ...config, token: '' }));
  assert.throws(() => new RappiCargoSandboxProvider({ ...config, testClient: { ...testClient, phone: '123' } }));
  assert.throws(() => new RappiCargoSandboxProvider({ ...config, pickingPoints: { otherWarehouse: 'other-point' } }));
  assert.throws(() => new RappiCargoSandboxProvider({ ...config, vehicle: { ...vehicle, maxLoadGrams: 0 } }));
  assert.deepEqual(requests, []);
});

test('exige configuración aislada, presupuesto y destino de prueba para activar la integración', () => {
  const settings = {
    pickingPoints: { suba: 'sandbox-picking-point' },
    vehicle,
    vehicleType: 'BIKE',
    testClient,
    testDestination: shipment.destination,
    externalBudgetCOP: 10000,
  };
  const env = {
    BOLT_RAPPI_CARGO_SANDBOX: '1',
    BOLT_RAPPI_CARGO_SANDBOX_TOKEN: token,
    BOLT_RAPPI_CARGO_SANDBOX_SETTINGS: JSON.stringify(settings),
  };

  assert.equal(configureRappiCargoSandbox({ ...env, BOLT_RAPPI_CARGO_SANDBOX: undefined }, true), undefined);
  assert.throws(() => configureRappiCargoSandbox(env, false), /simulación aislada/i);
  const configured = configureRappiCargoSandbox(env, true);
  assert.equal(configured?.externalBudgetCOP, 10000);
  assert.deepEqual(configured?.testDestination, shipment.destination);
  const invalidSettings = [
    { externalBudgetCOP: undefined },
    { externalBudgetCOP: 0 },
    { externalBudgetCOP: -100 },
    { testDestination: undefined },
    { testDestination: { ...shipment.destination, coordinates: { lat: 91, lng: -74.080 } } },
  ];
  for (const overrides of invalidSettings) {
    const invalidEnv = { ...env, BOLT_RAPPI_CARGO_SANDBOX_SETTINGS: JSON.stringify({ ...settings, ...overrides }) };
    assert.throws(() => configureRappiCargoSandbox(invalidEnv, true), /configura|revisa/i);
  }
});
