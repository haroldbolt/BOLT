# Límites de uso de la API y de servicios externos

Los siguientes son los valores iniciales de BOLT. Cada instalación debe contrastarlos con su tráfico de caja, despacho y seguimiento, y con las cuotas y costos de sus cuentas de proveedor. Un intento externo consume cupo antes de enviar la petición, incluso si el proveedor falla. El contador mide intentos y no acredita cobros ni entregas.

## Solicitudes entrantes

La API aplica una ventana de 60 segundos a la red de origen. Cuando hay una sesión válida, aplica también una cuota compartida por las sesiones del mismo cliente, funcionario o conductor. El identificador procede de la autenticación del servidor. Un invitado comparte la cuota de su red. La consulta de salud por GET o HEAD queda exenta para que el balanceador pueda comprobar el proceso durante una saturación.

| Variable | Valor inicial | Qué controla |
| --- | ---: | --- |
| `BOLT_API_RATE_IP_PER_MINUTE` | 600 | Solicitudes de cualquier ruta API desde una IPv4 o una red IPv6 /64. |
| `BOLT_API_RATE_USER_PER_MINUTE` | 300 | Solicitudes de una identidad autenticada, incluso si cambia de red. |
| `BOLT_API_RATE_AUTH_PER_MINUTE` | 20 | Cuota adicional para inicios de sesión, alta, configuración inicial y callbacks de autenticación. |
| `BOLT_API_RATE_RECOVERY_PER_MINUTE` | 8 | Cuota adicional para recuperación de seguimiento, contraseña y envío de verificación. |
| `BOLT_API_RATE_MAX_KEYS` | 50.000 | Claves de conteo en memoria por ventana. Si se llena, las identidades nuevas deben esperar hasta la próxima ventana. |

El servidor responde con HTTP 429 y `Retry-After` en segundos. El cliente debe esperar al menos ese plazo antes de reintentar. Los sondeos de seguimiento y las consultas administrativas también consumen cuota. Si se reintenta una confirmación de pedido, se conserva su `Idempotency-Key`.

La autenticación de clientes conserva además el limitador de Better Auth en PostgreSQL, tabla `customer_rate_limit`. Su cuota general es 60 solicitudes por 60 segundos, 5 para el alta por correo y 5 para el inicio por correo en sus respectivas rutas, y 3 para solicitar el restablecimiento de contraseña. Verificación y recuperación usan enlaces transaccionales. Google y Apple dependen de credenciales configuradas y de los límites que cada proveedor aplica a su autorización.

## Consultas salientes y correo

| Servicio | Por identidad/min | Total/min | Simultáneas | Cupo diario | Operación medida |
| --- | ---: | ---: | ---: | ---: | --- |
| `GEOCODE` | 30 | 300 | 8 | 2.000 | Las búsquedas de dirección y las consultas inversas comparten el cupo del servidor de Google Maps. |
| `WOMPI` | 12 | 60 | 4 | 500 | Consulta administrativa de una transacción existente al proveedor configurado. Es una lectura de conciliación. |
| `MAIL` | 5 | 30 | 1 | 500 | Intentos de envío del trabajador de correo, con cuota por destinatario identificado mediante HMAC. |
| Búsqueda por foto | 5 | 60 | 4 | 100 | Las cuotas por minuto y simultaneidad protegen la recepción y procesamiento. El cupo diario sólo se consume cuando se llama al reconocedor externo. |

Para las tres primeras filas, use `BOLT_<SERVICIO>_PER_IDENTITY_PER_MINUTE`, `BOLT_<SERVICIO>_TOTAL_PER_MINUTE`, `BOLT_<SERVICIO>_MAX_CONCURRENT` y `BOLT_<SERVICIO>_DAILY_LIMIT`. Para foto, use `BOLT_PHOTO_SEARCH_REQUESTS_PER_MINUTE`, `BOLT_PHOTO_SEARCH_TOTAL_PER_MINUTE`, `BOLT_PHOTO_SEARCH_MAX_CONCURRENT` y `BOLT_PHOTO_SEARCH_DAILY_LIMIT`.

Las consultas HTTP externas se limitan por IP e identidad verificada cuando está disponible. El límite global protege además frente a muchas redes distintas. El cupo diario se renueva a medianoche de Bogotá. En el piloto de producción se conserva en `.bolt-private/provider-budget.json` dentro de `BOLT_DATA_DIR`, en el volumen usado por el único proceso escritor. Se registra el día y el conteo por servicio. Si el archivo es ilegible, la operación externa queda bloqueada hasta recuperar el registro. Fuera de este modo, el contador vive en memoria y se reinicia junto con el proceso.

El trabajador de correo conserva la cola cifrada en PostgreSQL. Cuando se agota un cupo, aplaza el mensaje y conserva sus intentos. Ante fallos de envío usa espera creciente y hasta ocho intentos, con vigencia de 24 horas. Resend recibe una clave idempotente por mensaje. En SMTP, si el proceso se interrumpe tras la aceptación, el usuario puede volver a recibir el mismo enlace de un solo uso.

## Operación y ampliación

1. Configure la IP del cliente mediante los proxies de confianza descritos en la guía de hosting. Varias cajas o móviles pueden compartir una IPv4 por NAT. Mida respuestas 429 en horas pico y distinga la cuota de red de la del usuario o proveedor antes de ajustar el umbral. Un valor alto para toda la aplicación también aumenta el margen de consumo abusivo.
2. Configure en cada cuenta externa las credenciales por entorno, las cuotas que permita el proveedor y las alertas de consumo. La biblioteca web de Google Maps puede originar solicitudes directamente desde el navegador. Esas solicitudes se controlan en Google Cloud por dominio, API y cuota de la clave web. El cupo de geocodificación de BOLT controla las peticiones que pasan por Express.
3. Compare consumo del proveedor, errores y costos con los contadores de BOLT. Una llamada al buscador de fotos puede tener costo variable. La conciliación Wompi está condicionada a configuración y al tipo de transacción. Los cupos de este documento no activan pagos en línea ni servicios de reparto.
4. Antes de habilitar varias réplicas, traslade los contadores y la admisión de trabajos a un almacén común. Use incrementos atómicos con expiración por ventana y por fecha de Bogotá, y permisos de concurrencia con vencimiento y liberación controlada. Valide reinicio, pérdida de un trabajador y carga simultánea desde dos réplicas. Los contadores de minutos y concurrencia actuales son por proceso. La reserva diaria en disco depende del bloqueo de escritor del piloto. Revise también la transición de datos operativos antes de escalar. [Aislamiento y migración](./AISLAMIENTO-PRODUCCION.md)
