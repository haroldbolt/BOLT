# Acceso privado de demo: formulario rechazado

Fecha: 2026-11-11. Rama del PR #16; no modifica main ni credenciales.

## Causa reproducida

La contraseña vigente era válida mediante HTTP (303 y cookie de sesión), pero
el formulario nativo del navegador devolvía «Origen no autorizado». Al habilitar
cuentas, el gateway enviaba `Referrer-Policy: no-referrer` también en la página
del formulario. Esa política hace que una navegación POST del formulario use
`Origin: null`, rechazado correctamente por la protección de origen del gateway.
Las pruebas anteriores enviaban Origin manualmente y no detectaban el problema.

Referencia del comportamiento del navegador:
https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Referrer-Policy#effect_on_the_origin_header

## Corrección limitada

`sendGatePage` usa `strict-origin` exclusivamente para el formulario de acceso
(incluidos errores y espera por intentos) y el portal que contiene el formulario
de salida. Conserva el origen en HTTPS, sin enviar rutas ni parámetros privados
de enlaces de verificación/recuperación como Referer. Los demás flujos mantienen
su política previa. No se aceptan orígenes null, ausentes ni ajenos en login o
logout; no se modifican cookies, claves, OAuth, permisos ni bloqueos legales.

## Regresión automatizada

`deployment/demo-customer.test.mjs` falla antes de la corrección y aprueba después:
política del formulario normal y con continuación privada, reintento tras clave
incorrecta, límite de intentos, login, logout, rechazo de orígenes ajenos/null/
ausentes y mantenimiento de no-referrer para respuestas de la API de cliente.
También aprueban `npm run test:customer-hosted`, TypeScript y compilación.

## Comprobación al desplegar

Abrir la demo sin sesión, escribir la clave existente en el formulario nativo,
comprobar el portal y abrir Cliente. Comprobar también Salir de la demo y un nuevo
ingreso. No sustituir esta comprobación por un fetch que fija Origin manualmente.
Recargar una pestaña que aún conserve el formulario anterior antes de reintentar.
No se necesita eliminar carrito, direcciones ni almacenamiento del navegador.

La revisión legal sigue pendiente y el registro de clientes continúa bloqueado.
Esta corrección habilita la entrada privada a la demo; no crea una cuenta de cliente.
