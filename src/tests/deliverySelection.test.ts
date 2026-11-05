import assert from 'node:assert/strict';
import type { Order } from '../types';
import type { DeliveryQuote } from '../lib/deliveryService';
import { availableDeliveryMode, deliveryPricingContext, deliveryStore, groupScheduledOrders, HISTORIC_LOCALITY, scheduledOrderLocality } from '../lib/deliverySelection';

let passed = 0;
function check(description: string, test: () => void) { test(); passed++; console.log(`PASS: ${description}`); }
const quote = {
  assignedStoreId: 'HUB_KENNEDY', assignedStoreName: 'Kennedy', recommendedMode: 'TURBO',
  availableModes: { turbo: true, turboDividido: false, scheduled: true },
  scheduledAssignment: { storeId: 'HUB_ALAMOS', storeName: 'Álamos', localityCode: 'FONTIBON', localityName: 'Fontibón', status: 'CONFIRMADA', policyVersion: 'fixture' },
} as DeliveryQuote;

check('Programado toma su sede propia cuando Turbo ofrece otra', () => assert.equal(deliveryStore(quote, 'PROGRAMADO')?.id, 'HUB_ALAMOS'));
check('Turbo conserva su sede original aunque Programado tenga otra', () => assert.equal(deliveryStore(quote, 'TURBO')?.id, 'HUB_KENNEDY'));
check('una cotización antigua sin política no hereda la sede Turbo para Programado', () => assert.equal(deliveryStore({ ...quote, scheduledAssignment: undefined }, 'PROGRAMADO'), undefined));
check('Centro nunca se utiliza desde una asignación programada manipulada', () => assert.equal(deliveryStore({ ...quote, scheduledAssignment: { ...quote.scheduledAssignment!, storeId: 'HUB_CENTRO' } }, 'PROGRAMADO'), undefined));
check('Sumapaz sin cobertura no conserva una sede sugerida anterior', () => assert.equal(deliveryStore({ ...quote, scheduledAssignment: { ...quote.scheduledAssignment!, status: 'SIN_COBERTURA' } }, 'PROGRAMADO'), undefined));
check('una dirección pendiente no permite usar una sede anterior', () => assert.equal(deliveryStore({ ...quote, scheduledAssignment: { ...quote.scheduledAssignment!, status: 'DIRECCION_PENDIENTE' } }, 'PROGRAMADO'), undefined));
check('sin modalidad programada disponible no existe sede para confirmar', () => assert.equal(deliveryStore({ ...quote, availableModes: { ...quote.availableModes, scheduled: false } }, 'PROGRAMADO'), undefined));
check('una sugerencia permite consultar catálogo pero no representa confirmación', () => assert.equal(deliveryStore({ ...quote, scheduledAssignment: { ...quote.scheduledAssignment!, status: 'SUGERIDA' } }, 'PROGRAMADO')?.confirmed, false));
check('la revisión de existencias no se presenta como bodega confirmada', () => assert.equal(deliveryStore({ ...quote, scheduledAssignment: { ...quote.scheduledAssignment!, status: 'REVISION_REQUERIDA' } }, 'PROGRAMADO')?.confirmed, false));
check('una cotización pendiente no produce una sede de reserva', () => assert.equal(deliveryStore(null, 'PROGRAMADO'), undefined));
check('refrescar una cotización no deshace Programado elegido por el cliente', () => assert.equal(availableDeliveryMode(quote, 'PROGRAMADO'), 'PROGRAMADO'));
check('si Turbo deja de estar disponible se sigue la recomendación vigente', () => assert.equal(availableDeliveryMode({ ...quote, recommendedMode: 'PROGRAMADO', availableModes: { turbo: false, turboDividido: false, scheduled: true } }, 'TURBO'), 'PROGRAMADO'));
check('Turbo Dividido se conserva mientras está disponible', () => assert.equal(availableDeliveryMode({ ...quote, availableModes: { turbo: false, turboDividido: true, scheduled: true } }, 'TURBO_DIVIDIDO'), 'TURBO_DIVIDIDO'));

const context = { mode: 'PROGRAMADO' as const, storeId: 'HUB_ALAMOS', address: 'Dirección de prueba', coordinates: { lat: 4.7, lng: -74.1 }, items: [{ productId: 'FIXTURE-VARIANT', quantity: 1 }] };
const key = deliveryPricingContext(context);
check('clonar el mismo contexto permite reutilizar su respuesta de precio', () => assert.equal(deliveryPricingContext(structuredClone(context)), key));
check('cambiar de modalidad invalida el precio, incluso si la sede coincide', () => assert.notEqual(deliveryPricingContext({ ...context, mode: 'TURBO' }), key));
check('cambiar de bodega invalida la promoción y el precio anteriores', () => assert.notEqual(deliveryPricingContext({ ...context, storeId: 'HUB_SUBA' }), key));
check('cambiar la cantidad invalida el total anterior', () => assert.notEqual(deliveryPricingContext({ ...context, items: [{ productId: 'FIXTURE-VARIANT', quantity: 2 }] }), key));
check('cambiar presentación invalida el precio anterior', () => assert.notEqual(deliveryPricingContext({ ...context, items: [{ productId: 'FIXTURE-OTHER', quantity: 1 }] }), key));
check('una dirección nueva invalida el contexto de envío anterior', () => assert.notEqual(deliveryPricingContext({ ...context, address: 'Otra dirección de prueba' }), key));
check('mover el pin invalida el contexto aunque el texto coincida', () => assert.notEqual(deliveryPricingContext({ ...context, coordinates: { lat: 4.71, lng: -74.1 } }), key));
check('sin sede validada no coincide el contexto de una respuesta anterior', () => assert.notEqual(deliveryPricingContext({ ...context, storeId: undefined }), key));

const base = {
  id: 'FIXTURE-1', storeId: 'HUB_ALAMOS', storeName: 'Álamos', deliveryMode: 'PROGRAMADO', fulfillmentStatus: 'CONFIRMADO',
  scheduledWindow: { date: '2026-11-04', windowId: 'HORARIO_1', startTime: '09:00', endTime: '14:00', displayWindow: '09–14' },
  scheduledDispatch: { localityCode: 'FONTIBON', localityName: 'Fontibón', status: 'CONFIRMADA', policyVersion: 'fixture' },
} as unknown as Order;
check('dos pedidos del mismo grupo se cuentan juntos', () => assert.equal(groupScheduledOrders([base, { ...base, id: 'FIXTURE-2' }])[0].count, 2));
check('la agrupación mantiene separadas las bodegas', () => assert.equal(groupScheduledOrders([base, { ...base, storeId: 'HUB_SUBA', storeName: 'Suba' }]).length, 2));
check('la agrupación mantiene separadas las fechas de entrega', () => assert.equal(groupScheduledOrders([base, { ...base, scheduledWindow: { ...base.scheduledWindow!, date: '2026-11-05' } }]).length, 2));
check('la agrupación mantiene separadas las franjas', () => assert.equal(groupScheduledOrders([base, { ...base, scheduledWindow: { ...base.scheduledWindow!, windowId: 'HORARIO_2', startTime: '14:00', endTime: '18:00', displayWindow: '14–18' } }]).length, 2));
check('la agrupación mantiene separadas las localidades', () => assert.equal(groupScheduledOrders([base, { ...base, scheduledDispatch: { ...base.scheduledDispatch!, localityCode: 'ENGATIVA', localityName: 'Engativá' } }]).length, 2));
check('entregados y cancelados no se presentan como rutas pendientes', () => assert.equal(groupScheduledOrders([{ ...base, fulfillmentStatus: 'ENTREGADO' }, { ...base, fulfillmentStatus: 'CANCELADO' }]).length, 0));
check('los envíos Turbo no se mezclan con los grupos programados', () => assert.equal(groupScheduledOrders([{ ...base, deliveryMode: 'TURBO' }]).length, 0));
check('un pedido histórico se etiqueta sin inferir localidad de su dirección', () => assert.equal(scheduledOrderLocality({ ...base, scheduledDispatch: undefined }).code, HISTORIC_LOCALITY));
check('el grupo histórico conserva la sede guardada y no la reasigna', () => {
  const historic = { ...base, storeId: 'HUB_CENTRO', storeName: 'Centro histórico', scheduledDispatch: undefined };
  const group = groupScheduledOrders([historic])[0];
  assert.equal(group.storeId, 'HUB_CENTRO'); assert.equal(group.status, 'Histórico / sin clasificación');
});
check('agrupar pedidos no modifica sus datos operativos', () => {
  const before = JSON.stringify(base); groupScheduledOrders([base]); assert.equal(JSON.stringify(base), before);
});

console.log(`SELECCIÓN Y AGRUPACIÓN DE ENTREGAS: ${passed} comprobaciones aprobadas.`);
