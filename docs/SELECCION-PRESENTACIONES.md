# Presentaciones en el catálogo

La tarjeta y la ficha utilizan `PresentationSelector` y un `PresentationProvider` compartido. Las opciones proceden de `Product.presentaciones`: `varianteId`, `nombre`, `sku`, `foto`, `price`, `stockByStore`, `reservedStockByStore` y `bodegaIds`. No se importan datos ni se ejecutan ajustes de inventario al seleccionar.

- Varias opciones: ninguna seleccionada inicialmente. El botón + lleva el foco al selector sin añadir una variante implícita.
- Una opción: nombre visible directamente. Sin radios innecesarios.
- Nombres repetidos: se conserva el título completo y se distingue mediante SKU único o referencia real. La misma etiqueta se utiliza en tarjeta, ficha, carrito y nuevos pedidos.
- Precio, imagen, stock y cantidad del carrito proceden de la presentación elegida. No se reutilizan descuentos o precios por unidad de otra variante.
- `saleVariant` conserva el contrato histórico: ID del producto para la primera variante y `varianteId` para las siguientes; además conserva `parentProductId` y `variantId`. El servidor vuelve a resolver los datos comerciales al crear el pedido.

## Disponibilidad y entrega

La tarjeta consulta `/api/v1/delivery/quote` con el destino seleccionado, modalidad, franja y carrito más una unidad de la presentación elegida. La bodega procede de esa respuesta, nunca de una sede predeterminada de la interfaz. Se restan las reservas de las existencias de esa variante y bodega. Los errores geográficos, de franja o de inventario mantienen el mensaje del servidor.

Sin dirección, sede, precio válido o validación disponible, la compra permanece bloqueada con un mensaje específico. El estado Turbo solo se muestra cuando el servidor recomienda esa modalidad y la habilita. Si recomienda Programado, la tarjeta lo indica; el flujo existente del carrito ofrece sus franjas.

Cada cambio de variante, dirección, modalidad, franja o carrito cambia la clave de consulta y descarta respuestas anteriores. Se consultan solo tarjetas visibles; las peticiones idénticas comparten una caché de hasta 15 segundos, limitada a 100 entradas. Se actualiza a los 30 segundos y al volver a la pestaña. Checkout vuelve a validar el pedido.

## Verificación

- `npm run lint` y `npm run build`.
- `npm test`: 309 casos (297 existentes y 12 nuevos).
- `src/tests/presentationSelection.test.tsx`: fixtures aislados para una/varias opciones, ID inexistente, precio inválido, reservas, agotado por sede, destino pendiente, títulos repetidos, líneas independientes y HTML accesible.
- `src/tests/presentationSelectionHttp.test.ts`: se ejecuta exclusivamente desde una copia desechable llamada `variants-test-runtime`, en puerto 3005. Crea un pedido de prueba de Agility Gold Adulto Raza Grande con 3 kg ($54.900) y 15 kg ($245.000), desde Suba; verifica reservas, precio manipulado, exceso de stock, ID inválido e idempotencia. `--verify-restart` comprueba persistencia tras detener y arrancar ese servidor.
- Navegador: selección inicial vacía, + enfoca sin agregar, selección con Espacio/flechas, cambio de precio, selección compartida entre ficha/tarjeta y dos líneas conservadas en carrito. Revisado en escritorio y tamaños móviles de 390 y 430 px.

Los pedidos de prueba y las capturas se guardan fuera del repositorio. No ejecutar la prueba HTTP contra la app principal. No se hicieron importaciones Shopify, nuevos ajustes +6 ni cambios a los datos de la app local.
