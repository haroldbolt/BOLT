# BOLT: asignación y seguimiento de despachos

## Alcance y operación segura

Implementación backend sobre `OrdersRepository`, `ChildShipment`, la máquina de estados, `TransportRepository`, el planificador de bultos y el inventario derivado de pedidos existentes. No crea otra compra al buscar, ofertar, aceptar o reasignar. No modifica precios ni ejecuta importaciones ni ajustes de inventario.

La aplicación BOLT Conductor nativa no está en este repositorio. Este cambio entrega sus endpoints y DTO. El panel administrativo consume el resumen agrupado nuevo; todavía necesita conectar sus controles específicos de ofertas, búsqueda, conciliación y custodia. La tienda conserva su contrato de pedidos y obtiene acceso privado a sus compras nuevas desde `api.ts`; los datos nuevos de despachos/eventos se incluyen en pedido y tracking para conectar la visualización detallada. No se promete que los tres paneles tengan ya implementadas todas estas pantallas.

Rappi e inDrive NO están conectados ni habilitados. El proceso normal de `server.ts` no registra proveedores externos ni utiliza disponibilidad ficticia para cotizar. Los adaptadores simulados se inyectan exclusivamente en pruebas. La flota propia requiere una cuenta de conductor, capacidades en la configuración de transporte, turno, ubicación y heartbeat vigentes. Los conductores semilla no se consideran disponibles por defecto.

## Identidad, privacidad y códigos

- Administración reutiliza `/auth/login` y `AdminAuthService`: Bearer de sesión verificado en servidor. Las cabeceras `x-actor-role`, `x-driver-id` y los roles enviados en JSON no dan permisos.
- BOLT Conductor: `POST /driver/auth/login` con correo/contraseña de una cuenta provisionada por administración. Contraseñas con scrypt y sal; tokens aleatorios opacos de 256 bits, guardados como hash y con caducidad. NO se implementó JWT ni Firebase en este cambio. Cinco intentos fallidos bloquean temporalmente el acceso. Suspender una cuenta revoca sus sesiones.
- Invitado: crear un pedido devuelve `guestAccessToken`. `api.ts` guarda exclusivamente el mapa privado de acceso en `bolt_guest_order_access_v1` y envía `X-Order-Token` en las consultas de esa compra. Es independiente de las claves de carrito y direcciones. No debe enviarse en URLs, analítica ni logs.
- Consultar todos los pedidos y la auditoría/telemetría histórica requiere administración. El invitado consulta únicamente los IDs de compras para las que tiene una capacidad privada. La tienda ya no recurre a pedidos semilla si la consulta falla.
- Compra visible: `BP-000001`. Entregas: `BP-000001-E01`, `BP-000001-E02`, etc. El servidor genera los códigos al confirmar la compra y los conserva al reintentar o cambiar conductor. El contador se persiste con el pedido. Los UUID y `assignmentId` originales siguen siendo los identificadores internos.
- El PIN de cada entrega permanece en el pedido protegido. El DTO del conductor nunca contiene PIN, fórmula veterinaria, credenciales ni el pedido completo. Verificar la entrega requiere la asignación autenticada y el PIN; se limita el número de intentos. Una compra dividida requiere un PIN por despacho.
- La posición visible al cliente solo se entrega durante `EN_CAMINO` y mientras sea vigente. Un dato antiguo se marca como tal y no se devuelve como posición actual. No se garantiza GPS con la app cerrada: la app nativa deberá implementar y homologar permisos y ejecución en segundo plano.

## Selección y preparación

Se filtra antes de comparar:

1. Cuenta habilitada, turno disponible, heartbeat y ubicación vigentes, precisión aceptable.
2. Sede autorizada, vehículo habilitado y modalidad correspondiente.
3. Sin asignación, oferta o custodia incompatible.
4. Capacidad comprobada por el planificador existente para todas las unidades cerradas del despacho: gramos, embalaje, volumen y dimensiones.
5. Ventana aún viable. Programado conserva su franja autorizada y no comienza a buscar demasiado pronto respecto a su ventana.

Turbo mantiene 50.000 g base y hasta 3.000 g acumulados solo de unidades ligeras elegibles. Comida y arena no reciben el margen. La capacidad física del vehículo prevalece. Datos incompletos no se convierten en cero. No se cambia de sede para acercar el pedido al conductor. Los límites y capacidades siguen administrándose por `/admin/transport`; no hay un máximo fijo de tres.

La búsqueda comienza cuando bodega marca `LISTO_PARA_DESPACHO`, evitando llamar conductores antes de que exista una recogida preparada. No se han inventado tiempos de preparación de producción. Una futura integración puede proporcionar predicción de alistamiento; actualmente se utiliza la confirmación real de bodega.

`routeEstimate(driver, store)` es el punto de integración para una fuente autorizada de rutas. Si todos los candidatos propios tienen ETA comparable vigente, gana el menor tiempo. Sin esa fuente, se compara distancia geográfica a la **bodega**, con `kind: GEOGRAPHIC` y sin minutos. Si una cotización externa aporta ETA y la propia no tiene un ETA comparable, se prioriza la opción propia elegible sin afirmar que es más rápida que la externa. Con ETA comparable, la externa gana solo si mejora a la propia por más del margen configurable de desempate; en empate se prioriza flota propia.

## Ofertas, concurrencia y persistencia

Estados de conductor: `OFF_DUTY`, `AVAILABLE`, `OFFER_PENDING`, `BUSY`. Crear una oferta reserva temporalmente al candidato para ese despacho. Aceptar es una transacción síncrona: vuelve a validar elegibilidad, capacidad, vencimiento y estado, asigna una sola vez y actualiza conductor y despacho juntos. La oferta tiene un UUID; el POST de aceptación debe enviar ese `offerId`, no solo el código de despacho.

Rechazar o vencer conduce al siguiente candidato elegible. Al agotarse la búsqueda se conserva el despacho en `SEARCH_EXHAUSTED`, con incidencia administrativa. No se inventan nuevas ventanas ni se cambia la compra a Programado automáticamente. Administración puede comprobar alternativas con `/delivery/quote` y obtener aceptación del cliente de cualquier cambio antes de intervenir.

El almacenamiento actual admite **un solo proceso escritor**, protegido por el bloqueo existente de servidor. La primera transacción de despacho crea `<BOLT_DATA_DIR>/persisted-fulfillment.json` con pedidos, conductores, auditoría, telemetría y estado de asignación. Se escribe un temporal, se sincroniza el archivo y se renombra atómicamente. Desde ese momento este archivo es autoritativo; los antiguos JSON separados quedan como base de migración y no deben editarse para cambiar datos actuales. Las transacciones fallidas restauran el estado anterior; ofertas, sesiones, contador, recaudo y asignaciones sobreviven a reinicios.

Antes de desplegar: respaldar tanto los JSON actuales como `persisted-fulfillment.json` si existe. No bajar a una versión que ignore ese archivo, ni restaurar ciegamente JSON antiguos con pedidos o cobros posteriores. Para varios procesos/servidores será necesaria una base transaccional compartida y bloqueo de filas/leases; esta versión no afirma soportar un clúster.

Los pedidos históricos no se registran ni reasignan automáticamente. Administración puede registrarlos explícitamente; quedan en conciliación, conservando historial y custodia. `/reconcile-legacy` exige verificar conductor, capacidad y saldo pendiente. No se deduce que un efectivo histórico ya fue recaudado.

## Recaudo y custodia

El saldo autorizado se distribuye una sola vez entre despachos; la suma es exactamente el pendiente confirmado. Cada conductor ve `cashToCollect` de su despacho, nunca el total de la compra multiplicado por entregas. La entrega valida `collectedCOP` contra ese saldo, y reintentar no agrega otro cobro. `cashSettled` no equivale a entrega: el efectivo retenido por conductor se liquida con recibo administrativo idempotente. El ledger de recibos conserva conductor, importe, administrador y fecha.

Antes de recogida: administración solicita liberar; el conductor anterior debe confirmar `/release`. Hasta entonces no se permite recoger ni asignar otro conductor. Una oferta pendiente puede retirarse sin fingir una entrega física.

Después de recogida: administración solicita `/transfer`, se comprueba la capacidad del receptor, el conductor anterior confirma `/release-custody` y el receptor `/accept-custody`. El pedido, sus productos, sus códigos y el saldo pendiente no cambian. La entrega se bloquea mientras la transferencia esté incompleta. No existe una reasignación automática de mercancía en custodia externa; exige resolver la incidencia con el proveedor.

## Proveedores externos

`DispatchProvider` define capacidades reales independientes: cotizar, solicitar, consultar estado, cancelar y recaudar. Cotización no equivale a aceptación; aceptación de servicio no equivale a conductor asignado. Se conservan referencia externa, UUID de idempotencia, cotización, costo y estados `REQUESTING`, `UNKNOWN`, `ACCEPTED`, `ASSIGNED`, `REJECTED`, `CANCELLED`.

Antes de llamar se persiste `REQUESTING`. Si hay timeout, queda `UNKNOWN`: se consulta/reconcilia antes de contratar otra opción. Una respuesta tardía se acepta solo para la misma solicitud vigente. Una cancelación no confirmada no libera el servicio. La simulación prueba aceptación, rechazo, demora, resultado desconocido, respuesta tardía y cancelación. El adaptador simulado nunca contacta Rappi/inDrive ni cobra dinero.

El costo externo debe caber en el transporte ya aprobado de la compra; este backend no aumenta el cobro al cliente. Cotizaciones que lo superen quedan sin contratar. Los proveedores sin recaudo confirmado se excluyen de contraentrega. Para producción faltan convenio, credenciales, capacidades por zona/servicio, tarifas, tiempos, semántica de idempotencia y cancelación, firma/autenticación de webhooks y conciliación. No hay un webhook público sin verificación ni endpoints que permitan habilitar un proveedor real desde el navegador.

## Endpoints /api/v1

### Administración (Bearer administrativo)

| Método y ruta | Función |
|---|---|
| GET `/admin/dispatch` | Compras agrupadas, ofertas, drivers/ubicación/antigüedad, incidencias, auditoría y métricas |
| PUT `/admin/dispatch/config` | Parámetros de búsqueda, vigencia y seguridad |
| POST `/admin/dispatch/drivers` | Provisionar cuenta propia; body `{driver, email, password, storeIds}` |
| PATCH `/admin/dispatch/drivers/:id` | Habilitación/sedes; requiere no tener custodia activa |
| POST `/admin/dispatch/drivers/:id/settlement` | `{amountCOP, receiptId}` para liquidación de efectivo |
| POST `/admin/dispatch/orders/:orderId/register` | Registro explícito de operación histórica |
| POST `/admin/dispatch/:id/reconcile-legacy` | `{driverId?, cashDueCOP, note}` verificados por administración |
| POST `/admin/dispatch/:id/search` | Iniciar búsqueda elegible del despacho preparado |
| POST `/admin/dispatch/:id/restart-search` | Reiniciar búsqueda agotada, con auditoría |
| POST `/admin/dispatch/:id/release` | Solicitar liberación previa a recogida |
| POST `/admin/dispatch/:id/transfer` | `{toDriverId}` para transferencia propia autorizada |
| POST `/admin/dispatch/:id/reconcile` | Consultar estado externo pendiente |
| POST `/admin/dispatch/:id/cancel-external` | Cancelar solo si el adaptador lo admite y confirma |
| POST `/admin/dispatch/:id/simulate` | Avance exclusivo de un servicio simulado registrado en entorno de pruebas |
| GET/PUT `/admin/transport` | Capacidades físicas, sedes, modalidades, franjas y política de tarifas existente |

Las operaciones antiguas `/operations/*` ahora requieren sesión administrativa real. No permiten saltar directamente a repartidor asignado, recogido o entregado. `/operations/orders/:id/assign-driver` inicia la búsqueda elegible; no fuerza el ID enviado por el navegador. Los estados de preparación siguen en el contrato existente.

### BOLT Conductor (Bearer propio, excepto login)

| Método y ruta | Body/resultado |
|---|---|
| POST `/driver/auth/login` | `{email,password}` → `{token,profile}` |
| POST `/driver/auth/logout` | Revocar sesión |
| GET `/driver/profile` | Usuario, estado, capacidades, sede, edad y vigencia de ubicación |
| POST `/driver/shift` | `{action: START | END}`; no termina turno con custodia activa |
| POST `/driver/heartbeat` | Confirma conexión/disponibilidad actual |
| POST `/driver/location` | `{latitude,longitude,accuracy,timestamp}`; solo en turno |
| GET `/driver/assignments` | `{assignments:[...]}`: ofertas y despachos propios, transferencias entrantes |
| GET `/driver/assignments/:assignmentId` | Solo despacho autorizado |
| POST `.../accept`, `.../reject` | `{offerId}`; aceptación idempotente, rechazo busca siguiente |
| POST `.../arrived-hub` | Registra llegada y permite medir espera |
| POST `.../pickup` | `{sellablePackages}`; cuenta unidades vendibles cerradas, no inventa embalajes agrupados |
| POST `.../delivered` | `{deliveryCode,collectedCOP}`; PIN independiente y saldo exacto |
| POST `.../incident` | `{type}`; conserva custodia hasta resolución |
| POST `.../release` | Confirmación de liberación antes de recoger |
| POST `.../release-custody`, `.../accept-custody` | Confirmaciones de transferencia autorizada |
| POST `/driver/gps` | Contrato de telemetría existente con orderId, shipmentId, assignmentId y tripId válidos |
| GET `/driver/settlement` | Efectivo retenido y cobros por despacho |

DTO del conductor: `purchaseCode`, `dispatchCode`, `orderId`, `shipmentId`, `dispatchId`, `status`, oferta con vencimiento, sede e instrucciones, ítems/presentaciones/cantidades, peso bruto, volumen, advertencias, unidades cerradas, destino y contacto cuando está asignado, estimación de recogida, recaudo pendiente y acciones permitidas. No incluye el PIN. El PIN es ingresado por el conductor únicamente al recibirlo del cliente en la entrega.

### Cliente

Crear pedido devuelve el contrato anterior más `purchaseCode`, códigos de despacho y capacidad privada de acceso. GET `/orders/:id` y `/orders/:id/tracking` requieren `X-Order-Token` de esa compra o sesión administrativa. El array `dispatches` contiene estado público, proveedor confirmado, indicador de conductor confirmado, estimación disponible, código, recaudo pendiente y eventos públicos con UUID estable para deduplicar avisos. Las ofertas y razones internas permanecen en administración.

El endpoint antiguo `/orders/:id/verify-delivery` deja de avanzar estados; la confirmación se realiza desde el conductor autenticado. Los clientes invitados anteriores sin capacidad privada deben solicitar recuperación verificada por administración; conocer el número visible no constituye una prueba de identidad.

## Parámetros y métricas

Valores iniciales: oferta 30 s; búsqueda 180 s; timeout de proveedor 8 s; vigencia de GPS y heartbeat 90 s; precisión máxima 100 m; vigencia de ETA de ruta 60 s; margen de empate propio/externo 10 s; sesión conductor 12 h; 5 intentos de PIN antes de bloqueo temporal. Son configurables por el endpoint administrativo protegido. Los límites comerciales y físicos permanecen en transporte. No se fijan conteos de Kennedy, Álamos ni Suba.

Métricas: cantidad de despachos/asignados, promedio de segundos desde inicio de búsqueda hasta asignación, promedio de espera desde llegada a sede hasta recogida, ofertas vencidas/rechazadas, búsquedas agotadas, incidencias y solicitudes externas de resultado desconocido. Valores sin muestras devuelven `null`, no un cero inventado.

## Verificación

`src/tests/dispatch.test.ts`: pruebas aisladas con fixtures de flota, catálogo y proveedores. HTTP real en puerto efímero de 127.0.0.1; autentica administrador y dos conductores. También verifica propiedad del despacho, códigos/capacidad privada, concurrencia, reinicio, rollback, contraentrega, aceptación/rechazo/vencimiento, ubicación antigua, vehículo incompatible, timeout y respuesta tardía, compra mixta, entrega parcial, liberación/custodia y conciliación histórica. Los adaptadores y credenciales de fixtures no se importan en el servidor de producción.

Ejecutar `npm run lint`, `npm run build`, `npm test`. Si tsx CLI no puede abrir IPC, usar `node --import tsx src/tests/dispatch.test.ts` (y el mismo mecanismo para el resto de suites). Los casos HTTP necesitan permiso para abrir un puerto local temporal. No se hicieron pruebas de campo, cobros, contratación de servicios reales ni homologación Android en segundo plano.
