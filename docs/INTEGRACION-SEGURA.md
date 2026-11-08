# Integración revisable de #9 y #10

Esta rama se origina en main f4fba7c y conserva sus cuatro archivos del PR #11 por hash Git. Incorpora #9 mediante un merge con dos padres. Los borradores originales no se modifican ni se cierran. La recuperación compatible indicada más abajo es el commit de correcciones del #9 de esta rama, antes del merge de fotografías #10; su SHA figura en el PR.

## Históricos en administración

Administración → Despachos → Pedidos anteriores y recuperación de seguimiento lista también las compras sin run. Se puede buscar por código/estado. `PENDIENTE_CONFIRMACION` debe confirmarse en el flujo existente; nunca se activa un despacho por registrar un pedido sin confirmar. Entregados/cancelados quedan en lectura, sin reapertura.

Registrar usa `POST /api/v1/admin/dispatch/orders/:orderId/register`. Crea únicamente relaciones estables de despacho en incidencia y conserva la compra, existencias, reservas, cantidades, importe, estado, fechas e historial. Repetir no duplica códigos ni eventos de registro. El 409 de asignación permanece mientras falta registro/conciliación.

Cada despacho por conciliar muestra custodio, datos pendientes y saldo de referencia; un operador verifica y escribe el saldo pendiente y la evidencia. `POST /api/v1/admin/dispatch/:id/reconcile-legacy` registra actor, fecha de conciliación y huella del contenido. Repetir exactamente es idempotente; contenido diferente después de conciliar exige revisión. Preparación y búsqueda siguen el motor existente.

Si un histórico EN_CAMINO carece de pickedUpAt, se rechaza con PICKUP_EVIDENCE_REQUIRED antes de modificar conductor o despacho. El estado permanece en incidencia y la compra EN_CAMINO. Se admite evidencia alternativa de una **fecha histórica comprobada**, acompañada de referencia del soporte. Se conserva en legacyReconciliation.pickupEvidence y no se rellena silenciosamente el timestamp original. La fecha de intervención es distinta. Si solo se conoce que ocurrió la recogida, pero no existe fecha comprobable, continuar conciliación manual: no usar la hora actual ni liberar custodia. Falta de custodio, cuenta o capacidad verificadas sigue bloqueando.

## Recuperación privada de seguimiento

Cliente → Historial → Recuperar seguimiento, o `/recuperar-seguimiento`. El dispositivo genera una clave aleatoria de 256 bits; guarda su solicitud en `bolt_tracking_recovery_v1` y envía la clave solo en cuerpo HTTPS al backend de la misma app. No se usa en URL. El servidor conserva únicamente su hash, referencia, estado y vigencia de 24 horas. Iniciar no revela si una compra existe ni modifica el pedido.

- POST `/api/v1/tracking-recovery`: iniciar de manera idempotente.
- POST `/api/v1/tracking-recovery/status`: requiere ID y clave privada de esa solicitud; únicamente después de aprobación devuelve acceso a esa compra.
- GET `/api/v1/admin/dispatch/recoveries`: administrador autenticado; excluye secretos y hashes.
- POST `/api/v1/admin/dispatch/recoveries/:id/approve`: administrador autenticado, revisión explícita de titularidad, método y referencia `CASE-...` del expediente.

La prueba automática de propiedad solo reutiliza un acceso privado válido existente. Los pedidos antiguos sin ese acceso requieren revisión humana de comprobante original (la referencia debe coincidir con la transacción guardada) o documentos y compra revisados presencialmente. El backend delega esa verificación presencial al administrador autenticado y la audita; no hay OTP ni validación documental automatizada. No guardar documentos, nombres, teléfonos o secretos en el campo CASE. Conocer contacto o código de compra no autoriza el acceso.

La emisión usa la capacidad privada de pedido existente y no crea runs, ni reabre cerrados. Al consultar la autorización, el navegador guarda el token con el mecanismo existente de api.ts. La auditoría contiene actor, pedido, caso, método y referencia, nunca la clave ni el token. No se activa mensajería externa; no enviar enlaces de acceso por servicios de terceros dentro de esta etapa.

## Verificación de bodega

backendAuthorization permite credenciales únicamente hacia rutas explícitas del backend del mismo origen, incluida `/api/v1/stores/:id/verify-entrance`. Sin sesión: 401; rol por cabecera: 401; token inválido o de conductor: 403; admin con coordenadas inválidas: 400; coordenadas estructuralmente aceptadas: 200. Guardarlas **no acredita presencia física** en la bodega.

## Transición por instalación

No copiar almacenamiento de pruebas ni ejecutar una migración masiva en producción desde esta revisión. Respaldar primero la instancia con un único escritor detenido. Identificar la carpeta de catálogo/precios/inventario por separado y el `BOLT_DATA_DIR` real.

Fuentes: hasta la transición se leen los archivos legacy existentes, o el snapshot unified v1 del #9. Después de publicar v2, **solo persisted-fulfillment.json v2 es autoritativo** para pedidos, conductores, estados de despacho, accesos, telemetría y auditoría. Catálogo/precios/reservas siguen sus repositorios existentes; la transición no los sustituye.

Desde la revisión compatible, con dependencias instaladas y el servidor detenido:

```
node --import tsx scripts/fulfillment-storage.ts check /ruta/absoluta/datos /ruta/revision-compatible
node --import tsx scripts/fulfillment-storage.ts migrate /ruta/absoluta/datos /ruta/revision-compatible
node --import tsx scripts/fulfillment-storage.ts backup /ruta/absoluta/datos /ruta/revision-compatible
npm run build
node --import tsx scripts/fulfillment-storage.ts run /ruta/absoluta/datos /ruta/revision-compatible
```

El primer cambio operativo también usa este mismo mecanismo si aún no se ejecutó migrate; el arranque de lectura no registra pedidos ni reasigna conductores. La herramienta utiliza un bloqueo por carpeta de datos; el servidor mantiene además su bloqueo de catálogo.

Proceso versionado: copia recuperable de las fuentes en `.bolt-storage/backups/<id>/`; hashes de origen; journal PREPARED; fsync y rename de un único snapshot v2; journal COMMITTED. El journal es comprobación recuperable, no otra copia autoritativa. No se declaran atómicas escrituras independientes. Antes de publicar, una interrupción conserva las fuentes; al reanudar se exige que sus hashes coincidan. Después de publicar, v2 prevalece incluso si faltó marcar COMMITTED; la próxima escritura completa ese registro. Cambio de las fuentes durante la transición se bloquea para revisión. Se conserva la transición original y revisión creciente en cada snapshot. Los backups son privados.

## Reversión compatible (no basta con Git)

No iniciar f4fba7c ni los borradores antiguos contra una instalación ya transicionada. Su código no conoce v2 y puede leer archivos legacy obsoletos. Los archivos legacy se conservan como evidencia; no son proyecciones ni reciben escrituras paralelas.

1. Detener el escritor y crear un respaldo **actual** con `backup`, sin restaurar datos antiguos.
2. Seleccionar el commit de correcciones #9 de esta rama (antes de fotografías) u otra revisión que declare y pruebe `storage-contract.json` v2.
3. Desde la herramienta compatible ejecutar `check DATA_DIR CANDIDATE_DIR`. Rechaza main anterior sin contrato **antes de arrancarlo**. Compilar el candidato compatible y ejecutar `run DATA_DIR CANDIDATE_DIR`.
4. Mantener el mismo archivo v2 y el resto del almacenamiento comercial actual. Verificar códigos, entregas, recaudos, auditorías y reservas posteriores. No importar el backup de origen sobre movimientos nuevos.

El guardado/arranque gestionado detecta lectores incompatibles. No puede impedir que un operador ejecute directamente un binario antiguo ignorando este procedimiento. `server.js` antiguo, npm start antiguo y restauraciones manuales no son una reversión soportada. El contrato declara compatibilidad de código confiable revisado; no valida software arbitrario.

La revisión de recuperación mantiene el backend corregido y todos los estados nuevos; permite revertir las fotografías sin perder entregas posteriores. No hay conversión prometida al esquema anterior. Un retorno total a software anterior requeriría un proyecto separado de conversión validada. Se mantiene un proceso escritor; varias réplicas requieren almacenamiento transaccional compartido.

## Regresiones

storageTransition.test.ts comprueba interrupciones antes/después de publicación, reanudación, conflicto de fuente, conservación de movimientos posteriores y rechazo de lectores incompatibles. historicalIntegrationHttp.test.ts prueba nueve estados con HTTP real aislado, autorización por rol, recuperación abierta/cerrada, evidencia de custodia, reintentos, secretos ausentes de listados/auditoría, inventario y reinicio. Los cuatro archivos #11 se conservan; nuevas pruebas van en archivos independientes. Las pruebas de imágenes se incorporan al comando general al integrar #10.

Para ejecutar en el entorno restringido puede usarse `node --import tsx src/tests/<suite>` en vez del lanzador tsx. La evidencia del PR distingue tests de componentes del recorrido real en navegador.
