# Verificación de servicios de demo · 2026-11-11

Código de aplicación: `93f76a58370ca10b5e5666837b67903933f824c5`, rama `codex/cuentas-clientes-legales`, PR #16 sin fusionar. Main comprobado en `38ea7bf1966d6cef13cddb6d52e07d7620c003c4`.

## Comprobado

- `npm test`: las 27 suites anteriores y las cinco de cuentas terminaron con código 0.
- `npm run test:customer-hosted`: puerta privada original, puerta con sesiones de clientes, correo HTTPS simulado y diez casos OAuth mediante la puerta; código 0.
- `npm run lint`, `npm run build` y `node deployment/demo-runtime.test.mjs`: código 0. Persisten advertencias informativas de Vite sobre tamaño de chunks y futura carga de configuración.
- El test de retiro inmediato de promociones reprodujo un fallo de orden de timestamps: dos decisiones rápidas podían conservar la anterior. Se corrigió con transacción, bloqueo por usuario y fecha estrictamente creciente del registro de consentimiento. La suite aprobó después.
- Despliegue `840a663e-398c-4416-9ed0-19ca9b1be281`: SUCCESS; PostgreSQL privado aprovisionado explícitamente, esquema v1 aplicado con rol limitado.
- Despliegue posterior `33bfeafe-803b-4eea-9b89-77cb62a2bab8`: SUCCESS; comando de predeploy retirado, bootstrap vaciado y bandera de aprovisionamiento desactivada. No quedan cambios staged. El conector oculta valores de variables: se conserva evidencia de las escrituras autorizadas, sin afirmar lectura de secretos.
- HTTP HTTPS después del reinicio: cuentas configuradas, usuario anónimo nulo, registro y métodos deshabilitados hasta terminar correo/revisión legal; páginas públicas de la app accesibles tras la puerta de demo.
- Navegador HTTPS: formulario sin identidad ficticia, consentimientos desmarcados, botón Crear cuenta deshabilitado y texto «Acceso por correo pendiente de configuración».
- Comparación antes/después: 4 pedidos y 3.636 registros de catálogo. Huella de pedidos `edbd3ba948f043fb8fc18421fe60737afed5c2d9db3769b8df088cb53463df35`; catálogo/precios/existencias/reservas `03f508c8acf9ad87118cd4d0336caa52def3ad74f8b729f904840564fa4c5ac6`. Ambas intactas.
- Los cuatro blobs del PR #11 siguen intactos: PresentationSelector `31b407ba7ea8115db6270048eff3dabd494842a3`, presentationDisplay `e7999d2091eef2cb861132533faa445072fc4a67`, catalogPurchase `35d1d46113c3ebf6eea62dea92cdb494e434bdd8`, presentationSelection `6b5dca4c0dcc510175f8955ab7578be3107ceb41`.

## Configurado, todavía sin prueba integral real

Google Cloud: proyecto y cliente web exclusivos de la demo; origen/callback exactos; un usuario de prueba autorizado. Credenciales guardadas únicamente en configuración privada. No se ha completado aún el ingreso real Google desde BOLT.

Resend: dominio `auth.cultivacenter.com` **Verified** tras agregar un TXT y dos CNAME autorizados en Shopify. Comprobación DNS pública coincidente. Conservados A, AAAA, CNAME de www/account, DMARC y TXT del proveedor. Seguimiento de aperturas/clics y recepción desactivados.

Clave exclusiva de envío restringida a ese subdominio, guardada en Railway/demo; clave Onboarding revocada con autorización. Las copias temporales locales de secretos se eliminaron después de configurar Railway. Ninguna credencial se incluyó en GitHub ni en capturas.

Un único correo técnico autorizado fue aceptado por la API real de Resend usando `sendCustomerMailHTTP` y apareció como **Delivered** en su panel. Esto confirma entrega al servidor destinatario; no confirma lectura ni ubicación en bandeja frente a spam. No creó cuenta ni aceptó consentimientos. La verificación de cuenta, recuperación de contraseña y Google reales siguen pendientes.

Último despliegue de correo: `1b93c960-f5de-4fe9-8462-0b59c3217536`, SUCCESS. Railway reporta commit `f96d24181c2b6358e449a6698c5c853fcc7de4b6` (únicamente documentación adicional sobre el código `93f76a5`), aunque su configuración source conserva `93f76a5`. Verificar siempre el commit efectivo de cada despliegue, también al actualizar variables; no inferirlo solo del campo source.

HTTP final: configured/email/google=true, apple=false, registrationEnabled=false y legalStatus=draft. Intento directo de registro rechazado con 403 `LEGAL_REVIEW_PENDING`, identidad anónima nula; huellas de los cuatro pedidos y 3.636 registros del catálogo nuevamente intactas.

Apple: pendiente membresía, identificadores, credenciales y pruebas. Sigue deshabilitado.

Documentos: versión `2026-11-10-draft-1`, todavía borrador. La empresa confirmó expresamente que la revisión continúa pendiente. No se estableció `BOLT_LEGAL_APPROVED_VERSION`. Aprobar servicios técnicos no sustituye la aprobación empresarial/jurídica de los documentos.

## Para continuar

1. Completar aprobación de los documentos antes de habilitar registros.
2. Probar con el titular registro, verificación, recuperación y Google reales, más Safari/iPhone y Android. Los fixtures y el correo técnico no sustituyen esas pruebas.
3. Para Apple: obtener membresía y configurar el proveedor; permanece deshabilitado.

Evidencias locales en `output/customer-auth/`: `google-oauth-test-user.png`, `shopify-dns-before.png`, `shopify-dns-after.png`, `resend-domain-verified.png`, `resend-key-scope.png`, `resend-test-delivered.png`, `hosted-services-legal-pending.png` y `dns-public-check.json`. No se publican cookies, credenciales, mensajes privados ni datos personales en GitHub.
