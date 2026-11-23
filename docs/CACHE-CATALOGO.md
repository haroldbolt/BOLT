# Caché de catálogo, inventario y precios

## Cómo obtiene BOLT el catálogo

| Lectura | Fuente | Cuándo se actualiza |
| --- | --- | --- |
| Productos, presentaciones y sedes del catálogo base | Archivos de `src/data/catalogo-local` y catálogo incorporado a la versión | `LocalCatalogService` conserva el resultado agrupado en memoria. El TTL de catálogo limita la vigencia de esa copia. |
| Fichas comerciales, fotos y estado de publicación | Catálogo base más personalizaciones persistidas que gestiona `CatalogRepository` | Las altas, ediciones, cambios de estado y lotes de imágenes se reflejan en la caché combinada. |
| Listado público con precios, promociones, cantidades y reservas por presentación y sede | `CatalogOperations.publicCatalog()` combina los datos comerciales con los movimientos de los pedidos | Conserva una sola vista del listado. Al cambiar la base combinada, el estado comercial o la revisión persistida de operaciones, la lectura siguiente reconstruye la vista. Una entrega, cancelación o nueva reserva puede cambiar el resultado aunque nadie haya editado la ficha. |
| Productos vendibles durante una petición | `currentSalesProducts()` en `server.ts` | Reutiliza la vista sólo dentro de la petición que la necesita. La petición siguiente vuelve a leer su estado comercial. Salud y telemetría evitan aplanar todo el catálogo únicamente por pasar por la API. |

El TTL se configura con `BOLT_CATALOG_CACHE_TTL_SECONDS`, de 1 a 3.600 segundos. Su valor inicial es **60 segundos**. Una lectura posterior al vencimiento compara la identidad, el tamaño y las marcas de tiempo de los archivos. Sólo reconstruye el catálogo si cambió la fuente. El proceso conserva la última lectura correcta si falla la actualización del catálogo base. El piloto fija las sedes operativas activas al arrancar. Los cambios de configuración de esas sedes requieren reiniciar la versión correspondiente.

Cada cotización y confirmación obtiene su propia vista de productos vendibles. El backend comprueba la cantidad, la sede, la disponibilidad y la reserva correspondiente al pedido.

El resumen de `/api/v1/catalog/summary` describe la importación del catálogo base. Para ver inventario operativo de una sede y las reservas actuales, consulte Inventario en BOLT Admin. Los ajustes deben realizarse por los recorridos autorizados de administración, que persisten la edición e invalidan las vistas correspondientes.

## Navegador y cachés compartidas

| Respuesta | Política HTTP de producción |
| --- | --- |
| `GET /api/v1/catalog` y `/api/v1/catalog/summary`, sin credenciales | `public, no-cache, must-revalidate`. El navegador puede guardar la representación y debe revalidarla antes de reutilizarla. Un ETag vigente permite responder 304. Cada URL con filtros tiene su propia representación. |
| Esos mismos recursos con cookie, autorización, token del pedido o respuesta con `Set-Cookie` | `private, no-store`. La negociación incluye `Vary` para origen y credenciales. |
| Otras API, cotizaciones, pedidos, seguimiento, fotos de entrada, datos de clientes y paneles operativos | Respuestas con `no-store`. Los datos personales, el PIN, la dirección de entrega y los saldos operativos requieren acceso actual y autorizado. |
| Archivos JavaScript y CSS con hash que figuran en el manifiesto de compilación de Vite | `public, max-age=31536000, immutable`. Un cambio de contenido genera una URL nueva. |
| HTML público, iconos, manifiesto PWA y fotografías públicas del catálogo | `public, no-cache, must-revalidate`. El cliente comprueba si cambió la versión antes de reutilizarla. |

El acceso privado de la demo depende de la cookie de la reunión. Su pasarela devuelve `no-store` en las respuestas reenviadas. Compruebe los headers públicos contra el servidor de producción aislado. La actualización de imágenes de catálogo no concede acceso a las fotos de entrada de los pedidos.

## Comprobación en una instalación aislada

1. Solicite el catálogo sin credenciales, guarde el ETag y vuelva a solicitar la misma URL con `If-None-Match`. Si sigue vigente, compruebe el estado 304. Repita con una sesión y compruebe que la respuesta se marque privada.
2. En un catálogo de prueba cambie precio, foto y estado de una ficha por sus rutas administrativas. Compruebe el contenido nuevo y la revalidación de la URL del catálogo. Una ficha archivada debe desaparecer de la vista pública.
3. En las pruebas de inventario aisladas, parta de una vista pública ya consultada. Lea la disponibilidad tras los movimientos de reserva, entrega o cancelación y compruebe el saldo por sede. La cotización y la confirmación consultan su propia vista.
4. Compruebe los headers de una URL JavaScript del manifiesto, del HTML y de una consulta autorizada de seguimiento. Solicite también un archivo inexistente y verifique que la respuesta 404 queda fuera de la caché de larga duración.
