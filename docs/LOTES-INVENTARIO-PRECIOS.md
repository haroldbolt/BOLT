# Lotes administrativos por variante

La herramienta suma seis unidades vendibles a cada presentación, solo en sus bodegas asociadas y activas según la configuración central de `warehouseConfig.ts` y el catálogo existente. No es un conteo físico ni una lectura del inventario Shopify. Los precios se consultan una sola vez, en modo lectura, por ID de variante o SKU exacto único en ambos catálogos. Nombres y fotografías no sirven como correspondencia.

## Modelo y almacenamiento

- Catálogo y asociaciones: `src/data/catalogo-local/`, `seedData.ts` y `persisted-catalog-overrides.json`.
- Registro durable: `.bolt-private/catalog-operations.json`, excluido de Git, permisos locales 0600. Contiene valores por variante, movimientos, resultados, versiones y auditoría del lote.
- Respaldo: `.bolt-private/backups/<ID>/catalog-before.json` y `operations-before.json`. Incluye precios, existencias, reservas, asociaciones, sedes y huella de pedidos; no contiene datos personales de pedidos.
- Informes CSV/JSON: `.bolt-private/reports/<ID>/`.
- Existencia es `stockByStore`; disponible = existencia − reservas. El ajuste incrementa existencia y disponibilidad en seis, sin cambiar reservas. Cada paquete/presentación cuenta como una unidad vendible.

Antes de esta mejora, las presentaciones solo contenían IDs y nombres: el precio y las existencias estaban en el producto agrupado. Se conserva ese valor para la presentación principal que la tienda utilizaba; las demás tenían inventario sin asignar (cero) y precio pendiente (cero). No se replica el inventario de la presentación principal a todas. El ID de venta original sigue identificando la presentación principal para conservar pedidos históricos. Las demás usan su ID estable de variante.

## Operación protegida

Los endpoints `/api/v1/admin/catalog/batches` (preparar/listar), `/:id` (detalle), `/:id/apply` (reanudar) y `/:id/reverse` requieren la sesión administrativa existente. El actor se toma de esa sesión; no se guarda su token. La preparación recibe `{id,source,inventoryDelta:6}`. `inventoryDelta:0` permite un lote posterior solo de precios. Cada aplicación procesa como máximo 500 variantes y guarda efectos y marcas de finalización juntos con escritura temporal, fsync y rename.

Alternativa de mantenimiento **local**: detener el servidor que usa ese almacenamiento y ejecutar con permisos del usuario propietario:

```sh
export BOLT_BATCH_ACTOR='Nombre del operador autorizado'
npm run catalog:batch -- prepare ID_LOTE /ruta/fuente-shopify.json
npm run catalog:batch -- apply ID_LOTE
npm run catalog:batch -- report ID_LOTE
```

El CLI y el servidor comparten un bloqueo de proceso; no ejecutar dos instancias contra el mismo directorio. El almacenamiento JSON está diseñado para un único servidor Node. Para múltiples réplicas se requiere migrar a una base transaccional antes de habilitarlas.

La fuente debe incluir `shop`, `currency`, `complete:true`, `completedAt` y todas las `variants` con `id`, `sku`, `title`, `price`, `product:{id,title,handle}`. Se rechaza una lectura incompleta. Money usa punto decimal; no se aceptan separadores locales ambiguos, valores ausentes, cero, negativos ni moneda distinta de COP. `compareAtPrice`, precios “desde” y cupones no se aplican. Consulta oficial: https://shopify.dev/docs/api/admin-graphql/2026-10/queries/productVariants

## Reintentos, reservas y ediciones simultáneas

Un ID identifica una fuente y una operación inmutables. Repetir `apply` no repite los ajustes. Una interrupción antes de rename deja el estado anterior; después, efectos y resultados ya están confirmados. Los registros completados se omiten al reanudar. Las omisiones de precio no bloquean el ajuste de stock.

Los cambios de precio verifican la versión que se preparó. Los ajustes suman sobre la existencia vigente, sin reemplazar mapas completos. La edición rápida del administrador también exige la versión leída. El servidor valida precio, variante, cantidades, asociación y stock; rechaza un carrito con precio antiguo o manipulado. La reserva del pedido se hace una sola vez.

La proyección de inventario parte del estado capturado y aplica las diferencias de los pedidos durables respecto de ese momento: reserva, entrega, cancelación y devolución pendiente. Así los pedidos posteriores se conservan tras reiniciar, sin reescribir pedidos anteriores. Los envíos divididos se contabilizan por hijo para no descontar también al padre. Las devoluciones pendientes conservan su reserva hasta la inspección existente.

Para corregir precios omitidos después, consultar una nueva fuente y crear **solo precios**:

```sh
npm run catalog:batch -- prepare-prices ID_PRECIOS /ruta/fuente-actualizada.json
npm run catalog:batch -- apply ID_PRECIOS
```

No crear otro lote +6 para resolver únicamente precios.

## Revertir sin perder movimientos posteriores

```sh
npm run catalog:batch -- reverse ID_LOTE
```

La reversión registra una compensación de −6 por ajuste aplicado, nunca restaura ciegamente el respaldo. Si quedan menos de seis unidades disponibles, deja esa reversión pendiente. No toca reservas, pedidos o entregas posteriores. El precio anterior se restaura solo si el precio y su versión siguen siendo los que aplicó el lote; una edición posterior queda pendiente de revisión. La reversión también es idempotente. Revisar el informe para los casos pendientes.

No habilita sincronización: las rutas antiguas de conciliación y simulación quedan bloqueadas y exigen autenticación. Ningún proceso automático consulta o escribe Shopify. La fuente y los datos del lote son privados y no se deben subir a GitHub.
