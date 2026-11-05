import assert from 'node:assert/strict';
import { INITIAL_PRODUCTS, INITIAL_STORES } from '../data/seedData';
import { getScheduledAssignment, getQuoteDispatchStore, SCHEDULED_LOCALITY_WAREHOUSES, SCHEDULED_NO_COVERAGE_MESSAGE } from '../lib/scheduledDispatch';
import { evaluateDeliveryQuote, detectBogotaLocality, DELIVERY_CONFIG } from '../lib/deliveryService';
import type { Product, Store } from '../types';

let passed = 0;
function check(label: string, run: () => void) { run(); passed++; console.log('PASS: ' + label); }
const stores = structuredClone(INITIAL_STORES);
const product = structuredClone(INITIAL_PRODUCTS[0]);
Object.assign(product, { status: 'ACTIVE', price: 20000, weightKg: 1, bodegaIds: ['HUB_KENNEDY', 'HUB_ALAMOS', 'HUB_SUBA', 'HUB_CENTRO'],
  stockByStore: Object.fromEntries(stores.map(store => [store.id, 30])), reservedStockByStore: Object.fromEntries(stores.map(store => [store.id, 0])),
  inventoryVerifiedByStore: { HUB_KENNEDY: true, HUB_ALAMOS: true, HUB_SUBA: true, HUB_CENTRO: true } });
const fixtures: Record<string, [number, number]> = {
  USAQUEN: [4.744,-74.026], CHAPINERO: [4.651,-74.058], SANTA_FE: [4.604,-74.066], SAN_CRISTOBAL: [4.558,-74.075],
  USME: [4.488,-74.119], TUNJUELITO: [4.574,-74.135], BOSA: [4.611,-74.198], KENNEDY: [4.631,-74.151],
  FONTIBON: [4.682,-74.145], ENGATIVA: [4.7026,-74.1149], SUBA: [4.747,-74.098], BARRIOS_UNIDOS: [4.671,-74.07],
  TEUSAQUILLO: [4.64,-74.088], LOS_MARTIRES: [4.604,-74.09], ANTONIO_NARINO: [4.588,-74.099], PUENTE_ARANDA: [4.615,-74.114],
  LA_CANDELARIA: [4.596,-74.072], RAFAEL_URIBE_URIBE: [4.566,-74.113], CIUDAD_BOLIVAR: [4.54,-74.16], SUMAPAZ: [4.265,-74.2],
};
const at = (code: string) => ({ lat: fixtures[code][0], lng: fixtures[code][1] });
const basket = [{ productId: product.id, quantity: 1 }];
for (const [code, storeId] of Object.entries(SCHEDULED_LOCALITY_WAREHOUSES)) {
  check('asigna y confirma ' + code + ' en ' + storeId, () => {
    const assignment = getScheduledAssignment(at(code), stores, [product], basket);
    assert.equal(assignment.localityCode, code);
    assert.equal(assignment.storeId, storeId);
    assert.equal(assignment.status, 'CONFIRMADA');
  });
}
check('sin carrito solo sugiere la bodega y no crea disponibilidad verificada', () => {
  assert.equal(getScheduledAssignment(at('CHAPINERO'), stores).status, 'SUGERIDA');
});
check('Sumapaz no recibe bodega, franjas ni modo incluso con texto Kennedy', () => {
  const quote = evaluateDeliveryQuote({ destination: { address: 'Kennedy, Bogotá', coordinates: at('SUMAPAZ') }, items: basket }, stores, [product]);
  assert.equal(quote.message, SCHEDULED_NO_COVERAGE_MESSAGE);
  assert.equal(quote.scheduledAssignment?.status, 'SIN_COBERTURA');
  assert.equal(quote.scheduledAssignment?.storeId, undefined);
  assert.equal(quote.scheduledEligible, false);
  assert.deepEqual(quote.scheduledSlots, []);
  assert.deepEqual(quote.availableModes, { turbo: false, turboDividido: false, scheduled: false });
  assert.equal(quote.recommendedMode, null);
});
check('una calle o barrio llamado Sumapaz no reemplaza la localidad por coordenadas', () => {
  assert.equal(detectBogotaLocality(at('KENNEDY'), 'Barrio Sumapaz, Usaquén'), 'KENNEDY');
});
for (const coordinates of [null, { lat: NaN, lng: -74.1 }, { lat: Infinity, lng: -74.1 }, { lat: 91, lng: -74.1 }, { lat: 4.8, lng: -74.2 }, { lat: 0, lng: 0 }]) {
  check('ubicación inválida o externa no hereda Kennedy: ' + JSON.stringify(coordinates), () => {
    const assignment = getScheduledAssignment(coordinates, stores);
    assert.equal(assignment.status, 'DIRECCION_PENDIENTE');
    assert.equal(assignment.storeId, undefined);
  });
}
check('Centro no sustituye a Álamos cuando la bodega responsable no tiene mercancía', () => {
  const missing = structuredClone(product);
  missing.stockByStore.HUB_ALAMOS = 0;
  const assignment = getScheduledAssignment(at('CHAPINERO'), stores, [missing], basket);
  assert.equal(assignment.storeId, 'HUB_ALAMOS');
  assert.equal(assignment.status, 'REVISION_REQUERIDA');
  assert.equal(missing.reservedStockByStore.HUB_ALAMOS, 0);
  assert.equal(missing.reservedStockByStore.HUB_CENTRO, 0);
});
check('cantidades desconocidas y reservas existentes no cuentan como unidades disponibles', () => {
  const missing = structuredClone(product);
  Object.assign(missing, { inventoryVerifiedByStore: { HUB_KENNEDY: true } });
  assert.equal(getScheduledAssignment(at('CHAPINERO'), stores, [missing], basket).status, 'REVISION_REQUERIDA');
  Object.assign(missing, { inventoryVerifiedByStore: { HUB_ALAMOS: true } });
  missing.reservedStockByStore.HUB_ALAMOS = 30;
  assert.equal(getScheduledAssignment(at('CHAPINERO'), stores, [missing], basket).status, 'REVISION_REQUERIDA');
});
check('líneas repetidas se agregan para verificar el pedido completo', () => {
  const limited = structuredClone(product); limited.stockByStore.HUB_ALAMOS = 1;
  assert.equal(getScheduledAssignment(at('CHAPINERO'), stores, [limited], [...basket, ...basket]).status, 'REVISION_REQUERIDA');
});
check('bodega inactiva o pausada no habilita Programado ni usa Centro como alternativa', () => {
  for (const patch of [{ isActive: false }, { isPaused: true }]) {
    const unavailable = structuredClone(stores); Object.assign(unavailable.find(store => store.id === 'HUB_ALAMOS')!, patch);
    const quote = evaluateDeliveryQuote({ destination: { address: 'Chapinero', coordinates: at('CHAPINERO') } }, unavailable);
    assert.equal(quote.scheduledAssignment?.status, 'REVISION_REQUERIDA');
    assert.equal(quote.scheduledEligible, false);
    assert.deepEqual(quote.scheduledSlots, []);
    assert.equal(getQuoteDispatchStore(quote, 'PROGRAMADO')?.storeId, 'HUB_ALAMOS');
  }
});
check('Centro no amplía el radio de cobertura programada', () => {
  const moved = structuredClone(stores);
  for (const store of moved.filter(store => store.id !== 'HUB_CENTRO')) {
    store.coordinates = store.shopifyCoordinates = store.verifiedEntrance = { lat: 4.9, lng: -74.2 };
  }
  const quote = evaluateDeliveryQuote({ destination: { address: 'La Candelaria', coordinates: at('LA_CANDELARIA') } }, moved);
  assert.equal(quote.scheduledEligible, false); assert.equal(quote.scheduledAssignment?.status, 'SIN_COBERTURA');
});
check('Turbo y Programado conservan sus bodegas separadas en una misma cotización', () => {
  const changed = structuredClone(stores);
  const kennedy = changed.find(store => store.id === 'HUB_KENNEDY')!;
  kennedy.coordinates = kennedy.shopifyCoordinates = kennedy.verifiedEntrance = { lat: 4.69, lng: -74.2 };
  const alamos = changed.find(store => store.id === 'HUB_ALAMOS')!;
  alamos.coordinates = alamos.shopifyCoordinates = alamos.verifiedEntrance = at('KENNEDY');
  const quote = evaluateDeliveryQuote({ destination: { address: 'Kennedy', coordinates: at('KENNEDY') }, items: basket }, changed, [product]);
  assert.equal(quote.availableModes.turbo, true);
  assert.equal(quote.assignedStoreId, 'HUB_ALAMOS');
  assert.equal(getQuoteDispatchStore(quote, 'TURBO')?.storeId, 'HUB_ALAMOS');
  assert.equal(getQuoteDispatchStore(quote, 'PROGRAMADO')?.storeId, 'HUB_KENNEDY');
});
check('la política no modifica los límites oficiales de Turbo o franjas', () => {
  assert.equal(DELIVERY_CONFIG.coverageRadiusMeters, 6000);
  assert.equal(DELIVERY_CONFIG.maxDeliverySeconds, 1500);
  assert.equal(DELIVERY_CONFIG.scheduledCoverageRadiusMeters, 25000);
  assert.equal(DELIVERY_CONFIG.scheduledDelivery.maxCapacityPerSlot, 10);
});
console.log('PROGRAMADO POLICY: ' + passed + ' comprobaciones aprobadas.');
