# BOLT: una compra, varias entregas

La implementación utiliza la cotización, catálogo por variante, repositorio de pedidos, inventario, conductores, PIN y seguimiento existentes. No crea pedidos al modificar el carrito o cotizar. Los pedidos nuevos necesitan una cotización vigente y su identificador de idempotencia. La flota ficticia no forma parte de la configuración operativa predeterminada.

## Reglas del servidor

- Turbo: 50.000 g de base por despacho; los productos no elegibles juntos no pueden superar esa base.
- Hasta 3.000 g adicionales acumulados de productos explícitamente aptos, no voluminosos, de hasta 3.000 g por unidad, en categorías candidatas. Comida, arena y otras categorías no reciben margen. Accesorios requieren tipo JUGUETES o MODA para ser candidatos.
- Cada peso, embalaje y dimensión corresponde a la unidad vendible de la variante. Datos faltantes bloquean la confirmación con información pendiente; nunca se convierten en cero. Dimensiones incluyen embalaje.
- Peso físico = productos + embalaje por unidad + embalaje por vehículo. Siempre debe caber en la carga útil verificada; también se comprueban volumen útil y acomodo de cajas completas, con rotación y sin compresión.
- Se colocan primero unidades pesadas/voluminosas; los extras aprovechan despachos existentes. El algoritmo de acomodo es conservador, no garantiza el mínimo matemático de vehículos para cualquier geometría.
- El máximo por compra, disponibilidad y modalidades por sede se respetan. Un conductor ocupado no se vuelve a reservar para otro Turbo. Programado requiere disponibilidad explícita para su franja y evita doble reserva en ella.
- Una unidad indivisible que no cabe puede ofrecerse para Programado solo si hay un vehículo y franja con capacidad comprobada. Programado conserva la asignación territorial existente (Usaquén/Cedritos → Suba).
- La tarifa vigente se cobra por compra: transporte y servicio una vez. La cotización incluye el umbral de transporte gratis. No se ha añadido una tarifa por moto ni un nuevo cobro bancario.

## Confirmación, stock y seguimiento

La propuesta muestra sede, modalidad, entregas, unidades, pesos con embalaje, tiempo/franja y total antes de confirmar. Un token enlaza destino, modalidad, franja, precios, costo, vehículos y distribución. Si algo cambia, el servidor exige recotizar; no crea silenciosamente una compra distinta.

Una compra principal mantiene hijos con identificadores estables, la misma sede, unidades exactas, vehículo/conductor y PIN independiente. El servidor comprueba que la suma de hijos sea exactamente la compra original. Stock se reserva una vez desde el padre; las ventas/devoluciones se contabilizan desde los hijos. Reintentar la misma confirmación devuelve la misma compra. El PIN usa el mecanismo existente; cada hijo tiene un código diferente.

La administración muestra los hijos en el mismo panel. Una entrega parcial no marca toda la compra como ENTREGADA. Solo se libera el inventario de la entrega cancelada; cuando ya salió, la reserva se conserva hasta confirmar su devolución física. Las entregas realizadas no se revierten por cancelar otra. La conciliación monetaria/reembolso sigue el mecanismo existente; no se incorporó una pasarela nueva. El seguimiento solicita GPS por hijo y muestra pendiente si no hay telemetría, sin inventar una ubicación.

## Administración y almacenamiento

En `/admin` → **Flota & Repartidores**, con sesión administrativa:

1. Configurar límite base, margen, máximo de repartidores y tarifas por compra. Dejar el tope vacío elimina el máximo logístico; 0 pausa confirmaciones.
2. Asociar un vehículo a un conductor ya registrado. Seleccionar sedes y modalidades. Registrar carga útil, medidas, volumen útil y embalaje adicional verificados; habilitar solo tras confirmar esos datos.
3. Marcar las franjas programadas en las que realmente estará disponible. Revisarlas al avanzar los días.
4. Buscar un producto por nombre/SKU, seleccionar su presentación y guardar peso, embalaje, dimensiones, condición voluminoso y aptitud para margen. No basta marcar aptitud: el servidor valida categoría y peso.
5. Cotizar una compra representativa antes de habilitar operaciones reales. Cambios posteriores no reasignan pedidos confirmados.

Se reutilizan los IDs de sedes y conductores. Registrar una sede nueva no le asigna territorios automáticamente. Su cobertura sigue gestionándose en la configuración territorial existente; no hay ramas de UI específicas por sede.

- `.bolt-private/transport-config.json`: configuración central, revisión optimista y auditoría administrativa.
- Catálogo existente y sus overrides: atributos físicos por presentación, auditados; precios e inventario permanecen en sus mecanismos actuales.
- `.bolt-private/catalog-operations.json`: conserva el inventario y sus movimientos tras reiniciar. Si no existía, se establece una base sin sumar unidades, importar precios ni reprocesar pedidos históricos.
- `src/data/persisted-orders.json`, conductores, auditoría y telemetría existentes. `BOLT_DATA_DIR` permite separar esos archivos para pruebas.

La configuración predeterminada mantiene 50 kg + margen 3 kg, pero contiene **cero vehículos y proveedores habilitados, y tope operativo opcional sin límite fijo (`null`)**. No debe desplegarse para ventas antes de cargar datos reales. El carrito conserva selecciones mientras falten datos; la confirmación queda bloqueada con el motivo específico.

## Simulación reproducible

Los fixtures están exclusivamente en `src/tests/transportFixtures.ts` y el inicializador de pruebas. Usan Kennedy 3, Álamos 2 y Suba 3 vehículos; máximo 3 solo en ese fixture inicial; caja 80×60×60 cm, como escenario solicitado.

**Supuestos añadidos solo para probar la excepción:** carga física 55 kg, embalaje 500 g por vehículo y 100 g por unidad; cajas de productos 30×20×10 cm salvo el voluminoso. No son capacidades medidas ni datos del catálogo real. Los productos llevan `SIMULACIÓN` y precios ficticios de COP 10.000, sin ofertas. Las coordenadas del destino de ensayo están identificadas como fixture; no prueban un domicilio comercial real.

```sh
npm test
npm run lint
npm run build
node --import tsx scripts/transport-simulation.ts /tmp/bolt-transport-simulation-nueva
cd /tmp/bolt-transport-simulation-nueva
PORT=3010 npm run dev
```

El inicializador rechaza directorios existentes y no copia pedidos, credenciales, archivos privados ni `.env`. Los módulos instalados pueden reutilizarse mediante un enlace local. Para entrar al administrador de esta copia, usar credenciales de prueba separadas mediante el mecanismo existente `BOLT_ADMIN_EMAIL`/`BOLT_ADMIN_PASSWORD` al iniciar, nunca credenciales reales en el código.

En otro terminal, únicamente contra esa simulación:

```sh
BOLT_TRANSPORT_TEST_URL=http://localhost:3010 node --import tsx src/tests/transportHttp.test.ts
```

El ensayo HTTP crea pedidos ficticios contra entrega, mueve estados y confirma una devolución parcial; no hace cobros reales. Exige el puerto dedicado y el catálogo SIMULACIÓN. Se puede repetir si quedan al menos dos vehículos libres en Kennedy.

## Archivos principales

- `src/types/transport.ts`, `src/types/index.ts`: atributos, vehículos y cargas.
- `src/lib/transportPlanner.ts`, `externalDelivery.ts`, `transportQuote.ts`, `transportRepository.ts`, `deliveryService.ts`: distribución, disponibilidad, tarifas y configuración autoritativa.
- `server.ts`, `src/lib/ordersRepository.ts`, `catalogOperations.ts`, `variantCommerce.ts`, `presentationSelection.ts`, `api.ts`: creación, reservas, seguimiento, atributos y contratos existentes.
- `src/components/customer/DeliveryPlanSummary.tsx`, `CartDrawer.tsx`, `CheckoutModal.tsx`, `OrderTracking.tsx`, `AddressConfirmationModal.tsx`, `src/App.tsx`: propuesta y recorrido del cliente.
- `src/components/operations/TransportManagerTab.tsx`, `ExternalProviderFields.tsx`, `GroupedDispatches.tsx`, `OperationsDashboard.tsx`: capacidades y entregas dentro de administración.
- `src/tests/transport.test.ts`, `transportHttp.test.ts`, `transportFixtures.ts`, ajustes en pruebas de cobertura/cotización y estados; `scripts/transport-simulation.ts`, `package.json`.

Las tarjetas, variantes y persistencia de invitado se conservan. No se vuelve a ejecutar el lote de +6 ni Shopify.

## Red externa y ampliación posterior

No hay un máximo permanente de tres, ni cantidades fijas por sede. El plan usa las unidades completas y la flota disponible. `maxDispatches: null` significa sin tope comercial de repartidores; cualquier entero no negativo permite establecer un límite operativo (0 pausa). Existe un resguardo técnico explícito de 1.000 unidades por cálculo, distinto de un límite logístico. Se probó una distribución de 30 despachos disponibles.

En Flota & Repartidores, **Red externa · simulación** permite registrar nombre/ID, sedes, modalidades, respuesta aceptada/demorada/rechazada, hora de respuesta, vencimiento, vehículos ofrecidos, costo y ETA, carga admitida, medidas/volumen, embalaje y franjas. El escenario de demora no aporta capacidad antes de su respuesta; rechazo, vencimiento o plazo incompatible con Turbo tampoco garantizan repartidores. No se realizan llamadas a Rappi.

El adaptador `src/lib/externalDelivery.ts` aporta únicamente ofertas simuladas aceptadas y vigentes. La capacidad física de cada oferta se somete a las mismas reglas 50+3, espacio y embalaje. Se usan primero vehículos propios y se agregan ofertas externas según necesidad. Pedidos confirmados mantienen sus ofertas y conductores como snapshot; la configuración no los reasigna.

La tarifa de flota propia sigue aplicándose una vez si participa. Se suman los importes **explícitamente cotizados** por los despachos externos utilizados; el servicio se aplica una vez. El beneficio de transporte gratis de BOLT no se promete para cargos externos. Antes de confirmar se muestra el total, el costo de cada entrega externa y su ETA. Un cambio de oferta o costo exige recotizar y confirmar nuevamente. El ensayo externo utiliza COP 8.000 por entrega y 20 minutos, valores **ficticios**, sin modificar tarifas reales.

Se probó por HTTP una compra mixta de 5 despachos (2 propios disponibles + 3 externos simulados), total ficticio COP 80.400, reintento idempotente, asignación y seguimiento por hijo; el pedido HTTP fue cancelado mediante sus estados, preservando el historial.

**Pendiente para una operación externa real:** contrato/acceso del proveedor, adaptador de cotización y aceptación/reserva real con idempotencia, cancelación/compensación, tarifas y capacidades verificadas, webhooks de disponibilidad/seguimiento y pruebas del proveedor. Configurar `RAPPI` como si estuviera integrado es rechazado. La simulación no es evidencia de que Rappi acepte esta carga ni de que haya repartidores reales.

El ensayo HTTP externo requiere credenciales ficticias fuera del repositorio:

```sh
BOLT_TRANSPORT_TEST_URL=http://localhost:3010 BOLT_TRANSPORT_TEST_ADMIN=/ruta/privada/test-admin.json node --import tsx src/tests/externalTransportHttp.test.ts
```

Solo admite un usuario `@example.invalid`. La configuración permanece en la copia aislada para revisarla; nunca en la configuración predeterminada del código.

## Validación de esta implementación (7 de noviembre de 2026)

- Suite completa: **370 comprobaciones aprobadas**, incluidas 30 de transporte y las regresiones de cobertura, variantes, carrito, estados, catálogo y notificaciones. TypeScript y compilación aprobados; Vite conserva su aviso de tamaño del bundle.
- HTTP en puerto aislado: 8 escenarios de peso/espacio, cotizaciones sin pedidos, creación agrupada, repetición idempotente, concurrencia de capacidad, precios autoritativos, PIN erróneo, entrega parcial, devolución parcial y protección administrativa.
- HTTP externo: aceptación, demora, rechazo, caducidad, cambio de precio con nueva confirmación, 5 entregas mixtas, reserva/seguimiento y asignación. Los fixtures HTTP se finalizan mediante los estados existentes; no se borran históricos.
- Navegador: carrito → checkout → compra `#BP-15B1D21D` con 5 unidades indivisibles de 50 kg, 2 vehículos propios y 3 externos simulados. COP 50.000 de productos + COP 28.900 de transporte + COP 1.500 de servicio = COP 80.400. Sin propina ni pago real. 5 unidades reservadas una sola vez, 5 PIN distintos y todos los hijos en Kennedy.
- Tras reiniciar el servidor, se verificaron otra vez la misma compra, sus 5 hijos, asignación, stock y seguimiento de la entrega externa 3. Otra compra ficticia de 3 bolsas de 20 kg conserva una entrega de 40 kg completada y otra de 20 kg pendiente, sin marcar toda la compra entregada.
- Guardado de capacidades y atributos físicos comprobado en el administrador; revisión y auditoría conservadas. El inicializador de simulación fue ejecutado en un directorio nuevo, fuera de la app existente.
- La comprobación visual se realizó en el navegador integrado con ancho efectivo de 490 px. No se afirma una validación visual de escritorio completo; el suite incluye las pruebas de composición responsive existentes.
- 126 archivos protegidos de la app local original se compararon mediante SHA-256 y permanecen iguales, incluidos sus datos privados, inventarios y pedidos. La implementación y sus fixtures se alojan en una copia separada.
