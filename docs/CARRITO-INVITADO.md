# Carrito de invitado

El carrito inicia sin productos de demostración. Se guarda en `localStorage`, bajo `bolt_pets_guest_cart_v1`, únicamente con este esquema:

```json
{"version":1,"items":[{"productId":"ID del producto","variantId":"ID de la presentación, si existe","quantity":2}]}
```

La clave pertenece al origen y perfil del navegador. No vence por tiempo; permanece hasta que el cliente edite/vacíe el carrito, complete un pedido o elimine los datos del sitio. No hay sincronización de carritos entre dispositivos ni cuentas de clientes. El modo privado sigue la duración de almacenamiento que permita el navegador.

`GuestCartStore` solo lee durante construcción/restauración. Cada acción explícita escribe su nueva selección antes de notificar a React. Un carrito vacío guardado no equivale a un carrito ausente. Los fallos de almacenamiento dejan operar en memoria y muestran un aviso. Los datos inválidos se toleran sin borrar otras claves; una modificación explícita guarda el nuevo estado válido. Duplicados exactos no suman cantidades automáticamente.

La restauración espera el catálogo completo con respuesta exitosa del servidor y sin caché HTTP. No utiliza el catálogo semilla como respaldo de restauración. El servidor entrega nombres, imágenes, precios y existencias. Una variante retirada se conserva como referencia no disponible y debe eliminarse explícitamente; nunca se elige otra por posición. La cotización vuelve a validar el destino, modalidad y carrito. Antes de abrir checkout se refresca el catálogo; el servidor valida nuevamente importes y reservas al crear el pedido.

No se crean pedidos ni reservas al leer o editar el carrito. El mecanismo `bolt_checkout_request` y su encabezado `Idempotency-Key` se conservan. El carrito se vacía exclusivamente en el callback de pedido exitoso; los errores y la apertura del checkout lo conservan. Los pedidos de este flujo se identifican como invitados.

## Validación

`npm run lint`, `npm run build`, `npm test`; pruebas adicionales en `src/tests/guestCart.test.tsx`. Cubren referencias, variantes, cantidades, vacío explícito, campos comerciales manipulados, catálogo no disponible, presentación retirada, JSON inválido, almacenamiento bloqueado, duplicados y renderizados repetidos con StrictMode.

Recorrido de navegador en origen separado: primera visita, agregar/recargar, NexGard y Meloxicam legítimos, cantidades, vaciado/recarga, cierre/reapertura, dos presentaciones, pedido fallido por cambio de precio, precio actualizado, pedido exitoso y vacío posterior. Los casos HTTP de precio alterado e inventario insuficiente no crean pedidos. Las pruebas de pedidos deben usar una copia independiente de los datos.

## Aislamiento de pruebas locales

Ejecutar el servidor de pruebas con `NODE_ENV=production PORT=3007 node --import tsx server.ts` desde la copia de pruebas. El repositorio de pedidos usa una ruta relativa a su módulo; al empaquetarlo en `server.js`, esa ruta cambia a `../data`. No ejecutar varios bundles hermanos suponiendo que sus pedidos están aislados por el directorio de trabajo. Esta corrección del carrito no migra ni cambia el almacenamiento de pedidos existente.
