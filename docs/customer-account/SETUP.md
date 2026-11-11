# Configurar cuentas de BOLT

## Estado y decisiones

El código implementa Better Auth 1.7.20 + PostgreSQL, cookies de cliente separadas y proveedores oficiales Google/Apple. La configuración de la demo evoluciona por separado: consultar [DEMO-SERVICES.md](./DEMO-SERVICES.md). **No hay una instalación de producción autorizada**. Sin configuración, la tienda permite invitados y los métodos aparecen deshabilitados: no hay una identidad simulada.

Se evaluó [Supabase Auth](https://supabase.com/docs/guides/auth/auth-identity-linking): vincula automáticamente identidades por correo. Se eligió Better Auth para deshabilitar esa vinculación mediante `disableImplicitLinking: true`. Supabase puede alojar **PostgreSQL**, sin usar su Auth ni exponer una clave privilegiada al navegador. Un vínculo nuevo requiere una sesión verificada reciente, una acción explícita y completar la autorización del proveedor; no se permite vincular correos distintos. Un usuario de Apple con correo privado puede tener su cuenta independiente.

## PostgreSQL, secretos y transición

1. Crear un proyecto PostgreSQL dedicado (puede ser Supabase) en la cuenta empresarial. Confirmar ubicación, contrato de tratamiento, respaldos, costos y accesos. La demo dispone de PostgreSQL privado en Railway, autorizado y aprovisionado el 11 de noviembre; ver DEMO-SERVICES.md. Esto no habilita una instalación de producción.
2. Crear una credencial exclusiva del backend con propiedad solo sobre las tablas `customer_*`. No reutilizar cuentas administrativas de BOLT, roles `anon`/`authenticated` de Supabase ni exponer la conexión en `VITE_*`. Usar TLS con validación de certificado. Las tablas habilitan RLS sin políticas públicas; el rol propietario del backend puede operarlas. Los roles públicos no deben recibir privilegios ni `BYPASSRLS`.
3. Copiar los nombres de `.env.customer.example` al gestor de secretos. `BOLT_CUSTOMER_ORIGIN` debe ser un único origen HTTPS sin ruta ni barra final. `BOLT_CUSTOMER_SECRET` debe tener al menos 32 caracteres aleatorios. Conservarlo cifrado y respaldado: firma sesiones y cifra tokens OAuth/correos; cambiarlo arbitrariamente invalida esos datos. Planificar rotación, no sobrescribirlo sin procedimiento.
4. Respaldar la base seleccionada. Ejecutar `npm run customer:migrate -- --apply` de forma explícita. La migración SQL v1 se ejecuta en una transacción con bloqueo asesor; un fallo revierte el esquema y puede reintentarse. El arranque comprueba la versión y no migra automáticamente. No toca JSON de pedidos, inventario, conductores o administración.
5. Aprobar y versionar los documentos de `src/customer/legal.ts`; confirmar DV del NIT, municipio del domicilio y revisión jurídica. Solo después establecer `BOLT_LEGAL_APPROVED_VERSION` a la versión exacta aprobada. Los consentimientos incluyen hashes SHA-256 del contenido, versión y fecha del servidor.
6. Iniciar el backend con los secretos configurados. Revisar `/api/customer/config`: nunca devuelve credenciales. Crear cuentas reales solo en un ambiente autorizado tras las aprobaciones.

Las sesiones se revalidan al volver a la pestaña y cada cinco minutos mientras está visible. La respuesta de sesión propaga las cookies renovadas al navegador. Las sesiones vencen en 7 días, se renuevan a partir de 1 día de antigüedad y las acciones sensibles usan una sesión reciente (15 minutos, además de verificación de eliminación por correo). Las cookies son HttpOnly, SameSite=Lax y Secure en HTTPS; no usan localStorage. Hay límites de intentos persistidos en PostgreSQL. No habilitar confianza indiscriminada en cabeceras `X-Forwarded-For`; ajustar y probar la cadena de proxy antes de producción para evitar límites compartidos o IP manipulable.

## Correo transaccional

Railway Free/Trial/Hobby requiere correo por HTTPS. El adaptador Resend utiliza `BOLT_RESEND_API_KEY` y `BOLT_CUSTOMER_MAIL_FROM`; no configurarlo junto con SMTP. Ver los pasos y límites en [DEMO-SERVICES.md](./DEMO-SERVICES.md).

Configurar SMTP real, remitente empresarial, dominio verificado, SPF/DKIM/DMARC y TLS. El correo `agroabastossas@gmail.com` es un canal empresarial confirmado, **no una credencial SMTP ni prueba de un servicio transaccional contratado**. Para Apple relay, registrar y verificar el origen de correo en Apple Developer.

Los enlaces de verificación, cambio de correo, eliminación y recuperación son privados. No registrar sus URLs, cookies ni cuerpos OAuth en proxy/APM. El encabezado Referrer-Policy es no-referrer para las rutas de autenticación. La cola `customer_mail` conserva payload cifrado, reintenta hasta 8 veces con espera creciente y elimina mensajes de más de 24 horas. Monitorear conteos de pendientes/errores sin datos personales. La cola se escribe después de la transacción de registro: una interrupción entre ambos pasos exige reenviar verificación (intentar iniciar sesión con correo pendiente); no se declara entrega de correo garantizada por crear el usuario. La captura de correo de los tests nunca es el servicio de producción.

## Google OAuth

En Google Cloud, configurar pantalla de consentimiento y cliente OAuth de aplicación web, scopes mínimos `openid email profile`. Registrar el origen HTTPS exacto y retorno `https://HOST/api/customer-auth/callback/google`. Guardar ID y secreto en `BOLT_GOOGLE_CLIENT_ID`/`BOLT_GOOGLE_CLIENT_SECRET`. Configurar dominios, enlaces públicos de privacidad/términos y usuarios de prueba; completar la verificación que Google exija. La librería aplica código de autorización con PKCE S256, estado y validación de emisor, firma, audiencia y caducidad del ID token. No se aceptan tokens nativos enviados directamente por el navegador.

## Sign in with Apple

Se necesita cuenta empresarial Apple Developer, App ID con Sign in with Apple, Service ID para web, dominio y retorno `https://HOST/api/customer-auth/callback/apple`. Configurar `BOLT_APPLE_SERVICE_ID` y un client secret JWT ES256 firmado con la clave `.p8`, Team ID y Key ID. Nunca subir la `.p8` ni el JWT a GitHub. Utilizar `scripts/customer/apple-secret.ts` con archivos privados y salida protegida; programar su renovación antes del vencimiento y probarla. Apple utiliza form_post y la librería conserva/verifica state, intercambia el código y valida el ID token. Se preserva el nombre recibido en la primera autorización; no se sobrescribe con una cadena vacía en accesos posteriores.

Para una futura app nativa deben registrarse el bundle ID/audiencias exactas, universal links y flujo nativo apropiado. Esta etapa implementa web; no habilita arbitrariamente `idToken` en el endpoint web. Probar Apple con relay y revocación real antes de habilitarlo. La eliminación revoca el refresh token en Apple; si falta el token o falla Apple, deja una solicitud verificada pendiente y bloquea nuevas sesiones. Ejecutar `npm run customer:retry-deletions -- --apply` para reintentar solo solicitudes ya verificadas. El proceso es idempotente y no reabre compras.

## Endpoints y permisos

| Ruta | Acceso y función |
|---|---|
| GET `/api/customer/config`, `/api/customer/legal/:kind` | Público; configuración sin secretos y documentos |
| `/api/customer-auth/*` | Better Auth: registro/login, callback de proveedor, verificación, reset, logout, cambio de correo, vinculación explícita y eliminación |
| GET `/api/customer/me` | Identidad de la sesión de cliente o null; ningún rol administrativo |
| GET/PUT `/api/customer/data` | Cliente verificado; IDs/cantidades de carrito, direcciones, favoritos/listas. Escritura por revisión, 409 ante conflicto |
| PATCH `/api/customer/profile` | Cliente verificado; nombre/teléfono validados |
| PUT `/api/customer/communications` | Consentimiento comercial opcional auditado |
| POST `/api/customer/import` | Cliente verificado; importación voluntaria idempotente por usuario/lote |
| GET `/api/customer/orders` | Solo compras cuyo propietario es la cuenta o que fueron vinculadas con prueba privada |
| POST `/api/customer/orders/:id/link` | Sesión de cliente + acceso privado de invitado; no número/correo/teléfono como prueba |
| `/api/v1/orders/:id` | Mantiene admin/invitado; añade propiedad verificada de cliente sin ampliar permisos de roles |

Las escrituras de cuenta exigen origen exacto y `X-Customer-Id` coincidente con la sesión (la cabecera no autentica; impide que una escritura en vuelo de una cuenta termine en otra). El pedido nuevo guarda `customerAccountId` exclusivamente desde la sesión del servidor en el mismo registro durable del pedido. La idempotencia original se conserva y rechaza reutilización entre cuentas.

La importación conserva la mayor cantidad para una misma variante, mantiene variantes diferentes separadas y deduplica direcciones. No copia precios ni autorizaciones de cobertura. No toca las claves originales del invitado. Un conflicto entre dispositivos ofrece descargar las selecciones pendientes antes de cargar la versión del servidor; el respaldo contiene datos personales y debe guardarse de forma privada. Requiere revisión; el cliente no sobreescribe la versión remota silenciosamente. Las fotos de entrada previas a un pedido siguen en IndexedDB del dispositivo según el módulo existente; **el binario de esas fotos no se sincroniza con el perfil**. Tras confirmar una compra, su acceso sigue protegido por el mecanismo existente del pedido.

## Reversión y conservación

La base de clientes es nueva y separada. No restaurar respaldos antiguos sobre pedidos ni inventario. Para retirar temporalmente el frontend de cuentas, mantener esta revisión del backend para que los pedidos con `customerAccountId` sigan siendo consultables; deshabilitar nuevos registros dejando vacía la aprobación legal y retirar métodos del cliente de forma controlada. Una versión anterior no entiende la propiedad por cuenta: revertir solo Git puede quitar el acceso a esos pedidos. Conservar PostgreSQL, el secreto y el backend compatible; no convertir automáticamente pedidos a invitados ni publicar sus accesos privados. Antes de una reversión completa se necesita un plan de acceso autorizado y probado para las compras creadas desde cuentas.

La eliminación borra las tablas de perfil/datos y sus vínculos mediante cascadas; no modifica la evidencia comercial del pedido. Conserva auditoría seudonimizada de consentimiento/eliminación y estados de trabajos. La matriz de conservación de auditoría y copias de seguridad requiere aprobación jurídica antes de producción; no se programa una purga indiscriminada de registros legales. Los datos nuevos y los movimientos posteriores deben conservarse al revertir cualquier despliegue.

Los recibos de notificaciones de cuenta se guardan por ID de usuario para evitar duplicados en este dispositivo, sin almacenar el contenido privado de las notificaciones. Al salir se recupera únicamente el ámbito de invitado.
