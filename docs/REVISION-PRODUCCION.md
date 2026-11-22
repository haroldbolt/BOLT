# Revisión de producción de BOLT Pets

Base de la revisión del 22 de noviembre de 2026: `main` en `d2e2054ce683637b8dab16a04f1327793f48eb45`. Las pruebas usan archivos temporales, HTTP local y PostgreSQL de pruebas (PGlite).

## 1. Archivos entregados al navegador

Vite ya minificaba las entradas de Cliente y Admin en producción. Al inspeccionar `dist` comprobamos que no había ficheros `.map` ni referencias a mapas de fuentes. La minificación reduce el tamaño; cualquier JavaScript entregado al navegador sigue siendo legible.

Movimos a un archivo histórico privado de la distribución un volcado de Shopify de 16,4 MB y las notas de una importación que Vite copiaba desde `public`. La ficha, el mapa de seguimiento y la vista de sedes leen la llave pública de Maps desde la compilación. Las vistas permiten continuar cuando falta esa variable. Los servicios externos que requieren secretos se invocan desde el backend.

Para activar los mapas del lanzamiento, la persona que administra Google Cloud debe identificar la credencial asociada al sitio y los dominios HTTPS definitivos, autorizar esos sitios y limitar la llave web a Maps JavaScript API. La demo de Railway expone el nombre de la variable en su panel. No se verificó la correspondencia de esa variable con la credencial sin restricciones de sitio encontrada en el proyecto de demostración. [Guía oficial de Google](https://developers.google.com/maps/api-security-best-practices)

## 2. Aislamiento de cuentas y de la operación

Se conserva el catálogo activo público. Las consultas de inventario administrativo, integración y productos no publicados requieren autorización. El operador real de una sede tiene acceso limitado a ella. La dirección, el teléfono y la foto de entrada solo se muestran al conductor mientras conserva la asignación y la custodia correspondientes. El almacenamiento operativo continúa en JSON con un solo escritor.

La migración de cuentas de la versión 1 a la 2 fuerza RLS en las tres tablas de datos propios de una cuenta. El servidor asigna el identificador de la sesión verificada dentro de cada transacción. Las regresiones cubren dos cuentas, el propietario SQL sin privilegio de evasión, el alcance entre sedes y la pérdida de acceso al transferir la custodia. Procedimiento y límites en [Aislamiento en producción](AISLAMIENTO-PRODUCCION.md).
