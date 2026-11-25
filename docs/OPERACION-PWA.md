# Publicación de BOLT para Álamos, Kennedy y Suba

Usa un solo servicio HTTPS para Cliente, Admin, Despachos y Conductor. Los tres módulos operativos comparten permisos y pedidos con Cliente a través del mismo backend. Cada sede conserva sus existencias, reservas, conductores y despachos.

| Ajuste del servicio en Railway | Valor |
| --- | --- |
| Compilación | `Dockerfile` del repositorio con `BOLT_IMAGE_STAGE=production` |
| Comando de arranque | `node --import tsx deployment/start-pilot.ts` |
| Chequeo de salud | `/api/v1/health`, espera de 120 s |
| Réplicas | 1, sin solapamiento y con 30 s de drenaje |
| Volumen independiente | Montaje en `/data` |
| `BOLT_PILOT_VOLUME` | `/data` |
| `BOLT_REQUIRE_VOLUME_MOUNT` | `1` |
| `BOLT_PILOT_STORE_IDS` | `HUB_ALAMOS,HUB_KENNEDY,HUB_SUBA` |
| `BOLT_ADMIN_SETUP_TOKEN` | Secreto de al menos 32 caracteres para el alta inicial de Coordinación |

Configura el arranque en los ajustes del servicio nuevo de Railway. El `railway.json` existente define el arranque de la demo. El volumen operativo guarda sus datos en `/data/bolt-operacion`. El lanzador rechaza los volúmenes de simulación y exige una migración explícita si el volumen contiene una instalación anterior exclusiva de Suba. Retira el bloqueo de escritura solo después de confirmar que la instancia anterior se detuvo. [Configuración de Railway](https://docs.railway.com/config-as-code) · [Healthchecks y volúmenes](https://docs.railway.com/deployments/healthchecks)

## Sede y modalidad

- **Turbo** se ofrece según cobertura, ruta, existencias y capacidad de reparto. Respeta las zonas aprobadas de Kennedy, Engativá y Suba.
- **Programado** usa la sede asignada al destino, con franjas, cupos y capacidad verificada. Soacha conserva Kennedy. Chía y Cajicá usan Suba para Programado.
- Cada sede debe cargar precios, existencias y medidas verificadas de las referencias a vender. Registra la flota propia y sus capacidades en la sede correspondiente. Coordina los cupos y las franjas antes de ofrecer Programado.

## Publicar y verificar sin crear pedidos

1. Conecta una revisión verificada al servicio operativo y arranca sin pedidos de ejemplo. Usa una cuenta real de Coordinación para administrar las tres sedes.
2. Ejecuta `node deployment/check-pilot.mjs https://<origen-operativo>`. Solo usa GET. Comprueba las tres sedes, rutas, manifiesto y archivos de instalación, protección de las API operativas y aislamiento de la simulación. Tras autorizar el recaudo y abrir el checkout, agrega `--checkout-abierto` para comprobar ese estado mediante GET.
3. Abre el mismo origen en iPhone o Android. En Safari usa **Compartir → Añadir a pantalla de inicio**. En Chrome para Android, usa **Instalar aplicación** si está disponible. Admin abre en `/admin/nuevo/`, Despachos en `/admin/nuevo/?view=dispatch` y Conductor en `/conductor`.

## Apertura del checkout real

Para operar exclusivamente con flota propia, configura `BOLT_PILOT_OWN_FLEET_ONLY=1`. Cuando las sedes tengan inventario, vehículos y conductores habilitados para recaudar, abre el checkout con `BOLT_PILOT_CHECKOUT_ENABLED=1`. BOLT comprueba la capacidad propia, los horarios y las existencias al cotizar y confirmar. Este modo omite el adaptador de Rappi y funciona sin su credencial. Para cerrar la recepción de pedidos, desactiva `BOLT_PILOT_CHECKOUT_ENABLED`. Antes de cambiar de un modo con Cargo a flota propia, concilia y cierra los despachos externos que sigan activos.

En el modo con respaldo de Cargo (el predeterminado) el checkout conserva el carrito y responde con `RAPPI_CASH_UNCONFIRMED` mientras esté pendiente el recaudo. Para las dos PWAs, el backend autoriza solo los orígenes HTTPS exactos en `BOLT_PWA_ORIGINS` y ambos paquetes usan el mismo `VITE_BOLT_API_ORIGIN`. Las sesiones administrativas y de conductor conservan sus permisos. El frontend separado admite compras de invitado y seguimiento privado. Los pagos en línea aparecen como **No disponible** hasta integrar Wompi.

Confirma con Rappi Cargo la habilitación de efectivo de Agrocentro, credenciales de producción, puntos de recogida de las tres sedes, límites y liquidación. Conecta el adaptador de producción al mismo sistema de cotización y despachos. `POST /v3/order-validate` con `payment_method: "CASH"` valida sin solicitar un envío. La validación de envío y la liquidación bancaria se comprueban por separado. [API oficial de Rappi Cargo](https://cargo-docs.dev.rappi.com/api/)

Consulta la [preparación de AppDeploy](../deployment/appdeploy-pwa.md) y la [configuración operativa de Cargo](RAPPI-CARGO-OPERACION.md).
