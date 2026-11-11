# Solicitudes pendientes de confirmación de entrega

Cambio solicitado el 11 de noviembre de 2026: quitar el aviso técnico duplicado y permitir enviar el pedido aunque falten medidas del catálogo. El cliente autorizó expresamente recibirlo pendiente de confirmación por la sede, sin cobrar ni prometer horario.

## Flujo y límites

- El servidor conserva precio, stock, asociación de sede y cobertura como requisitos. Solo `TRANSPORT_DATA_PENDING` con inventario validado habilita `reviewRequestToken`. El token no autoriza transporte; una nueva petición vuelve a comprobar el carrito.
- El carrito muestra un único aviso comercial y permite continuar. El checkout muestra **Enviar solicitud sin cobro**. No solicita medidas al cliente ni presenta total final, PIN, reparto o ETA aprobados. El precio del envío cotizado se distingue de la disponibilidad de entrega.
- Se reutilizan `POST /api/v1/orders`, su idempotencia, almacenamiento unificado, acceso privado y el estado `PENDIENTE_CONFIRMACION`. La solicitud reserva productos una sola vez, sin generar despachos, ofertas, cobro o cupos de horario. El peso no comprobado se guarda como `null`.
- El seguimiento privado conserva los productos y el subtotal. Cancelar libera exclusivamente su reserva mediante la máquina de estados existente. Las reservas pendientes necesitan seguimiento de la sede; no se implementa una caducidad automática nueva.
- El motor de transporte y sus reglas de 50 kg + hasta 3 kg de extras elegibles, embalaje, volumen y vehículos permanecen intactos. Datos inexistentes nunca se convierten en medidas ficticias.

## Administración

En **Despachos y asignación → Solicitudes pendientes de confirmar**:

1. Completar los atributos reales de las presentaciones y la flota usando los editores existentes de catálogo/transporte.
2. Consultar disponibilidad real y escoger una franja programada cuando corresponda. La cotización excluye solo la reserva de esta solicitud; conserva las reservas de todos los demás pedidos.
3. Contactar al cliente por el canal operativo habitual. Acordar costo, modalidad, horario y pago contra entrega. Esta etapa no envía mensajes automáticos ni activa pagos externos.
4. Registrar referencia de esa aceptación, sin secretos, y confirmar. Se revalida la cotización en el servidor, incluido token, stock y capacidad. Si cambian los precios de productos, se rechaza la conversión: no se sobrescribe silenciosamente el precio aceptado.

Endpoints administrativos protegidos por la sesión y permisos existentes:

- `POST /api/v1/admin/orders/:id/delivery-review/quote`
- `POST /api/v1/admin/orders/:id/delivery-review/confirm`

La confirmación convierte el mismo pedido, mantiene sede, códigos, fecha inicial y acceso privado, conserva una sola reserva y registra auditoría. Crea los despachos completos según el plan verificado. No cobra; el recaudo contra entrega se distribuye una vez por el mecanismo existente. La transición genérica de estado no permite saltarse esta revisión.

## Verificación

- `npm run test:pending-delivery`: renderizado, aviso único, botones, ausencia de promesas falsas; HTTP aislado con recepción, acceso privado, repetición, cancelación, reinicio, permisos, conciliación en dos despachos, token obsoleto, stock y códigos.
- `npm test`: incluye las nuevas regresiones y las suites previas de capacidad, territorio, variantes, carrito, clientes, inventario y despachos.
- `npm run lint` y `npm run build`.
- Revisión visual y evidencia de la demo se documentan en el PR; no se modifica el inventario ni se aplican lotes de precios al desplegar.

## Instalación y reversión

No hay migración masiva. Los campos de revisión se agregan únicamente a solicitudes nuevas, dentro del almacenamiento unificado existente. No se reemplaza el volumen ni sus archivos.

Mantener esta revisión de código mientras existan solicitudes pendientes: el main anterior reconoce el estado pendiente pero no su recorrido ni el bloqueo de confirmación genérica. Antes de revertir a esa versión, completar o cancelar autorizadamente cada solicitud mediante esta revisión; no restaurar un respaldo antiguo ni perder movimientos posteriores. Una revisión compatible debe conservar el campo y la validación de `deliveryReview` si quedan pendientes.

Rappi/inDrive, sincronización Shopify y servicios reales de pago permanecen sin activar.

## Tarifa autorizada el 11 de noviembre de 2026

Turbo y Turbo Dividido: envío gratis si el subtotal de productos es de COP 60.000 o más; por debajo, COP 10.000 una sola vez por compra. Servicio: COP 0. No se calcula el umbral usando envío, propinas o servicio. Las unidades y los precios vigentes del servidor determinan el subtotal.

La configuración se administra en **Flota y capacidad de transporte → Límites y tarifas por compra**. `pricing.turbo` contiene `shipping: 10000` y `freeShippingFrom: 60000`; `pricing.serviceFee` vale `0`. Se conserva el transporte Programado en `pricing.shipping` y `pricing.freeShippingFrom`. Al cambiar realmente a Programado se vuelve a calcular su tarifa; no se arrastra la tarifa Turbo.

Los costos ofrecidos por proveedores se conservan en el plan de operación. No se suman al precio plano que paga el cliente Turbo, ni se duplican cargos por cada despacho. Esto no activa proveedores ni acredita disponibilidad.

En instalaciones existentes hay que guardar estos campos mediante el administrador autenticado (`PUT /api/v1/admin/transport`) con la revisión vigente. La operación es auditada y rechaza una revisión obsoleta; no se reescribe automáticamente la configuración persistida al iniciar. Respaldar la configuración anterior y conservar vehículos, límites y franjas. Una reversión de tarifas usa una nueva revisión y cambia solo esos campos: no restaura el archivo completo ni recalcula pedidos ya confirmados.

Una solicitud pendiente sigue sin cobro ni horario. El envío y el servicio calculados por el servidor se muestran aunque falte confirmar la capacidad. `charges.mode` identifica la modalidad de esa tarifa: no se etiqueta como Turbo un precio Programado. Un envío cotizado en cero muestra «Envío gratis»; un precio ausente, una cotización no válida o un subtotal cambiado permanece pendiente. Mostrar una tarifa no autoriza despacho, cobro ni horario; el total final y cualquier cambio de modalidad o costo requieren aceptación. Las cotizaciones confirmadas incluyen los importes en su token y se invalidan cuando cambia la tarifa.

`npm run test:turbo-pricing` comprueba límites 59.999/60.000/60.001, varias entregas, costos externos, cambio a Programado, validación de tarifas y renderizado. Su recorrido HTTP aislado verifica creación con importes autoritativos, reintento, reserva única, rechazo de cotización anterior, permisos, persistencia y conservación del total histórico.

La regresión `pendingShippingPrice.test.tsx` reproduce el checkout de COP 490.000 con capacidad pendiente: carrito y checkout muestran el envío gratuito, mantienen la solicitud sin cobro y no confunden una tarifa Programada con Turbo. También comprueba 59.999/60.000, cotización ausente y subtotal obsoleto.
