# Servicios reales de cuentas en la demo (PR #16)

La demo permanece separada de main y de operación real. Origen actual:
`https://bolt-demo-demo.up.railway.app`.

## Recursos y acceso

- Railway: proyecto `BOLT demo reunión`, entorno `demo`. Servicio de aplicación `bolt-demo`.
- PostgreSQL separado `Postgres`, base `bolt_customers_demo`, volumen independiente. Sin dominio público ni proxy TCP.
- Google Cloud: proyecto `BOLT Demo Cuentas` / `absolute-disk-514405-a3`, cliente web `BOLT Demo Railway PR16`. Prueba externa, sin publicación en producción. Inicio con identidad básica, sin Gmail/Drive.
- Origen Google: `https://bolt-demo-demo.up.railway.app`.
- Callback Google: `https://bolt-demo-demo.up.railway.app/api/customer-auth/callback/google`.
- Apple sigue pendiente de membresía Apple Developer, App ID, Services ID, clave y configuración de correo relay. Retorno futuro: `https://bolt-demo-demo.up.railway.app/api/customer-auth/callback/apple`.
- Dominio comunicado por la empresa: `cultivacenter.com`; `/es` es una ruta. Remitente de demo verificado: `Bolt by Agrocentro <cuentas@auth.cultivacenter.com>`. El subdominio está verificado en Resend tras agregar sus tres registros autorizados en Shopify; la tienda conserva sus registros existentes.

## PostgreSQL y primer despliegue

1. Crear solo la base de la demo, previa autorización del costo (recibida el 11 de noviembre).
2. Guardar un secreto aleatorio estable y una contraseña exclusiva del rol `bolt_customer_app` en Railway. No imprimirlos ni copiarlos a GitHub. La URL del backend utiliza referencias de variables; no la cuenta superusuario.
3. Para este primer aprovisionamiento, establecer temporalmente `BOLT_CUSTOMER_BOOTSTRAP_DATABASE_URL=${{Postgres.DATABASE_URL}}` y `BOLT_CUSTOMER_PROVISION_DEMO=1`.
4. Ejecutar como predeploy `npm run customer:provision-demo`. El script solo admite la base `bolt_customers_demo`, rol previsto y host privado `.railway.internal`. Crea el rol sin superusuario/creación de roles/BYPASSRLS, revoca acceso público, concede acceso al esquema dedicado y aplica la migración transaccional existente bajo el rol de aplicación. Un reintento no rota credenciales ni elimina datos.
5. Tras confirmar el éxito, retirar el comando de predeploy y vaciar la referencia bootstrap; establecer `BOLT_CUSTOMER_PROVISION_DEMO=0`. El launcher nunca transmite esa credencial privilegiada al servidor de BOLT.
6. `BOLT_DEMO_CUSTOMER_ACCOUNTS=1` activa únicamente el paso de la configuración y sesiones de clientes. No aprueba documentos, no habilita proveedores sin credenciales y no migra automáticamente.

El transporte interservicio de esta instalación usa la red privada de Railway cifrada con WireGuard. No se desactiva la verificación TLS de conexiones públicas ni se expone PostgreSQL por Internet. Una instalación externa debe usar TLS validado. Respaldos y políticas de retención requieren configuración y comprobación propia; no se afirman respaldos programados que aún no se hayan configurado.

## Correo por HTTPS

Railway Free/Trial/Hobby no admite SMTP saliente. Se añade Resend HTTPS como alternativa, manteniendo SMTP para otras instalaciones. Configurar solo un transporte:

- `BOLT_RESEND_API_KEY`: clave privada con permiso solo de envío y el dominio verificado correspondiente.
- `BOLT_CUSTOMER_MAIL_FROM`: remitente verificado. No usar el Gmail empresarial como si autorizara enviar desde un dominio propio.
- No rellenar simultáneamente las variables SMTP.

En Resend: agregar `auth.cultivacenter.com`, copiar exactamente sus registros DNS al administrador del dominio, verificar SPF/DKIM y revisar DMARC. Mantener desactivados seguimiento de aperturas/clics para enlaces de autenticación. No inventar valores DNS: los emite la cuenta de Resend. `resend.dev` solo permite mensajes de prueba al correo de su propia cuenta y no sirve para habilitar registro general.

La cola existente guarda el mensaje cifrado. Las llamadas van solo a `https://api.resend.com/emails`, sin redirecciones; reintentos conservan el mismo identificador de idempotencia durante la vigencia del mensaje (24 horas). Una aceptación HTTP del proveedor no equivale a entrega en bandeja: comprobar recepción real, verificación, recuperación y bloqueo de reutilización.

## Puerta privada y cookies

Con el opt-in activo, la puerta conserva el origen HTTPS original y únicamente cookies `bolt_customer` conocidas para rutas de clientes/pedidos. No pasa la clave de demo al backend ni cookies administrativas arbitrarias. Solo acepta retornos OAuth exactos de proveedores configurados; Apple POST únicamente desde `https://appleid.apple.com`. El backend mantiene validación de state firmado, estado de un uso y PKCE.

El state de Apple lleva SameSite=None/Secure, necesario para su retorno POST; la cookie de sesión del cliente sigue Lax. La cookie de puerta de demo usa Lax para regresos desde Google/correo, conservando controles explícitos de origen para escrituras. Los enlaces privados de verificación/recuperación se conservan temporalmente cifrados al pedir la clave de demo, sin redirecciones a otros sitios.

## Activación y verificación final

No establecer `BOLT_LEGAL_APPROVED_VERSION` hasta que la empresa apruebe esa versión exacta y complete la revisión pendiente. La implementación no elimina ese bloqueo para aparentar un registro operativo. Los textos son borradores; configurar servicios no equivale a revisión jurídica. Antes de aprobarlos se debe actualizar su inventario de proveedores con los servicios de demo que ya están configurados (PostgreSQL/Railway, Google y Resend), precisar los contratos y países aplicables y emitir la versión legal correspondiente; Apple sigue pendiente. La empresa confirmó que la revisión continúa pendiente.

Comprobar en HTTPS con el titular presente:

- Registro por correo; recepción, verificación de un uso e inicio de sesión.
- Recuperación de contraseña desde otro navegador pasando por la puerta privada.
- Google con usuario de prueba autorizado; consentimiento real y perfil; cerrar sesión y restaurar.
- Apple solo tras membresía/configuración real: relay, primera autorización, retorno POST en Safari y revocación.
- Dos cuentas, carrito invitado, direcciones y pedidos separados; expiración y retiro de promociones.
- Sin secretos en logs, informes, capturas ni commits.

Las pruebas de protocolos firmados y correo HTTP simulado no se presentan como prueba de entrega ni autorización de Google/Apple reales. No habilitar pagos ni repartos reales.

## Reversión

Conservar el volumen de operaciones, PostgreSQL y el secreto estable. Desactivar nuevos registros y proveedores mediante configuración, manteniendo el backend que entiende propietarios de pedidos existentes. No volver a una versión que descarte cookies o `customerAccountId` para cuentas con compras sin un plan de acceso compatible. No restaurar una copia antigua sobre datos posteriores.


### Actualización del esquema de cuentas en la demo privada del PR 40

1. En Railway selecciona **BOLT demo reunión → demo → bolt-demo**. El servicio necesita su volumen habitual y la conexión privada de `bolt_customer_app` a `bolt_customers_demo`. Conserva el identificador del despliegue anterior y comprueba que el volumen disponga de espacio para la copia.
2. Para el paso de versión 1 a 2, despliega esta rama con `BOLT_DEMO_CUSTOMER_DB_ACTION=upgrade`. Antes de cambiar las políticas, el proceso toma una copia completa, la restaura en un PostgreSQL temporal y guarda el archivo con permisos privados. El comprobante queda asociado a la transición. Un fallo detiene la actualización.
3. Verifica el mensaje de copia restaurada, el resultado de la transición y la respuesta de `/__demo/health`. Comprueba el acceso privado de Cliente y Admin y la configuración de cuentas. Deja vacía `BOLT_DEMO_CUSTOMER_DB_ACTION` después del éxito. La copia contiene datos privados de cuentas y debe permanecer en el almacenamiento restringido.
4. Para volver al lector de versión 1, detén la atención desde el lector de versión 2 y arranca el mantenimiento de esta rama con `BOLT_DEMO_CUSTOMER_DB_ACTION=rollback`. Verifica la reversión a versión 1 antes de volver a desplegar el código anterior y dejar vacía la variable. El proceso comprueba la copia y revierte las políticas y los metadatos de la transición sobre las filas actuales. Así se conservan altas y cambios posteriores. Si la estructura cambió o la copia falla su validación, detén la reversión y revisa el comprobante.

## Fuentes oficiales consultadas

- [Railway: correo saliente](https://docs.railway.com/networking/outbound-networking#email-delivery)
- [Railway: red privada cifrada](https://docs.railway.com/networking/private-networking#key-features)
- [Resend: dominios verificados](https://resend.com/docs/dashboard/domains/introduction)
- [Resend: idempotencia](https://resend.com/docs/dashboard/emails/idempotency-keys)
- [Google: OAuth web](https://developers.google.com/identity/protocols/oauth2/web-server)
- [Apple: configuración web](https://developer.apple.com/help/account/capabilities/configure-sign-in-with-apple-for-the-web/)
