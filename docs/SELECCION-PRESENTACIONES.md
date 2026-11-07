# Presentaciones en el catálogo

La tarjeta y la ficha utilizan `PresentationSelector` y un `PresentationProvider` compartido. Las opciones proceden de `Product.presentaciones`: `varianteId`, `nombre`, `sku`, `foto`, `price`, `stockByStore`, `reservedStockByStore` y `bodegaIds`. No se importan datos ni se ejecutan ajustes de inventario al seleccionar.

- Varias opciones: ninguna seleccionada inicialmente. El botón Agregar lleva el foco al selector sin añadir una variante implícita.
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
- `npm test`: 321 casos (297 originales y 24 de selección/compra).
- `src/tests/presentationSelection.test.tsx`: fixtures aislados para una/varias opciones, ID inexistente, precio inválido, reservas, agotado por sede, destino pendiente, títulos repetidos, líneas independientes y HTML accesible.
- `src/tests/presentationSelectionHttp.test.ts`: se ejecuta exclusivamente desde una copia desechable llamada `variants-test-runtime`, en puerto 3005. Crea un pedido de prueba de Agility Gold Adulto Raza Grande con 3 kg ($54.900) y 15 kg ($245.000), desde Suba; verifica reservas, precio manipulado, exceso de stock, ID inválido e idempotencia. `--verify-restart` comprueba persistencia tras detener y arrancar ese servidor.
- Navegador: selección inicial vacía, Agregar enfoca sin agregar, selección con Espacio/flechas, cambio de precio, selección compartida entre ficha/tarjeta y dos líneas conservadas en carrito. Revisado en escritorio y tamaños móviles de 390 y 430 px.

Los pedidos de prueba y las capturas se guardan fuera del repositorio. No ejecutar la prueba HTTP contra la app principal. No se hicieron importaciones Shopify, nuevos ajustes +6 ni cambios a los datos de la app local.

## Tarjeta de compra directa

La estructura compartida es imagen → marca (si existe) → nombre → precio seleccionado en COP → opciones reales → disponibilidad → botón Agregar de ancho completo. Se mantienen las fotografías, colores, favoritos, listas y comparador de BOLT. Los contenedores flexibles de altura completa alinean los botones por fila y por carrusel; las fotos usan object-contain para conservar el empaque completo. La selección previa de la sesión se conserva al cambiar entre catálogo y ficha; sin selección válida se pide elegir, sin añadir automáticamente otra presentación.

`catalogPurchase.ts` centraliza el bloqueo de operaciones simultáneas, el estado de stock por sede, las ofertas respaldadas por precios finitos y la validación del agregado. Antes de sumar una unidad se consulta el endpoint de cotización sin caché. Una respuesta rechazada o un cambio de selección/destino/carrito mientras responde el servidor no añade nada. La segunda activación de un doble clic no duplica la compra. El mismo bloqueo se comparte con la ficha.

Durante la validación se muestra Agregando… y se bloquean botones y opciones. Después se anuncia Agregado al carrito: {presentación} durante cuatro segundos, sin abrir un modal ni abandonar el catálogo. Se mantiene un control para quitar una unidad y un contador de la variante. El carrito conserva su contrato e IDs; checkout vuelve a validar importes e inventario. No hay reservas ni pedidos creados por pulsar Agregar.

Las opciones sin stock se identifican en la sede confirmada; siguen siendo consultables pero su compra queda bloqueada. Sin sede confirmada no se afirma que estén agotadas. Ningún precio, inventario, asociación ni fotografía se escribe como parte de este flujo.

Pruebas adicionales: `catalogPurchase.test.tsx` cubre 12 casos con fixtures (orden de contenido, botón principal, una presentación, agotado, imagen de respaldo, ofertas válidas, cantidades acumuladas, doble activación, reintento, respuestas obsoletas y líneas distintas). `catalogPurchaseHttp.test.ts` solo permite una copia `purchase-test-runtime` en puerto 3006: dos unidades de Agility Gold 3 kg y una de 15 kg (21 kg; subtotal $354.800), Programado desde Suba, precios canónicos, stock e IDs inválidos rechazados e idempotencia. La app principal no recibe pedidos de prueba.
