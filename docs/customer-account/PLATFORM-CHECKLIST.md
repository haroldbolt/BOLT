# Preparación iOS / Android — revisión del 10 de noviembre de 2026

No representa aprobación de las tiendas ni una aplicación nativa terminada.

## Hecho en código web
- Identidad real y modo invitado; sesiones de clientes separadas de administración/conductores.
- Métodos Google/Apple deshabilitados sin configuración, correo verificado, recuperación, cierre de sesión.
- Páginas `/legal/terminos`, `/legal/privacidad`, `/legal/eliminacion`, `/eliminar-cuenta` sin sesión de cliente.
- Solicitud de eliminación desde Mi cuenta y enlace público externo, verificación de titularidad y revocación Apple reintentable.
- Ubicación y foto opcionales conservadas; entrada manual disponible. No se añadió seguimiento continuo del teléfono.
- Pruebas HTTP con PostgreSQL aislado y proveedores OAuth firmados de fixture; revisión visual web.

## Pendiente antes de habilitar usuarios reales
- Proyecto PostgreSQL empresarial, SMTP y OAuth Google/Apple reales; prueba de entrega, spam, relay de Apple, revocación y rotación de secretos.
- Aprobación jurídica, DV del NIT, municipio del domicilio, responsable jurídico y matriz de conservación/proveedores/países.
- URL HTTPS empresarial estable y páginas legales accesibles **sin la contraseña de la demo**. La demo de revisión sigue protegida por su clave privada; no sustituye las páginas públicas requeridas para publicación en tiendas.
- Definir monitoreo, alertas de correo, recuperación de respaldos, accesos de soporte y respuesta a incidentes.
- Confirmar medios de pago, facturación y controles veterinarios reales. La base contiene comportamientos simulados de pagos/recetas; esta funcionalidad no los convierte en integraciones verificadas.

## Apple
- Registrar App ID, Service ID y dominios; ofrecer Apple en condiciones equivalentes a Google.
- Crear aplicación nativa o contenedor aprobado, integrar autenticación nativa y audiencias exactas; revisar uso de navegador externo según las normas aplicables.
- Declarar en App Store Connect datos realmente recogidos, finalidades, vinculación con identidad y proveedores/SDK. Revisar manifest y APIs de motivo requerido al elegir tecnología nativa.
- Probar permisos de ubicación/cámara, denegación y alternativa manual en iPhone real; verificar Safari y después la aplicación nativa.
- Probar eliminación y revocación real de Apple, incluida cuenta con correo privado.
- Proporcionar a revisión una cuenta de prueba válida o demo completa, instrucciones y acceso a backend disponible. No una identidad ficticia mostrada como autenticada.

## Google Play
- Configurar Google OAuth oficial y probar Android real.
- Declarar correctamente Data Safety: cuenta/contacto, direcciones/ubicación cuando se usa, compras, fotos opcionales, seguridad y proveedores realmente activos.
- Publicar URL externa para solicitar eliminación y mantener la acción dentro de la app.
- Mostrar política pública, permisos proporcionados y explicaciones en contexto. No exigir ubicación para escribir una dirección.
- Verificar SDKs, formularios de Play Console y pruebas del formato nativo elegido antes de enviar a revisión.

## Fuentes oficiales consultadas
- [Apple App Review Guidelines, 4.8 y 5.1.1](https://developer.apple.com/app-store/review/guidelines/).
- [Apple: eliminación de cuentas](https://developer.apple.com/help/app-review/guideline-reference/5-1-1-account-deletion/).
- [Apple: revocar tokens](https://developer.apple.com/documentation/signinwithapplerestapi/revoke-tokens).
- [Google Play: eliminación de cuentas](https://support.google.com/googleplay/android-developer/answer/13327111?hl=es).
- [Google Play: datos de usuario](https://support.google.com/googleplay/android-developer/answer/10144311?hl=es).
- [Better Auth: cuentas y vinculación](https://better-auth.com/docs/concepts/users-accounts).
- [Better Auth: Apple](https://better-auth.com/docs/authentication/apple).
- [Better Auth: integración Express](https://better-auth.com/docs/integrations/express).
- [Ley 1581 de 2012](https://www1.funcionpublica.gov.co/eva/gestornormativo/norma.php?5=&i=49981).
- [Ley 1480 de 2011 y modificaciones](https://www.funcionpublica.gov.co/eva/gestornormativo/norma.php?i=44306).
- [Ley 962 de 2005, artículo 28](https://www.funcionpublica.gov.co/eva/gestornormativo/norma.php?emergente=1&i=17004).
