# Dirección confirmada y foto opcional de entrada

Base revisada: `main` `38ea7bf1966d6cef13cddb6d52e07d7620c003c4`. Rama propuesta: `codex/foto-entrada-direcciones`. No requiere modificar catálogo, reservas, precios ni pedidos anteriores. Incluye las mejoras locales previas del encabezado y ubicación actual.

## Recorrido del cliente

1. En el encabezado superior izquierdo, abrir **Mis direcciones**. Seleccionar una guardada, escribir una nueva o pulsar **Usar mi ubicación actual**.
2. Se solicita la ubicación únicamente tras esa acción. Revisar la dirección y ajustar el pin. La posición del dispositivo nunca confirma una dirección automáticamente.
3. Completar apartamento o referencia si hace falta. **Tomar foto** o **Elegir foto** son opcionales; se puede cambiar o quitar la imagen y continuar sin ella. No se exige una imagen para comprar.
4. Pulsar **Usar esta dirección**. La misma pantalla permite guardar una dirección con nombre y marcarla como predeterminada. La cobertura se vuelve a consultar en el servidor.
5. Revisar la foto y el destino en checkout. Elegir la franja, revisar el costo y confirmar la compra por el flujo existente.
6. Después de una respuesta exitosa, se guarda una copia de la foto para ese pedido y se intenta enviarla. Si falla, el seguimiento permite **Reintentar envío de la foto**, sin volver a crear ni cobrar el pedido.
7. El cliente y administración ven la referencia en el seguimiento; administración también en despachos. BOLT Conductor la ve con las instrucciones del despacho confirmado. No se ofrece al conductor que solo tiene una oferta pendiente.

Cambiar el destino retira la foto del borrador. Editar/quitar la foto de una dirección guardada no modifica las imágenes de compras ya confirmadas. La referencia no prueba que el cliente esté físicamente ahí y no reemplaza dirección, coordenadas ni PIN de entrega.

## Datos y privacidad

- Direcciones: clave existente `bolt_pets_guest_addresses_v1`, campo opcional `referencePhotoId`. El esquema sigue siendo compatible con las direcciones sin foto. No se guardan imágenes ni permisos de cobertura en localStorage.
- Imágenes y envíos pendientes: IndexedDB `bolt_guest_entrance_photos_v1`, almacenes `photos` y `uploads`. Cada envío contiene su propia copia y la identidad del destino; no incluye credenciales.
- Al retirar referencias locales se eliminan las fotos que ya no usa una dirección. Los borradores abandonados se limpian después de 24 horas. La cola del pedido conserva su copia independiente.
- Si el navegador impide IndexedDB, se informa que la imagen solo dura mientras la página esté abierta. No se promete sincronización entre dispositivos. El usuario puede continuar sin foto.
- Cliente: hasta 20 MB de entrada; JPEG/PNG/WebP y HEIC/HEIF solo si el navegador puede decodificarlos. Se redibuja en JPEG, máximo 1280 px y 1 MiB, eliminando nombre de archivo y metadatos.
- Servidor: vuelve a decodificar JPEG, limita bytes/píxeles, corrige orientación, redimensiona y recodifica sin metadatos. No confía en MIME o dimensiones enviados por el navegador. [Comportamiento documentado de Sharp](https://sharp.pixelplumbing.com/api-output/).
- Almacenamiento privado: `<BOLT_DATA_DIR>/private-entrance-photos/`, o `src/data/private-entrance-photos/` si no se define la variable. Está excluido de Git y fuera de `/uploads` y `dist`.
- Cada pedido tiene un registro inmutable versionado con JPEG, hash, origen, fecha y actor. La escritura publica metadata y bytes juntos mediante archivo temporal, fsync y enlace exclusivo; un reintento no sobrescribe la imagen. Archivos temporales de una interrupción no se sirven.
- Las respuestas llevan `Cache-Control: private, no-store`. Las credenciales viajan en cabeceras al backend, nunca en URLs de imagen.
- La conservación/eliminación de fotos de pedidos confirmados debe seguir la política operativa de la instalación. Esta etapa no borra fotos de históricos ni inventa una política legal de retención. Respaldar este directorio privado junto con los pedidos; no publicarlo en CDN.

## Endpoints

| Método y ruta | Permiso y resultado |
| --- | --- |
| `PUT /api/v1/orders/:id/entrance-photo` | Capacidad privada de esa compra o sesión administrativa verificada; `X-Photo-Id`, `X-Photo-Destination`, cuerpo JPEG. Comprueba el destino guardado. Primera carga 201; reintento idéntico 200; otra foto o destino 409. No admite primera carga de un pedido cerrado. |
| `GET /api/v1/orders/:id/entrance-photo` | Mismo acceso privado del pedido; 404 si no hay foto. Los pedidos cerrados conservan su referencia sin reabrirse. |
| `GET /api/v1/driver/dispatches/:id/entrance-photo` | Sesión real del conductor actualmente asignado; estados activos y custodia no liberada. No permite ofertas, otros conductores ni entregas cerradas. |

Las imágenes no alteran el estado del pedido. La fecha de carga no es una prueba de entrega o recogida. El registro privado contiene auditoría de creación sin tokens. Rappi e inDrive reales continúan desactivados.

## Instalación y revisión

Instalar con el lockfile existente actualizado: `bun install --frozen-lockfile`. Sharp es una dependencia de producción; `fake-indexeddb` se utiliza solo en pruebas. Ejecutar `npm run lint`, `npm test`, `npm run build` con Node 22. El despliegue debe conservar el directorio de datos privado y dar escritura solo al proceso de BOLT. No necesita migración masiva de pedidos ni ajustes de inventario.

Para una revisión aislada: `node --import tsx scripts/dispatch-simulation.ts ../bolt-dispatch-simulation-foto-entrada`. Seguir las instrucciones que devuelve el generador. Nunca activar `BOLT_DISPATCH_SIMULATION` en producción. `src/tests/entrancePhotoReview.tsx` es un arnés separado, no importado por la app ni incluido en su build normal; usa coordenadas de fixtures documentados y los componentes reales de dirección, checkout y seguimiento.

La reversión de interfaz puede ignorar `referencePhotoId`. Conservar IndexedDB y los archivos privados; no restaurar inventario ni pedidos viejos. La reversión no habilita acceso público a las fotos. Para mantener su visualización se requiere esta revisión o una que conserve sus endpoints y autenticación.

## Verificación realizada

- 25 suites de la aplicación aprobaron con las versiones de `bun.lock`, incluyendo carrito, variantes, cobertura, transporte, históricos, seguridad, imágenes y ubicación. TypeScript y build correctos.
- Nuevas pruebas: IndexedDB, direcciones con/sin foto, edición y eliminación, copia independiente del pedido, almacenamiento no disponible, fallo/reintento y deduplicación.
- HTTP contra servidor real en directorio temporal: autenticación, MIME falso, imagen inválida, tamaño, destino diferente, EXIF eliminado, administrador, titular, conductor asignado y conductor ajeno, reintento de compra/carga, persistencia tras reinicio, conservación de precios, cantidades y reservas, lectura de foto en pedido cerrado y prohibición de una primera carga que lo reabra.
- Navegador: cargar PNG de prueba y convertir a JPEG; guardar dirección/foto, recargar, checkout real de prueba con franja de Suba, pedido `BP-000001`, foto en seguimiento y recarga. Un intento con cotización no vigente creó cero pedidos. Eliminar foto de la dirección dejó intacta la del pedido.
- Administración y BOLT Conductor mostraron la foto; el despacho asignado de prueba `BP-000002-E01` conservó código, contenido y estado. Solo fixtures, sin cobros ni servicios externos.
- Vista de 390 × 844: imagen cargada, controles accesibles por teclado y sin desbordamiento horizontal. También se revisó escritorio.
- Los cuatro archivos protegidos del PR #11 permanecen idénticos a main: `PresentationSelector.tsx`, `presentationDisplay.ts`, `catalogPurchase.test.tsx`, `presentationSelection.test.tsx`.
- Los 15 archivos de datos de la simulación anterior del usuario permanecen con sus hashes originales. La nueva revisión usa otro directorio y otro origen local.

Pendiente antes de publicar: verificar captura de cámara/GPS en teléfonos iOS y Android reales con HTTPS y permisos del dispositivo. La emulación de ancho no sustituye esa prueba. HEIC depende del decodificador del navegador; se muestra una alternativa JPG/PNG si no se puede abrir. No hay Street View automático, seguimiento en segundo plano ni nuevos servicios de pago.
