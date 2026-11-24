# BOLT · Guía de continuidad para Muse

**Corte verificado el 24 de noviembre de 2026.** Empieza cada cambio de producto desde el último `main`. La rama de Railway contiene ajustes exclusivos para probar BOLT con datos de demostración. El orden recomendado para los tres borradores de producto es **#31 → #2 → #1**.

## Versiones desde las que retomar

| Referencia | Estado al corte |
|---|---|
| [`main` · `163194e`](https://github.com/haroldbolt/BOLT/commit/163194e47b794af29aff647cf791a30e8af832a4) | Incluye el PR #43 y el perfil de prueba Operador de Álamos. Es la base del próximo PR de producto. |
| [`codex/demo-pr40-efectivo-tres-sedes` · `f26138f`](https://github.com/haroldbolt/BOLT/commit/f26138fe779090d7b7eabf254e7514202fee016c) | Contiene ese `main`. Su último commit corrige la prueba que identifica la presentación de Suba y las seis del collar Pawise. La suite de BOLT Admin pasó con esas siete referencias. |
| [Demo de BOLT Admin en Railway](https://bolt-demo-demo.up.railway.app/admin/nuevo/?view=orders&sede=HUB_ALAMOS) | El servicio `bolt-demo`, entorno `demo`, publicó [`39d5a11`](https://github.com/haroldbolt/BOLT/commit/39d5a11825fa3274b0f617ae9ba9f66d3bbd6c39) con estado `SUCCESS`. El único cambio posterior en la rama es la prueba del catálogo. |

## Qué funciona en la base actual

- **Cliente.** Catálogo por marcas, búsqueda por foto, selección de presentación con precio e imagen, carrito de invitado persistente, direcciones guardadas y mapa con pin móvil. El comprobante distingue una compra confirmada de una solicitud pendiente sin cobro. Hay seguimiento privado por despacho. [Carrito](CARRITO-INVITADO.md) · [Mapa en Safari](https://github.com/haroldbolt/BOLT/pull/42) · [Seguimiento](https://github.com/haroldbolt/BOLT/pull/32)
- **Admin.** El panel principal reúne pedidos Turbo y Programados, inventario por presentación y ventas por sede. Coordinación administra cantidades, precios y fotos. En la demo se comprobó que el Operador de Álamos consulta pedidos, inventario y ventas de Álamos y obtiene `403` para esas tres consultas en Kennedy y Suba. Las entregas de prueba quedan identificadas y excluidas de las ventas reales. [Inventario](https://github.com/haroldbolt/BOLT/pull/29) · [Ventas](https://github.com/haroldbolt/BOLT/pull/30) · [Permisos](https://github.com/haroldbolt/BOLT/pull/43)
- **Checkout y Despachos.** El piloto admite efectivo para Turbo y Programado en Álamos, Kennedy y Suba. Se probaron las seis combinaciones con datos aislados, reserva en la sede asignada y reintento sin duplicarla. Una compra puede agrupar varios despachos. BOLT prioriza un vehículo propio apto. Cargo está previsto como respaldo de Turbo y Turbo Dividido. Programado conserva su sede territorial y la flota propia. [Pruebas multisede](REVISION-PILOTO-EFECTIVO.md) · [Operación de Cargo](RAPPI-CARGO-OPERACION.md)

Los borradores #10, #19, #20, #21, #27 y #36 ya se cerraron. Las fotos y los chips entraron por los PR #11 y #12, la cadena de catálogo por #22, el resumen del checkout por #28 y el perfil de Álamos por #43.

## Orden para los tres PR pendientes

### 1. Rappi Cargo · #31

El adaptador colombiano de producción ya está en `main`, desactivado por defecto. Consultar con Operaciones si Rappi exige homologación en su entorno de desarrollo. En ese caso, portar desde `7dc5afa` el adaptador de pruebas, su configuración y su diagnóstico a un PR nuevo. El borrador acredita consultas de puntos de recogida en desarrollo. El primer envío de homologación sigue pendiente. [PR #31](https://github.com/haroldbolt/BOLT/pull/31)

**Antes de activar recaudo**, simular aceptación, rechazo y respuesta tardía. Ante un resultado desconocido, consultar por la misma referencia antes de solicitar otro servicio. Harold y Rappi deben confirmar el permiso de recaudo y la credencial productiva, los puntos de recogida de las tres sedes, las capacidades, los límites en COP, las comisiones y la liquidación. [Condiciones de activación](RAPPI-CARGO-OPERACION.md)

### 2. Inventario Shopify · #2

Acordar con Inventario y con quien integra el POS qué sistema controla los precios, las existencias y las reservas, y cómo se relacionan las variantes y las sedes. Empezar con el lector paginado de `3eb26be` en modo de solo lectura y generar un informe de diferencias. En `main`, la sincronización automática y los webhooks devuelven `409` por diseño. Conservar la asignación territorial de Programado al recuperar el lector. El borrador antiguo elige la sede por cercanía. [PR #2](https://github.com/haroldbolt/BOLT/pull/2) · [Asignación territorial](COBERTURA-MUNICIPAL.md)

**Antes de aplicar saldos**, contrastar dos lecturas completas por variante y sede. Probar una reserva activa, un evento firmado repetido y una lectura interrumpida. Verificar que se conserven la última lectura válida, el saldo de las otras sedes, el precio aprobado y el historial. Usar datos aislados y evitar repetir lotes históricos. [Ajustes de inventario](INVENTARIO-AJUSTE-MANUAL.md) · [Lotes de precios](LOTES-INVENTARIO-PRECIOS.md)

### 3. Herramientas para agentes · #1

Las nueve herramientas de `a60f6a3` son opcionales para el piloto. Elegir las que Muse necesite, revisar su origen y fijar las versiones del instalador y de las fuentes. Probarlas en una instalación limpia. El borrador documenta 93 archivos comprimidos omitidos del paquete Shopify. Comprobar las funciones que dependan de ellos antes de darlas por disponibles. [PR #1](https://github.com/haroldbolt/BOLT/pull/1)

Si Rappi tarda en responder, puede adelantarse la definición de responsabilidades con el POS. Ninguno de los tres borradores requiere fusionar su rama histórica completa.

## Cómo validar y publicar un cambio

1. Actualizar las referencias de GitHub, revisar qué commits del borrador faltan aún en `main` y abrir un PR pequeño desde `origin/main` con el cambio elegido.
2. En una instalación temporal con Node 22, ejecutar `npm run lint`, `npm run build`, `npm test` y `npm run test:bolt-admin`. Para Cargo, repetir `npm run test:pilot`. Para inventario, repetir `npm run test:inventory-manual` y las regresiones específicas de sincronización.
3. Probar en demo el checkout en efectivo, la reserva por sede y el acceso del operador. Mantener los pedidos de prueba con recaudo de $0 y comprobar que sigan fuera de ventas reales. Si se toca el catálogo, verificar las siete presentaciones de muestra en esa rama.
4. Tras la revisión, integrar el cambio de producto a `main` mediante su PR. Para actualizar Railway, llevar el nuevo `main` **hacia la rama de demo**, conservar sus simulaciones y el respaldo de Catastro exclusivo de ese entorno, y comprobar que el servicio publique el commit previsto con estado `SUCCESS`.
