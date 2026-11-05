import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Order, GPSTelemetry, OrderActor } from '../types';

const directories: string[] = [];
const temporary = () => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bolt-gps-test-')); directories.push(dir); return dir; };
const previousDataDir = process.env.BOLT_DATA_DIR;
process.env.BOLT_DATA_DIR = temporary();
const { OrdersRepository } = await import('../lib/ordersRepository');
const { INITIAL_ORDERS, INITIAL_DRIVERS } = await import('../data/seedData');
let passed = 0;
function check(name: string, run: () => void) { run(); passed++; console.log(`PASS: ${name}`); }
const actor: OrderActor = { role: 'CONDUCTOR', id: INITIAL_DRIVERS[0].id, name: 'Conductor de prueba' };
const admin: OrderActor = { role: 'ADMINISTRADOR', id: 'ADMIN-TEST', name: 'Prueba' };
const fixture = (id: string): Order => ({
  ...structuredClone(INITIAL_ORDERS[0]), id, orderNumber: id, isSplitOrder: false, childShipments: undefined,
  fulfillmentStatus: 'EN_CAMINO', assignmentId: `${id}-ASG`, tripId: `${id}-TRIP`, driver: structuredClone(INITIAL_DRIVERS[0]),
});
const point = (order: Order, suffix = '1', seq = 1): GPSTelemetry => ({
  pointId: `${order.id}-POINT-${suffix}`, orderId: order.id, driverId: order.driver!.id,
  assignmentId: order.assignmentId!, tripId: order.tripId!, latitude: 4.65, longitude: -74.10,
  accuracy: 10, timestamp: Date.now(), sequenceNumber: seq,
});
function repoFor(...orders: Order[]) { return new OrdersRepository({ dataDir: temporary(), initialOrders: orders, initialDrivers: structuredClone(INITIAL_DRIVERS) }); }

try {
  const order = fixture('GPS-ORDEN');
  const repo = repoFor(order);
  const first = point(order);
  check('acepta un punto real de un recorrido activo', () => assert.equal(repo.recordTelemetry(first, actor).success, true));
  check('el próximo contador viene del servidor', () => assert.equal(repo.getNextTelemetrySequence(order.id), 2));
  check('reintento idéntico es idempotente sin duplicar historial', () => {
    const out = repo.recordTelemetry(first, actor);
    assert.equal(out.success, true); assert.equal(out.duplicate, true); assert.equal(repo.getTelemetryHistory(order.id).length, 1);
  });
  check('mismo pointId no puede cambiar coordenadas', () => assert.equal(repo.recordTelemetry({ ...first, latitude: 4.66 }, actor).code, 409));
  check('reiniciar desde la secuencia anunciada permite continuar', () => {
    const resumed = point(order, 'RESUME', repo.getNextTelemetrySequence(order.id));
    assert.equal(repo.recordTelemetry(resumed, actor).success, true);
  });
  check('secuencia repetida devuelve el siguiente contador esperado', () => {
    const out = repo.recordTelemetry(point(order, 'OTHER', 1), actor); assert.equal(out.code, 409); assert.equal(out.nextSequenceNumber, 3);
  });
  for (const field of ['pointId', 'driverId', 'assignmentId', 'tripId', 'timestamp', 'sequenceNumber']) {
    check(`rechaza campo obligatorio ausente: ${field}`, () => {
      const input = point(order, `MISSING-${field}`, 3) as any; delete input[field]; assert.equal(repo.recordTelemetry(input, actor).success, false);
    });
  }
  for (const value of [0, -1, 1.5, NaN, Infinity]) {
    check(`rechaza secuencia inválida ${String(value)}`, () => assert.equal(repo.recordTelemetry({ ...point(order, `SEQ-${String(value)}`, 3), sequenceNumber: value }, actor).success, false));
  }
  for (const value of [NaN, Infinity, Date.now() - 301_000, Date.now() + 31_000]) {
    check(`rechaza fecha inválida ${String(value)}`, () => assert.equal(repo.recordTelemetry({ ...point(order, `TIME-${String(value)}`, 3), timestamp: value }, actor).success, false));
  }
  for (const value of [NaN, Infinity, -Infinity, 5]) {
    check(`rechaza latitud inválida ${String(value)}`, () => assert.equal(repo.recordTelemetry({ ...point(order, `LAT-${String(value)}`, 3), latitude: value }, actor).success, false));
  }
  check('rechaza precisión insuficiente', () => assert.equal(repo.recordTelemetry({ ...point(order, 'BAD-ACCURACY', 3), accuracy: 201 }, actor).success, false));
  check('rechaza actor sin identidad', () => assert.equal(repo.recordTelemetry(point(order, 'NO-ACTOR', 3), { role: 'CONDUCTOR', name: 'Sin ID' }).code, 403));
  check('rechaza otro conductor', () => assert.equal(repo.recordTelemetry(point(order, 'OTHER-ACTOR', 3), { ...actor, id: 'OTRO' }).code, 403));
  check('rechaza driverId del punto incorrecto aunque el actor sea administrador', () => assert.equal(repo.recordTelemetry({ ...point(order, 'OTHER-DRIVER', 3), driverId: 'OTRO' }, admin).code, 403));
  check('rechaza fecha regresiva dentro de la ventana permitida', () => assert.equal(repo.recordTelemetry({ ...point(order, 'REGRESSIVE', 3), timestamp: first.timestamp - 1 }, actor).success, false));

  const split = fixture('GPS-DIVIDIDO');
  split.isSplitOrder = true;
  split.childShipments = ['A', 'B'].map((suffix, index) => ({
    shipmentId: `HIJO-${suffix}`, shipmentIndex: index + 1, shipmentCount: 2, parentOrderId: split.id,
    assignmentId: `ASG-${suffix}`, tripId: `TRIP-${suffix}`, items: structuredClone(split.items),
    weightKg: 10, weightGrams: 10000, subtotal: 0, cashToCollect: 0, fulfillmentStatus: 'EN_CAMINO',
    secretDeliveryCode: '0000', estimatedDeliveryMinutes: 20, driver: structuredClone(INITIAL_DRIVERS[0]), timestamps: {},
  }));
  const splitDir = temporary();
  const splitRepo = new OrdersRepository({ dataDir: splitDir, initialOrders: [split], initialDrivers: structuredClone(INITIAL_DRIVERS) });
  const childPoint = (index: number): GPSTelemetry => ({ ...point(split, String(index)), shipmentId: split.childShipments![index].shipmentId, assignmentId: split.childShipments![index].assignmentId!, tripId: split.childShipments![index].tripId! });
  check('pedido dividido exige seleccionar un hijo', () => assert.equal(splitRepo.recordTelemetry(point(split), actor).success, false));
  check('hijo rechaza asignación y recorrido del padre', () => assert.equal(splitRepo.recordTelemetry({ ...point(split), shipmentId: 'HIJO-A' }, actor).success, false));
  check('hijo A acepta su contexto', () => assert.equal(splitRepo.recordTelemetry(childPoint(0), actor).success, true));
  check('hijo B mantiene contador independiente', () => assert.equal(splitRepo.recordTelemetry(childPoint(1), actor).success, true));
  check('padre no devuelve ubicaciones mezcladas de hijos', () => { assert.equal(splitRepo.getLatestTelemetry(split.id), null); assert.deepEqual(splitRepo.getTelemetryHistory(split.id), []); });
  check('cada hijo conserva únicamente su ubicación', () => { assert.equal(splitRepo.getLatestTelemetry(split.id, 'HIJO-A')!.shipmentId, 'HIJO-A'); assert.equal(splitRepo.getLatestTelemetry(split.id, 'HIJO-B')!.shipmentId, 'HIJO-B'); });
  check('recupera GPS y contadores desde la carpeta privada', () => {
    const recovered = new OrdersRepository({ dataDir: splitDir, initialOrders: [], initialDrivers: [] });
    assert.equal(recovered.getTelemetryHistory(split.id, 'HIJO-A').length, 1); assert.equal(recovered.getNextTelemetrySequence(split.id, 'HIJO-A'), 2);
  });
  check('un cambio de asignación no presenta el punto del recorrido anterior como actual', () => {
    const trackedChild = splitRepo.getOrderById(split.id)!.childShipments![0];
    trackedChild.tripId = 'NUEVO-RECORRIDO';
    assert.equal(splitRepo.getLatestTelemetry(split.id, 'HIJO-A'), null);
    assert.equal(splitRepo.getTelemetryHistory(split.id, 'HIJO-A').length, 1);
    assert.equal(splitRepo.getNextTelemetrySequence(split.id, 'HIJO-A'), 2);
  });
  check('reintento idéntico tras cierre no añade puntos; nuevas lecturas se rechazan', () => {
    repo.getOrderById(order.id)!.fulfillmentStatus = 'ENTREGADO';
    assert.equal(repo.recordTelemetry(first, actor).success, true);
    assert.equal(repo.recordTelemetry(point(order, 'CLOSED', 3), actor).success, false);
    assert.equal(repo.getTelemetryHistory(order.id).length, 2);
  });
  check('el guardado contiene pedidos, auditoría y telemetría en un archivo privado', () => {
    const state = JSON.parse(fs.readFileSync(path.join(splitDir, 'operations-state.json'), 'utf8'));
    assert.equal(state.version, 1); assert(Array.isArray(state.orders)); assert(Array.isArray(state.auditHistory)); assert(state.telemetryHistory);
    assert.equal(fs.readdirSync(splitDir).filter(file => file.endsWith('.tmp')).length, 0);
  });
  console.log(`GPS: ${passed} comprobaciones aprobadas.`);
} finally {
  if (previousDataDir === undefined) delete process.env.BOLT_DATA_DIR; else process.env.BOLT_DATA_DIR = previousDataDir;
  for (const dir of directories) {
    if (path.dirname(path.resolve(dir)) !== path.resolve(os.tmpdir()) || !path.basename(dir).startsWith('bolt-gps-test-')) throw new Error('Ruta temporal no válida');
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
