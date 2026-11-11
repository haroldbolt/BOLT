# Cuentas de clientes: plan y límites de integración

Revisión: 2026-11-10. main `38ea7bf1966d6cef13cddb6d52e07d7620c003c4`.
Rama: `codex/cuentas-clientes-legales`, desde `a8fdbb6619ee80e2cd07582b25dcc20b7f908c1f` del PR #15. PR apilado sobre #15; integrar primero #13 (fotos de entrada), #14 (demo) y #15 (ubicación). No copiar árboles sobre main ni migrar archivos operativos. Los borradores originales se conservan.

## Secuencia
1. Retirar identidad, beneficios y selecciones personales ficticias del cliente.
2. Autenticación de clientes independiente, PostgreSQL, sesiones en cookies y permisos en servidor. Configuración ausente = método deshabilitado.
3. Consentimientos versionados, perfil y datos por usuario; importación voluntaria de invitado. Vinculación de pedidos mediante prueba privada de propiedad.
4. Páginas públicas legales, cuenta, recuperación y eliminación. No activar proveedores ni correo ficticios.
5. Pruebas aisladas de autenticación, datos, integración y recorrido visual. Comprobar cuatro archivos del PR #11 sin cambios.
6. Publicar rama y PR revisable; sin integración ni despliegue de producción.

## Decisión de arquitectura
Se evaluó Supabase Auth. Su vinculación automática de identidades por correo contradice el requisito de no fusionar cuentas únicamente por esa coincidencia (https://supabase.com/docs/guides/auth/auth-identity-linking). Se utiliza Better Auth con PostgreSQL y vinculación implícita deshabilitada. PostgreSQL puede alojarse en Supabase; no se usa Supabase Auth ni se entrega una service-role key al navegador. Las sesiones del cliente no son las sesiones administrativas ni de conductores.

No existen todavía proyecto PostgreSQL/Supabase, clientes OAuth Google/Apple ni correo transaccional. Las pruebas locales no sustituyen verificaciones con esas credenciales ni en iPhone/Android reales. Los documentos son borradores pendientes de revisión jurídica y empresarial.

## Invariantes
No modificar cobertura, tarifas, bodegas, Shopify, reservas, PIN ni estado de despachos. Carrito = identificadores/cantidades; servidor sigue validando precios y stock. Un número de pedido/correo/teléfono no prueba titularidad. La eliminación de cuenta no borra documentos comerciales con retención legal ni altera pedidos. Ninguna prueba toca los archivos operativos.
