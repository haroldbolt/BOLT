import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AddressConfirmationModal, locateAddressDevice, quoteAddressForSelection } from '../components/customer/AddressConfirmationModal';
import { evaluateDeliveryQuote, type DeliveryQuote } from '../lib/deliveryService';
import { INITIAL_STORES } from '../data/seedData';

let passed = 0;
function check(label: string, run: () => void) { run(); passed++; console.log('PASS: ' + label); }
const props = { isOpen: true, onClose() {}, currentAddress: '', currentDetails: '', currentCoordinates: null,
  onConfirmAddress() {}, stores: [], cartItems: [], products: [] };
const empty = renderToStaticMarkup(React.createElement(AddressConfirmationModal, props));
check('la primera visita permite escribir o usar ubicación sin asignar un domicilio de muestra', () => {
  assert.match(empty, /Escribe tu dirección completa/);
  assert.match(empty, /Usar mi ubicación/);
  assert.match(empty, /Sin punto seleccionado/);
  assert.doesNotMatch(empty, /Calle 3 #78-20|Apto 502|Probar por localidad/);
});
check('el estado inicial no informa error o falta de cobertura y mantiene confirmación deshabilitada', () => {
  assert.doesNotMatch(empty, /role="alert"|Ubicación fuera de cobertura|Dirección desincronizada/);
  assert.match(empty, /<button[^>]*disabled=""[^>]*>[\s\S]*?Esperando dirección/);
  assert.match(empty, /Elige y confirma dónde quieres recibir tu compra/);
});
check('el gancho de 25 minutos y las condiciones siguen visibles en el selector vacío', () => {
  assert.match(empty, /Turbo hasta 25 minutos/);
  assert.match(empty, /En zonas habilitadas\. Confirma tu dirección\./);
  assert.match(empty, /La dirección confirmada se guarda en este dispositivo/);
});
const remembered = renderToStaticMarkup(React.createElement(AddressConfirmationModal, { ...props,
  currentAddress: 'Dirección elegida por el comprador', currentDetails: 'Entrada lateral',
  currentCoordinates: { lat: 4.65, lng: -74.08 }, addressRemembered: true, onForgetAddress() {},
}));
check('la dirección recordada conserva sus datos y ofrece olvidarla explícitamente', () => {
  assert.match(remembered, /value="Dirección elegida por el comprador"/);
  assert.match(remembered, /value="Entrada lateral"/);
  assert.match(remembered, /Olvidar dirección en este dispositivo/);
});
check('sin dirección guardada no se ofrece olvidar y el selector cerrado no se renderiza', () => {
  assert.doesNotMatch(empty, /Olvidar dirección en este dispositivo/);
  assert.equal(renderToStaticMarkup(React.createElement(AddressConfirmationModal, { ...props, isOpen: false })), '');
});

function deviceHarness() {
  let success!: PositionCallback;
  let failure!: PositionErrorCallback;
  let options: PositionOptions | undefined;
  let calls = 0;
  const device: Pick<Geolocation, 'getCurrentPosition'> = { getCurrentPosition(ok, fail, settings) {
    calls++; success = ok; failure = fail!; options = settings;
  } };
  const controller = new AbortController();
  return { device, controller, success: (position: GeolocationPosition) => success(position),
    failure: (code: number) => failure({ code } as GeolocationPositionError), get calls() { return calls; }, get options() { return options; } };
}
const fix = (lat = 4.65, lng = -74.08, accuracy = 15) => ({ coords: { latitude: lat, longitude: lng, accuracy } } as GeolocationPosition);
async function asyncCheck(label: string, run: () => Promise<void>) { await run(); passed++; console.log('PASS: ' + label); }
await asyncCheck('la consulta explícita usa ubicación reciente y solo resuelve coordenadas válidas', async () => {
  const h = deviceHarness();
  const pending = locateAddressDevice(h.device, h.controller.signal);
  assert.equal(h.calls, 1);
  assert.deepEqual(h.options, { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 });
  h.success(fix());
  assert.deepEqual(await pending, { lat: 4.65, lng: -74.08 });
});
await asyncCheck('rechazar el permiso permite continuar escribiendo manualmente sin coordenadas de respaldo', async () => {
  const h = deviceHarness();
  const pending = locateAddressDevice(h.device, h.controller.signal);
  h.failure(1);
  await assert.rejects(pending, /No se autorizó.*escribir tu dirección/);
});
await asyncCheck('una ubicación imprecisa o inválida pide elegir la entrada y no confirma un destino', async () => {
  for (const position of [fix(4.65, -74.08, 500), fix(91, -74.08), fix(4.65, -74.08, -1)]) {
    const h = deviceHarness();
    const pending = locateAddressDevice(h.device, h.controller.signal);
    h.success(position);
    await assert.rejects(pending, /ubicación es aproximada/);
  }
});
await asyncCheck('el vencimiento del dispositivo conserva la alternativa de escribir o elegir en el mapa', async () => {
  const h = deviceHarness();
  const pending = locateAddressDevice(h.device, h.controller.signal);
  h.failure(3);
  await assert.rejects(pending, /Escribe tu dirección o elige un punto/);
});
await asyncCheck('cerrar o editar invalida una consulta pendiente y descarta su callback tardío', async () => {
  const h = deviceHarness();
  const pending = locateAddressDevice(h.device, h.controller.signal);
  h.controller.abort();
  h.success(fix());
  await assert.rejects(pending, error => error instanceof DOMException && error.name === 'AbortError');
});
await asyncCheck('una consulta ya cancelada no solicita permiso ni consulta el dispositivo', async () => {
  const h = deviceHarness();
  h.controller.abort();
  await assert.rejects(locateAddressDevice(h.device, h.controller.signal), error => error instanceof DOMException && error.name === 'AbortError');
  assert.equal(h.calls, 0);
});
const destination = { address: 'Dirección de ensayo, Bogotá', coordinates: { lat: 4.631, lng: -74.151 } };
const addressQuote = evaluateDeliveryQuote({ destination, items: [] }, structuredClone(INITIAL_STORES), []);
const unavailable: DeliveryQuote = { ...addressQuote, availableModes: { turbo: false, turboDividido: false, scheduled: false }, reasonCode: 'STOCK_UNAVAILABLE', message: 'Carrito sin disponibilidad' };
const basket = [{ productId: 'QA-ADDRESS-CART', quantity: 1 }];
await asyncCheck('una cotización de carrito disponible se conserva sin consultar de nuevo ni marcar revisión', async () => {
  let calls = 0;
  const result = await quoteAddressForSelection(basket, async () => { calls++; return addressQuote; }, new AbortController().signal);
  assert.equal(result, addressQuote);
  assert.equal(result.cartNeedsReview, undefined);
  assert.equal(calls, 1);
});
await asyncCheck('un carrito no disponible permite elegir cobertura sin afirmar disponibilidad de sus productos', async () => {
  const requests: unknown[] = [];
  const before = JSON.stringify(basket);
  const result = await quoteAddressForSelection(basket, async items => { requests.push(structuredClone(items)); return items.length ? unavailable : addressQuote; }, new AbortController().signal);
  assert.deepEqual(requests, [basket, []]);
  assert.equal(JSON.stringify(basket), before);
  assert.equal(result.cartNeedsReview, true);
  assert.deepEqual(result.destination, destination);
  assert.equal('cartNeedsReview' in addressQuote, false);
});
await asyncCheck('fallar la conexión no convierte la dirección en cobertura ni solicita una alternativa vacía', async () => {
  let calls = 0;
  await assert.rejects(quoteAddressForSelection(basket, async () => { calls++; throw new Error('Servidor no disponible'); }, new AbortController().signal), /Servidor no disponible/);
  assert.equal(calls, 1);
});
await asyncCheck('Sumapaz y un punto externo siguen sin modos de entrega después de revisar solo la dirección', async () => {
  for (const coordinates of [{ lat: 4.265, lng: -74.2 }, { lat: 0, lng: 0 }]) {
    const outside = evaluateDeliveryQuote({ destination: { address: 'Kennedy escrito no cambia el punto', coordinates }, items: [] }, structuredClone(INITIAL_STORES), []);
    const result = await quoteAddressForSelection(basket, async items => items.length ? unavailable : outside, new AbortController().signal);
    assert.deepEqual(result.availableModes, { turbo: false, turboDividido: false, scheduled: false });
    assert.equal(result.cartNeedsReview, undefined);
  }
});
await asyncCheck('sin carrito la cobertura se consulta una vez y no necesita revisión de productos', async () => {
  let calls = 0;
  const result = await quoteAddressForSelection([], async () => { calls++; return addressQuote; }, new AbortController().signal);
  assert.equal(result.cartNeedsReview, undefined);
  assert.equal(calls, 1);
});
await asyncCheck('un cambio de borrador cancela la revisión antes de consultar cobertura sin carrito', async () => {
  const controller = new AbortController();
  let calls = 0;
  await assert.rejects(quoteAddressForSelection(basket, async () => { calls++; controller.abort(); return unavailable; }, controller.signal), error => error instanceof DOMException && error.name === 'AbortError');
  assert.equal(calls, 1);
});
console.log(`SELECTOR DE DIRECCIÓN: ${passed} comprobaciones aprobadas; componentes, ubicación y cobertura con datos ficticios.`);
