# R2 · Acceso a pedidos y despachos

Guía de revisión para Muse y la ingeniera. La prueba local usa las rutas HTTP de BOLT, sesiones separadas, pedidos ficticios y una base temporal con el motor PostgreSQL embebido PGlite.

## Abrir la demo local

1. Desde la raíz de la revisión de R2, usa Node 22 y las dependencias del archivo de bloqueo del proyecto. En una copia nueva puedes instalarlas con `bun install --frozen-lockfile`. La revisión necesita permiso para abrir dos puertos locales y escribir en el directorio temporal del equipo.
2. Ejecuta `npm run review:order-access`. Mantén el proceso abierto y abre en ese computador la dirección `http://127.0.0.1` con el puerto que imprime la terminal. Compartan la pantalla para revisarla en grupo.
3. Selecciona cada perfil y alterna la consulta propia y la ajena. Cada clic hace una consulta al servidor. La pantalla muestra el resultado HTTP y, cuando corresponde, el código, los productos y el estado. Al cambiar de caso desaparecen los datos del anterior.
4. Termina con Ctrl+C. La demo prepara un directorio temporal propio y lo elimina al cerrarse normalmente. Emplea correo capturado localmente, ofertas simuladas y pedidos de prueba. Cada ejecución crea sus propios pedidos y asignaciones. El selector de seis perfiles es una herramienta local de revisión y debe permanecer fuera de la interfaz pública.

| Perfil | Consulta propia | Consulta ajena |
|---|---|---|
| Cliente A | Compra creada con su sesión verificada. Aparece en su historial. | El pedido de Cliente B queda bloqueado. |
| Cliente B | Compra anterior vinculada con su sesión y la prueba privada de esa compra. Aparece en su historial. | El pedido de Cliente A queda bloqueado. |
| Invitados A y B | Cada uno consulta el detalle y el seguimiento de la compra para la que posee acceso privado. | La credencial de una compra no abre la otra. |
| Conductores A y B | Cada uno ve su asignación y los productos de su despacho. Ambos despachos pertenecen a la misma compra. | El otro despacho de esa misma compra queda bloqueado. |

La respuesta esperada al consultar un caso propio es HTTP 200. Al consultar el ajeno, se espera una denegación genérica sin artículos, dirección, contacto, PIN ni códigos del pedido. Si la pantalla indica *Revisar resultado* o *Consulta interrumpida*, ese caso requiere investigación. La página de revisión consulta dos perfiles de conductor con asignaciones aceptadas. La prueba específica de foto de entrada comprueba por separado el acceso a la imagen.

## Reglas que debe conservar la integración

- **Titularidad.** El servidor vincula la compra nueva a la identidad verificada. Para una compra antigua de invitado, exige la sesión de cliente y la prueba privada de ese pedido al vincularlo. Una titularidad ya registrada prevalece sobre un vínculo incoherente. El número visible de compra sirve para identificarla.
- **Detalle y seguimiento.** Historial, detalle de cliente, panel de sede y vista de conductor seleccionan los campos de sus respectivos contratos. El PIN de entrega se habilita en el seguimiento del titular durante el trayecto que corresponde. El conductor puede presentar el PIN facilitado al entregar, sin recibir el valor esperado. Para el conductor, la foto de entrada y el contacto requieren asignación y custodia vigentes. Los filtros de sede se vuelven a aplicar en el servidor.
- **Reintento del checkout.** Antes del primer envío se prepara el intento. En el mismo origen, una cookie opaca de primera parte usa `HttpOnly`, `SameSite=Strict` y, con HTTPS, `Secure`. El servidor guarda con la compra un verificador ligado al intento y a su clave de idempotencia. La recuperación de invitado con esa prueba dura 24 horas y exige el mismo contenido. El identificador y un carrito coincidente por sí solos no otorgan el recibo. Para una compra anterior sin verificador se necesita titularidad o acceso privado vigente. Un conflicto requiere revisar la compra antes de iniciar otra.
- **PWA con dominio separado.** El origen configurado usa otra prueba limitada al intento en su pestaña. En ese despliegue hay que comprobar la política de origen y los reintentos desde el navegador realmente utilizado. La cookie del intento y la sesión para consultar pedidos tienen funciones distintas. El traslado de las credenciales de seguimiento guardadas por el navegador pertenece a R5.
- **Actualizaciones.** El canal de eventos comunica cambios y el panel vuelve a solicitar los datos autorizados. El canal de pedido revalida la sesión o el permiso de esa compra y el canal de sede vuelve a comprobar su alcance. Con el servidor en funcionamiento normal se comprueba cada latido a los diez segundos y se conceden hasta cinco segundos a la autorización. Una revocación o una consulta atascada deben cerrar el canal en un máximo de quince segundos. Conductor consulta sus asignaciones mediante peticiones autenticadas.

## Qué verificar antes de producción

Ejecutar `npm run lint`, `npm run build`, `npm test` y `npm run test:bolt-admin` en la revisión candidata. Para repetir únicamente R2, usar `npm run test:r2`. Ese comando incluye las pruebas de vista por destinatario, reintento del checkout, eventos, datos de cuenta, foto y la revisión local en modo automático. Registrar la revisión de Git, entorno y resultados sin copiar credenciales, PIN, direcciones ni respuestas personales.

La ingeniera debe cotejar en la instalación el rol efectivo usado por la API de cuentas, la versión de esquema y las políticas aplicadas. El rol requiere `NOSUPERUSER` y `NOBYPASSRLS`. En `customer_data`, `customer_imports` y `customer_order_links` debe estar forzada la seguridad por filas. El contexto de usuario debe terminar al confirmar o revertir la transacción, incluso al reutilizar una conexión. Las compras y los repartos aún se autorizan en el servidor sobre su almacén de archivos. La prueba local con PGlite no certifica el estado del PostgreSQL alojado.

Repetir en preproducción el cierre de sesión con un seguimiento abierto, la pérdida de la primera respuesta del checkout y el caso de dos pestañas. Usar el dominio HTTPS, el proxy, las cookies y los dispositivos previstos para el piloto. Contrastar también con la ingeniera el hallazgo original mediante su revisión y recorrido exactos en privado. La decisión de despliegue requiere estas evidencias y la aprobación del titular.
