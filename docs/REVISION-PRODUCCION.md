# Revisión de producción de BOLT Pets

Base de la revisión del 22 de noviembre de 2026: `main` en `d2e2054ce683637b8dab16a04f1327793f48eb45`. Las pruebas usan archivos temporales, HTTP local y PostgreSQL de pruebas (PGlite).

## 1. Archivos entregados al navegador

Vite ya minificaba las entradas de Cliente y Admin en producción. Al inspeccionar `dist` comprobamos que no había ficheros `.map` ni referencias a mapas de fuentes. La minificación reduce el tamaño; cualquier JavaScript entregado al navegador sigue siendo legible.

Movimos fuera de la carpeta pública de la aplicación un volcado de Shopify de 16,4 MB y las notas de una importación que Vite copiaba desde `public`. La ficha, el mapa de seguimiento y la vista de sedes leen la llave pública de Maps desde la compilación. Las vistas permiten continuar cuando falta esa variable. Los servicios externos que requieren secretos se invocan desde el backend.

Para activar los mapas del lanzamiento, la persona que administra Google Cloud debe identificar la credencial asociada al sitio y los dominios HTTPS definitivos, autorizar esos sitios y limitar la llave web a Maps JavaScript API. La demo de Railway expone el nombre de la variable en su panel. No se verificó la correspondencia de esa variable con la credencial sin restricciones de sitio encontrada en el proyecto de demostración. [Guía oficial de Google](https://developers.google.com/maps/api-security-best-practices)

## 2. Aislamiento de cuentas y de la operación

Se conserva el catálogo activo público. Las consultas de inventario administrativo, integración y productos no publicados requieren autorización. El operador real de una sede tiene acceso limitado a ella. La dirección, el teléfono y la foto de entrada solo se muestran al conductor mientras conserva la asignación y la custodia correspondientes. El almacenamiento operativo continúa en JSON con un solo escritor.

La migración de cuentas de la versión 1 a la 2 fuerza RLS en las tres tablas de datos propios de una cuenta. El servidor asigna el identificador de la sesión verificada dentro de cada transacción. Las regresiones cubren dos cuentas, el propietario SQL sin privilegio de evasión, el alcance entre sedes y la pérdida de acceso al transferir la custodia. Procedimiento y límites en [Aislamiento en producción](AISLAMIENTO-PRODUCCION.md).

## 3. Ramas, publicación y etiquetas

La revisión usa una rama y un PR. GitHub no tenía etiquetas al inicio. La API de GitHub tampoco devolvió reglas activas para main. Harold puede exigir revisión de PR en la configuración de la rama. La salud pública expone únicamente el SHA completo declarado por el despliegue, si está configurado. El publicador debe ejecutar `node deployment/tag-release.mjs production <origen-HTTPS> <SHA-completo>` después de comprobar que el despliegue está saludable. Use `demo` para una versión de demostración que exponga su revisión. El script verifica el SHA en el backend, comprueba que producción pertenece al historial de main y verifica la etiqueta en GitHub. Repetirlo para la misma versión conserva la misma etiqueta. Un despliegue cancelado no se etiqueta. Use la credencial del publicador fuera del repositorio.

## 4. Contrato e integraciones de la API

Las rutas existentes conservan su prefijo y sus contratos. Se añadió un identificador de solicitud generado por el servidor, errores JSON para una ruta de API desconocida o un cuerpo inválido y límites de tiempo en geocodificación. Las búsquedas de dirección requieren la llave privada del servicio de geocodificación. El mapa del navegador sigue usando su llave web.

Coordinación puede consultar una transacción de Wompi vinculada previamente a un pedido. El resultado requiere concordancia de comercio, referencia, identificador, método, moneda e importe. Esta operación es de lectura. El checkout sigue aceptando efectivo según sus condiciones existentes. Queda pendiente comprobar con la cuenta del comercio las respuestas que contienen evidencia suficiente y contratar/habilitar pagos en línea.

Se conservan el GPS y el seguimiento privado. El centro del cliente ahora muestra los cambios de preparación y cancelación confirmados en el historial y reserva los controles de simulación para la demo. Estos avisos funcionan mientras la aplicación consulta el seguimiento. [Contrato por recurso](API-V1.md)

## 5. Contenedor y hosting

El repositorio ya contenía un Dockerfile, pero su arranque predeterminado era la demo. El nuevo target de producción arranca con un usuario sin privilegios, un volumen verificable y bloqueo de escritor. El runtime compilado se probó dos veces con el mismo directorio temporal y conservó las imágenes y el estado. La prueba de GitHub Actions construye la imagen y verifica salud, sedes, simulación desactivada y reinicio. El Blueprint de Render necesita aprobación del hosting, plan, tamaño de disco y dominios. La revisión base conserva el bloqueo de recaudo del piloto de Suba. [Guía de despliegue y límites](HOSTING-PRODUCCION.md)

## 6. Secretos, sesiones y HTTPS

El build inspecciona la distribución y falla si detecta mapas de fuentes, archivos privados, un prefijo público indebido o valores confidenciales conocidos. La prueba permite la llave web específica de Maps. La inspección del árbol versionado cubrió 344 archivos de texto y patrones específicos de credenciales; no constituye un inventario de las cuentas de los proveedores ni de toda la historia de Git.

Un archivo administrativo dañado impide iniciar autenticación. Un fallo de escritura invalida las sesiones afectadas y exige recuperar el almacenamiento. Las cuentas se crean y se exponen al frontend una vez confirmada la escritura. Los archivos históricos de pedidos dañados se conservan para recuperación. Los errores de compra llevan un identificador de solicitud, sin detalles internos.

En producción, el acceso externo requiere el origen HTTPS configurado y TLS directo o un proxy de confianza explícita. Administra las claves en el gestor de secretos del hosting. El dominio real, sus certificados y la configuración del proxy deben comprobarse en la instalación elegida.

## 7. Límites de uso

La autenticación de clientes ya contaba con límites en PostgreSQL. La API ahora limita por IP resuelta desde los proxies de confianza y por identidad verificada. El acceso y la recuperación tienen cupos separados. Una solicitud rechazada recibe 429 y el plazo para reintentar. El servidor conserva cantidades acotadas de contadores.

Los cupos adicionales protegen geocodificación, reconocimiento de fotos, consulta de Wompi y correo saliente. En el piloto de un escritor se reserva el consumo diario en el volumen antes de llamar al proveedor. Los contadores por minuto y la concurrencia pertenecen al proceso. Un tope de solicitudes no equivale a un presupuesto en COP; los límites monetarios y alertas de facturación deben configurarse en cada cuenta de proveedor. [Parámetros y alcance](LIMITES-API.md)

## 8. Caché e inventario vigente

El catálogo base y los cambios administrativos ya se combinaban en memoria. Ahora la caché tiene un TTL configurable y reconoce las modificaciones de sus archivos. El listado público se invalida al guardar cambios comerciales o una reserva. El carrito y la confirmación revalidan las condiciones vigentes. Salud, autenticación y telemetría dejaron de reconstruir el catálogo de ventas en cada llamada.

El navegador revalida el catálogo por ETag. La prueba de inventario obtiene 304 mientras no hay cambios y 200 con una nueva versión después de editar existencias. Las respuestas privadas se marcan no-store y los archivos de build con nombre versionado pueden guardarse a largo plazo. [Políticas y pruebas](CACHE-CATALOGO.md)

## 9. Capacidad y competencia por inventario

El catálogo público completo y el de cada sede reutilizan sus bytes hasta que cambia la información comercial. El trabajador de despachos sigue evaluando candidatos cada segundo y registra una nueva incidencia cuando cambia la situación. Suprimimos escrituras idénticas al volumen y redujimos el trabajo para sincronizar el historial.

En un proceso local con Node 22 y volumen aislado, 1.000 usuarios virtuales consultaron productos, sedes y cotizaciones durante un minuto con pausas de 8 a 16 segundos. Se validaron 4.909 respuestas, con un máximo de 27 solicitudes simultáneas. El percentil 95 fue de 114 ms en catálogo, 111 ms en sedes y 145 ms al cotizar. El estado de las reservas y el número de pedidos y despachos coincidieron al principio y al final.

En otra instalación temporal, dos confirmaciones HTTP simultáneas con claves distintas compitieron por la última unidad de una referencia en Suba. Se aceptó exactamente una compra. Tras reiniciar persistió una reserva en Suba y ninguna en Kennedy o Álamos. Quedan pendientes la medición sostenida de compras y seguimiento con historial representativo en el hosting elegido y el almacenamiento transaccional compartido antes de escalar a varios escritores. [Ensayos y alcance](ESCALA-PILOTO.md)

## 10. Errores, alertas y métricas

La instalación ya tenía una ruta pública de salud, el informe de Ventas y estadísticas de Despachos. Coordinación ahora puede abrir **Inicio → Estado del servicio → Consultar** para ver los errores recientes, el estado del canal de alertas, los pedidos, los despachos y el efectivo con evidencia de entrega. Los agregados excluyen el dinero de pruebas y distinguen el recaudo desconocido del cero acreditado. El mismo contrato de lectura exige una sesión global de administración y devuelve datos sin caché.

El backend emite registros estructurados de fallos HTTP, ráfagas de peticiones limitadas, fallos del trabajador y nuevas incidencias de despacho. Puede enviarlos a un receptor HTTPS configurado. El envío tiene un plazo y límites de frecuencia y concurrencia. Un comprobador independiente consulta salud y sedes para detectar también la caída del proceso. Hay pruebas de agrupación, fallos de notificación, permisos y resultados de pago sin evidencia suficiente. [Guía del monitor y de guardia](MONITOREO.md)

En una instalación local con volumen vacío abrimos el panel en un navegador, iniciamos sesión como Coordinación y consultamos el resultado. Mostró cero pedidos, «Sin recaudo verificado» y «Pendiente de configurar» para el canal externo. La revisión del panel solo consultó datos. Falta registrar el canal de guardia, programar la sonda fuera del proceso y verificar la recepción en el destino elegido.

## Publicación y decisiones

Los diez puntos se trabajaron en la rama `codex/produccion-diez-puntos`. Los comandos de cada etapa son `npm run lint`, `npm run build` y `npm test`. La comprobación adicional del contenedor Linux arranca la imagen, lee la API y repite las verificaciones después del reinicio. Los ajustes conservan las reglas comerciales de transporte y los métodos de pago existentes. [PR de revisión](https://github.com/haroldbolt/BOLT/pull/39)

| Decisión | Qué se necesita para activar |
| --- | --- |
| Dónde poner BOLT en Internet | Harold aprueba el proveedor y el coste mensual. Para el piloto de un escritor, la configuración preparada es un servicio de Render con disco persistente. La ingeniera configura el volumen, HTTPS, el proxy, los respaldos y los dominios. |
| Dominio y mapas | Elegir la dirección web de Cliente y Admin, identificar la llave que usa esa instalación y restringirla en Google Cloud al sitio y a la API necesarios. |
| Quién recibe incidentes | Nombrar al responsable, conectar el canal de alertas y acordar con la ingeniera cómo comprobar disponibilidad, guardar registros y ensayar recuperación. |
| Crecimiento y cobros | Antes de abrir ventas, comprobar el convenio de recaudo y la operación por sede. Para más de un escritor, aprobar la migración transaccional, la restauración y la prueba de carga representativa. Las ampliaciones a tres sedes y a Rappi Cargo tienen una revisión separada. [PR #38](https://github.com/haroldbolt/BOLT/pull/38) |
