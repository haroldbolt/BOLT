# Demo privada para revisión de BOLT

Preparada para la reunión del 10 de noviembre de 2026. Es una instalación independiente, no producción. Base verificada: main `38ea7bf1966d6cef13cddb6d52e07d7620c003c4`, más PR #13 `f02f688205745021c473f7237b04c499488ef63b` (ubicación, direcciones en encabezado y foto opcional de entrada). No integra el PR #13 a main.

## Arquitectura del despliegue

Railway ejecuta el Dockerfile con Node 22.22.0 y dependencias de bun.lock instaladas con Bun 1.4.4. Un volumen de 500 MB en `/data` conserva el directorio `bolt-dispatch-simulation-meeting`. Debe existir una sola réplica y un solo escritor. El puerto público 8080 pertenece al gateway; el servidor original de BOLT escucha en 127.0.0.1:3030 y mantiene su bloqueo de origen local.

El gateway exige una clave de reunión, genera una cookie firmada HttpOnly/Secure/SameSite=Strict de 12 horas y valida el origen. No sustituye la sesión administrativa, la del conductor ni el acceso privado de cada pedido. Solo el chequeo `/__demo/health` es anónimo y devuelve disponibilidad, sin datos. Los participantes autorizados pueden consultar las cuentas ficticias del simulador; no usar esta instancia con información personal u operacional real.

## Variables y puesta en marcha

- `BOLT_DEMO_PASSWORD`: secreto de al menos 16 caracteres, introducido en las variables privadas del proveedor. No guardarlo en el repositorio.
- `BOLT_DEMO_PUBLIC_ORIGIN`: origen HTTPS exacto sin barra final; alternativamente se usa `RAILWAY_PUBLIC_DOMAIN`.
- `BOLT_DEMO_VOLUME=/data`; montar el volumen antes del primer arranque.
- `PORT=8080`; `NODE_ENV=production`.
- Comando: `node deployment/start-demo.mjs`.
- Healthcheck: `/__demo/health`. Esperar HTTP 200 antes de compartir la URL.
- Conectar la rama de demo fijando un commit. Los cambios de main no deben desplegarse automáticamente en esta revisión.

El primer arranque reutiliza `createIntegrationReview.ts` y `dispatch-simulation.ts`, excluye archivos privados y crea tres históricos, dos conductores ficticios y productos de prueba. La inicialización se publica con un rename de directorio. Una inicialización interrumpida queda identificada y bloquea el arranque; no borra ni sobrescribe datos silenciosamente. Los arranques siguientes comprueban storage-contract.json, actualizan solo código y preservan archivos `persisted-*`, configuración, fotos y credenciales. No reejecutan importaciones Shopify ni ajustes +6.

`--local-test` solo permite HTTP sobre 127.0.0.1 y con NODE_ENV distinto de production. No utilizarlo en Railway. Se permite únicamente para pruebas aisladas de este launcher.

## Recorrido de la reunión (30 minutos)

1. **Acceso (3 min).** Abrir la URL HTTPS en celular y computador, introducir la clave, entrar a Cliente. En un navegador nuevo deben estar vacíos dirección, complemento, contacto y carrito.
2. **Compra (7 min).** Revisar tarjetas de una y varias presentaciones, chips compactos sin precio duplicado, precio principal y carrito persistente. Usar productos reales para revisión visual; para crear pedidos con capacidad comprobable usar `SIM-FOOD-20KG` o `SIM-CARD`, expresamente ficticios.
3. **Destino (5 min).** Probar Cedritos → Usaquén → Suba, Chía/Cajicá → Programado → Suba y Cota → bloqueo. Dirección, mapa, ubicación del dispositivo y foto opcional requieren confirmación del cliente. Guardar una dirección y recargar. Una falta de capacidad no equivale a exclusión geográfica.
4. **Operación (10 min).** Abrir `/simulacion`, ingresar, habilitar dos conductores propios ficticios y crear compra de tres bolsas de 20 kg. Administración prepara sus entregas de 40 + 20 kg. Cada conductor acepta, llega, cuenta unidades, recoge y confirma con el PIN facilitado por cliente. Una sola entrega terminada no completa toda la compra. Simular proveedor externo que acepta, demora o rechaza, sin Rappi/inDrive reales.
5. **Continuidad y decisiones (5 min).** En administración → Despachos → Pedidos anteriores: HIST-READY permite registro/conciliación; HIST-WAY carece de evidencia de recogida y debe mantener el bloqueo; HIST-CLOSED permite recuperar acceso privado sin reabrirse. Acordar responsables y prioridades de producción.

Las posiciones ficticias caducan. Para renovar las de conductores libres usar el simulador; no aumentar la vigencia para fingir disponibilidad. Los horarios de prueba se generan al inicializar, por lo que una demo reutilizada días después necesita actualizar la disponibilidad simulada mediante administración, sin tocar pedidos previos.

## Reinicio, respaldo y reversión

Un reinicio del servicio conserva `/data`; la administración inicia sesión de nuevo según su contrato existente. El launcher libera únicamente locks del PID del servidor que acaba de detener. Tras una terminación forzada y un lock antiguo, comprobar que no existe un escritor antes de intervenir: no eliminar locks automáticamente ni arrancar una segunda réplica.

Para respaldo, detener el servicio escritor y copiar el volumen actual completo: `.bolt-private` (incluye pedidos, fotos, flota, claves), `src/data/persisted-*` y `public/uploads`. Un respaldo antiguo no se restaura sobre movimientos posteriores. Las instrucciones de transición y reversión compatible siguen en INTEGRACION-SEGURA.md. Volver a main anterior a PR #12 es incompatible con fulfillment v2. Cambiar solo Git no revierte datos.

La demo alojada no es una garantía de disponibilidad permanente. Revisar créditos, límites y vigencia de Railway antes de la reunión. No se autoriza desde esta configuración una suscripción, pago, proveedor real ni sincronización comercial.

## Validación reproducible

```sh
bun install --frozen-lockfile
npm run lint
npm run build
node deployment/demo-gateway.test.mjs
node deployment/demo-runtime.test.mjs
npm test
```

Gateway: autenticación, origen, cookie segura, CSRF, separación de tokens, alteración de cookie y salida. Runtime: instancia nueva, tres históricos, dos entregas, idempotencia, recuperación privada de cerrado, reinicio y conservación de códigos/estados. Las pruebas existentes cubren catálogo, cobertura, transporte, históricos, imágenes y foto de entrada. Registrar por separado el resultado realmente obtenido en Railway y en navegador; no equiparar pruebas locales con un despliegue verificado.

## Pendientes para la ingeniera

- Revisar el PR #13 antes de integrarlo; conservar PR #11 y la integración de PR #12.
- Probar cámara, permisos GPS y persistencia en iOS/Android reales. HTTPS habilita el contexto seguro, pero no demuestra esas pruebas físicas.
- Autorizar el dominio HTTPS en las restricciones de las claves de mapas existentes; revisar separación de clave servidor/cliente y cuotas. No crear credenciales ni ampliar restricciones globalmente desde la demo.
- Planificar base de datos transaccional, almacenamiento privado de imágenes, backups externos, secretos, monitorización y pruebas de concurrencia antes de escalar réplicas.
- Verificar medidas, stock, cupos, tarifas y capacidad física reales; muchos productos del catálogo todavía no tienen mediciones logísticas verificadas.
- Revisar fotografías pendientes; el código de imágenes integrado no significa que todos los empaques hayan sido verificados ni que se haya aplicado un lote pendiente.
- Pagos, Rappi e inDrive reales y push en segundo plano permanecen pendientes. BOLT Conductor es web, no una app nativa con ubicación continua.

Fuentes de alojamiento consultadas: https://docs.railway.com/volumes y https://docs.railway.com/pricing/free-trial.
