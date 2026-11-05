import assert from 'node:assert/strict';
import {
  CUSTOMER_DELIVERY_ADDRESS_KEY,
  createConfirmedDeliveryAddress,
  readCustomerDeliveryAddress,
  saveCustomerDeliveryAddress,
} from '../lib/customerDeliveryAddress';

let checks = 0;
function check(label: string, action: () => void) { action(); checks++; console.log('PASS: ' + label); }
const fixedTime = new Date(Date.now() - 1000);
const point = { lat: 4.634, lng: -74.148 };
const selection = createConfirmedDeliveryAddress('  Dirección elegida por el comprador, Bogotá  ', '  Torre A, Apto 101  ', point, fixedTime);
const makeStorage = () => {
  const data = new Map<string, string>();
  const keysRead: string[] = [];
  return { data, keysRead, getItem(key: string) { keysRead.push(key); return data.get(key) ?? null; },
    setItem(key: string, value: string) { data.set(key, value); }, removeItem(key: string) { data.delete(key); } };
};
const readRaw = (value: unknown) => readCustomerDeliveryAddress({ getItem: () => JSON.stringify(value) });

check('la primera visita no restaura ningún domicilio por defecto', () => {
  assert.equal(readCustomerDeliveryAddress(makeStorage()), null);
  assert.equal(readCustomerDeliveryAddress(), null, 'La lectura también funciona fuera del navegador');
});
check('solo se consulta la clave de la nueva selección confirmada, nunca un perfil antiguo', () => {
  const storage = makeStorage();
  storage.data.set('bolt_pets_customer_address', JSON.stringify(selection));
  storage.data.set('bolt_pets_profile', JSON.stringify({ address: 'Dirección de ejemplo' }));
  assert.equal(readCustomerDeliveryAddress(storage), null);
  assert.deepEqual(storage.keysRead, [CUSTOMER_DELIVERY_ADDRESS_KEY]);
});
check('una selección confirmada se guarda y recupera con dirección, detalles y pin coherentes', () => {
  const storage = makeStorage();
  assert.equal(saveCustomerDeliveryAddress(selection, storage), true);
  assert.deepEqual(readCustomerDeliveryAddress(storage), selection);
  assert.equal(selection.address, 'Dirección elegida por el comprador, Bogotá');
  assert.equal(selection.details, 'Torre A, Apto 101');
  assert.equal(selection.confirmedAt, fixedTime.toISOString());
});
check('la selección y la lectura no comparten referencias mutables con el punto original', () => {
  const original = { lat: 4.6, lng: -74.1 };
  const value = createConfirmedDeliveryAddress('Dirección elegida', '', original, fixedTime);
  original.lat = 0;
  assert.equal(value.coordinates.lat, 4.6);
  const storage = makeStorage(); saveCustomerDeliveryAddress(value, storage);
  const first = readCustomerDeliveryAddress(storage)!;
  first.coordinates.lat = 80;
  assert.equal(readCustomerDeliveryAddress(storage)!.coordinates.lat, 4.6);
});
check('olvidar dirección elimina solo su propia clave', () => {
  const storage = makeStorage();
  storage.data.set('bolt_pets_order_access', 'acceso privado ficticio, conservar');
  saveCustomerDeliveryAddress(selection, storage);
  assert.equal(saveCustomerDeliveryAddress(null, storage), true);
  assert.equal(readCustomerDeliveryAddress(storage), null);
  assert.equal(storage.data.get('bolt_pets_order_access'), 'acceso privado ficticio, conservar');
});
check('JSON corrupto, vacío o excesivo vuelve al estado sin dirección', () => {
  for (const raw of ['', '{not-json', 'undefined', ' '.repeat(10001)]) {
    assert.equal(readCustomerDeliveryAddress({ getItem: () => raw }), null);
  }
});
check('rechaza estructuras antiguas, arrays y valores que no sean una selección completa', () => {
  for (const value of [null, [], 'dirección', 0, true, {}, { ...selection, version: 0 }, { ...selection, version: '1' },
    { address: selection.address, coordinates: point }, { ...selection, coordinates: [4.6, -74.1] }]) {
    assert.equal(readRaw(value), null);
  }
});
check('valida cadenas reales sin aceptar datos de contacto como objetos ni texto vacío', () => {
  for (const address of ['', '   ', null, {}, 123, 'a'.repeat(501), 'Dirección\u0000inyectada']) {
    assert.equal(readRaw({ ...selection, address }), null);
  }
  for (const details of [null, {}, 123, 'a'.repeat(1001), 'Torre\nA']) {
    assert.equal(readRaw({ ...selection, details }), null);
  }
});
check('rechaza coordenadas ausentes, cadenas, no finitas y fuera de rango', () => {
  for (const coordinates of [null, {}, { lat: 4.6 }, { lat: '4.6', lng: -74.1 }, { lat: NaN, lng: -74.1 },
    { lat: Infinity, lng: -74.1 }, { lat: 90.01, lng: 0 }, { lat: -90.01, lng: 0 }, { lat: 0, lng: 180.01 }, { lat: 0, lng: -180.01 }]) {
    assert.equal(saveCustomerDeliveryAddress({ ...selection, coordinates } as any, makeStorage()), false);
  }
});
check('cero y los límites geográficos son coordenadas válidas; cobertura se revalida aparte', () => {
  for (const coordinates of [{ lat: 0, lng: 0 }, { lat: 90, lng: 180 }, { lat: -90, lng: -180 }]) {
    assert.deepEqual(readRaw({ ...selection, coordinates })!.coordinates, coordinates);
  }
});
check('la fecha de confirmación debe ser ISO válida y no estar artificialmente en el futuro', () => {
  for (const confirmedAt of ['', 'hoy', {}, null, '2026-02-31T12:00:00.000Z', '2026-11-03',
    new Date(Date.now() + 60 * 60 * 1000).toISOString()]) {
    assert.equal(readRaw({ ...selection, confirmedAt }), null);
  }
  assert.throws(() => createConfirmedDeliveryAddress('Dirección', '', point, new Date(NaN)));
});
check('direcciones válidas que coincidan con un ejemplo anterior no están prohibidas', () => {
  const chosen = createConfirmedDeliveryAddress('Calle 3 #78-20, Kennedy Central, Bogotá', 'Apto 502, Torre 2', point, fixedTime);
  assert.deepEqual(readRaw(chosen), chosen);
});
check('se excluyen cotizaciones, disponibilidad, credenciales y datos de pago tanto al leer como al guardar', () => {
  const unsafe = { ...selection, quote: { estimatedMinutes: 12, availableCapacity: 10 }, storeId: 'HUB_KENNEDY',
    shipping: 4900, secretDeliveryCode: '0000', accessToken: 'ficticio' };
  const storage = makeStorage();
  assert.deepEqual(readRaw(unsafe), selection);
  assert.equal(saveCustomerDeliveryAddress(unsafe, storage), true);
  assert.deepEqual(JSON.parse(storage.data.get(CUSTOMER_DELIVERY_ADDRESS_KEY)!), selection);
});
check('almacenamiento bloqueado o sin cuota no interrumpe el uso de la aplicación', () => {
  assert.equal(readCustomerDeliveryAddress({ getItem() { throw new Error('Lectura bloqueada'); } }), null);
  const blocked = { setItem() { throw new Error('Sin cuota'); }, removeItem() { throw new Error('Bloqueado'); } };
  assert.equal(saveCustomerDeliveryAddress(selection, blocked), false);
  assert.equal(saveCustomerDeliveryAddress(null, blocked), false);
  const readableButNotRemovable = { ...makeStorage(), removeItem() { throw new Error('Borrado bloqueado'); } };
  assert.equal(saveCustomerDeliveryAddress(selection, readableButNotRemovable), true);
  assert.equal(saveCustomerDeliveryAddress(null, readableButNotRemovable), false);
  assert.deepEqual(readCustomerDeliveryAddress(readableButNotRemovable), selection, 'Un borrado fallido no se anuncia como dirección eliminada del dispositivo');
  assert.equal(saveCustomerDeliveryAddress(selection), false, 'Escritura sin navegador segura');
});
check('no guarda estructuras con prototipos especiales ni propiedades heredadas', () => {
  const inherited = Object.create(selection);
  assert.equal(saveCustomerDeliveryAddress(inherited, makeStorage()), false);
  const inheritedPoint = Object.create(point);
  assert.equal(saveCustomerDeliveryAddress({ ...selection, coordinates: inheritedPoint }, makeStorage()), false);
});
check('una confirmación incompleta no reemplaza una selección previamente guardada', () => {
  const storage = makeStorage(); saveCustomerDeliveryAddress(selection, storage);
  assert.equal(saveCustomerDeliveryAddress({ ...selection, address: '' }, storage), false);
  assert.deepEqual(readCustomerDeliveryAddress(storage), selection);
  assert.throws(() => createConfirmedDeliveryAddress('', '', point, fixedTime));
});

console.log(`DIRECCIÓN RECORDADA: ${checks} comprobaciones aprobadas; almacenamiento ficticio, sin datos operativos.`);
