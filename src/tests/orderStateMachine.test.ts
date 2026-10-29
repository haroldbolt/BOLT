/**
 * BOLT PETS — SUITE DE PRUEBAS DE MÁQUINA DE ESTADOS Y GESTIÓN OPERATIVA REAL
 * 
 * Verifica:
 * 1. Flujo autorizado completo (Happy Path) con PIN de 4 dígitos.
 * 2. Rechazo estricto de transiciones inválidas y saltos prohibidos.
 * 3. Restricción de permisos por rol (Cliente no puede avanzar alistamiento ni marcar entregado).
 * 4. Idempotencia y protección contra pedidos duplicados.
 * 5. Validación de PIN secreto de entrega (Código erróneo rechazado, código válido aceptado).
 * 6. Gestión atómica de stock en cancelaciones (Pre-despacho vs. Post-despacho con retorno físico).
 * 7. Envíos divididos (>60 kg): independencia de estados e IDs estables (shipmentId, assignmentId, tripId).
 * 8. Sincronización del pedido padre: NUNCA se marca ENTREGADO mientras queden envíos pendientes.
 * 9. Auditoría inmutable de cambios (actor, timestamp, anterior, nuevo, motivo).
 * 10. Persistencia real en disco al simular reinicio del servidor.
 */

import { OrdersRepository } from '../lib/ordersRepository';
import { Order, Product, FulfillmentStatus, OrderActor } from '../types';
import { INITIAL_PRODUCTS, INITIAL_ORDERS } from '../data/seedData';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let testsPassed = 0;
let testsFailed = 0;

function assert(condition: boolean, testName: string, detail?: string) {
  if (condition) {
    console.log(`✅ PASS: ${testName}`);
    testsPassed++;
  } else {
    console.error(`❌ FAIL: ${testName} ${detail ? `(${detail})` : ''}`);
    testsFailed++;
  }
}

async function runStateMachineTests() {
  console.log('\n=============================================================');
  console.log('BOLT PETS — TEST SUITE: MÁQUINA DE ESTADOS OPERATIVA PERSISTENTE');
  console.log('=============================================================\n');

  // Repositorio aislado de prueba
  const repo = new OrdersRepository();
  const testProducts: Product[] = JSON.parse(JSON.stringify(INITIAL_PRODUCTS));
  const testStoreId = 'HUB_KENNEDY';

  // -------------------------------------------------------------
  // TEST GROUP 1: CREACIÓN DE PEDIDO Y RESERVA ATÓMICA DE INVENTARIO
  // -------------------------------------------------------------
  console.log('--- 1. Creación de Pedido y Reserva de Stock ---');

  const prod1 = testProducts[0];
  const initialStock = prod1.stockByStore[testStoreId] || 10;
  const initialReserved = prod1.reservedStockByStore[testStoreId] || 0;

  const testOrder1Id = `ORD-TEST-${Date.now()}-A`;
  const testOrder1: Order = {
    id: testOrder1Id,
    orderNumber: '#BP-TEST-01',
    createdAt: new Date().toISOString(),
    storeId: testStoreId,
    storeName: 'Sede Kennedy',
    deliveryMode: 'TURBO',
    customer: {
      name: 'Camila Morales',
      phone: '3157891234',
      email: 'camila.test@boltpets.co',
      isGuest: false,
    },
    deliveryAddress: {
      address: 'Calle 38 Sur #72-10',
      details: 'Apto 402',
      porteriaPolicy: 'LLAMAR_AL_LLEGAR',
      coordinates: { lat: 4.6210, lng: -74.1520 },
    },
    items: [
      {
        productId: prod1.id,
        sku: prod1.sku,
        name: prod1.name,
        brand: prod1.brand,
        presentation: '15 kg',
        price: 185000,
        quantity: 2,
        image: prod1.image || '',
        weightKg: 15,
        requiresPrescription: false,
      },
    ],
    totals: {
      subtotal: 370000,
      discount: 0,
      shipping: 0,
      serviceFee: 1500,
      tip: 0,
      total: 371500,
      totalWeightKg: 30,
    },
    payment: {
      method: 'WOMPI_CARD',
      status: 'APROBADO',
    },
    prescriptionReview: { status: 'NO_REQUIERE' },
    fulfillmentStatus: 'CONFIRMADO',
    secretDeliveryCode: '7412',
    estimatedDeliveryMinutes: 22,
    originalPromiseWindow: {
      start: new Date().toISOString(),
      end: new Date(Date.now() + 22 * 60000).toISOString(),
    },
    timestamps: {
      confirmedAt: new Date().toISOString(),
    },
  };

  const createRes = repo.createOrder(testOrder1, testProducts);
  assert(createRes.success, 'Creación de pedido testOrder1 exitosa');
  assert(testOrder1.assignmentId?.startsWith('ASG-') === true, 'Asignación de ID estable assignmentId generado para GPS');
  assert(testOrder1.tripId?.startsWith('TRP-') === true, 'Asignación de ID estable tripId generado para telemetría');
  assert(
    prod1.reservedStockByStore[testStoreId] === initialReserved + 2,
    'Reserva atómica de inventario aplicada en almacén Kennedy'
  );

  // Duplicado de pedido con el mismo ID debe fallar
  const duplicateRes = repo.createOrder(testOrder1, testProducts);
  assert(!duplicateRes.success, 'Rechazo estricto de pedido con ID duplicado');

  // -------------------------------------------------------------
  // TEST GROUP 2: PERMISOS DE ROL Y SALTOS INVÁLIDOS
  // -------------------------------------------------------------
  console.log('\n--- 2. Permisos de Rol y Transiciones Inválidas ---');

  const clientActor: OrderActor = { role: 'CLIENTE', id: 'camila.test@boltpets.co', name: 'Camila Morales' };
  const pickerActor: OrderActor = { role: 'ALISTADOR', id: 'OP-01', name: 'Mateo (Alistador Kennedy)' };
  const dispatcherActor: OrderActor = { role: 'DESPACHADOR', id: 'OP-02', name: 'Laura (Despachadora)' };
  const driverActor: OrderActor = { role: 'CONDUCTOR', id: 'DRV-CARLOS-01', name: 'Carlos Rodríguez' };

  // A. Cliente intenta pasar a EN_ALISTAMIENTO (Rechazado)
  const clientPickingAttempt = repo.transitionStatus(testOrder1Id, 'EN_ALISTAMIENTO', clientActor);
  assert(!clientPickingAttempt.success && clientPickingAttempt.code === 403, 'Cliente NO puede cambiar estado a EN_ALISTAMIENTO (403)');

  // B. Cliente intenta marcar pedido como ENTREGADO (Rechazado)
  const clientDeliverAttempt = repo.transitionStatus(testOrder1Id, 'ENTREGADO', clientActor);
  assert(!clientDeliverAttempt.success && clientDeliverAttempt.code === 403, 'Un botón de cliente NO puede marcar pedido ENTREGADO (403)');

  // C. Salto inválido: de CONFIRMADO directamente a ENTREGADO sin pasar por alistamiento ni ruta (Rechazado)
  const illegalJump = repo.transitionStatus(testOrder1Id, 'ENTREGADO', { role: 'BODEGA', name: 'Jefe Bodega' }, { deliveryCode: '7412' });
  assert(!illegalJump.success && illegalJump.code === 400, 'Salto inválido directo de CONFIRMADO a ENTREGADO rechazado (400)');

  // D. Salto inválido: de CONFIRMADO directamente a EN_CAMINO sin alistamiento (Rechazado)
  const illegalJump2 = repo.transitionStatus(testOrder1Id, 'EN_CAMINO', driverActor);
  assert(!illegalJump2.success && illegalJump2.code === 400, 'Salto inválido de CONFIRMADO a EN_CAMINO rechazado (400)');

  // -------------------------------------------------------------
  // TEST GROUP 3: HAPPY PATH AUTORIZADO PASO A PASO
  // -------------------------------------------------------------
  console.log('\n--- 3. Happy Path Autorizado Paso a Paso ---');

  // 1. Alistador inicia picking (EN_ALISTAMIENTO)
  const step1 = repo.transitionStatus(testOrder1Id, 'EN_ALISTAMIENTO', pickerActor);
  assert(step1.success && step1.order?.fulfillmentStatus === 'EN_ALISTAMIENTO', 'Paso 1: Transición autorizada a EN_ALISTAMIENTO por Alistador');
  assert(!!step1.order?.timestamps.prepStartedAt, 'Marca de tiempo prepStartedAt registrada');

  // Idempotencia: reenviar EN_ALISTAMIENTO no debe fallar
  const idemStep1 = repo.transitionStatus(testOrder1Id, 'EN_ALISTAMIENTO', pickerActor);
  assert(idemStep1.success, 'Idempotencia: Solicitud repetida a EN_ALISTAMIENTO procesada de forma segura');

  // 2. Alistador finaliza embalaje (LISTO_PARA_DESPACHO)
  const step2 = repo.transitionStatus(testOrder1Id, 'LISTO_PARA_DESPACHO', dispatcherActor, { reason: 'Empaque sellado con precinto #0082' });
  assert(step2.success && step2.order?.fulfillmentStatus === 'LISTO_PARA_DESPACHO', 'Paso 2: Transición autorizada a LISTO_PARA_DESPACHO');
  assert(!!step2.order?.timestamps.prepCompletedAt, 'Marca de tiempo prepCompletedAt registrada');

  // 3. Coordinador asigna repartidor (REPARTIDOR_ASIGNADO)
  const step3 = repo.assignDriver(testOrder1Id, 'DRV-CARLOS-01', { role: 'COORDINADOR', name: 'Jefe Despacho' });
  assert(step3.success && step3.order?.fulfillmentStatus === 'REPARTIDOR_ASIGNADO', 'Paso 3: Conductor asignado y estado REPARTIDOR_ASIGNADO');
  assert(step3.order?.driver?.id === 'DRV-CARLOS-01', 'Datos del conductor Carlos Rodríguez asociados al pedido');

  // 4. Conductor confirma llegada y recogida en hub (EN_CAMINO)
  const step4 = repo.confirmPickup(testOrder1Id, driverActor);
  assert(step4.success && step4.order?.fulfillmentStatus === 'EN_CAMINO', 'Paso 4: Conductor confirma recogida en sede y pasa a EN_CAMINO');
  assert(!!step4.order?.timestamps.pickedUpAt, 'Marca de tiempo pickedUpAt registrada');

  // 5. Intento de entrega con PIN incorrecto (Rechazado)
  const badPinAttempt = repo.verifyDelivery(testOrder1Id, '9999', driverActor, undefined, testProducts);
  assert(!badPinAttempt.success && badPinAttempt.code === 403, 'Intento de entrega con PIN erróneo (9999) rechazado con 403');
  assert(repo.getOrderById(testOrder1Id)?.fulfillmentStatus === 'EN_CAMINO', 'Pedido permanece en EN_CAMINO tras PIN inválido');

  // 6. Entrega autorizada con PIN correcto de 4 dígitos suministrado por el cliente
  const reservedBeforeDelivery = prod1.reservedStockByStore[testStoreId];
  const stockBeforeDelivery = prod1.stockByStore[testStoreId];

  const step5 = repo.verifyDelivery(testOrder1Id, '7412', driverActor, undefined, testProducts);
  assert(step5.success && step5.order?.fulfillmentStatus === 'ENTREGADO', 'Paso 5: Entrega validada exitosamente con PIN secreto 7412');
  assert(!!step5.order?.timestamps.deliveredAt, 'Marca de tiempo deliveredAt registrada');

  // Verificar descuento definitivo de stock físico tras entrega
  assert(
    prod1.stockByStore[testStoreId] === stockBeforeDelivery - 2,
    'Stock físico deducido definitivamente tras entrega con PIN'
  );
  assert(
    prod1.reservedStockByStore[testStoreId] === reservedBeforeDelivery - 2,
    'Reserva de stock liberada y convertida en venta final'
  );

  // 7. Estado terminal: no se permite avanzar un pedido ya ENTREGADO
  const postDeliveryAttempt = repo.transitionStatus(testOrder1Id, 'EN_CAMINO', driverActor);
  assert(!postDeliveryAttempt.success, 'Rechazo de transición en estado terminal ENTREGADO');

  // -------------------------------------------------------------
  // TEST GROUP 4: CANCELACIÓN Y GESTIÓN ATÓMICA DE STOCK
  // -------------------------------------------------------------
  console.log('\n--- 4. Cancelación Pre-despacho vs. Post-despacho y Devolución Física ---');

  // Escenario A: Cancelación Pre-Despacho (CONFIRMADO) -> Stock liberado de inmediato
  const orderPreCancelId = `ORD-TEST-${Date.now()}-PRE`;
  const orderPreCancel: Order = {
    ...JSON.parse(JSON.stringify(testOrder1)),
    id: orderPreCancelId,
    orderNumber: '#BP-TEST-PRE',
    fulfillmentStatus: 'CONFIRMADO',
  };

  const reservedBeforePre = prod1.reservedStockByStore[testStoreId] || 0;
  repo.createOrder(orderPreCancel, testProducts);
  assert(prod1.reservedStockByStore[testStoreId] === reservedBeforePre + 2, 'Stock reservado al crear orderPreCancel');

  // Cliente cancela antes de alistamiento
  const cancelPreRes = repo.transitionStatus(orderPreCancelId, 'CANCELADO', clientActor, {
    reason: 'Cliente cambió de opinión antes del despacho',
    catalogProducts: testProducts,
  });
  assert(cancelPreRes.success && cancelPreRes.order?.fulfillmentStatus === 'CANCELADO', 'Cliente cancela exitosamente en CONFIRMADO');
  assert(
    prod1.reservedStockByStore[testStoreId] === reservedBeforePre,
    'Reserva de stock liberada atómicamente de inmediato en pre-despacho'
  );
  assert(!cancelPreRes.order?.physicalReturnPending, 'No requiere retorno físico pendiente');

  // Escenario B: Cancelación Post-Despacho (EN_CAMINO) -> Mercancía en tránsito, NO reponer stock automáticamente
  const orderPostCancelId = `ORD-TEST-${Date.now()}-POST`;
  const orderPostCancel: Order = {
    ...JSON.parse(JSON.stringify(testOrder1)),
    id: orderPostCancelId,
    orderNumber: '#BP-TEST-POST',
    fulfillmentStatus: 'CONFIRMADO',
  };

  const reservedBeforePost = prod1.reservedStockByStore[testStoreId] || 0;
  repo.createOrder(orderPostCancel, testProducts);

  // Avanzar hasta EN_CAMINO
  repo.transitionStatus(orderPostCancelId, 'EN_ALISTAMIENTO', pickerActor);
  repo.transitionStatus(orderPostCancelId, 'LISTO_PARA_DESPACHO', dispatcherActor);
  repo.assignDriver(orderPostCancelId, 'DRV-CARLOS-01', { role: 'COORDINADOR', name: 'Jefe' });
  repo.confirmPickup(orderPostCancelId, driverActor);

  // Cliente intenta cancelar una vez en camino (Rechazado)
  const clientCancelInTransit = repo.transitionStatus(orderPostCancelId, 'CANCELADO', clientActor);
  assert(!clientCancelInTransit.success && clientCancelInTransit.code === 400, 'Cliente NO puede cancelar cuando el pedido ya está en ruta (400)');

  // Soporte / Bodega cancela por novedad grave en ruta
  const currentReservedPost = prod1.reservedStockByStore[testStoreId];
  const cancelPostRes = repo.transitionStatus(orderPostCancelId, 'CANCELADO', { role: 'SOPORTE', name: 'Agente Soporte' }, {
    reason: 'Dirección inexistente reportada por conductor',
    catalogProducts: testProducts,
  });

  assert(cancelPostRes.success && cancelPostRes.order?.fulfillmentStatus === 'CANCELADO', 'Bodega cancela pedido en ruta con motivo');
  assert(cancelPostRes.order?.physicalReturnPending === true, 'Marcado physicalReturnPending = true por mercancía despachada');
  assert(
    prod1.reservedStockByStore[testStoreId] === currentReservedPost,
    'Stock reservado NO se libera a disponible antes de confirmación física'
  );

  // Confirmación física en bodega
  const returnRes = repo.confirmPhysicalReturn(orderPostCancelId, 'Jefe de Bodega Kennedy', testProducts, 'Paquete recibido sin roturas');
  assert(returnRes.success, 'Confirmación física de devolución procesada');
  assert(returnRes.order?.physicalReturnPending === false, 'Estado physicalReturnPending limpiado');
  assert(
    prod1.reservedStockByStore[testStoreId] === currentReservedPost - 2,
    'Stock reservado reintegrado a inventario vendible tras corroborar devolución física'
  );

  // -------------------------------------------------------------
  // TEST GROUP 5: ENVÍOS DIVIDIDOS (>60 KG, TURBO DIVIDIDO)
  // -------------------------------------------------------------
  console.log('\n--- 5. Envíos Divididos (Turbo Dividido >60 kg) ---');

  const splitOrderId = `ORD-TEST-${Date.now()}-SPLIT`;
  const splitOrder: Order = {
    ...JSON.parse(JSON.stringify(testOrder1)),
    id: splitOrderId,
    orderNumber: '#BP-TEST-SPLIT',
    isSplitOrder: true,
    shipmentCount: 2,
    fulfillmentStatus: 'LISTO_PARA_DESPACHO',
    childShipments: [
      {
        shipmentId: `SHP-${splitOrderId.slice(-4)}-1`,
        shipmentIndex: 1,
        shipmentCount: 2,
        parentOrderId: splitOrderId,
        childOrderId: `${splitOrderId}-A`,
        assignmentId: `ASG-${splitOrderId.slice(-4)}-1`,
        tripId: `TRP-${splitOrderId.slice(-4)}-1`,
        items: [testOrder1.items[0]],
        weightKg: 24,
        weightGrams: 24000,
        subtotal: 185000,
        cashToCollect: 0,
        fulfillmentStatus: 'LISTO_PARA_DESPACHO',
        secretDeliveryCode: '1111',
        estimatedDeliveryMinutes: 20,
        timestamps: { prepCompletedAt: new Date().toISOString() },
      },
      {
        shipmentId: `SHP-${splitOrderId.slice(-4)}-2`,
        shipmentIndex: 2,
        shipmentCount: 2,
        parentOrderId: splitOrderId,
        childOrderId: `${splitOrderId}-B`,
        assignmentId: `ASG-${splitOrderId.slice(-4)}-2`,
        tripId: `TRP-${splitOrderId.slice(-4)}-2`,
        items: [testOrder1.items[0]],
        weightKg: 24,
        weightGrams: 24000,
        subtotal: 185000,
        cashToCollect: 0,
        fulfillmentStatus: 'LISTO_PARA_DESPACHO',
        secretDeliveryCode: '2222',
        estimatedDeliveryMinutes: 20,
        timestamps: { prepCompletedAt: new Date().toISOString() },
      },
    ],
  };

  repo.createOrder(splitOrder, testProducts);
  const child1Id = splitOrder.childShipments![0].shipmentId;
  const child2Id = splitOrder.childShipments![1].shipmentId;

  // Asignar conductores independientes a cada envío
  repo.assignDriver(splitOrderId, 'DRV-CARLOS-01', { role: 'COORDINADOR', name: 'Jefe' }, child1Id);
  repo.assignDriver(splitOrderId, 'DRV-CARLOS-01', { role: 'COORDINADOR', name: 'Jefe' }, child2Id);

  // Conductor 1 recoge envío 1
  repo.confirmPickup(splitOrderId, driverActor, child1Id);
  const splitOrderState1 = repo.getOrderById(splitOrderId);
  assert(splitOrderState1?.fulfillmentStatus === 'EN_CAMINO', 'Pedido padre refleja EN_CAMINO cuando envío 1 inicia ruta');
  assert(splitOrderState1?.childShipments?.[0].fulfillmentStatus === 'EN_CAMINO', 'Envío 1 en estado EN_CAMINO');
  assert(splitOrderState1?.childShipments?.[1].fulfillmentStatus === 'REPARTIDOR_ASIGNADO', 'Envío 2 conserva estado independiente REPARTIDOR_ASIGNADO');

  // Conductor 1 entrega envío 1 con su PIN (1111)
  const deliverChild1 = repo.verifyDelivery(splitOrderId, '1111', driverActor, child1Id, testProducts);
  assert(deliverChild1.success, 'Envío 1 entregado exitosamente con PIN 1111');
  assert(deliverChild1.childShipment?.fulfillmentStatus === 'ENTREGADO', 'Envío 1 pasa a ENTREGADO');

  // CRÍTICO: El pedido padre NO DEBE estar ENTREGADO porque el envío 2 sigue pendiente
  const parentAfterChild1 = repo.getOrderById(splitOrderId);
  assert(parentAfterChild1?.fulfillmentStatus !== 'ENTREGADO', 'Pedido padre NO está ENTREGADO mientras existan envíos pendientes');

  // Intento de forzar pedido completo a ENTREGADO cuando hay envíos pendientes (Rechazado)
  const forceDeliveryAttempt = repo.transitionStatus(splitOrderId, 'ENTREGADO', dispatcherActor, { deliveryCode: '7412' });
  assert(!forceDeliveryAttempt.success, 'Rechazo de entrega total sobre pedido dividido con envíos pendientes');

  // Conductor 2 recoge y entrega envío 2 con su PIN (2222)
  repo.confirmPickup(splitOrderId, driverActor, child2Id);
  const deliverChild2 = repo.verifyDelivery(splitOrderId, '2222', driverActor, child2Id, testProducts);
  assert(deliverChild2.success, 'Envío 2 entregado exitosamente con PIN 2222');

  // Ahora que TODOS los hijos fueron entregados, el pedido padre pasa automáticamente a ENTREGADO
  const finalParent = repo.getOrderById(splitOrderId);
  assert(finalParent?.fulfillmentStatus === 'ENTREGADO', 'Pedido padre pasa a ENTREGADO automáticamente solo cuando TODOS los envíos hijos fueron entregados');

  // -------------------------------------------------------------
  // TEST GROUP 6: AUDITORÍA INMUTABLE Y TRAZABILIDAD
  // -------------------------------------------------------------
  console.log('\n--- 6. Historial de Auditoría Inmutable ---');

  const history = repo.getAuditHistory(testOrder1Id);
  assert(history.length >= 5, `Historial completo registrado con ${history.length} eventos de auditoría`);
  
  const sampleEntry = history[history.length - 1];
  assert(!!sampleEntry.actor?.role, 'Auditoría registra rol del actor autorizado');
  assert(!!sampleEntry.previousStatus && !!sampleEntry.newStatus, 'Auditoría registra previousStatus y newStatus');
  assert(!!sampleEntry.timestamp, 'Auditoría registra timestamp en formato ISO');
  assert(!!sampleEntry.reason, 'Auditoría registra motivo explícito de la transición');

  // -------------------------------------------------------------
  // TEST GROUP 7: PERSISTENCIA AL REINICIAR SERVIDOR
  // -------------------------------------------------------------
  console.log('\n--- 7. Persistencia Real en Disco al Reiniciar ---');

  // Simular apagado y arranque de un nuevo proceso del servidor instanciando un nuevo OrdersRepository
  const restartedRepo = new OrdersRepository();
  const recoveredOrder = restartedRepo.getOrderById(testOrder1Id);

  assert(!!recoveredOrder, 'Pedido recuperado de disco tras reinicio del servidor');
  assert(recoveredOrder?.fulfillmentStatus === 'ENTREGADO', 'Estado ENTREGADO preservado intacto en disco');
  assert(recoveredOrder?.timestamps.deliveredAt === step5.order?.timestamps.deliveredAt, 'Timestamp de entrega preservado en disco');
  assert(!!recoveredOrder?.statusHistory && recoveredOrder.statusHistory.length >= 5, 'Historial de auditoría preservado en disco tras reinicio');

  const recoveredSplit = restartedRepo.getOrderById(splitOrderId);
  assert(!!recoveredSplit && recoveredSplit.fulfillmentStatus === 'ENTREGADO', 'Pedido dividido preservado en disco con todos los hijos entregados');
  assert(recoveredSplit?.childShipments?.[0].fulfillmentStatus === 'ENTREGADO', 'Estado de envíos hijos preservado');

  // =============================================================
  // RESUMEN DE PRUEBAS
  // =============================================================
  console.log('\n=============================================================');
  console.log(`RESULTADOS: ${testsPassed} aprobadas, ${testsFailed} fallidas`);
  console.log('=============================================================\n');

  if (testsFailed > 0) {
    process.exit(1);
  }
}

runStateMachineTests().catch(err => {
  console.error('Error ejecutando tests de máquina de estados:', err);
  process.exit(1);
});
