# Sedes y avisos de asignación

## Fuente autoritativa

`src/data/warehouseConfig.ts` es el registro operativo central. Reutiliza los IDs, nombres, direcciones y coordenadas existentes. `src/data/seedData.ts` reexporta el registro para compatibilidad; el catálogo local combina el registro con el estado de Shopify, sin crear copias de las sedes. El backend sigue decidiendo la asignación mediante el motor de entrega y los polígonos geográficos existentes.

No existe una administración persistente de sedes mediante API en esta versión. El panel operativo existente consulta las mismas sedes. Los cambios de configuración se revisan como código y se aplican reiniciando/desplegando el servidor.

## Registrar una nueva sede

1. Añadir una entrada a `WAREHOUSES` en `warehouseConfig.ts`, con ID estable y único, `name` (nombre comercial completo), `customerName` (por ejemplo, “Suba”), `address`, coordenadas verificadas y los restantes campos del modelo `Store`. `showAddressToCustomer:false` permite omitir la dirección comercial de nuevos eventos.
2. Empezar con `isActive:false`, `enabledModes:[]` y territorios vacíos. Habilitar solo las modalidades aprobadas: `PROGRAMADO`, `TURBO` o `TURBO_DIVIDIDO`. Para Turbo también debe estar habilitado `turboEnabled`; siguen vigentes los límites y localidades Turbo existentes. Habilitar una modalidad no amplía sus reglas geográficas.
3. Para Programados, asignar localidades oficiales en `SCHEDULED_TERRITORIES[id]` o en `scheduledLocalities` de la sede. Los municipios se configuran en `SCHEDULED_MUNICIPALITIES` o `scheduledMunicipalities`. Si se mueve un territorio, retirarlo primero de la sede anterior: el validador rechaza IDs o territorios duplicados. Un registro sin territorios no obtiene cobertura. Los municipios adicionales siguen bloqueados por la validación geográfica hasta una aprobación explícita de cobertura; añadir su nombre al registro no amplía el perímetro habilitado.
4. Registrar su mapeo real de catálogo/Shopify y existencias; no inventar inventario para habilitar compras. Activar la sede únicamente cuando esté operativa. El estado inactivo de origen también bloquea su uso.
5. Ejecutar `npm run lint`, `npm test`, `npm run build`. En una copia aislada, cotizar un destino del territorio, comprobar `warehouse` en la cotización, crear un pedido y comprobar `warehouseAssignment` en la respuesta y después de reiniciar. No hay que modificar ningún componente de tienda para incorporar la sede.

Se conserva el reparto acordado de Programados: Kennedy (12 localidades y Soacha urbano habilitado), Álamos (5 localidades), Suba (Suba y Usaquén). Sumapaz y exclusiones rurales siguen fuera. La cuarta sede de la suite es temporal en memoria del proceso de pruebas y no forma parte de la configuración operativa.

## Datos y eventos

La cotización devuelve `warehouse: {id,name,customerName,address?}`. Es una propuesta previa a crear el pedido; si no existe, checkout muestra “Sede pendiente de confirmar”. No se envía un `storeId` desde checkout para decidir la asignación.

Al crear el pedido, el servidor guarda en el mismo registro `warehouseAssignment`, con ID estable `warehouse:{orderId}:{revision}`, revisión, fecha, tipo (`ASSIGNED` o `CHANGED`) y snapshot de la sede. Solo tras guardar correctamente el pedido devuelve el evento al navegador. Las respuestas de pedido y el historial incluyen ese mismo snapshot. Los pedidos antiguos sin evento resuelven su sede mediante el ID guardado y el registro; si no existe, se muestra “Sede pendiente de confirmar”, sin asumir Kennedy ni confiar en un nombre enviado por el cliente.

Los reintentos de checkout usan `Idempotency-Key` y una huella del contenido. Si la respuesta se pierde, el servidor devuelve el mismo pedido/evento; no vuelve a reservar existencias. Reutilizar la clave con un cuerpo distinto devuelve 409. Al recibir éxito, el navegador retira la clave para permitir una compra posterior intencional. La clave pendiente y la huella se guardan en `sessionStorage`, sin almacenar el cuerpo con datos de contacto.

`pushService` conserva las notificaciones y los IDs/revisiones vistos en `localStorage` (`bolt_pets_notifications_v1`). La lista visible mantiene las últimas 30 notificaciones; la deduplicación conserva los IDs aunque un aviso salga de esa lista. Se descartan revisiones antiguas. Reabrir o refrescar no repite el aviso. La persistencia entre recargas requiere que el navegador permita almacenamiento local; si lo bloquea, se conserva la deduplicación en memoria durante la sesión actual.

Una reasignación no se ejecuta automáticamente ni se expone como una nueva ruta HTTP. `OrdersRepository.recordWarehouseAssignment` es una integración interna reservada para un flujo operativo autorizado (`ADMINISTRADOR` o `COORDINADOR`), que debe haber validado el traslado, inventario, promesa de entrega y elegibilidad antes de invocarla. Rechaza sedes inexistentes/inactivas, conserva el evento al repetir la misma asignación y guarda una revisión `CHANGED` si realmente cambia el ID. El aviso se detecta mediante las consultas de seguimiento existentes.

## Mensajes y accesibilidad

- Inicial: “Tu pedido será preparado y despachado desde nuestra sede de {customerName}.”
- Cambio autorizado: “La sede asignada a tu pedido cambió a {customerName}.”

El banner existente se reutiliza con `role="status"`, `aria-live="polite"`, cierre accesible y sin robar foco ni exigir aceptación. Los avisos de sede permanecen 15 segundos y también quedan en el centro de notificaciones. Checkout, resumen, confirmación/seguimiento móvil y escritorio conservan el nombre y la dirección comercial disponible. El mensaje no modifica el estado logístico del pedido ni dice que el repartidor salió.

Esto es una **alerta interna**. La infraestructura existente simula notificaciones mientras la app está abierta: no hay Service Worker, suscripción Web Push ni entrega push desde un servidor. Las notificaciones con la app cerrada quedan pendientes; este cambio no solicita permisos ni se presenta como push de segundo plano.

## Validación aislada

`warehouseNotifications.test.ts` verifica sedes existentes, cuarta sede temporal, cobertura no implícita, persistencia de eventos, cambios autorizados, deduplicación, respuestas antiguas, pedidos sin sede y resolución de pedidos históricos.

La prueba HTTP crea pedidos únicamente en la copia local de pruebas, por ejemplo:

```sh
BOLT_TEST_BASE_URL=http://localhost:3002 BOLT_TEST_RESULT=/tmp/bolt-warehouse-http.json node --import tsx src/tests/warehouseNotificationsHttp.test.ts
# Reiniciar el servidor aislado, conservando sus archivos, y comprobar:
BOLT_TEST_BASE_URL=http://localhost:3002 BOLT_TEST_RESULT=/tmp/bolt-warehouse-http.json node --import tsx src/tests/warehouseNotificationsHttp.test.ts --verify-restart
```

No ejecutar esta prueba contra pedidos reales. La suite crea sus repositorios de unidad en directorios temporales y elimina únicamente esos directorios al terminar.
