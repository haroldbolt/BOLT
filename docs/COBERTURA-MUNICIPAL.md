# Cobertura municipal de BOLT

La lista permitida está en `src/data/coverageConfig.ts`. Es configuración de código protegida por los permisos del repositorio: no existe un endpoint público para modificarla. `GET /api/v1/admin/coverage` permite consultarla con la autenticación administrativa existente. No se añade un editor de municipios al panel en este cambio.

| Municipio (DIVIPOLA) | Zona habilitada | Programado | Turbo |
| --- | --- | --- | --- |
| Bogotá D.C. (11001) | Suelo urbano existente; Sumapaz excluido | Mapa de localidades existente en `warehouseConfig.ts` | Reglas existentes de localidad, radio, tiempo y capacidad |
| Soacha (25754) | Intersección del polígono urbano y zona habilitada previamente | HUB_KENNEDY | No |
| Chía (25175) | Cabecera municipal DANE; sin centros poblados ni suelo rural | HUB_SUBA, mismo servicio aprobado de Bogotá | No |
| Cajicá (25126) | Cabecera municipal DANE; sin centros poblados ni suelo rural | HUB_SUBA, mismo servicio aprobado de Bogotá | No |

Todos los demás municipios están excluidos. La presencia de Cota, Madrid, Funza, Mosquera, Sibaté y Zipaquirá en la cartografía permite identificarlos: NO les otorga cobertura.

## Autoridad y cartografía

`serverGeography.ts` resuelve las coordenadas del destino contra copias locales de polígonos oficiales. Descarta municipio, localidad, país, código DIVIPOLA y exclusiones suministrados por el navegador. Nunca consulta la ubicación del teléfono. Las coordenadas ausentes, invertidas o inválidas exigen completar información. Un punto comprobado fuera de los polígonos habilitados sí constituye una exclusión geográfica aunque no se conozca su nombre municipal.

Se conservan los polígonos de localidades, suelo urbano de Bogotá y zona urbana de Soacha ya usados. Las nuevas capas proceden del [DANE, DIVIPOLA MGN 2024](https://portalgis.dane.gov.co/mparcgis/rest/services/Divipola/Serv_DIVIPOLA_MGN_2024/FeatureServer): municipios (317) y cabeceras (305, CLAS_CCDGO=1). Cada JSON conserva URL exacta y fecha de consulta. Son una referencia geoestadística verificable para delimitar la zona de servicio, no una declaración catastral. No se habilitan todos los centros poblados ni toda la extensión municipal. La versión 2025 devolvió geometrías nulas en la consulta y no fue incorporada.

El cargador y el actualizador rechazan geometrías vacías/truncadas. Para actualizar: `node scripts/update-coverage-geography.mjs` con acceso a las fuentes oficiales; revisar el diff y ejecutar regresiones antes de desplegar. Actualizar la cartografía no autoriza municipios nuevos.

`quoteForPurchase` aplica la resolución geográfica tanto al cotizar como al crear pedidos. No se emite token de confirmación sin modalidad y capacidad válidas. Crear un pedido vuelve a evaluar territorio, modalidad, franja, precios, existencias, vehículos y token. Los pedidos ya confirmados y sus reintentos idempotentes conservan el comportamiento e historial existentes.

## Habilitar un municipio nuevo

1. Obtener y revisar su código DIVIPOLA, polígono municipal y zonas urbanas autorizadas. Incorporarlos mediante el script; ampliar la consulta de municipios y cabeceras. Si requiere una restricción distinta, añadir un polígono de servicio documentado al resolver del servidor.
2. Registrar en `COVERAGE_MUNICIPALITIES` el código, nombre, alias equivalentes, `active`, `modes`, `scheduledStoreId` real y `zone`. Una sede nueva o un proveedor externo no cambia esta lista.
3. Para una ruta nueva, comenzar con `scheduledService: null`. No copiar `EXISTING_SERVICE`: su reutilización requiere autorización expresa, como la recibida para Chía y Cajicá.
4. Sustituir `null` por datos aprobados: `routeReference`, `verifiedAt`, `weekdays` (0 domingo–6 sábado), `windowIds` del sistema existente (`HORARIO_1/2/3`), `capacityPerWindow` y precios COP (`shipping`, `freeShippingFrom`, `serviceFee`). La tarifa se aplica una vez a la compra según la política existente; se conservan los cargos de proveedores cuando corresponden.
5. Registrar en la administración de transporte vehículos, capacidad física y disponibilidad explícita para esas franjas. Revisar cobertura del proveedor y capacidad para la ruta. Añadir un repartidor no permite un destino excluido.
6. Probar centro, bordes, rural, municipio vecino, modalidad no habilitada, stock, franja sin cupo, ausencia de flota, cotización y pedido por API. Cambiar `active`/modalidades solo con autorización. Revisar también el texto de cobertura de esta configuración si cambia la lista comercial.

## Servicio aprobado: Chía y Cajicá

El usuario autorizó el 7 de noviembre de 2026 utilizar los mismos días, franjas, cupos, tarifa y ruta operativa que Bogotá. Ambas cabeceras usan `scheduledService: 'EXISTING_SERVICE'`, exclusivamente Programado desde `HUB_SUBA`. No se copian ni inventan horarios por municipio: se reutilizan `OFFICIAL_SCHEDULED_WINDOWS` (09–14, 14–18, 18–22), sus cortes (10:00, 12:00, 16:00), calendario `America/Bogota`, capacidad base de 10 pedidos por franja menos reservas activas de Suba y la tarifa de la configuración de transporte. Las reglas de capacidad/embalaje y la disponibilidad explícita de vehículos de Suba se validan por franja y carrito. No se modifican radios ni se habilita Turbo.

La copia local de revisión utiliza flota ficticia aislada, identificada como SIMULACIÓN. Esto no acredita flota real disponible: registrar vehículos, capacidades físicas y franjas reales antes de operar. Rappi sigue sin integración real. Si un municipio se configura en `null` o con datos incompletos, permanece geográficamente habilitado y responde `SCHEDULED_SERVICE_PENDING` sin franjas ni confirmación.

## Interfaz y alertas

Al pulsar **Confirmar dirección** sobre un destino identificado fuera de la zona, la app conserva dirección y carrito, bloquea la entrega y muestra el banner interno existente con “¡Muy pronto llegaremos a tu zona!” y **Cambiar dirección**. No se dispara por escribir ni por cada render; no necesita permiso de notificaciones. Se puede descartar para continuar explorando. Cambiar dirección conserva el texto rechazado para corregirlo. Confirmar una dirección válida elimina el bloqueo, descarta la franja anterior y vuelve a cotizar. Los contadores de solicitud y cancelaciones de efectos impiden aplicar respuestas antiguas.

Una dirección habilitada pero sin operación también puede quedar seleccionada; se comunica la causa pendiente sin inventar una sede, ETA o disponibilidad. Se conservan el carrito de invitado, catálogo, tarjetas y variantes.

## Verificación

- `npm run lint`, `npm run build`.
- `npm test`: 13 suites, incluidas regresiones de cobertura, pedidos, variantes, carrito, inventario y transporte. En entornos que bloquean el socket IPC de la CLI `tsx`, usar `node --import tsx <archivo>` para cada script de test.
- `src/tests/municipalCoverage.test.ts`: municipios excluidos con nombres/códigos manipulados, Chía/Cajicá con servicio heredado autorizado, simulación de operación configurada y falta de flota, país/componentes, datos incompletos, rural/Sumapaz, recuperación de Cedritos y banner accesible.
- `municipalCoverageHttp.test.ts`: solo copia aislada llamada `BOLT-coverage`, puerto 3020, producto y flota SIMULACIÓN. Bloqueos directos de API, token anterior, precio manipulado, pedido Cedritos/Suba, idempotencia y reserva única; compara pedidos anteriores sin modificarlos. Ejecutar con `BOLT_COVERAGE_TEST_URL=http://localhost:3020 node --import tsx src/tests/municipalCoverageHttp.test.ts`.
- Fixtures de nuevas direcciones: resultados reales de Google Geocoding del 7 de noviembre de 2026, validados por polígonos del servidor; puntos rurales de prueba se derivan explícitamente de geometrías y no se presentan como direcciones postales.

No ejecutar el test HTTP contra pedidos reales. No se repite ningún lote +6 ni importación Shopify. La copia de revisión tiene datos separados y disponibilidad ficticia. El cambio de código no migra ni reescribe inventarios, catálogo o historial.


## Selector de horarios y regresión de noviembre

La modal muestra modalidad, sede y destino provenientes de la cotización. Cambiar de destino desmonta la selección anterior, elimina la franja y espera la nueva respuesta. El cliente elige explícitamente una franja; no se confirma automáticamente el primer horario. Una fecha que pierde cupo permanece visible con “No hay horarios disponibles para esta fecha. Elige otro día”; las alternativas se muestran solo si tienen capacidad confirmada. La falta de flota conserva su motivo específico. Los cupos muestran el máximo del servidor; no se promete “Sin recargo” a partir de un precio de franja genérico.

`scheduledDestination.test.tsx` verifica herencia Bogotá/Suba, fecha COT, cupos por sede, alternativas con flota, configuración pendiente, ausencia de selección automática y transiciones Cota/Chía/Cajicá/Cedritos/Soacha. Las pruebas HTTP revalidan municipio, sede y franja y comparan el historial para comprobar que consultar horarios no crea pedidos.

Para verificar horarios sin crear pedidos: `BOLT_COVERAGE_TEST_URL=http://localhost:3020 node --import tsx src/tests/scheduledDestinationHttp.test.ts` (solo copia aislada). Compara historial, existencias y reservas antes/después; rechaza franjas inexistentes y cotizaciones reutilizadas para Cota.
