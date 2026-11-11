# Ajustes administrativos de inventario sin importación de precios

Se reutiliza `CatalogOperations` y su almacenamiento autoritativo
`.bolt-private/catalog-operations.json`. No hay un inventario paralelo.
En la demo desplegada este archivo vive dentro del volumen persistente:
`/data/bolt-dispatch-simulation-meeting/.bolt-private/catalog-operations.json`.

## Operación protegida

Con la sesión administrativa existente, preparar:

```http
POST /api/v1/admin/catalog/inventory-batches
Content-Type: application/json
Authorization: Bearer <sesión administrativa>

{"id":"LOTE-UNICO-PERSISTENTE","delta":5,"reason":"Solicitud autorizada de ajuste manual de inventario"}
```

El servidor toma el actor de la sesión, valida delta entero positivo y motivo,
respalda catálogo/asociaciones/precios/reservas y estado previo de operaciones
en `.bolt-private/backups/<id>/`. Preparar no suma unidades. El plan incluye
todas las variantes existentes (también de productos archivados, sin publicarlos),
solo en sus bodegas activas actualmente asociadas, incluidos identificadores
de ubicación Shopify ya mapeados. No se crean asociaciones ni se consulta Shopify.

Aplicar y reanudar con los endpoints existentes:

- `POST /api/v1/admin/catalog/batches/<id>/apply` con `{"limit":500}`.
- `GET /api/v1/admin/catalog/batches/<id>` para verificar filas y auditoría.
- `GET /api/v1/admin/catalog/batches` para listar lotes.

Un ID persistente identifica la operación, no cada intento. Repetirlo con otra
cantidad o motivo se rechaza. Cada aplicación suma al stock actual, conserva
reservas, ventas y precios concurrentes; efecto y marca de finalización se guardan
juntos mediante el escritor único existente. Un fallo antes del commit no publica
resultados parciales. Volver a aplicar filas completadas no duplica el ajuste.

Los precios usan `NOT_REQUESTED`; el movimiento identifica `INVENTORY_ONLY` y
`APPLY_MANUAL_PLUS_<cantidad>_INVENTORY_ONLY`. No equivale a conteo físico.
El panel y la tienda consultan el mismo catálogo del servidor.

## Reversión

`POST /api/v1/admin/catalog/batches/<id>/reverse` descuenta el delta del lote del
inventario actual, conservando ventas, ajustes y precios posteriores. Si quedan
menos unidades libres que el delta, deja la reversión pendiente. No restaures
ciegamente `catalog-before.json`. No uses el código antiguo que asumía siempre
6 unidades para aplicar/revertir un lote nuevo de otra cantidad: mantén esta
revisión compatible del motor y sus respaldos, aun al revertir otros cambios.

## Verificación

`npm run test:inventory-manual` usa almacenamiento y cuentas aisladas: 0→5,
10→15 con reservas, varias presentaciones, sede inactiva/no asociada, conservación
de archivados, reintentos, interrupción/reinicio, edición concurrente, fallo de
persistencia, reversión compensatoria, API protegida y consistencia tienda/admin.
`src/tests/catalogBatch.test.ts` conserva los casos históricos de +6 y precios.

En la instalación destino: guardar respaldo previo, preparar un solo ID,
revisar número de referencias/asociaciones, aplicar por bloques y comparar cada
fila antes/después con las cantidades del servidor. Confirmar en el panel y
releer después de reiniciar. No se ejecuta ningún lote automáticamente al desplegar.
