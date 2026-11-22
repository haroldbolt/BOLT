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
