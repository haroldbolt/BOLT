# Paneles conectados y simulación de despachos

Rama de trabajo: `codex/asignacion-conductores`. No integrado a `main`.

## Pantallas

- `/operacion?tab=DESPACHOS`: sesión administrativa existente. Compras agrupadas, preparación por entrega, ofertas, conductor/proveedor, carga, incidencias, búsqueda/reintento, liberación antes de recoger, transferencia de custodia después de recoger, disponibilidad, auditoría y métricas. Respeta el filtro de sede; las métricas se identifican como globales. Vincula usuarios a conductores existentes y registra liquidaciones con recibo único. Capacidades y tarifas continúan en **Flota & Repartidores**.
- `/conductor`: sesión propia independiente de administración, conservada en `sessionStorage` de esa pestaña. Turno, ubicación, ofertas, aceptación/rechazo, llegada a sede, conteo de unidades cerradas, recogida, incidencia, custodia y entrega con PIN proporcionado por el cliente. Muestra solo el recaudo asignado a ese despacho y el efectivo pendiente de liquidar. No recibe el PIN desde su API.
- `/pedido/:id`: seguimiento privado existente ampliado con todas las entregas, códigos estables, productos, proveedor confirmado, progreso parcial y alertas internas deduplicadas por evento persistente. Consultas antiguas no sobrescriben una selección nueva. Errores de acceso tienen salida/reintento en lugar de carga infinita.
- `/simulacion`: centro de pruebas, solo en una instancia aislada. `/simulacion/cliente/:id` utiliza exclusivamente la capacidad privada del pedido, incluso si el navegador tiene una sesión administrativa.

La consola antigua de GPS con identidad de demostración se reemplazó por acceso a Conductor. Las acciones antiguas de entrega remiten al flujo autenticado; no saltan la aceptación ni la custodia. Los datos de prueba no se incorporan a carritos, pedidos ni inventarios de la app existente. Las notificaciones nuevas ya no comienzan con avisos de ejemplo.

## Ejecutar una simulación independiente

Desde el repositorio, con dependencias instaladas y Node 22:

```sh
npm run build
npm run dispatch:simulation -- ../bolt-dispatch-simulation-revision
cd ../bolt-dispatch-simulation-revision
BOLT_DISPATCH_SIMULATION=1 BOLT_DATA_DIR="$PWD/.bolt-private/orders" NODE_ENV=production PORT=3031 node --import tsx server.ts
```

Abrir `http://127.0.0.1:3031/simulacion`. El script exige un directorio nuevo, excluye persistencia, secretos y datos privados existentes y crea credenciales ficticias distintas para cada instancia. No ejecuta sincronizaciones Shopify, ajustes +6 ni pagos. Se activa solo con variable, marcador, nombre de directorio y almacenamiento aislados; el servidor simulado escucha exclusivamente en loopback y rechaza otros orígenes/hosts. El origen normal responde `{enabled:false}` y no monta los endpoints del simulador.

1. Pulsar **Ingresar a la simulación**. Abrir administración y Conductor desde los enlaces. Las cuentas ficticias de conductor están en el desplegable.
2. Habilitar **2 conductores propios** (renueva ubicación solo de los libres). Las posiciones vencen; no se finge telemetría continua. Iniciar turno y enviar ubicación simulada también funciona desde Conductor.
3. Crear la compra de prueba: tres bolsas cerradas de 20 kg, 40 kg + 20 kg de producto, 40,7 kg + 20,6 kg con embalaje. Capacidad ficticia 55 kg y 80 × 60 × 60 cm. Máximo por compra `null`; dos conductores son datos de este escenario, no un límite comercial.
4. En administración, **Iniciar preparación** y **Marcar listo** en cada entrega. El trabajador del backend busca al elegible; también existe búsqueda/reintento manual. La oferta dura 120 segundos en esta instancia para facilitar la prueba; la configuración normal conserva 30 segundos.
5. Conductor acepta, confirma llegada, cuenta unidades y recoge. Enviar ubicación simulada publica un punto ficticio mediante las validaciones de telemetría existentes. En cliente consultar el PIN de esa entrega; escribirlo en Conductor y confirmar el importe recaudado, que es cero en este escenario prepagado ficticio.
6. La primera entrega completa solo su despacho. La compra termina al completar ambos. Actualizar/reiniciar conserva códigos, reservas, sesiones de conductor y estados. Tras reiniciar, administración debe iniciar sesión de nuevo según su mecanismo existente.
7. Para red externa: configurar 0 o 1 conductores propios y elegir **Externo acepta**, **Externo demora** o **Externo rechaza** antes de crear otra compra. Los controles de eventos permiten resolver el resultado desconocido, vencer ofertas y simular recogida/entrega externa con PIN. Una demora no genera otro servicio hasta conciliar. La tarifa de $1.000 por servicio externo es exclusivamente un fixture; el total de la compra ficticia de $36.400 no se cobra realmente.

Los pedidos de prueba se crean únicamente al pulsar explícitamente el botón, con identificador persistido por intento. Consultar, cambiar pestañas o recargar no crea pedidos. El proveedor simulado conserva referencias/resultados para reconciliar después de un reinicio.

## Contratos y permisos

Se reutilizan `/api/v1/admin/dispatch/*`, `/api/v1/driver/*`, `/api/v1/operations/orders/:id/status`, `/api/v1/orders/:id` y `/tracking`. Administración usa su bearer; Conductor envía exclusivamente su bearer; cliente usa `X-Order-Token`. `dispatchClient.ts` centraliza estos transportes separados. Los tipos de panel se derivan de DTOs del servicio (importación de tipo, sin empaquetar código servidor en el navegador).

DTO administrativo añade sede, contenido y peso de cada despacho, saldo real de conductor y antigüedad de estimación. El DTO público incluye `shipmentId` para enlazar cada entrega existente. Ninguno de los DTOs de conductor expone PIN ni credenciales. Los códigos BP no sustituyen permisos.

Las alertas son internas con persistencia local y eventos del backend. No se implementó push con la app cerrada. La ubicación web funciona mientras la pantalla esté abierta y el navegador permita geolocalización; no equivale a una app nativa con seguimiento en segundo plano.

## Verificación

- Las 18 suites declaradas en `npm test` pasaron ejecutadas mediante `node --import tsx` (evita el socket IPC del ejecutable tsx en el sandbox).
- `dispatch.test.ts`: 19 escenarios de elegibilidad, capacidades, cercanía, rechazo/vencimiento, concurrencia, permisos, PIN, recaudo, custodia, idempotencia, reinicio y externos. Incluye incidencia antes de recoger con liberación confirmada y antigüedad de estimaciones en los paneles.
- `dispatchPanels.test.tsx`: tokens separados, acceso privado invitado, controles de inicio de sesión, progreso parcial y deduplicación de avisos después de reconstruir el servicio de notificaciones.
- `dispatchSimulation.test.ts`: servidor completo temporal con cuentas reales de prueba, compra dividida, reintento sin duplicado, denegación entre conductores, recogida/GPS/PIN, entrega parcial y total, reinicio, proveedor que demora y luego acepta/rechaza, bloqueo de origen cruzado. El directorio temporal se elimina al finalizar.
- `dispatchServer.test.ts`: conserva protecciones de rutas antiguas y no habilita proveedores en servidor normal.
- Navegador: administración → preparación → oferta → aceptación en Conductor → llegada → recogida → ubicación ficticia → PIN → cliente con 1/2 → segunda entrega → cliente y administración ENTREGADO 2/2. Se verificaron recarga y sesión de conductor después de reiniciar.
- Vista estrecha de Conductor sin desbordamiento horizontal (viewport efectivo de 490 px del navegador de pruebas); escritorio y mapas existentes verificados. No se afirma prueba en un dispositivo físico ni en segundo plano.
- TypeScript y build aprobados. Vite mantiene advertencias de tamaño de bundle y futura configuración nativa, sin error de compilación.
- Los seis archivos de persistencia privada existentes mantienen sus hashes previos.

Los antiguos scripts HTTP manuales ligados a puertos y directorios de otras etapas se negaron a ejecutar fuera de sus entornos, según su guardia de seguridad; no se deshabilitaron esas guardias ni se usaron esos servidores para estos ensayos.

## Pendiente para operación real

Capacidades y medidas verificadas, conductores propios autenticados/en turno, telemetría vigente y disponibilidad real por sede. Sin fuente de rutas, la interfaz presenta distancia geográfica estimada, no minutos garantizados. Rappi e inDrive siguen desactivados, pendientes de convenio, credenciales, capacidades autorizadas y homologación. El panel web de Conductor no es una aplicación nativa instalada.
