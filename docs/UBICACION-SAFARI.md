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


## Corrección del reporte de Santa Marta — 2026-11-10

La demo anterior (eb11dee) enviaba la calle sin municipio a Google, limitada solamente al país, y elegía `results[0]`. Se reprodujo por HTTP: `calle 11 #15-53` devolvía Santa Marta; la misma calle con Bogotá devolvía Bogotá, Los Mártires / Voto Nacional. La cotización seguía excluyendo Santa Marta, pero el pin elegido automáticamente era incorrecto para la intención del cliente.

Ahora el formulario solicita el municipio (sin predeterminarlo), consulta con esa restricción y muestra los resultados para elegir. No coloca automáticamente el primer resultado ni cambia el texto escrito. Los polígonos del servidor verifican el municipio de las coordenadas; el municipio escogido no concede cobertura. Cota y otros municipios se pueden localizar mediante «Otro municipio», pero continúan bloqueados para entrega. Los resultados parciales, de una vía o de una ciudad no se toman como direcciones completas. Cambiar texto/municipio cancela la selección, pin, cotización y respuestas anteriores.

La captura del teléfono muestra el rechazo de una lectura recibida, no una denegación de permiso. Antes se agrupaban coordenadas, precisión y hora inválidas en un mismo mensaje, con una tolerancia temporal de cinco segundos. Sin la lectura original no puede afirmarse qué condición exacta falló en ese iPhone. La corrección acepta lecturas de hasta un minuto como aproximadas, informa su antigüedad cuando supera cinco segundos y mantiene la revisión/confirmación de la dirección. Una lectura más antigua activa una espera acotada de una nueva lectura; el seguimiento se detiene al obtenerla, al cancelar o al agotar el plazo. Coordenadas/precisión inválidas, lectura antigua y hora no verificable tienen mensajes diferentes. No se registra la ubicación del teléfono en logs.

### Contrato y archivos

- `server.ts`: endpoint de búsqueda con municipio obligatorio y sin selección implícita; la consulta inversa conserva el nombre real del proveedor cuando queda fuera del mapa local, sin habilitar cobertura.
- `src/lib/forwardGeocoding.ts`: restricción Google, verificación geográfica independiente y candidatos.
- `src/lib/addressSearch.ts`: contrato tipado de resultados.
- `src/lib/api.ts`: envío de municipio, sin caché, respuesta controlada si la versión del servidor no coincide.
- `src/components/customer/AddressConfirmationModal.tsx`: selector, elección explícita y descarte de respuestas obsoletas.
- `src/lib/deviceLocation.ts` y `CurrentLocationAction.tsx`: antigüedad y errores específicos, limpieza de la espera de GPS.
- `src/tests/addressLocationRegression.test.ts`, `deviceLocation.test.tsx`, `deviceLocationReview.tsx` y `package.json`: regresiones y simulación aislada.

### Comprobaciones

- Suite completa: 27 suites aprobaron; TypeScript y compilación aprobaron. Tras el endurecimiento adicional del cotejo de municipio se repitieron las suites de ubicación, direcciones guardadas y cobertura, además de TypeScript/compilación.
- Regresiones nuevas: municipio ausente, Bogotá explícita, respuesta Santa Marta, proveedor con ciudad manipulada, coordenadas de Cota, ciudades fuera del mapa local, coincidencias parciales, múltiples candidatos, proveedor no disponible; lectura reciente de 20 segundos, lectura antigua seguida de una fresca, cancelación, vencimiento y hora futura.
- HTTP y navegador aislado: calle reportada → Bogotá / Los Mártires → Programado / HUB_KENNEDY. Cota permanece excluida; Cota → Chía retira el rechazo y asigna Programado / Suba. GPS ficticio de Cedritos con 20 segundos de antigüedad muestra Usaquén / Suba sin confirmar ni crear pedido.
- Marco de 390 px: municipio, dirección y resultado seleccionable visibles; no es una prueba física de iPhone.
- Los cuatro blobs protegidos del PR #11 permanecen idénticos: PresentationSelector, presentationDisplay, catalogPurchase.test y presentationSelection.test.
- No se modificaron catálogo, inventarios, reservas ni históricos. Rappi/inDrive siguen desactivados. Pendiente: comprobación del GPS del teléfono del usuario después de recargar la demo.

### Cómo probar

Recarga la demo. Agrega dirección → Municipio de entrega «Bogotá D.C.» → escribe `calle 11 #15-53` → elige el resultado «Cl. 11 #15-53, Bogotá, Colombia» → revisa el mapa y confirma. Debe indicar Los Mártires y Programado desde Kennedy. «Usar mi ubicación actual» continúa siendo opcional y requiere permiso del dispositivo. No es necesario borrar el carrito ni el almacenamiento.

Referencias de implementación: [componentes del geocodificador Google](https://developers.google.com/maps/documentation/geocoding/guides-v3/requests-geocoding) y [fecha de adquisición de una lectura](https://developer.mozilla.org/en-US/docs/Web/API/GeolocationPosition/timestamp). No se modifica `main` en esta etapa.
