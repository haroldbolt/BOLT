# Capacidad del piloto

El objetivo es atender a 1.000 usuarios activos de forma sostenida. Para dimensionar el servicio hay que conocer con qué frecuencia consultan el catálogo, cuántos siguen un despacho, cuántos confirman pedidos por minuto y cuánto historial existe. Un millar de conexiones abiertas puede producir cargas muy diferentes según estas cuatro cifras.

## Capacidad que necesita medirse

| Recorrido | Trabajo que realiza el servidor | Qué comprobar |
| --- | --- | --- |
| Consultar catálogo | Reutiliza una vista de productos hasta que cambian la base, el estado comercial o la revisión operativa. El listado completo y el listado por ID real de sede conservan también los bytes y su ETag. Una consulta condicional repetida puede responder 304 sin serializar otra vez. Las búsquedas y categorías se filtran y serializan por petición. | Medir catálogo completo, por sede y con filtros, primera lectura, lectura repetida, bytes transferidos y latencia después de una reserva. Un 304 mide un recorrido distinto al de descargar el catálogo en el primer ingreso. |
| Cotizar y confirmar | Obtiene la vista comercial de la petición, evalúa disponibilidad por sede y conserva la clave idempotente. El escritor de fulfillment conserva pedidos, despachos y auditoría. | Medir cotizaciones y confirmaciones por separado con historial de tamaño representativo. Registrar conflictos esperados de disponibilidad, errores inesperados y tiempo de publicación en disco. |
| Seguir pedidos y operar la flota | La lectura del seguimiento convive con las escrituras de estados y telemetría. La persistencia JSON publica una instantánea del estado operativo. | Medir el impacto de escrituras en paralelo sobre el tiempo de respuesta de los clientes y sobre el consumo de CPU, memoria y disco. |
| Usar cuentas | Las sesiones y datos de clientes usan PostgreSQL. El límite de conexiones y las políticas RLS de las tablas deben conservarse al ampliar el servicio. | Medir espera por conexión y latencia de lecturas y escrituras con identidades distintas. Verificar que las conexiones reutilizadas mantengan el aislamiento de cada cuenta. |

## Ensayo local reproducible

`node deployment/load-pilot.mjs` inicia el piloto en loopback sobre un volumen temporal, con un único escritor. La carga programa 1.000 usuarios virtuales, 10 segundos de incorporación, 60 segundos de observación y pausas de 8 a 16 segundos entre solicitudes. El itinerario reparte consultas de catálogo por SKU, sedes y cotizaciones para Suba. Exige una respuesta coherente con el bloqueo vigente de recaudo. Compara antes y después la revisión, cantidad de pedidos y despachos y un resumen verificable de reservas por referencia y sede. Ajusta sólo en el proceso aislado la cuota por IP, porque todo el tráfico proviene de loopback. [Script del ensayo](../deployment/load-pilot.mjs)

La salida expresa cuántos usuarios llegaron a actuar más de una vez y el máximo de solicitudes simultáneas. Permite distinguir un ensayo completo de uno que acabó con clientes en espera o con timeouts. Este recorrido omite pedidos reales, sesiones de clientes, pagos y servicios externos.

### Resultado medido en el equipo local

Con Node 22.22.0, macOS ARM64 y 10 CPU lógicas, los **1.000 usuarios virtuales completaron al menos dos interacciones**. De las 4.909 solicitudes iniciadas en el minuto medido, 4.902 terminaron dentro de esa ventana, para **81,7 respuestas por segundo**. Las siete restantes terminaron durante el drenaje. Todas devolvieron HTTP 200 y pasaron la comprobación de contenido. El pico observado fue de 27 solicitudes en vuelo.

| Recorrido | Respuestas válidas | p50 | p95 | p99 |
| --- | ---: | ---: | ---: | ---: |
| Búsqueda de catálogo por SKU | 2.456 | 24 ms | 114 ms | 190 ms |
| Sedes | 1.474 | 22 ms | 111 ms | 194 ms |
| Cotización con recaudo bloqueado | 979 | 56 ms | 145 ms | 206 ms |

La revisión del volumen se mantuvo en 1, con cero pedidos y cero despachos. El resumen verificable de 26.490 filas de reservas por referencia y sede coincidió antes y después. Esta medición cubre un minuto de navegación y cotizaciones con el servidor y el generador en el mismo equipo. El rendimiento de compra, la latencia de la red pública y el comportamiento durante un turno completo requieren un ensayo en el hosting seleccionado.

El trabajador de despachos continúa buscando candidatos cuando falta capacidad. Si sigue en el mismo estado, evita volver a guardar la misma incidencia a cada sondeo. La sincronización localiza pedidos y recorridos mediante un índice durante el ciclo. En las transacciones, el repositorio conserva la copia necesaria para revertir un fallo y evita un clonado adicional al publicar los datos. Estas mejoras reducen escrituras y trabajo de CPU de fondo mientras el piloto sigue con un único escritor.

La suite HTTP de precios contiene una prueba separada de la última unidad. Envía dos confirmaciones concurrentes con claves distintas a un servidor temporal, exige una sola compra, comprueba el motivo de rechazo de la otra y revisa la reserva en Suba y los saldos de las otras dos sedes tras reiniciar. [Regresión de compras concurrentes](../src/tests/turboPricingHttp.test.ts)

## Ensayo de aceptación

1. Harold y la ingeniera acuerdan una mezcla de recorridos, período sostenido y objetivos de latencia y error. Preparan en el hosting elegido una instalación aislada con catálogo e historial representativos, identidades de prueba, volumen y base exclusivos y proveedores sin efectos externos.
2. Aumentan gradualmente la cantidad de usuarios activos hasta 1.000. El informe debe incluir usuarios simultáneos, solicitudes en vuelo, solicitudes por segundo, duración y percentiles p50, p95 y p99 por recorrido. Separan 429 por cuota, rechazos de inventario previstos, fallos 5xx y timeouts. Para simular distintos clientes detrás del proxy deben usar una topología de confianza que represente tanto redes distintas como clientes que comparten NAT.
3. En la copia aislada comprueban que las confirmaciones simultáneas sobre la última unidad disponible de la misma variante y sede acepten como máximo una reserva. Repetir una confirmación con la misma clave y contenido debe devolver el mismo pedido. Comparan saldos por SKU y sede tras reserva, cancelación y entrega, incluyendo devoluciones físicas pendientes. Revisan cantidades de los despachos y la ausencia de cobros o servicios externos. Verifican también que los estados sobrevivan a un reinicio.
4. Registran tamaño del historial, clase de máquina, memoria máxima, latencia de disco, retrasos del bucle de eventos y conexiones a PostgreSQL. Repiten el ensayo con una copia del historial de mayor tamaño para comprobar el efecto de serializar la instantánea. Las mediciones locales deben conservar su escenario y duración al comunicarlas.

## Decisión para operar y crecer

El lanzamiento con JSON requiere **un escritor y un volumen persistente**. La instantánea incluye pedidos, conductores, auditoría, telemetría y despachos. Su coste de lectura, clonado y escritura crece con el historial. La topología de piloto limita las réplicas a una, y la configuración vigente conserva el bloqueo de checkout hasta validar el recaudo. Una lectura rápida o el endpoint de salud por sí solos no acreditan capacidad para ventas concurrentes. [Hosting del piloto](./HOSTING-PRODUCCION.md)

Para escalar escrituras entre instancias, llevar pedidos, reservas, inventario operativo y custodia a una autoridad transaccional compartida. La reserva debe aplicar el cambio condicional por sede y variante, la idempotencia debe ser única y los trabajadores deben reclamar cada operación una sola vez. Establecer políticas por cuenta y sede, cuotas compartidas, una copia coherente para el cambio de versión y una reversión probada con movimientos posteriores. La migración y el ensayo sostenido en el hosting elegido son condiciones pendientes para comprometer capacidad comercial de 1.000 usuarios. [Plan de aislamiento y migración](./AISLAMIENTO-PRODUCCION.md) · [Límites compartidos](./LIMITES-API.md)
