# Inventario de Shopify en Bolt Pets

## Estado y alcance

El código prepara lecturas de productos, variantes y existencias por ubicación. No crea pedidos ni modifica precios, productos o inventario en Shopify. Requiere `read_products`, `read_inventory` y `read_locations`.

Sin credenciales propias, puede usar la última copia privada válida. La lectura disponible es del **26 de octubre de 2026 a las 9:16:43 a. m. de Colombia**: 3.830 productos, 5.652 variantes y cinco ubicaciones. Esos conteos describen esa copia; no son límites para futuras lecturas.

Tener variables rellenadas o pasar pruebas con datos simulados no demuestra una conexión real. Debe completarse una lectura autorizada, completa y reciente. El estado distingue la copia guardada de la lectura en vivo, conserva la última copia buena ante un fallo e informa su antigüedad.

## Autorizar la tienda

1. En el [Dev Dashboard de Shopify](https://dev.shopify.com/), crear o seleccionar una app propia de Bolt Pets, configurar solo los tres permisos de lectura e instalarla en la tienda correcta.
2. Elegir la vía correspondiente:
   - **App y tienda de la misma organización:** configurar `SHOPIFY_CLIENT_ID` y `SHOPIFY_CLIENT_SECRET`. El servidor intercambia esas credenciales por un token y lo renueva antes de vencer; este flujo entrega tokens de aproximadamente 24 horas. Tener acceso como colaborador o ser dueño de una tienda no demuestra que compartan organización. [Autenticación de la propia organización](https://shopify.dev/docs/apps/build/authentication-authorization/client-credentials-grant).
   - **Tienda de otra organización:** completar la autorización OAuth del comerciante y configurar `SHOPIFY_ADMIN_ACCESS_TOKEN` en el servidor. Este proyecto acepta el token autorizado; no incluye una interfaz de instalación OAuth ni administra su renovación externa. El gestor del token debe mantenerlo vigente. [Autenticación de aplicaciones independientes](https://shopify.dev/docs/apps/build/authentication-authorization/authenticate-standalone-apps).
3. Guardar las credenciales en las variables privadas del servidor o su gestor de secretos. No pegarlas en el chat, React, variables `VITE_`, capturas o GitHub. El Client ID y el Client secret no se envían directamente como token a la Admin API.
4. Reiniciar con las variables cargadas y verificar la lectura real. La conexión de Shopify de este chat no proporciona una credencial de ejecución a Bolt Pets.

## Variables

Para uso local, copiar `.env.example` a `.env`. En el servidor alojado, usar sus variables privadas. Las variables del proceso tienen prioridad. `.env` y sus variantes están excluidos de Git.

| Variable | Uso |
|---|---|
| `SHOPIFY_STORE_DOMAIN` | Dominio canónico `myshopify.com`, sin protocolo ni ruta. |
| `SHOPIFY_API_VERSION` | Versión probada: `2026-10`. Cambiarla requiere validar operaciones. |
| `SHOPIFY_CLIENT_ID`, `SHOPIFY_CLIENT_SECRET` | Vía de autorización para la misma organización. |
| `SHOPIFY_ADMIN_ACCESS_TOKEN` | Alternativa: token autorizado obtenido y mantenido externamente. |
| `SHOPIFY_SYNC_INTERVAL_MINUTES` | Lectura completa cada `10` minutos de forma predeterminada. |
| `BOLT_SHOPIFY_SNAPSHOT_PATH` | Archivo privado; predeterminado `.bolt-private/shopify/snapshot.json`. |
| `BOLT_ADMIN_API_TOKEN` | Secreto administrativo independiente para sincronización manual. Generar al menos 32 bytes aleatorios. |
| `SHOPIFY_WEBHOOK_SECRET` | Secreto de firma de la app emisora, si se configura separado; por defecto se usa `SHOPIFY_CLIENT_SECRET`. |

Configurar una sola vía de autorización. Dejar vacías las credenciales que no correspondan. No usar valores de ejemplo ni prefijos `VITE_` para secretos del servidor.

## Ejecutar y comprobar

Con Node.js y npm instalados, desde la carpeta del proyecto:

```text
npm install
npm run dev
```

Para producción:

```text
npm run build
npm start
```

El puerto es `PORT` o `3000`. La vista local de esta sesión utiliza `4325`. Servir únicamente `dist` no ejecuta las lecturas: se necesita el servidor.

Comprobaciones sin mostrar secretos ni modificar Shopify:

```text
node scripts/check-shopify-readiness.mjs --env-only
node scripts/check-shopify-readiness.mjs --url http://127.0.0.1:3000
node scripts/check-shopify-readiness.mjs --url http://127.0.0.1:3000 --require-live
```

La primera muestra solo la presencia de variables locales. La segunda consulta el resumen público del servidor. La tercera termina con código distinto de cero si no comprueba una lectura en vivo reciente con sincronización activada. No imprimen secretos ni realizan solicitudes de escritura. Si se consulta un servidor remoto, las variables locales no demuestran su configuración.

- `GET /api/v1/inventory/status`: resumen para comprobaciones.
- `GET /api/v1/shopify/status`: estado operativo.
- `POST /api/v1/shopify/sync`: sincronización manual protegida con `Authorization: Bearer` y el token administrativo. Solo usarlo desde un cliente autorizado del servidor; no guardarlo en el navegador.
- `/api/v1/shopify/webhook`: receptor firmado de Shopify.

Las pruebas de importación, disponibilidad y sincronización del proyecto comprueban el código con datos aislados. No sustituyen la lectura real de la tienda. No hace falta crear pedidos ni cobrar para probar inventario.

## Webhooks y continuidad

El webhook requiere una dirección HTTPS accesible y registro en Shopify; `localhost` no basta. Debe verificar la firma HMAC del cuerpo original y la tienda antes de procesar el evento. [Verificación oficial](https://shopify.dev/docs/apps/build/webhooks/verify-deliveries). La notificación solicita una nueva lectura, sin conceder permisos de escritura.

El temporizador funciona mientras el proceso está activo. Cerrar la app local, suspender el equipo, detener el contenedor o usar un alojamiento que congele la CPU detiene o retrasa las lecturas. Para operación continua, disponer de servicio persistente con CPU disponible o de un planificador externo autorizado que llame al endpoint protegido. Varias réplicas necesitan un único responsable o un bloqueo distribuido; un bloqueo local no coordina procesos distintos.

Guardar la caché en almacenamiento privado persistente si debe sobrevivir reemplazos del servidor. Un clon de GitHub no incluye esa caché. Sin archivo ni autorización, el sistema muestra estado pendiente y catálogo vacío, sin volver a los 15 productos de demostración.

## Criterio para cerrar el punto de inventario

- Lectura real completa de la tienda autorizada, con fecha y conteos de esa respuesta.
- Existencias de cada variante en su ubicación correcta, sin mezclar bodegas.
- Nueva lectura real después del intervalo; un temporizador declarado no basta.
- Un fallo conserva la última copia buena e informa el error o la antigüedad.
- Secretos y archivo completo fuera de carpetas públicas y de GitHub.

La sincronización no elimina las revisiones de calidad. Pesos físicos desconocidos, precios pendientes y productos marcados como inventario pendiente mantienen sus controles de compra. Corregir datos de Shopify requiere la autorización correspondiente fuera de esta integración de lectura.
