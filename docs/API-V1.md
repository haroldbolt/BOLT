# API de BOLT Pets

El prefijo de comercio, operación y reparto es `/api/v1`. Las cuentas conservan `/api/customer` y las rutas de Better Auth en `/api/customer-auth`. La moneda comercial es COP y las fechas de programación corresponden a `America/Bogota`. Usar HTTPS y enviar JSON con `Content-Type: application/json`, salvo las rutas de imagen que reciben binarios.

## Actores y credenciales

| Actor | Cómo acredita acceso | Alcance |
| --- | --- | --- |
| Visitante | Sin sesión | Catálogo público, búsqueda de dirección y cotización. Puede iniciar una compra cuando el checkout está habilitado. |
| Invitado con compra | `X-Order-Token` del pedido | Detalle, seguimiento y acciones permitidas sobre esa compra. El código visible de compra o despacho sirve para identificarla. |
| Cliente con cuenta | Cookie de sesión verificada en el backend | Datos de su cuenta y compras vinculadas. El enlace de una compra histórica exige la prueba de acceso a esa compra. |
| Operador de sede | `Authorization: Bearer …` desde el acceso administrativo | Operaciones del panel nuevo dentro de las sedes y permisos del usuario. El parámetro `storeId` selecciona dentro del alcance autorizado. |
| Coordinación | Sesión administrativa con permisos de coordinación | Supervisión, edición comercial, inventario y conciliación según la ruta. |
| Conductor | Bearer propio de `POST /driver/auth/login` | Su turno, ubicación, ofertas y asignaciones autorizadas. Recogida, custodia y entrega verifican además el despacho y su estado. |

Guardar las credenciales de compra como secretos. Excluir de telemetría, enlaces compartidos y registros los cuerpos de checkout o GPS, cookies, cabeceras de autorización, PIN, referencias privadas e imágenes. La cuenta administrativa y la de conductor tienen circuitos independientes del acceso de cliente. [Autorización por compra y conductor](../src/lib/dispatchRoutes.ts) · [autorización del panel](../src/lib/boltAdminRoutes.ts)

## Recorrido de compra

1. Obtener las sedes activas con `GET /stores` y el catálogo público con `GET /catalog`. Admite `category`, `species`, `q` y `storeId`. Mantener el identificador de la presentación vendible seleccionada.
2. Consultar `POST /delivery/quote` con `destination` (dirección y coordenadas), `items` (pares `productId`, `quantity`) y, cuando corresponda, `requestedMode` y `scheduledWindow`. Leer `reasonCode`, `availableModes`, sede y franjas de la respuesta. Una cotización puede responder 200 y describir una dirección incompleta o una modalidad sin capacidad. Consultar o editar el carrito no crea un pedido.
3. Mostrar el costo calculado y la franja elegida antes de confirmar. Enviar `POST /orders` con `Idempotency-Key`, artículos con su precio visible, contacto, `deliveryAddress`, modalidad, medio de pago y los datos de confirmación de la cotización que correspondan. El servidor resuelve nuevamente la sede y verifica variante, precio, reservas, cobertura y capacidad. En Programado valida la franja contra la fecha y el cupo actuales.
4. El primer registro responde 201. Un reintento de la misma confirmación con clave, cuerpo y titular coincidentes devuelve el registro existente con 200. Una clave ausente da 400 (`IDEMPOTENCY_REQUIRED`). La misma clave reutilizada con otros datos da 409. Conservar la clave original durante un reintento tras un corte de red. Si el precio cambia (`PRICE_CHANGED`) o cambia la cotización, mostrar los datos actuales y obtener una nueva confirmación.
5. Si la cotización ofrece únicamente revisión, usar `requestDeliveryReview: true` y su `reviewRequestToken`. La solicitud queda pendiente de la sede, sin cobrar ni prometer entrega. Administración cotiza sobre esa orden y registra la aceptación del cliente antes de confirmarla. El piloto puede mantener el checkout completo cerrado mientras falta autorización de recaudo.
6. Consultar `GET /orders/:orderId` y `GET /orders/:orderId/tracking` con la credencial apropiada. En una compra dividida, pasar `shipmentId` al seguimiento para identificar una entrega. La pantalla usa `timing.serverTime`, la ventana o estimación verificada y `locationStatus` (`LIVE`, `STALE`, `UNAVAILABLE` o `NOT_IN_TRANSIT`). La fecha de la última ubicación permite mostrar su antigüedad.

## Rutas por función

Las rutas de la tabla son relativas a `/api/v1`. Los nombres de campos y métodos de cada acción están en sus manejadores enlazados.

| Función | Rutas principales | Comportamiento |
| --- | --- | --- |
| Estado público | `GET /health`, `GET /catalog/summary` | Estado del proceso, versión, resumen del catálogo y revisión del despliegue cuando está configurada. La disponibilidad de cada proveedor se verifica por separado. |
| Ubicación | `GET /geocode/forward?address=…&municipality=…`, `GET /geocode/reverse?lat=…&lng=…` | Identifica el destino. La decisión sobre cobertura o modalidad pertenece a la cotización. |
| Búsqueda por foto | `GET /catalog/photo-search/status`, `POST /catalog/photo-search` | Consultar primero si está habilitada. El POST recibe JPEG binario de hasta 1 MiB. Devuelve sugerencias del catálogo y deja al cliente elegir su presentación. |
| Compra y privacidad | `POST /orders/:orderId/cancel`, `POST /orders/:orderId/prescription`, `GET/PUT /orders/:orderId/entrance-photo` | La operación depende de titularidad, producto y estado. La foto de la entrada se guarda como material privado de entrega. |
| Recuperación | `POST /tracking-recovery`, `POST /tracking-recovery/status`, `GET /admin/dispatch/recoveries`, `POST /admin/dispatch/recoveries/:id/approve` | El dispositivo conserva su secreto de recuperación. Un administrador verifica evidencia de titularidad. Recuperar acceso a un pedido cerrado conserva su estado. |
| Panel BOLT Admin | `GET /bolt-admin/session`, `GET /bolt-admin/orders`, `GET /bolt-admin/orders/:orderId`, `GET /bolt-admin/sales` | Lista, detalle y ventas se filtran con la sesión del panel. La preparación usa `POST /bolt-admin/orders/:orderId/start-preparation` y `ready-for-dispatch`. Para revisión comercial se usan `quote` y `confirm` bajo ese mismo prefijo. |
| Inventario y ajustes | `GET/PUT /bolt-admin/inventory`, `GET /bolt-admin/inventory/adjustments`, `GET/PUT /bolt-admin/prices`, `GET/PUT /bolt-admin/inventory/photo` | Verifica permisos de sede y de edición. Conserva la distinción entre unidades físicas y reservadas. |
| Catálogo y configuración operativa | `/admin/catalog`, `/admin/catalog/products`, `/admin/catalog/batches`, `/admin/coverage`, `/admin/transport`, `POST /stores/:id/verify-entrance` | Administración autenticada. La verificación de coordenadas de una sede por sí sola no acredita presencia física. Shopify tiene consulta de estado y operaciones explícitas de catálogo; la sincronización automática está desactivada. |
| Despachos | `GET /admin/dispatch`, `POST /admin/dispatch/:id/search`, `POST /admin/dispatch/orders/:orderId/register`, `POST /admin/dispatch/:id/reconcile-legacy` | La asignación opera por despacho. El registro y la conciliación permiten continuar pedidos históricos cuando existe evidencia suficiente de su estado y custodia. |
| Conductor | `GET /driver/profile`, `POST /driver/shift`, `POST /driver/heartbeat`, `POST /driver/location`, `POST /driver/gps`, `GET /driver/assignments` | Las acciones `accept`, `reject`, `arrived-hub`, `pickup`, `delivered` e `incident` cuelgan de `/driver/assignments/:assignmentId/`. La entrega solicita los datos de verificación de ese despacho. |

[Rutas de Express](../server.ts) · [inventario y ventas](../src/lib/boltAdminRoutes.ts) · [seguimiento y GPS](../src/lib/customerTracking.ts) · [recuperación](../src/lib/trackingRecovery.ts) · [búsqueda por foto](../src/lib/productPhotoSearchRoutes.ts) · [fotos privadas](../src/lib/entrancePhotoRoutes.ts)

## Pagos, proveedores y avisos

- **Efectivo.** El contrato de compra acepta `CASH_ON_DELIVERY` y el alias `EFECTIVO`. El importe por recaudar se asigna por despacho. Una entrega, un recaudo registrado y una liquidación son hitos distintos. El piloto heredado de Suba devuelve 503 con `RAPPI_CASH_UNCONFIRMED` mientras el recaudo real está pendiente.
- **Wompi.** El checkout rechaza tarjeta, PSE y Bancolombia con 400 y `PAYMENT_UNAVAILABLE`. Coordinación puede consultar `GET /admin/orders/:orderId/payments/wompi` para un pedido con transacción Wompi ya vinculada. La comprobación coteja comercio, ID, referencia del pedido, método, moneda COP e importe en centavos. El backend necesita `BOLT_WOMPI_LOOKUP_ENV`, `BOLT_WOMPI_MERCHANT_ID` y `BOLT_WOMPI_PRIVATE_KEY` del mismo entorno. Una configuración ausente devuelve 503 y una discrepancia devuelve 409. La consulta solo lee el estado de la transacción. [Adaptador de consulta](../src/lib/wompiLookup.ts)
- **Reparto externo.** En la base revisada de `main`, Rappi e inDrive figuran deshabilitados. El adaptador de Rappi Cargo de respaldo para Turbo está en el PR #38, un borrador independiente. El sandbox y la demo operan con servicios simulados. [Proveedores de esta versión](../src/lib/dispatchProviders.ts) · [PR #38](https://github.com/haroldbolt/BOLT/pull/38)
- **Avisos al cliente.** La PWA muestra cambios de sede, preparación, pedido listo para recoger, asignación, avance o cancelación al recibir datos autorizados del pedido. Deduplica eventos para no anunciar como nuevas las transiciones históricas. El correo de cuentas usa el transporte configurado para verificación y recuperación. Las alertas de la interfaz no acreditan entrega de una notificación al teléfono con la PWA cerrada. [Avisos de pedido](../src/lib/notifications.ts) · [correo de cuentas](../src/customer/mail.ts)

## Errores y compatibilidad

La API responde con un estado HTTP y un mensaje `error`; determinadas rutas incluyen `code` y contexto adicional. El encabezado de respuesta `X-Request-Id` permite indicar a soporte qué solicitud revisar sin copiar el cuerpo ni las credenciales.

| Estado | Acción del consumidor |
| --- | --- |
| 400, 413, 415 | Corregir campos, tamaño o tipo de archivo antes de repetir. |
| 401, 403 | Revalidar la sesión o la autorización de esa compra. El permiso del operador depende también de la sede. |
| 404 | Revisar el recurso o la ruta. Una ruta API inexistente responde JSON. |
| 409 | Resolver la discrepancia de precio, oferta, versión o estado y volver a confirmar cuando proceda. |
| 429 | Reducir la frecuencia y respetar `Retry-After` cuando esté presente. |
| 500, 502, 503 | Conservar los datos de la operación y consultar su estado. Reintentar confirmaciones con la misma clave y cuerpo ante un resultado incierto. |

Conservar contratos existentes dentro de v1. Si se necesita un cambio incompatible, publicar una ruta o versión distinta y mantener la anterior hasta migrar sus consumidores. Las rutas de cuentas y autenticación, con sus requisitos particulares de cookie y origen, se describen aparte. [Cuentas de clientes](./customer-account/SETUP.md)
