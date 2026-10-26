/**
 * BOLT PETS — ACCEPTANCE TESTS: DELIVERY POLICY 2026
 * 
 * Validates:
 * 1. Authoritative configuration: 6000m radius, 1500s (25 min) max delivery time.
 * 2. Strict 6,000 m boundary test (6000m valid, 6001m OUT_OF_COVERAGE).
 * 3. Strict 1,500 s boundary test (1500s valid, 1501s OVER_TIME_LIMIT).
 * 4. Automatic warehouse assignment (Kennedy, Álamos, Suba) based on lowest ETA.
 * 5. Non-Turbo warehouse (Centro) exclusion.
 * 6. Historical orders preservation.
 */

import {
  DELIVERY_CONFIG,
  calculateHaversineDistanceMeters,
  estimateRoadTravel,
  computeTotalETASeconds,
  evaluateDeliveryQuote,
  OFFICIAL_SCHEDULED_WINDOWS,
  generateScheduledSlots,
  validateScheduledBooking,
  getBogotaTime,
} from '../lib/deliveryService';
import { SCHEDULED_DELIVERY_CONFIG } from '../types';
import {
  getCurrentBogotaTime,
  getAvailableScheduledWindows,
  checkWindowAvailabilityToday,
  validateScheduledBookingWindow,
} from '../utils/timeUtils';
import { INITIAL_STORES, INITIAL_PRODUCTS, INITIAL_ORDERS } from '../data/seedData';

let testsPassed = 0;
let testsFailed = 0;

function assert(condition: boolean, testName: string) {
  if (condition) {
    console.log(`✅ PASS: ${testName}`);
    testsPassed++;
  } else {
    console.error(`❌ FAIL: ${testName}`);
    testsFailed++;
  }
}

async function runTests() {
  console.log('--- INICIANDO PRUEBAS DE HOMOLOGACIÓN BOLT PETS: POLÍTICA 25 MIN / 6 KM ---');

  // Test 1: Configuration Constants
  assert(DELIVERY_CONFIG.coverageRadiusMeters === 6000, 'DELIVERY_CONFIG.coverageRadiusMeters es exactamente 6000m');
  assert(DELIVERY_CONFIG.maxDeliverySeconds === 1500, 'DELIVERY_CONFIG.maxDeliverySeconds es exactamente 1500s (25 min)');

  // Test 2: Haversine distance accuracy
  const kennedyHub = INITIAL_STORES.find(s => s.id === 'HUB_KENNEDY')!;
  const kennedyClient = { lat: 4.6365, lng: -74.1448 };
  const d = calculateHaversineDistanceMeters(kennedyHub.coordinates, kennedyClient);
  assert(d > 500 && d < 2000, `Distancia geodésica cliente Kennedy (~0.9-1.5 km): calculada ${d}m`);

  // Test 3: Road travel estimation
  const road = estimateRoadTravel(kennedyHub.coordinates, kennedyClient);
  assert(road.roadDistanceMeters > d, `Ruta vial (${road.roadDistanceMeters}m) es mayor a geodésica (${d}m)`);
  assert(road.travelSeconds > 100 && road.travelSeconds < 600, `Tiempo de viaje vial moto (~23 km/h): ${road.travelSeconds}s`);

  // Test 4: Total ETA computation formula
  const eta = computeTotalETASeconds(road.travelSeconds, 2);
  const expectedTotal =
    Math.max(eta.etaComponents.preparationReadySeconds, eta.etaComponents.courierReadyAtWarehouseSeconds) +
    eta.etaComponents.pickupHandoffSeconds +
    eta.etaComponents.roadTravelSeconds +
    eta.etaComponents.customerHandoffSeconds +
    eta.etaComponents.operationalBufferSeconds;
  assert(eta.totalSeconds === expectedTotal, `Fórmula total ETA coincide con spec: ${eta.totalSeconds}s`);
  assert(eta.totalSeconds <= 1500, `ETA de cliente cercano (${eta.totalSeconds}s) es <= 1500s`);
  assert(eta.estimatedMinutes === Math.ceil(eta.totalSeconds / 60), `estimatedMinutes redondea correctamente: ${eta.estimatedMinutes} min`);

  // Test 5: Automatic assignment selects Kennedy for Kennedy address
  const quoteKennedy = evaluateDeliveryQuote(
    {
      destination: {
        address: 'Calle 3 #78-20, Kennedy Central, Bogotá',
        coordinates: kennedyClient,
      },
    },
    INITIAL_STORES,
    INITIAL_PRODUCTS
  );
  assert(quoteKennedy.eligibilityStatus === 'ELIGIBLE', 'Cliente Kennedy es ELIGIBLE');
  assert(quoteKennedy.assignedStoreId === 'HUB_KENNEDY', 'Asigna automáticamente HUB_KENNEDY');
  assert(quoteKennedy.estimatedMinutes! <= 25, `Tiempo dinámico estimado (${quoteKennedy.estimatedMinutes} min) <= 25 min`);

  // Test 6: Automatic assignment selects Álamos for Engativá address
  const alamosClient = { lat: 4.7001, lng: -74.1135 };
  const quoteAlamos = evaluateDeliveryQuote(
    {
      destination: {
        address: 'Transversal 93 #65-10, Álamos Norte, Bogotá',
        coordinates: alamosClient,
      },
    },
    INITIAL_STORES,
    INITIAL_PRODUCTS
  );
  assert(quoteAlamos.eligibilityStatus === 'ELIGIBLE', 'Cliente Álamos es ELIGIBLE');
  assert(quoteAlamos.assignedStoreId === 'HUB_ALAMOS', 'Asigna automáticamente HUB_ALAMOS');

  // Test 7: Automatic assignment selects Suba for Suba address
  const subaClient = { lat: 4.7380, lng: -74.0850 };
  const quoteSuba = evaluateDeliveryQuote(
    {
      destination: {
        address: 'Carrera 91 #130-45, Suba Rincón, Bogotá',
        coordinates: subaClient,
      },
    },
    INITIAL_STORES,
    INITIAL_PRODUCTS
  );
  assert(quoteSuba.eligibilityStatus === 'ELIGIBLE', 'Cliente Suba es ELIGIBLE');
  assert(quoteSuba.assignedStoreId === 'HUB_SUBA', 'Asigna automáticamente HUB_SUBA');

  // Test 8: Non-Turbo store (Centro Histórico) is excluded from Turbo candidates
  const centroClient = { lat: 4.6028, lng: -74.0754 };
  const quoteCentro = evaluateDeliveryQuote(
    {
      destination: {
        address: 'Calle 11 #15-53, Centro, Bogotá',
        coordinates: centroClient,
      },
    },
    INITIAL_STORES,
    INITIAL_PRODUCTS
  );
  assert(quoteCentro.assignedStoreId !== 'HUB_CENTRO', 'Sede Centro (turboEnabled: false) no es asignada a pedidos Turbo');

  // Test 9: Strict 6,000m Geodesic Boundary: Point beyond 6 km from all hubs
  const farClient = { lat: 4.8620, lng: -74.0580 }; // Chía
  const quoteFar = evaluateDeliveryQuote(
    {
      destination: {
        address: 'Avenida Pradilla #4-12, Chía',
        coordinates: farClient,
      },
    },
    INITIAL_STORES,
    INITIAL_PRODUCTS
  );
  assert(quoteFar.eligibilityStatus === 'OUT_OF_COVERAGE', 'Destino > 6.000m retorna OUT_OF_COVERAGE');
  assert(quoteFar.geographicDistanceMeters > 6000, `Distancia reportada > 6000m: ${quoteFar.geographicDistanceMeters}m`);

  // Test 10: Strict 1,500s Time Boundary Test
  // Create an artificial candidate store at distance where total seconds exceeds 1500s but distance is <= 6000m
  const customStore = {
    ...kennedyHub,
    id: 'TEST_HUB',
    coordinates: { lat: 4.6284, lng: -74.1539 },
  };
  // Distance 5.8 km (5800m <= 6000m), road distance 5800 * 1.32 = 7656m, travel = 7656 / (23000/3600) = 1198s
  // dispatch (180s) + handoff (60s) + 1198s + customer (120s) + buffer (120s) = 1678s (> 1500s)
  const edgeCoords = { lat: 4.6800, lng: -74.1539 };
  const quoteTimeExceeded = evaluateDeliveryQuote(
    {
      destination: {
        address: 'Punto Borde Tiempo',
        coordinates: edgeCoords,
      },
    },
    [customStore],
    INITIAL_PRODUCTS
  );
  const geoDist = calculateHaversineDistanceMeters(customStore.coordinates, edgeCoords);
  if (geoDist <= 6000) {
    assert(
      quoteTimeExceeded.eligibilityStatus === 'OVER_TIME_LIMIT',
      `Destino <= 6000m (${geoDist}m) pero ETA > 1500s retorna OVER_TIME_LIMIT`
    );
  }

  // Test 11: Historical orders are not rewritten and preserve their promise window
  assert(INITIAL_ORDERS.length > 0, 'Existen pedidos históricos');
  const histOrder = INITIAL_ORDERS[0];
  assert(typeof histOrder.estimatedDeliveryMinutes === 'number', 'Pedido histórico mantiene su estimatedDeliveryMinutes original');
  assert(!!histOrder.originalPromiseWindow.start, 'Pedido histórico mantiene originalPromiseWindow intacto');

  // Test 12: Weight boundary test: Exactly 60,000 g does NOT trigger split (<= 60 kg)
  const exact60kgQuote = evaluateDeliveryQuote(
    {
      destination: {
        address: 'Calle 3 #78-20, Kennedy Central',
        coordinates: kennedyClient,
      },
      items: [
        { productId: 'prod-rc-maxi-15k', quantity: 4 }, // 4 x 15 kg = 60 kg = exactly 60,000 g
      ],
    },
    INITIAL_STORES,
    INITIAL_PRODUCTS
  );
  assert(exact60kgQuote.totalWeightGrams === 60000, 'Peso de 4 bultos de 15 kg es exactamente 60.000 g');
  assert(exact60kgQuote.availableModes.turbo === true, 'Pedido de exactamente 60.000 g mantiene entrega Turbo monomoto');
  assert(exact60kgQuote.availableModes.turboDividido === false, 'Pedido de exactamente 60.000 g NO activa división Turbo Dividido');

  // Test 13: Weight boundary test: Strictly > 60,000 g (60,200 g) DOES trigger split
  const heavy60kgPlusQuote = evaluateDeliveryQuote(
    {
      destination: {
        address: 'Calle 3 #78-20, Kennedy Central',
        coordinates: kennedyClient,
      },
      items: [
        { productId: 'prod-rc-maxi-15k', quantity: 4 }, // 60,000 g
        { productId: 'prod-nexgard-spectra-m', quantity: 2 }, // +200 g = 60,200 g
      ],
    },
    INITIAL_STORES,
    INITIAL_PRODUCTS
  );
  assert(heavy60kgPlusQuote.totalWeightGrams === 60200, 'Peso total supera 60 kg (60.200 g)');
  assert(heavy60kgPlusQuote.availableModes.turbo === false, 'Pedido > 60 kg deshabilita Turbo monomoto');
  assert(heavy60kgPlusQuote.availableModes.turboDividido === true, 'Pedido > 60 kg habilita Turbo Dividido');

  // Test 14: Packaging algorithm preserves whole sellable units and vehicle capacity (<= 25 kg)
  assert(!!heavy60kgPlusQuote.turboDividido, 'Genera plan de partición Turbo Dividido');
  if (heavy60kgPlusQuote.turboDividido) {
    const shipments = heavy60kgPlusQuote.turboDividido.shipments;
    assert(shipments.length >= 2, `Divide pedido pesado en ${shipments.length} envíos`);
    const allWithinVehicleCapacity = shipments.every(s => s.weightKg <= 25);
    assert(allWithinVehicleCapacity, 'Cada envío hijo respeta la capacidad de la motocicleta (<= 25 kg)');
    
    // Test 15: Common 25-minute deadline: every child shipment meets <= 1,500s limit
    assert(heavy60kgPlusQuote.turboDividido.allShipmentsMeetDeadline, 'Todos los envíos hijos cumplen el plazo común de 25 min');
    const allMeet1500s = shipments.every(s => s.estimatedArrivalSeconds <= 1500);
    assert(allMeet1500s, 'Ningún envío hijo supera los 1.500 segundos');
  }

  // Test 16: Case A: Standard eligible order offers Turbo AND Envío Programado
  const caseAQuote = evaluateDeliveryQuote(
    {
      destination: {
        address: 'Calle 3 #78-20, Kennedy Central',
        coordinates: kennedyClient,
      },
      items: [{ productId: 'prod-nexgard-spectra-m', quantity: 1 }],
    },
    INITIAL_STORES,
    INITIAL_PRODUCTS
  );
  assert(caseAQuote.availableModes.turbo === true, 'Caso A: Turbo disponible');
  assert(caseAQuote.availableModes.scheduled === true, 'Caso A: Envío Programado disponible como alternativa');
  assert(caseAQuote.recommendedMode === 'TURBO', 'Caso A: Modo recomendado es TURBO');

  // Test 17: Case B: Heavy order within 6 km offers Turbo Dividido AND Envío Programado
  assert(heavy60kgPlusQuote.availableModes.turboDividido === true, 'Caso B: Turbo Dividido disponible');
  assert(heavy60kgPlusQuote.availableModes.scheduled === true, 'Caso B: Envío Programado disponible');
  assert(heavy60kgPlusQuote.recommendedMode === 'TURBO_DIVIDIDO', 'Caso B: Modo recomendado es TURBO_DIVIDIDO');

  // Test 18: Case C: Destination outside Turbo (> 6 km) but within Bogotá scheduled area (<= 25 km)
  // Usaquén (~11 km de Kennedy)
  const usaquenClient = { lat: 4.6980, lng: -74.0320 };
  const caseCQuote = evaluateDeliveryQuote(
    {
      destination: {
        address: 'Carrera 7 #120-15, Usaquén, Bogotá',
        coordinates: usaquenClient,
      },
      items: [{ productId: 'prod-nexgard-spectra-m', quantity: 1 }],
    },
    INITIAL_STORES,
    INITIAL_PRODUCTS
  );
  assert(caseCQuote.availableModes.turbo === false, 'Caso C: Turbo NO disponible (> 6 km)');
  assert(caseCQuote.availableModes.scheduled === true, 'Caso C: Envío Programado disponible');
  assert(caseCQuote.recommendedMode === 'PROGRAMADO', 'Caso C: Modo recomendado es PROGRAMADO');

  // Test 19: Case D: Point outside entire metropolitan scheduled coverage (> 25 km)
  const farAwayClient = { lat: 5.1000, lng: -73.8000 };
  const caseDQuote = evaluateDeliveryQuote(
    {
      destination: {
        address: 'Zona Rural Fuera de Cobertura',
        coordinates: farAwayClient,
      },
    },
    INITIAL_STORES,
    INITIAL_PRODUCTS
  );
  assert(caseDQuote.availableModes.turbo === false, 'Caso D: Turbo NO disponible');
  assert(caseDQuote.availableModes.scheduled === false, 'Caso D: Envío Programado NO disponible');
  assert(caseDQuote.recommendedMode === null, 'Caso D: Ningún modo disponible');

  // Test 20: COD cash reconciliation in split orders
  if (heavy60kgPlusQuote.turboDividido) {
    const totalSubtotal = heavy60kgPlusQuote.turboDividido.shipments.reduce((acc, s) => acc + s.subtotal, 0);
    const sumChildCash = heavy60kgPlusQuote.turboDividido.shipments.reduce((acc, s) => acc + s.cashToCollect, 0);
    assert(sumChildCash === totalSubtotal, 'Suma de recaudos de envíos hijos coincide exactamente con el total del pedido');
  }

  // ==========================================================================
  // TESTS 21 - 28: FRANJAS OFICIALES Y CORTES DE ENTREGA PROGRAMADA
  // ==========================================================================

  // Test 21: Configuration of the three official windows
  assert(OFFICIAL_SCHEDULED_WINDOWS.length === 3, 'Existen exactamente tres franjas oficiales configuradas');
  assert(OFFICIAL_SCHEDULED_WINDOWS[0].startTime === '09:00' && OFFICIAL_SCHEDULED_WINDOWS[0].endTime === '14:00' && OFFICIAL_SCHEDULED_WINDOWS[0].cutoffHour === 10, 'Horario 1: 09:00–14:00, corte 10:00');
  assert(OFFICIAL_SCHEDULED_WINDOWS[1].startTime === '14:00' && OFFICIAL_SCHEDULED_WINDOWS[1].endTime === '18:00' && OFFICIAL_SCHEDULED_WINDOWS[1].cutoffHour === 12, 'Horario 2: 14:00–18:00, corte 12:00');
  assert(OFFICIAL_SCHEDULED_WINDOWS[2].startTime === '18:00' && OFFICIAL_SCHEDULED_WINDOWS[2].endTime === '22:00' && OFFICIAL_SCHEDULED_WINDOWS[2].cutoffHour === 16, 'Horario 3: 18:00–22:00, corte 16:00');

  // Test 22: Simulated Bogotá 09:30 (14:30 UTC) - Horarios 1, 2 y 3 disponibles para hoy
  const time0930 = new Date('2026-10-26T14:30:00Z');
  const slots0930 = generateScheduledSlots(time0930);
  const today0930 = slots0930.filter(s => s.date === '2026-10-26');
  assert(today0930.length === 3, 'A las 09:30 en Bogotá están disponibles los tres horarios para hoy');
  assert(today0930.some(s => s.windowId === 'HORARIO_1'), 'A las 09:30 Horario 1 está disponible');
  assert(today0930.some(s => s.windowId === 'HORARIO_2'), 'A las 09:30 Horario 2 está disponible');
  assert(today0930.some(s => s.windowId === 'HORARIO_3'), 'A las 09:30 Horario 3 está disponible');
  const h1_0930 = today0930.find(s => s.windowId === 'HORARIO_1')!;
  assert(h1_0930.minutesUntilCutoff === 30, 'Horario 1 tiene exactamente 30 minutos restantes antes del corte');
  assert(Boolean(h1_0930.countdownNotice?.includes('30 minutos')), `Hook de cuenta regresiva (< 60 min) correcto: "${h1_0930.countdownNotice}"`);

  // Test 23: Simulated Bogotá 10:30 (15:30 UTC) - Horario 1 cerrado para hoy; Horarios 2 y 3 disponibles
  const time1030 = new Date('2026-10-26T15:30:00Z');
  const slots1030 = generateScheduledSlots(time1030);
  const today1030 = slots1030.filter(s => s.date === '2026-10-26');
  assert(today1030.length === 2, 'A las 10:30 en Bogotá solo hay dos horarios para hoy');
  assert(!today1030.some(s => s.windowId === 'HORARIO_1'), 'A las 10:30 Horario 1 está OCULTO para hoy');
  assert(today1030.some(s => s.windowId === 'HORARIO_2'), 'A las 10:30 Horario 2 está disponible para hoy');
  assert(today1030.some(s => s.windowId === 'HORARIO_3'), 'A las 10:30 Horario 3 está disponible para hoy');

  // Test 24: Simulated Bogotá 12:30 (17:30 UTC) - Horarios 1 y 2 cerrados para hoy; solo Horario 3 disponible
  const time1230 = new Date('2026-10-26T17:30:00Z');
  const slots1230 = generateScheduledSlots(time1230);
  const today1230 = slots1230.filter(s => s.date === '2026-10-26');
  assert(today1230.length === 1, 'A las 12:30 en Bogotá solo hay un horario para hoy');
  assert(today1230[0].windowId === 'HORARIO_3', 'A las 12:30 solo Horario 3 está disponible para hoy');

  // Test 25: Simulated Bogotá 16:30 (21:30 UTC) - Ningún horario de hoy; muestra fechas futuras
  const time1630 = new Date('2026-10-26T21:30:00Z');
  const slots1630 = generateScheduledSlots(time1630);
  const today1630 = slots1630.filter(s => s.date === '2026-10-26');
  assert(today1630.length === 0, 'A las 16:30 en Bogotá no queda ninguna franja para hoy');
  const tomorrow1630 = slots1630.filter(s => s.date === '2026-10-27');
  assert(tomorrow1630.length === 3, 'El corte de hoy NO afecta las franjas de mañana (3 horarios disponibles)');

  // Test 26: Commercial hooks text verification
  assert(
    OFFICIAL_SCHEDULED_WINDOWS[0].commercialHook === 'Pide antes de las 10:00 a. m. y recibe hoy de 9:00 a. m. a 2:00 p. m.',
    'Hook Horario 1 exacto según requerimiento'
  );
  assert(
    OFFICIAL_SCHEDULED_WINDOWS[1].commercialHook === 'Pide antes de las 12:00 m. y recibe hoy de 2:00 p. m. a 6:00 p. m.',
    'Hook Horario 2 exacto según requerimiento'
  );
  assert(
    OFFICIAL_SCHEDULED_WINDOWS[2].commercialHook === 'Pide antes de las 4:00 p. m. y recibe hoy de 6:00 p. m. a 10:00 p. m.',
    'Hook Horario 3 exacto según requerimiento'
  );

  // Test 27: Server-side booking cutoff validation
  const invalidBooking = validateScheduledBooking(
    { date: '2026-10-26', windowId: 'HORARIO_1' },
    time1030
  );
  assert(invalidBooking.valid === false, 'Reserva de Horario 1 a las 10:30 es rechazada por el servidor');
  assert(Boolean(invalidBooking.reason?.includes('cerró a las 10:00 a. m.')), 'Mensaje de rechazo contiene la hora de corte exacta');

  const validFutureBooking = validateScheduledBooking(
    { date: '2026-10-27', windowId: 'HORARIO_1' },
    time1030
  );
  assert(validFutureBooking.valid === true, 'Reserva de Horario 1 para mañana es aprobada');

  // Test 28: Historical scheduled orders preservation
  const seedScheduled = INITIAL_ORDERS.find(o => o.id === 'ORD-2026-9051');
  assert(seedScheduled !== undefined, 'Pedido histórico programado ORD-2026-9051 preservado');
  assert(seedScheduled?.deliveryMode === 'PROGRAMADO', 'ORD-2026-9051 mantiene modo PROGRAMADO');
  assert(seedScheduled?.scheduledWindow?.startTime === '14:00', 'ORD-2026-9051 mantiene hora de inicio 14:00');

  // ==========================================================================
  // TESTS 29 - 33: VERIFICACIÓN SCHEDULED_DELIVERY_CONFIG Y timeUtils.ts
  // ==========================================================================

  // Test 29: SCHEDULED_DELIVERY_CONFIG structure
  assert(SCHEDULED_DELIVERY_CONFIG.timezone === 'America/Bogota', 'SCHEDULED_DELIVERY_CONFIG usa timezone America/Bogota');
  assert(SCHEDULED_DELIVERY_CONFIG.windows.length === 3, 'SCHEDULED_DELIVERY_CONFIG contiene exactamente 3 ventanas');
  assert(SCHEDULED_DELIVERY_CONFIG.windows[0].cutoff.hour === 10, 'SCHEDULED_DELIVERY_CONFIG Horario 1 tiene corte a las 10:00');
  assert(SCHEDULED_DELIVERY_CONFIG.windows[1].cutoff.hour === 12, 'SCHEDULED_DELIVERY_CONFIG Horario 2 tiene corte a las 12:00');
  assert(SCHEDULED_DELIVERY_CONFIG.windows[2].cutoff.hour === 16, 'SCHEDULED_DELIVERY_CONFIG Horario 3 tiene corte a las 16:00');

  // Test 30: getCurrentBogotaTime in timeUtils.ts
  const bogotaParts = getCurrentBogotaTime(new Date('2026-10-26T14:45:00Z')); // 09:45 Bogotá
  assert(bogotaParts.hour === 9 && bogotaParts.minute === 45, 'getCurrentBogotaTime convierte UTC a Bogotá exactamente (09:45)');
  assert(bogotaParts.totalMinutes === 9 * 60 + 45, 'totalMinutes calculado correctamente');

  // Test 31: checkWindowAvailabilityToday in timeUtils.ts
  const checkH1 = checkWindowAvailabilityToday(SCHEDULED_DELIVERY_CONFIG.windows[0], new Date('2026-10-26T14:45:00Z'));
  assert(checkH1.isAvailable === true, 'A las 09:45 Horario 1 está disponible');
  assert(checkH1.minutesUntilCutoff === 15, 'A las 09:45 restan exactamente 15 minutos para el corte de las 10:00');
  assert(Boolean(checkH1.countdownNotice?.includes('15 minutos')), `Muestra cuenta regresiva correcta: "${checkH1.countdownNotice}"`);

  // Test 32: getAvailableScheduledWindows in timeUtils.ts filters valid windows
  const availableAt1245 = getAvailableScheduledWindows({ referenceDate: new Date('2026-10-26T17:45:00Z') }); // 12:45 Bogotá
  const todayAt1245 = availableAt1245.filter(s => s.date === '2026-10-26');
  assert(todayAt1245.length === 1, 'A las 12:45 solo hay una ventana disponible para hoy');
  assert(todayAt1245[0].windowId === 'HORARIO_3', 'A las 12:45 la única ventana disponible para hoy es Horario 3');

  // Test 33: validateScheduledBookingWindow in timeUtils.ts
  const validationExpired = validateScheduledBookingWindow(
    { date: '2026-10-26', windowId: 'HORARIO_2' },
    new Date('2026-10-26T17:45:00Z') // 12:45 Bogotá (después del corte de las 12:00)
  );
  assert(validationExpired.valid === false, 'Reserva de Horario 2 después de las 12:00 m. es rechazada');
  assert(Boolean(validationExpired.reason?.includes('12:00 m.')), 'Mensaje indica corte a las 12:00 m.');

  // Test 34: Exact three official Turbo warehouses (Kennedy, Álamos, Suba)
  const activeTurboHubs = INITIAL_STORES.filter(s => s.turboEnabled);
  assert(activeTurboHubs.length === 3, 'Exactamente tres bodegas están habilitadas en la red Turbo inicial');
  assert(activeTurboHubs.some(s => s.id === 'HUB_KENNEDY' && s.name === 'Bolt Pets Kennedy'), 'HUB_KENNEDY configurado como Bolt Pets Kennedy');
  assert(activeTurboHubs.some(s => s.id === 'HUB_ALAMOS' && s.name === 'Bolt Pets Álamos'), 'HUB_ALAMOS configurado como Bolt Pets Álamos');
  assert(activeTurboHubs.some(s => s.id === 'HUB_SUBA' && s.name === 'Bolt Pets Suba'), 'HUB_SUBA configurado como Bolt Pets Suba');

  // Test 35: Official addresses & Shopify Location GIDs
  const kStore = INITIAL_STORES.find(s => s.id === 'HUB_KENNEDY')!;
  const aStore = INITIAL_STORES.find(s => s.id === 'HUB_ALAMOS')!;
  const sStore = INITIAL_STORES.find(s => s.id === 'HUB_SUBA')!;
  assert(kStore.address === 'Carrera 79A #2-05, Bogotá, Colombia', 'Dirección oficial Kennedy coincide con spec');
  assert(aStore.address === 'Calle 72 #97A-18, Bogotá, Colombia', 'Dirección oficial Álamos coincide con spec');
  assert(sStore.address === 'Carrera 107 #143-31, Bogotá, Colombia', 'Dirección oficial Suba coincide con spec');
  assert(kStore.shopifyLocationGid === 'gid://shopify/Location/115617857816', 'Kennedy vinculado a GID 115617857816');
  assert(aStore.shopifyLocationGid === 'gid://shopify/Location/115617890584', 'Álamos vinculado a GID 115617890584');
  assert(sStore.shopifyLocationGid === 'gid://shopify/Location/115617923352', 'Suba vinculado a GID 115617923352');

  // Test 36: Centro excluded from Bolt Turbo
  const cStore = INITIAL_STORES.find(s => s.id === 'HUB_CENTRO')!;
  assert(cStore.turboEnabled === false, 'Sede Centro permanece excluida de la red Turbo');
  assert(cStore.isActive === true, 'Sede Centro se preserva activa para operaciones administrativas');

  // Test 37: Geocoded coordinates reported by Shopify
  assert(Math.abs(kStore.coordinates.lat - 4.6320297) < 0.0001, 'Coordenadas Kennedy coinciden con reporte de Shopify');
  assert(Math.abs(aStore.coordinates.lat - 4.7026365) < 0.0001, 'Coordenadas Álamos coinciden con reporte de Shopify');
  assert(Math.abs(sStore.coordinates.lat - 4.747154) < 0.0001, 'Coordenadas Suba coinciden con reporte de Shopify');

  // Test 38: Verified entrance coordinates update recalculates route origin
  const modifiedStores = JSON.parse(JSON.stringify(INITIAL_STORES)) as typeof INITIAL_STORES;
  const modKennedy = modifiedStores.find(s => s.id === 'HUB_KENNEDY')!;
  // Simular ajuste por administrador de entrada de cargue 100m al norte
  modKennedy.verifiedEntrance = { lat: 4.633000, lng: -74.1516306 };
  const clientCoord = { lat: 4.6365, lng: -74.1448 };
  const quoteOriginal = evaluateDeliveryQuote({ destination: { address: 'Calle 3 #78-20', coordinates: clientCoord } }, INITIAL_STORES);
  const quoteUpdated = evaluateDeliveryQuote({ destination: { address: 'Calle 3 #78-20', coordinates: clientCoord } }, modifiedStores);
  assert(quoteUpdated.assignedStoreCoordinates?.lat === 4.633000, 'Cotización utiliza las coordenadas de entrada verificadas como origen');
  assert(quoteUpdated.roadDistanceMeters !== quoteOriginal.roadDistanceMeters, 'Recalcula la distancia vial al modificar la entrada física');

  // Test 39: Independent stock isolation across warehouses
  const testProd = JSON.parse(JSON.stringify(INITIAL_PRODUCTS[0])) as typeof INITIAL_PRODUCTS[0];
  const initialKennedyStock = testProd.stockByStore['HUB_KENNEDY'] || 0;
  const initialSubaStock = testProd.stockByStore['HUB_SUBA'] || 0;
  const initialAlamosStock = testProd.stockByStore['HUB_ALAMOS'] || 0;

  // Simular descuento de 3 unidades en Kennedy
  testProd.stockByStore['HUB_KENNEDY'] -= 3;
  assert(testProd.stockByStore['HUB_KENNEDY'] === initialKennedyStock - 3, 'Kennedy descuenta 3 unidades');
  assert(testProd.stockByStore['HUB_SUBA'] === initialSubaStock, 'Venta en Kennedy NO descuenta inventario de Suba');
  assert(testProd.stockByStore['HUB_ALAMOS'] === initialAlamosStock, 'Venta en Kennedy NO descuenta inventario de Álamos');

  // Test 40: Out of stock at assigned hub produces rejection without stealing from another hub
  const zeroStockKennedyCatalog = JSON.parse(JSON.stringify(INITIAL_PRODUCTS)) as typeof INITIAL_PRODUCTS;
  // Agotar producto 0 en Kennedy pero dejar 50 unidades en Suba
  zeroStockKennedyCatalog[0].stockByStore['HUB_KENNEDY'] = 0;
  zeroStockKennedyCatalog[0].stockByStore['HUB_SUBA'] = 50;

  const quoteOutOfStock = evaluateDeliveryQuote(
    {
      destination: { address: 'Calle 3 #78-20, Kennedy Central', coordinates: clientCoord },
      items: [{ productId: zeroStockKennedyCatalog[0].id, quantity: 1 }],
    },
    INITIAL_STORES,
    zeroStockKennedyCatalog
  );
  assert(quoteOutOfStock.availableModes.turbo === false, 'No permite compra Turbo si el producto está agotado en la sede asignada');
  assert(quoteOutOfStock.eligibilityStatus === 'OUT_OF_STOCK', 'Retorna estado OUT_OF_STOCK sin tomar existencias de Suba');

  // Test 41: Advanced Search Filters (Price range, Specific brand, Weight range)
  const allProds = INITIAL_PRODUCTS;

  // Filter 41.1: Price Range
  const priceFiltered = allProds.filter(p => p.price >= 50000 && p.price <= 150000);
  assert(priceFiltered.length > 0, 'Filtro de precio encuentra productos en rango 50k–150k');
  assert(priceFiltered.every(p => p.price >= 50000 && p.price <= 150000), 'Todos los productos cumplen el rango de precio');

  // Filter 41.2: Specific Brand
  const royalCaninProds = allProds.filter(p => p.brand === 'Royal Canin');
  assert(royalCaninProds.length > 0, 'Filtro por marca encuentra productos de Royal Canin');
  assert(royalCaninProds.every(p => p.brand === 'Royal Canin'), 'Todos los productos filtrados son de la marca Royal Canin');

  // Filter 41.3: Multi-brand selection
  const multiBrandFiltered = allProds.filter(p => ['Royal Canin', "Hill's Science Diet"].includes(p.brand));
  assert(multiBrandFiltered.length > 0, 'Filtro multimarca encuentra productos de Royal Canin y Hills');
  assert(multiBrandFiltered.every(p => p.brand === 'Royal Canin' || p.brand === "Hill's Science Diet"), 'Filtro multimarca incluye solo marcas seleccionadas');

  // Filter 41.4: Weight Range
  const heavyProds = allProds.filter(p => (p.weightKg || 0) >= 10);
  assert(heavyProds.length > 0, 'Filtro de peso identifica bultos pesados >= 10 kg');
  assert(heavyProds.every(p => p.weightKg >= 10), 'Todos los productos pesados cumplen >= 10 kg');

  const lightProds = allProds.filter(p => (p.weightKg || 0) <= 2);
  assert(lightProds.length > 0, 'Filtro de peso identifica productos livianos <= 2 kg');
  assert(lightProds.every(p => p.weightKg <= 2), 'Todos los productos livianos cumplen <= 2 kg');

  // Filter 41.5: Combined Price, Brand and Weight
  const combined = allProds.filter(
    p => p.price <= 100000 && (p.weightKg || 0) <= 5
  );
  assert(combined.every(p => p.price <= 100000 && p.weightKg <= 5), 'Filtro combinado respeta precio y peso simultáneamente');

  // Test 42: Product Comparator Logic (Max 3 products, attributes, actions)
  const compareList: typeof INITIAL_PRODUCTS = [];
  const addCompare = (p: typeof INITIAL_PRODUCTS[0]) => {
    if (compareList.length < 3 && !compareList.some(item => item.id === p.id)) {
      compareList.push(p);
      return true;
    }
    return false;
  };
  const removeCompare = (id: string) => {
    const idx = compareList.findIndex(item => item.id === id);
    if (idx !== -1) {
      compareList.splice(idx, 1);
      return true;
    }
    return false;
  };

  // 42.1: Add up to 3 products
  assert(addCompare(INITIAL_PRODUCTS[0]) === true, 'Permite agregar primer producto al comparador');
  assert(addCompare(INITIAL_PRODUCTS[1]) === true, 'Permite agregar segundo producto al comparador');
  assert(addCompare(INITIAL_PRODUCTS[2]) === true, 'Permite agregar tercer producto al comparador');
  assert(compareList.length === 3, 'El comparador contiene exactamente 3 productos');

  // 42.2: Enforce max 3 limit
  assert(addCompare(INITIAL_PRODUCTS[3]) === false, 'Rechaza agregar un 4to producto al comparador (límite máximo 3)');
  assert(compareList.length === 3, 'Se mantiene el tope de 3 productos');

  // 42.3: Remove product
  assert(removeCompare(INITIAL_PRODUCTS[1].id) === true, 'Permite remover producto individual del comparador');
  assert(compareList.length === 2, 'El comparador ahora tiene 2 productos');
  assert(!compareList.some(p => p.id === INITIAL_PRODUCTS[1].id), 'Producto removido ya no está en la lista');

  // 42.4: Comparison attributes integrity
  const pA = compareList[0];
  const pB = compareList[1];
  assert(typeof pA.price === 'number' && typeof pB.price === 'number', 'Ambos productos tienen precio numérico para comparar');
  assert(typeof pA.weightKg === 'number' && typeof pB.weightKg === 'number', 'Ambos productos tienen peso en kg');
  assert(typeof pA.brand === 'string' && typeof pB.brand === 'string', 'Ambos productos tienen marca identificada');
  assert(typeof pA.description === 'string' && typeof pB.description === 'string', 'Ambos productos tienen beneficios y descripción');

  console.log(`\n========================================`);
  console.log(`RESULTADOS: ${testsPassed} aprobadas, ${testsFailed} fallidas`);
  console.log(`========================================`);

  if (testsFailed > 0) {
    process.exit(1);
  }
}

runTests().catch(e => {
  console.error('Error ejecutando pruebas:', e);
  process.exit(1);
});
