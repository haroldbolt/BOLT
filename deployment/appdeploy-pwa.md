# BOLT Cliente y Admin en AppDeploy

Publica dos interfaces independientes con la compilación de BOLT. Ambas usan una sola API HTTPS con el almacenamiento operativo persistente para Álamos, Kennedy y Suba. El proceso Express, inventario, pedidos y el trabajador de despachos se mantienen en ese servidor.

## Preparar las interfaces

Ejecuta en la raíz del repositorio con Node 22.22 y las dependencias instaladas.

```sh
VITE_BOLT_API_ORIGIN=https://<origen-operativo-de-bolt> \
  node deployment/appdeploy-package.mjs <directorio-nuevo>
```

Sustituye el origen por la URL HTTPS operativa real, sin rutas ni parámetros. La compilación no se publica ni envía pedidos. El origen es público y se incorpora al código del navegador. Las credenciales se configuran en el backend.

Ejecuta `node deployment/appdeploy-package.test.mjs` para comprobar los dos paquetes, los manifiestos, los iconos y las rutas estáticas usando un origen reservado sin solicitudes de red.

Cada carpeta resultante contiene una PWA con un manifiesto y punto de entrada propios. Cliente comienza por el catálogo. Admin comienza por el panel protegido. El paquete incluye páginas estáticas de entrada para `/admin/nuevo/`, `/conductor`, `/cuenta`, recuperación y documentos legales. Usa los enlaces que genera Cliente para abrir una confirmación o el seguimiento en el alojamiento estático. Comprueba una recarga desde esos enlaces en el dominio publicado.

El catálogo, categorías y marcas siguen usando los datos de BOLT. La compilación incluye el directorio de marcas y sus URL públicas. Las fotos cargadas en el catálogo se sirven desde la API HTTPS. AppDeploy recibe los iconos de instalación y el logotipo de BOLT como recursos.

## Cargar en AppDeploy

1. Consulta las instrucciones vigentes de AppDeploy para `frontend-only`, plantilla `html-static`. Comprueba que el plan permita ambos despliegues.
2. Por cada aplicación declara los cuatro recursos binarios indicados en su archivo `*.resources.json`. Los archivos están debajo de `<rol>/public/resources/`. Obtén un ID de carga por aplicación y valida el estado.
3. Usa el archivo `*.deploy.json` correspondiente como origen de los parámetros de despliegue, con los datos de la cuenta conectada, la versión actual del conector y el ID de la carga validada. Los archivos del template se modifican con diffs exactos y los nuevos módulos se envían como fuentes de texto legibles en `files`. La compilación final de cada aplicación minifica esos módulos y el punto de entrada, sin publicar mapas de fuentes. El payload incluye tres verificaciones de interfaz por aplicación, que evitan crear pedidos. En actualizaciones usa el ID de la aplicación existente.
4. Configura en BOLT los orígenes HTTPS exactos de Cliente y Admin. En la publicación con orígenes separados, Cliente conserva el flujo de invitado. La cuenta de Cliente depende de la configuración de autenticación del backend; Admin y Conductor usan sus permisos operativos.
5. Una vez publicado, comprueba ambos manifiestos, los iconos, el catálogo, el acceso protegido a Admin y Conductor y las rutas de seguimiento sin crear cuentas, compras ni despachos. Los escenarios de QA incluidos hacen consultas y navegación.

Los servicios se pueden preparar mientras se verifica Rappi Cargo. El checkout conserva la protección del servidor hasta que el recaudo real esté habilitado.

Comprueba el empaquetado local con `node deployment/appdeploy-package.test.mjs`. La comprobación compila ambas interfaces y verifica los manifiestos, recursos y rutas sin contactar al servidor operativo.
