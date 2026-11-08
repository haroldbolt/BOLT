# Direcciones de invitado en BOLT

BOLT no tiene autenticación real de clientes. La autenticación `/api/v1/auth/*` corresponde a administración y NO se usa como identidad del comprador. Esta implementación conserva la libreta por origen/perfil del navegador en la clave propia `bolt_pets_guest_addresses_v1`, versión 1. La interfaz informa **Direcciones guardadas en este dispositivo**. No hay sincronización entre dispositivos; dos perfiles/orígenes no comparten la libreta.

## Datos y conservación

`src/lib/guestAddresses.ts` permite guardar identificador UUID estable, nombre, dirección, referencias opcionales, coordenadas, municipio/localidad/barrio cuando están identificados y el indicador de predeterminada. La dirección actual se guarda al confirmarla, aunque el cliente todavía no la haya añadido a su libreta con **Guardar dirección**. Las entradas nombradas solo se crean mediante una acción explícita. No hay semillas ni direcciones de demostración.

Se restaura la última dirección utilizada, por encima de la predeterminada. Esta última se destaca y aparece primero en la lista; marcarla no cambia silenciosamente la compra actual. Si se elimina la dirección activa, se conserva una selección vacía explícita y se exige elegir otra, incluso al recargar y aunque quede una predeterminada.

Se evitan duplicados por dirección, referencias y coordenadas exactas, normalizando espacios y mayúsculas. Apartamentos diferentes permanecen separados. Guardar o cambiar el nombre no invalida por sí solo un destino sin cambios; editar el destino activo sí requiere una nueva cotización. Editar/eliminar una entrada distinta de la activa no sustituye la dirección de compra.

El almacenamiento usa listas permitidas de campos. Nunca conserva cobertura como autorización, sede, modalidades, disponibilidad, tarifas, cotización, token ni franjas. Datos corruptos o versiones desconocidas no bloquean la aplicación ni se borran durante la lectura. Si falla localStorage, el cliente ve un aviso de conservación temporal. No se escribe ni limpia ninguna otra clave: carrito, sesión administrativa e información de otros perfiles se conservan.

El store lee la última copia antes de modificar y recibe eventos `storage` para reflejar cambios de otras pestañas. Rechaza guardar con una etiqueta antigua si otra pestaña cambió la dirección activa. El almacenamiento de invitado no pretende resolver identidad de usuarios futuros; una autenticación de clientes deberá añadir un repositorio por usuario, permisos en servidor y migración explícita.

## Interfaz y autoridad

- `Header.tsx` abre la libreta desde la barra de destino y el acceso **Mis direcciones** / **Guardar dirección**.
- `SavedAddressesModal.tsx` muestra agregar, guardar, usar, editar, eliminar y predeterminada. El editor reutiliza `AddressConfirmationModal.tsx`, Google Geocoding y la validación del servidor existentes. Los nombres y referencias son campos editables; no se inventan.
- La lista consulta cobertura actual del servidor sin crear pedidos. Una zona habilitada no promete inventario/cupo para un carrito todavía no validado. Cota puede guardarse y se identifica como **No disponible para entrega**.
- `App.tsx` restaura el destino y vuelve a cotizar con el carrito y la modalidad; cada nueva selección tiene una revisión y contador de solicitud. Una respuesta tardía o una cotización de una revisión anterior no puede mostrar una sede, permitir checkout o reemplazar el destino actual.
- Cambiar/eliminar el destino activo descarta cotización y franja anteriores y cierra checkout/horarios. El carrito no se modifica. La sede se deriva de la cotización autoritativa.
- El checkout también requiere selección explícita de franja; no reutiliza un ID antiguo porque coincida entre sedes.

Se reutilizan sin cambios las reglas de geografía, precios, stock, creación de pedidos e idempotencia. Chía y Cajicá siguen Programado desde HUB_SUBA; Cedritos, Bogotá/Usaquén desde Suba; Cota sigue bloqueada con el aviso aprobado. Guardar una dirección no reserva inventario ni crea pedidos.

## Pruebas

`src/tests/guestAddresses.test.tsx` cubre inicio vacío, restauración sin escrituras, entradas y UUID, duplicados/referencias diferentes, edición, eliminación activa/inactiva, predeterminada, conservación de revisiones, JSON inválido, storage bloqueado, otras claves/perfiles, pestañas, StrictMode, revalidación geográfica y accesibilidad del panel.

`npm run lint`, `npm run build`, `npm test`. Si el entorno no permite IPC de la CLI `tsx`, ejecutar cada suite con `node --import tsx <archivo>`. Las pruebas usan almacenamiento en memoria, productos y flota ficticios. Las pruebas de navegador usan el origen separado `http://127.0.0.1:3020`, sin borrar datos del origen de revisión habitual `http://localhost:3020`.

Para revisar: abrir **Mis direcciones**, **Agregar nueva dirección**, confirmar el destino y guardarlo como Casa/Trabajo. Elegir una dirección guardada, revisar cobertura/sede y elegir una franja. Recargar y comprobar la restauración. Marcar una predeterminada, editar una entrada y eliminar la activa para verificar que se solicita otro destino.
