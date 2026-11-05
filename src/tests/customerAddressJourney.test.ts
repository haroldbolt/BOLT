import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import App from '../App';
import { api } from '../lib/api';
import { CUSTOMER_DELIVERY_ADDRESS_KEY, createConfirmedDeliveryAddress } from '../lib/customerDeliveryAddress';

let checks = 0;
function check(label: string, action: () => void) { action(); checks++; console.log('PASS: ' + label); }
async function asyncCheck(label: string, action: () => Promise<void>) { await action(); checks++; console.log('PASS: ' + label); }
const savedWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
const savedStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
const savedFetch = globalThis.fetch;
const savedWarn = console.warn;
let networkRequests = 0;
const storage = (value: string | null) => ({
  getItem: (key: string) => key === CUSTOMER_DELIVERY_ADDRESS_KEY ? value : null,
  setItem() {}, removeItem() {},
});

function renderInitial(value: string | null, blocked = false) {
  const target = storage(value);
  const fakeWindow: Record<string, unknown> = { location: { pathname: '/', origin: 'http://example.invalid' } };
  if (blocked) {
    Object.defineProperty(fakeWindow, 'localStorage', { get() { throw new Error('Storage bloqueado de ensayo'); } });
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('Storage bloqueado de ensayo'); } });
  } else {
    fakeWindow.localStorage = target;
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: target });
  }
  Object.defineProperty(globalThis, 'window', { configurable: true, value: fakeWindow });
  return renderToStaticMarkup(React.createElement(App));
}

try {
  console.warn = () => {}; // Expected storage failures are checked below; preserve output for actual failures.
  globalThis.fetch = (async () => { networkRequests++; throw new Error('Esta prueba nunca debe acceder a la red'); }) as typeof fetch;

  const empty = renderInitial(null);
  check('SSR primera visita muestra los 25 minutos y solicita una dirección sin asignar Kennedy', () => {
    assert.match(empty, /Turbo hasta 25 minutos/);
    assert.match(empty, /¿Dónde entregamos tu pedido\?/);
    assert.match(empty, /Ingresa tu dirección/);
    assert.match(empty, /En zonas habilitadas/);
    assert.doesNotMatch(empty, /Calle 3 #78-20|Apto 502|Torre 2|Entrega Turbo.*aprox/);
  });
  check('SSR inicial no monta checkout ni selector abierto ni confirma stock de una sede', () => {
    assert.doesNotMatch(empty, /Confirmar Pedido Turbo|Pagar .*Solicitar Turbo|Dirección de entrega confirmada/);
    assert.doesNotMatch(empty, /¡Últimas \d+ unidades!|Agotado en esta sede|Sede confirmada:/);
  });

  const selected = createConfirmedDeliveryAddress('Dirección confirmada de ensayo en Suba, Bogotá', 'Torre de ensayo 8', { lat: 4.75, lng: -74.08 });
  const restored = renderInitial(JSON.stringify({ ...selected, quote: { estimatedMinutes: 1 }, storeId: 'HUB_SUBA' }));
  check('SSR restaurado presenta la dirección elegida, conserva gancho y espera revalidación', () => {
    assert.match(restored, /Dirección confirmada de ensayo en Suba, Bogotá/);
    assert.match(restored, /Turbo hasta 25 minutos/);
    assert.match(restored, /Validando cobertura para tu dirección/);
    assert.doesNotMatch(restored, /Sede confirmada:|aprox\. 1 min|Calle 3 #78-20|Apto 502/);
  });
  check('SSR no transforma una cotización guardada artificialmente en disponibilidad confirmada', () => {
    assert.doesNotMatch(restored, /Entrega Turbo.*aprox|Confirmar Pedido Turbo|Pagar .*Solicitar Turbo/);
  });
  const broken = renderInitial('{json-corrupto');
  check('SSR con selección corrupta vuelve al estado sin dirección', () => {
    assert.match(broken, /¿Dónde entregamos tu pedido\?/);
    assert.match(broken, /Turbo hasta 25 minutos/);
    assert.doesNotMatch(broken, /Dirección confirmada de ensayo/);
  });
  const blocked = renderInitial(null, true);
  check('SSR con almacenamiento bloqueado puede mostrar la tienda sin domicilio ficticio', () => {
    assert.match(blocked, /¿Dónde entregamos tu pedido\?/);
    assert.match(blocked, /Turbo hasta 25 minutos/);
    assert.doesNotMatch(blocked, /Calle 3 #78-20|Apto 502/);
  });
  check('los renderizados SSR no realizan solicitudes; no sustituyen pruebas de efectos o interacción', () => {
    assert.equal(networkRequests, 0);
  });

  // API checks use a fake fetch and no database, web browser or external service.
  const request = { destination: { address: 'Dirección de ensayo, Bogotá', coordinates: { lat: 4.63, lng: -74.14 } }, items: [] };
  let optionsSeen: RequestInit | undefined;
  globalThis.fetch = (async (_input: RequestInfo | URL, options?: RequestInit) => {
    networkRequests++; optionsSeen = options;
    return new Response(JSON.stringify({ error: 'Servidor de ensayo no disponible' }), { status: 503, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
  await asyncCheck('cotización autoritativa rechaza HTTP503 sin fabricar una entrega local', async () => {
    await assert.rejects(api.getDeliveryQuote(request, [], [], undefined, { authoritative: true }), /No pudimos verificar la entrega/);
    assert.equal(optionsSeen?.method, 'POST');
    assert.equal(optionsSeen?.credentials, 'same-origin');
  });
  globalThis.fetch = (async () => { networkRequests++; throw new TypeError('Fallo de red ficticio'); }) as typeof fetch;
  await asyncCheck('cotización autoritativa rechaza pérdida de conexión sin fallback', async () => {
    await assert.rejects(api.getDeliveryQuote(request, [], [], undefined, { authoritative: true }), /No pudimos verificar la entrega/);
  });
  globalThis.fetch = (async () => { networkRequests++; return new Response('{json-corrupto', { status: 200 }); }) as typeof fetch;
  await asyncCheck('una respuesta no interpretable no se convierte en una cotización confirmada', async () => {
    await assert.rejects(api.getDeliveryQuote(request, [], [], undefined, { authoritative: true }), /No pudimos verificar la entrega/);
  });
  const quote = { availableModes: { turbo: true, turboDividido: false, scheduled: true }, assignedStoreId: 'HUB_KENNEDY', estimatedMinutes: 13 };
  globalThis.fetch = (async () => { networkRequests++; return new Response(JSON.stringify(quote), { status: 200, headers: { 'Content-Type': 'application/json' } }); }) as typeof fetch;
  await asyncCheck('una respuesta válida conserva las condiciones que devolvió el servidor', async () => {
    assert.deepEqual(await api.getDeliveryQuote(request, [], [], undefined, { authoritative: true }), quote);
  });
  const controller = new AbortController(); controller.abort(new DOMException('Consulta descartada', 'AbortError'));
  globalThis.fetch = (async (_input: RequestInfo | URL, options?: RequestInit) => { networkRequests++; throw options?.signal?.reason; }) as typeof fetch;
  await asyncCheck('una búsqueda cancelada sigue cancelada y nunca obtiene fallback local', async () => {
    await assert.rejects(api.getDeliveryQuote(request, [], [], controller.signal, { authoritative: true }), error => error instanceof DOMException && error.name === 'AbortError');
  });
  console.log(`DIRECCIÓN EN TIENDA: ${checks} comprobaciones aprobadas; SSR inicial y API ficticia, sin efectos ni compras.`);
} finally {
  if (savedWindow) Object.defineProperty(globalThis, 'window', savedWindow); else delete (globalThis as any).window;
  if (savedStorage) Object.defineProperty(globalThis, 'localStorage', savedStorage); else delete (globalThis as any).localStorage;
  globalThis.fetch = savedFetch;
  console.warn = savedWarn;
}
