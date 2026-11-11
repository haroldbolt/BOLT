# Marcas Shopify y catálogo de la demo

## Alcance

Rama `codex/marcas-shopify-catalogo`, basada en `f87cf395d49fbdbffd2ca7b717a1c7cd169f8ea2` del PR #18. No modifica main ni integra ese PR. Conserva el carrito, variantes, precio separado, chips compactos y solicitud pendiente sin cobro.

La navegación muestra **Todo → Marcas**. Marcas sustituye el acceso de Alimentos, sin renombrar la categoría comercial de los productos. Los botones abren los productos correspondientes dentro de BOLT y reutilizan sus tarjetas. Búsqueda propia y grupos adaptados de la tienda, con dos columnas en celular y cinco en escritorio.

## Fuente de logos y correspondencias

Fuente consultada: https://cultivacenter.com/es/pages/marcas (2026-11-11). `src/data/brandDirectory.json` conserva fecha, URL original, nombre, grupo, imagen y criterio de cada enlace. Contiene 284 entradas en cuatro grupos, 269 nombres diferentes y 235 imágenes únicas. Las marcas que aparecen en más de un grupo conservan los filtros distintos de Shopify.

`src/lib/brandDirectory.ts` compara vendor normalizado exacto o todas las etiquetas del enlace original. No usa coincidencias parciales del nombre de producto. Solo muestra botones con productos activos y asociados a la sede seleccionada. El conteo procede del catálogo de BOLT. Marcas adicionales conservan acceso por nombre; reutilizan un logo del manifiesto solo si el nombre de marca coincide exactamente tras normalizar. No se inventan logos.

Las imágenes se sirven desde las mismas URLs Shopify; no hay escritura ni sincronización automática en Shopify. Ante un error de carga, el botón conserva el nombre y acceso. Las imágenes usan `object-contain`, dimensiones reservadas y carga diferida.

Para actualizar el directorio: revisar la página de marcas, comprobar logo y destino original, actualizar la entrada versionada y ejecutar `npm run test:brands`. No cambiar precios, existencias, categorías ni IDs para lograr una coincidencia.

## Retiro de productos de simulación

Se identificaron y desactivaron únicamente `SIM-CARD` y `SIM-FOOD-20KG` en el administrador de la demo. Se utilizó `PUT /api/v1/admin/catalog/products/:id` con `{status:"INACTIVE"}`, sesión administrativa y las validaciones existentes. No se borraron registros: SIM-FOOD-20KG conserva reservas asociadas a pedidos históricos. La API pública ya excluye productos inactivos y el cliente aplica también ese filtro al cargar el catálogo.

El respaldo privado recuperable anterior a la operación es `.bolt-private/cart-review-evidence/brands-before.json`, en la copia local BOLT-marcas-shopify. La comprobación posterior está en `brands-archived.json`. No se incluyen en GitHub porque contienen datos de operación. Se comprobaron 3.847 registros de catálogo y 4 pedidos: solo cambiaron esos dos estados; precios, cantidades, reservas, asociaciones y pedidos permanecieron iguales. El catálogo público resultante contiene 3.634 productos.

No hay migración ni borrado automático al desplegar. En otra instalación, revisar sus registros antes de desactivar fixtures. Para revertir este retiro, una operación administrativa autorizada puede cambiar solo su estado; nunca restaurar el catálogo completo sobre movimientos posteriores. No reactivar estos productos al reintentar el lote.

## Validaciones

- `npm run lint`, `npm run build`.
- `npm run test:brands`: navegación, correspondencias exactas, etiquetas, exclusión de inactivos, sede, conservación de datos, nombres alternativos y marcado accesible.
- Suites `presentationSelection`, `catalogPurchase`, `guestCart`, `test:pending-delivery` y `test:turbo-pricing`.
- Comprobación HTTP de las 235 imágenes únicas: HTTP 200 y Content-Type image/*.
- Revisión visual y comprobación de persistencia después del despliegue: ver evidencia añadida al PR.

Los tests utilizan fixtures aislados. Ninguna consulta o cambio de marca crea pedidos, reservas o cobros. Los servicios externos y la configuración logística permanecen sin cambios.
