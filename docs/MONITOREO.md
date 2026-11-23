# Monitoreo de BOLT

## Disponibilidad desde fuera de la aplicación

La ingeniera configura una tarea periódica en un sistema independiente del servicio de BOLT. Necesita Node 22, salida HTTPS, un reloj sincronizado y la URL pública final del piloto. Un monitor en la misma instancia dejaría de ejecutarse precisamente cuando esa instancia se apaga.

1. Configure `BOLT_MONITOR_ORIGIN` con el origen HTTPS canónico de producción. Use sólo el origen, sin ruta, usuario, contraseña ni token. `BOLT_MONITOR_TIMEOUT_MS` admite de 1 a 60.000 milisegundos y usa 5.000 por defecto. El comprobador necesita la verificación TLS activa.
2. Ejecute `node deployment/check-availability.mjs`. Hace en paralelo dos lecturas públicas, `GET /api/v1/health` y `GET /api/v1/stores`. Exige HTTP 200, contenido JSON, la identidad de BOLT, zona horaria, timestamp reciente y un número coherente de sedes activas. Un formulario de acceso o una redirección se considera incidencia. El monitor no necesita credenciales y no consulta pedidos, cotiza ni crea compras.
3. Configure el programador para registrar el JSON y enviar una notificación al canal del responsable si la salida es 1 (fallo de servicio) o 2 (configuración incorrecta). El código 0 indica que ambas comprobaciones pasaron. La respuesta incluye latencias y motivos técnicos clasificados. Muestra únicamente el número de sedes. El programador debe alertar también si el trabajo deja de ejecutarse.
4. Harold designa quién recibe la alerta y la persona de respaldo. La ingeniera prueba el canal sobre una instalación independiente de pruebas, ejecuta una lectura exitosa y otra con el servicio detenido y confirma la recepción y el aviso de recuperación. La prueba automatizada `node --test deployment/check-availability.test.mjs` verifica contratos, respuestas intermedias y plazo sin hacer peticiones a proveedores. [Comprobador](../deployment/check-availability.mjs)

El periodo máximo aceptado del timestamp de salud es de cinco minutos y admite hasta un minuto de adelanto del reloj. La consulta de sedes verifica que el backend entregue datos, incluso cuando una página intermedia devuelve HTTP 200. Verifique por separado, con una instalación aislada, el acceso autenticado y los recorridos de compra antes de habilitarlos.

## Errores y notificaciones del servidor

El backend emite incidentes JSON en `stderr` cuando observa una respuesta 5xx, una ráfaga de al menos diez respuestas 429 en un minuto para la misma área, o un fallo de los trabajadores de despacho o correo. Agrupa repeticiones por área y señal. El evento puede incluir un `requestId` generado por el servidor, método y estado HTTP. El nuevo registro omite cuerpos, parámetros de consulta, direcciones, identificadores de compra, PIN y credenciales.

El monitor también notifica las incidencias y búsquedas agotadas que Despachos añade a su registro durante la ejecución. Al reiniciar toma el historial como punto de partida. La simulación conserva los contadores locales y omite el envío al webhook operativo.

La ingeniera configura en el hosting la captura de salida, rotación, retención, acceso y, si corresponde, exportación al sistema de logs acordado. Harold acuerda el período de conservación y el canal de atención con el equipo. Los contadores HTTP y el estado de envío de alertas viven en memoria y comienzan de nuevo al reiniciar. Si se necesitan tendencias entre despliegues, el sistema externo debe guardar las mediciones con la hora y revisión del despliegue.

Para enviar avisos desde el proceso, configure `BOLT_ALERT_WEBHOOK_URL` como secreto del entorno con el destino HTTPS autorizado que recibirá JSON. El enfriamiento `BOLT_ALERT_COOLDOWN_SECONDS` tiene un valor inicial de 300 segundos y admite de 60 a 86.400. El servidor intenta hasta doce notificaciones en una hora, con un máximo de una en vuelo. Un fallo al avisar queda en los contadores del servicio. El monitor externo cubre las caídas completas en las que el proceso ya no puede emitir.

Para validar ese canal, use un receptor controlado de pruebas y la suite del servidor con un incidente sintético. Compruebe formato, agrupación y contadores de envíos recibidos y fallidos. Antes de activar el canal de producción, acuerde con su destinatario un aviso controlado y verifique la entrega. El repositorio no instala una suscripción de pago, un receptor ni un canal de guardia.

## Pedidos, entregas y efectivo

Con sesión del rol administrador, `GET /api/v1/admin/observability` devuelve indicadores agregados. Los contadores del servicio incluyen estado HTTP por área, intervalos de latencia, fallos de trabajadores y una ventana reciente de cinco minutos. Las métricas operativas se calculan al consultar los pedidos y despachos persistidos. Evite un sondeo agresivo de este endpoint.

| Indicador | Interpretación |
| --- | --- |
| Ventas confirmadas del día | Importe conocido en COP de pedidos admitidos por el informe de ventas de BOLT Admin para el día de Bogotá. Los importes faltantes se señalan. |
| Estados de pago | Conteos según los registros de pago. Un pedido confirmado o un pago pendiente puede seguir pendiente de recaudo. |
| Efectivo verificado | Suma sólo con evidencia consistente del despacho entregado, importe esperado y recibido, y relación con la compra. Sin evidencia, el importe puede ser `null`. Un cero representa recaudo cero verificado cuando existe evidencia. |
| Entregas y pruebas | Despachos pendientes, asignados, recogidos, entregados, cancelados, con incidencia o búsqueda agotada. Se informan compras parcialmente entregadas y resultados desconocidos del proveedor. Las pruebas identificadas tienen conteos separados y quedan fuera del importe real. |

Para una incidencia, contraste hora, área, estado y `requestId` con el registro del hosting. Para diferencias de dinero, revise la compra y las evidencias del despacho mediante el panel con permisos. Este endpoint es de lectura. Su consulta no registra pagos, libera reservas ni solicita envíos. [Métricas operativas](../src/lib/operationalMetrics.ts)
