# Evidencia de cuentas de clientes — 11 de noviembre de 2026

## Versiones y alcance

- `main`: `38ea7bf1966d6cef13cddb6d52e07d7620c003c4` (comprobado otra vez antes de publicar).
- Base de esta rama: PR #15, `a8fdbb6619ee80e2cd07582b25dcc20b7f908c1f`, sin cambios posteriores detectados.
- Rama: `codex/cuentas-clientes-legales`. Propuesta apilada sobre `codex/safari-ubicacion-demo`; no se modifica main ni se despliega la demo pública.
- Dependencias pendientes de revisión/integración: #13 → #14 → #15 → cuentas. La base móvil y fotografías no se sustituyó por un árbol anterior.

## Verificación ejecutada

`npm test` aprobó las 27 suites existentes y las nuevas suites de cuentas incluidas en el comando. Después de los ajustes finales se repitieron las suites afectadas, TypeScript y build. Build mantiene la advertencia previa de tamaño de algunos chunks; no equivale a una prueba de rendimiento móvil.

Las cinco suites nuevas reúnen **44 comprobaciones** con PostgreSQL aislado (PGlite, motor PostgreSQL embebido), HTTP real y la librería de autenticación real:

| Suite | Casos | Resultado y límite |
|---|---:|---|
| `customerAccounts.test.ts` | 22 | Registro, correo capturado, verificación, cookies, renovación propagada por Express, expiración, reset de un uso, consentimientos, dos cuentas, CAS, origen, sesión cambiada, perfil, publicidad opcional, titularidad histórica, eliminación y reinicio |
| `customerOAuth.test.ts` | 10 | Código/PKCE/state, replay, JWT firmado, Google, Apple form_post/relay/nombre inicial, no fusión por correo, tokens cifrados y revocación pendiente/reanudada. **Proveedores simulados; no autorización real de Google/Apple** |
| `customerMigration.test.ts` | 4 | Interrupción transaccional, reanudación idempotente, conservación posterior, RLS contra rol público y rechazo de esquema desconocido |
| `customerStorage.test.ts` | 5 | Carrito invitado intacto, dos variantes, fallo recuperable, petición ligada a cuenta, separación, restauración y recibos de notificación sin contenido privado |
| `customerOrderIntegration.test.ts` | 3 | Servidor completo aislado: propietario verificado, propietario falsificado ignorado, idempotencia, seguimiento autorizado, invitado rechazado, reserva única, precio e histórico entregado conservados |

El test de pedido configura flota **ficticia**, crea una única compra de prueba con el endpoint habitual y elimina únicamente su directorio temporal. No contrata repartidores, cobra dinero ni altera inventario operativo.

## Navegador

Revisión en navegador real de la simulación local `customer:review`, con cuenta `@example.invalid`, correo capturado y datos ficticios:

1. Invitado sin identidad inventada ni categoría VIP; bienvenida con marca BOLT, Google/Apple deshabilitados.
2. Registro por correo con términos y privacidad separados; publicidad sin marcar. Verificación del enlace capturado y acceso real por contraseña.
3. Edición del nombre, actualización del encabezado y cierre de sesión.
4. Carrito invitado: 1 kg × 1 a $25.000 y 2 kg × 1 a $40.000, subtotal $65.000. Son fixtures; no precios comerciales nuevos.
5. Importación voluntaria a la cuenta: ambas variantes y destino conservados. Cambio a 1 kg × 2; recarga conserva tres unidades y subtotal $90.000 desde el almacenamiento de cuenta.
6. Reinicio del servidor conserva sesión y datos. Al cerrar sesión vuelve el carrito original de invitado, sin sustituirlo por el de cuenta.
7. Vistas de escritorio y 390 px, sin desbordamiento del formulario; controles de registro accesibles por teclado. Esto no acredita una prueba en iPhone/Android físico.
8. La capacidad de reparto no configurada impide continuar el checkout; autenticarse no elimina restricciones. No se creó un pedido por navegar, agregar al carrito o importar.

Las capturas se entregan como archivos locales de revisión; contienen únicamente una cuenta ficticia. El script reproducible es `npm run customer:review`, que crea una copia separada `bolt-dispatch-simulation-*`; nunca ejecutarlo dentro de almacenamiento operativo. El acceso por correo de esta copia usa capturas privadas, no SMTP real. Para detenerla, interrumpir el proceso. No compartir el directorio `.bolt-private`.

## Conservación del PR #11

Los cuatro blobs siguen idénticos:

| Archivo | SHA Git |
|---|---|
| `src/components/customer/PresentationSelector.tsx` | `31b407ba7ea8115db6270048eff3dabd494842a3` |
| `src/lib/presentationDisplay.ts` | `e7999d2091eef2cb861132533faa445072fc4a67` |
| `src/tests/catalogPurchase.test.tsx` | `35d1d46113c3ebf6eea62dea92cdb494e434bdd8` |
| `src/tests/presentationSelection.test.tsx` | `6b5dca4c0dcc510175f8955ab7578be3107ceb41` |

No hay modificaciones de archivos operativos `persisted-*`, precios, fotos, importaciones Shopify, cobertura, tarifas, capacidades o estados de despacho. Los endpoints de pedidos reciben únicamente la nueva verificación de propiedad y mantienen sus validaciones comerciales.

## Pendientes explícitos

No hay base de datos alojada, credenciales OAuth ni servicio SMTP contratado/configurado. No se comprobó correo real, login real Google/Apple, relay real, revocación real ni dispositivos nativos. La captura local nunca se presenta como envío de correo. Los documentos son borradores; faltan DV del NIT, municipio del domicilio, revisión jurídica, matriz de retención y proveedores. El consentimiento legal de la simulación no habilita usuarios reales.

La migración es de tablas nuevas de clientes, explícita y transaccional. No se migró almacenamiento operativo. Para reversión mantener un backend que comprenda `customerAccountId` y la base de clientes; no revertir Git a una versión que pierda el acceso del propietario, ni restaurar respaldos antiguos. Ver [SETUP](SETUP.md).
