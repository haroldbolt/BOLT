# Ubicación en iPhone / Safari — revisión de demo

Base: PR #14 `2da576866860deff8538a0e34417f48c1f06bb54`. Main revisado sin cambios: `38ea7bf1966d6cef13cddb6d52e07d7620c003c4`. No fusionar a main hasta la revisión en el iPhone del cliente.

## Hallazgo y corrección

El acceso desde las direcciones guardadas abría el formulario con `requestCurrentLocationOnOpen`; un `useEffect` posterior llamaba a geolocalización. Ese recorrido no iniciaba la solicitud directamente dentro del gesto del cliente. El botón dentro del formulario sí lo hacía. Además, cualquier código 1 se describía como permiso desactivado, aunque el navegador no distingue siempre una denegación del sitio, del sistema o de una política. No se ha identificado con certeza cuál de esas causas originó el aviso en el iPhone reportado.

Ahora ambos puntos de entrada llaman a `getCurrentPosition` desde su manejador de clic, sin `await`, consulta previa a Permissions API ni efecto de montaje. El formulario recibe la misma promesa ya iniciada. Un rechazo inmediato se conserva sin promesas no manejadas. React StrictMode puede volver a suscribirse sin emitir otra solicitud.

Los errores tienen un tipo explícito: permiso, espera agotada, ubicación no disponible, HTTPS requerido, API no disponible o lectura inválida. El código 1 muestra instrucciones de Safari para el sitio y de Localización en iOS, junto con reintento y entrada manual. Nunca se afirma que el teléfono sea incompatible. No se cambia ningún permiso mediante código ni se insiste automáticamente tras una denegación.

Se mantiene la espera de lectura de 12 segundos de la API. La salvaguarda para un aviso de permiso sin responder pasa a 60 segundos; el cliente puede cancelar e introducir una dirección durante la espera. Cerrar, escribir, cambiar el pin o cancelar descarta resultados tardíos. La ubicación sigue siendo provisional hasta confirmar la dirección y validar cobertura con el servidor.

## Archivos

- `src/lib/deviceLocation.ts`: intento iniciado durante el gesto y errores tipados.
- `src/App.tsx`: solicitud desde el botón de direcciones guardadas.
- `src/components/customer/AddressConfirmationModal.tsx`: consumo de la solicitud, cancelación, reintento y foco manual.
- `src/components/customer/CurrentLocationAction.tsx`: instrucciones accesibles de Safari y estados específicos.
- `src/tests/deviceLocationSafari.test.tsx`: nueve nuevas regresiones.
- `src/tests/deviceLocationReview.tsx`, `src/tests/entrancePhotoReview.tsx`: adaptación de las simulaciones existentes; el contador de gesto usa `navigator.userActivation` solo en el harness local.
- `package.json`: nueva suite dentro de `test` y `test:location`.

## Validación previa al despliegue

- TypeScript y compilación aprobados.
- 26 suites (`npm test`) aprobadas, incluidas las 15 pruebas anteriores de ubicación y las 9 nuevas de Safari. También cobertura, carrito, variantes, permisos, históricos y fotos.
- Navegador con React StrictMode y GPS ficticio: primera apertura 0 consultas; toque desde direcciones 1 consulta / 1 gesto; permiso denegado muestra ayuda; reintento válido 2 consultas / 2 gestos y Cedritos → Usaquén → Suba. Ninguna confirmación automática ni pedido creado.
- Entrada manual cancela, enfoca Dirección de entrega y descarta una respuesta pendiente después de cerrar. El contador permanece sin confirmaciones ni direcciones guardadas.
- Este harness es local y no reemplaza el GPS real de la demo ni se importa en el build de cliente.

## Prueba en iPhone

1. Abrir la demo HTTPS directamente en Safari. Con permiso en Preguntar, tocar el encabezado de dirección y Usar mi ubicación actual. El aviso lo controla Safari: puede no repetirse si ya hay una decisión guardada.
2. Permitir, revisar el punto y la dirección, y confirmar manualmente. Debe conservar el carrito.
3. Con permiso en Denegar, repetir: se deben mostrar instrucciones del sitio y del dispositivo, Reintentar y Escribir dirección.
4. Cambiar a Preguntar/Permitir y reintentar. Si Safari conserva su decisión, recargar; no borrar datos ni direcciones del navegador.
5. Verificar también cancelación y falta de señal. No confundir fallos del GPS con exclusión geográfica.

La aprobación de pruebas automatizadas no certifica el hardware ni los permisos del iPhone. Falta la comprobación física del usuario antes de integrar.

Referencias de permisos: [Apple: ajustes de sitios en Safari](https://support.apple.com/guide/iphone/browse-the-web-privately-iphb01fc3c85/ios), [Apple: Localización](https://support.apple.com/en-us/102515), [WebKit: estado de Permissions API que puede requerir recarga](https://bugs.webkit.org/show_bug.cgi?id=275268). Consultadas el 10 de noviembre de 2026.

## Evidencia en la demo y revisión final

- Demo HTTPS: https://bolt-demo-demo.up.railway.app. Revisión en PR #15 sobre #14; main sin integrar.
- La demo sirvió el bundle nuevo y la solicitud real pasó al estado de espera. El navegador integrado no proporcionó coordenadas y mostró el mensaje de tiempo agotado; Escribir dirección enfocó el campo y permitió continuar. El carrito permaneció con 2 líneas y subtotal 65.000 COP de las pruebas anteriores.
- Las cuatro compras mantuvieron IDs y estados, así como IDs/estados de sus despachos tras el despliegue. No se creó un pedido por solicitar ubicación. El hash del payload completo varía porque la API añade la antigüedad de la estimación de recogida; no se interpreta como hash del almacenamiento persistido.
- La prueba en Safari de escritorio llegó al acceso privado, pero se interrumpió al cambiar el usuario de pestaña; no se certifica desde ella el aviso nativo de permisos. La prueba continuó en el navegador integrado.
- Se corrigió además un caso detectado visualmente: después de un resultado válido, cerrar, reabrir y denegar podía recalcular con una referencia del render anterior. Se conserva la cotización solo para el borrador sin cambios y se elimina esa recalculación al denegar. Comprobación visual posterior: formulario vacío, municipio pendiente, ningún mensaje de Suba ni confirmación habilitada.
- Después de este ajuste final aprobaron de nuevo TypeScript, build y las suites de ubicación/Safari, direcciones guardadas y cobertura municipal. La ejecución completa previa aprobó 26 suites.
- El acceso y los permisos reales del iPhone del usuario siguen pendientes de confirmación física. No se ha modificado el permiso del dispositivo ni se promete que Safari vuelva a preguntar si el usuario ya eligió Denegar.
