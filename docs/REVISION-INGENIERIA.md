# Revisión técnica de BOLT

Esta guía reúne lo necesario para revisar el trabajo el martes. La rama consolidada es `codex/asignacion-conductores`, sobre `main`; la integración queda pendiente de revisión. El último cambio funcional al preparar esta guía es `8bbc225b8bdeeb80bd2c63785485319eca88e305`.

## Alcance guardado

| Área | Estado en la rama | Guía |
| --- | --- | --- |
| Catálogo, presentaciones, carrito de invitado y precios/stock validados | Conserva las mejoras ya integradas en `main` | [Presentaciones](SELECCION-PRESENTACIONES.md), [carrito](CARRITO-INVITADO.md), [lotes](LOTES-INVENTARIO-PRECIOS.md) |
| Sede informada al cliente | Conserva asignación autoritativa y avisos persistentes | [Sedes y avisos](SEDES-Y-AVISOS.md) |
| Cobertura y horarios | Bogotá, Soacha, Chía y Cajicá; Chía/Cajicá Programado desde Suba; bloqueo de otros municipios; validación geográfica del servidor | [Cobertura municipal](COBERTURA-MUNICIPAL.md) |
| Direcciones guardadas | Varias direcciones de invitado, edición, selección, predeterminada y revalidación al restaurar | [Direcciones](DIRECCIONES-GUARDADAS.md) |
| Distribución de la compra | Unidades completas; 50 kg base y hasta 3 kg de extras elegibles; capacidad física por vehículo; una compra con varios despachos | [Transporte](TURBO-DESPACHOS.md) |
| Backend de conductores | Autenticación, elegibilidad, ofertas, asignación, idempotencia, PIN, recaudo, custodia, métricas y persistencia | [Backend](DESPACHOS-Y-CONDUCTORES.md), [contrato](driver-integration-contract.md) |
| Tres paneles y simulación | Administración, BOLT Conductor web y cliente conectados al mismo backend; proveedor externo ficticio con aceptación, demora y rechazo | [Paneles y simulación](PANELES-Y-SIMULACION.md) |

La comparación de GitHub mostraba siete commits funcionales pendientes respecto de `main` antes de esta actualización documental. La rama es descendiente de `main`; no reemplaza sus cambios. Los borradores antiguos [#1](https://github.com/haroldbolt/BOLT/pull/1) y [#2](https://github.com/haroldbolt/BOLT/pull/2) conservan su estado y no se incorporan automáticamente por guardar esta revisión.

## Preparar una copia para revisar

Requisitos del proyecto: Git, Node 22 y npm. Usar un directorio nuevo y una instalación local de revisión.

```sh
git clone --branch codex/asignacion-conductores https://github.com/haroldbolt/BOLT.git bolt-revision
cd bolt-revision
npm ci
npm run lint
npm run build
npm test
```

Si el entorno bloquea el socket IPC de la CLI `tsx`, ejecutar cada archivo de la lista de `scripts.test` en `package.json` mediante `node --import tsx <archivo>`. Los ensayos HTTP necesitan escuchar puertos de loopback. Los scripts HTTP manuales de etapas anteriores fuera de esa lista exigen sus propios directorios, puertos y credenciales ficticias; no quitar sus guardias para ejecutarlos sobre datos existentes.

Para probar los paneles con datos separados:

```sh
npm run dispatch:simulation -- ../bolt-dispatch-simulation-revision
cd ../bolt-dispatch-simulation-revision
BOLT_DISPATCH_SIMULATION=1 BOLT_DATA_DIR="$PWD/.bolt-private/orders" NODE_ENV=production PORT=3031 node --import tsx server.ts
```

Abrir **http://127.0.0.1:3031/simulacion**. El puerto es local a la máquina donde se ejecute; la sesión abierta en el equipo de desarrollo no es un despliegue público. El directorio de simulación debe ser nuevo. Para conservar y revisar una simulación después de reiniciar, volver a ejecutar su servidor en ese mismo directorio; no volver a generarlo encima.

## Conductores para las pruebas

El script crea automáticamente **dos cuentas ficticias de Suba**, con IDs `SIM-HUB_SUBA-1` y `SIM-HUB_SUBA-2`, credenciales generadas para esa instancia y capacidades ficticias de 55 kg y 80 × 60 × 60 cm. El límite comercial base sigue siendo 50 kg. Estas dos cuentas no son un máximo de repartidores de producción.

1. Pulsar **Ingresar a la simulación**. En **Cuentas ficticias de conductor** están las credenciales locales generadas.
2. Abrir una pestaña de `/conductor` para cada cuenta e iniciar sesión por separado; cada pestaña conserva su propia sesión.
3. En el centro de pruebas pulsar **2 conductores propios** para iniciar disponibilidad y actualizar posiciones ficticias. Alternativamente, iniciar turno y enviar ubicación simulada desde cada conductor.
4. Crear una compra de prueba y, en administración, iniciar preparación y marcar listas sus entregas. Los conductores reciben ofertas que deben aceptar.
5. Confirmar llegada, cantidad de unidades recibidas y recogida. El cliente ve el PIN independiente de cada entrega; el conductor lo introduce al entregar. No se cobra dinero real.
6. La ubicación expira según configuración: actualizarla si la prueba se interrumpe. No se simula disponibilidad permanente ni ubicación continua con la app cerrada.

Las cuentas de la sesión local ya preparada no se suben con sus contraseñas: el script permite recrearlas sin publicar secretos ni depender de credenciales ajenas.

## Puntos de revisión recomendados

- Confirmar Cedritos → Usaquén → Suba; Chía/Cajicá → Programado → Suba; Cota y otros municipios no habilitados bloqueados. Cambiar destino debe conservar carrito e invalidar cotización/franja anterior.
- Verificar que dirección, complemento, nombre, teléfono, correo y carrito no se precargan con ejemplos en una primera visita; las selecciones legítimas guardadas se restauran.
- Probar dos variantes del mismo producto y verificar identidad, precio y stock en catálogo, carrito y checkout. No volver a ejecutar lotes +6 o importaciones para revisar la interfaz.
- Compra dividida: tres bolsas de 20 kg generan 40 kg + 20 kg de producto. La primera entrega completada no marca toda la compra como entregada.
- Revisar acceso cruzado entre conductores, capacidades insuficientes, ubicación vencida, oferta rechazada/vencida, reintentos, liberación previa a recogida y transferencia de custodia posterior.
- Probar proveedor ficticio que demora y luego acepta/rechaza. Un resultado desconocido requiere reconciliación antes de pedir otro servicio. No activar Rappi/inDrive reales.
- Revisar recaudo por despacho: nunca cobrar el total de la compra a cada conductor. Los recibos de liquidación son idempotentes.

## Evidencia ya obtenida

- Compilación y TypeScript aprobados en la versión funcional referenciada.
- 18 suites configuradas aprobadas. El motor de despachos tiene 19 escenarios de regresión; los ensayos de panel y simulación comprueban permisos, idempotencia, GPS, PIN, estado parcial/total y reinicio.
- Navegador: administración → oferta → aceptación → recogida → ubicación ficticia → PIN → 1/2 → 2/2 y pedido principal `ENTREGADO`. Se verificaron recarga y conservación de sesiones de conductor tras reiniciar.
- Captura de administración a 1280 px y Conductor en vista estrecha de 490 px; no se afirma prueba en un teléfono físico.
- La comprobación de guardado comparó los hashes Git de los archivos de código con GitHub. Los datos privados existentes se conservaron. Esta actualización de entrega añade documentación; no modifica la lógica de aplicación ni requiere repetir los ensayos funcionales ya aprobados.

## Datos y operación pendientes

El repositorio guarda código, pruebas, configuración versionada y generadores de fixtures. Las credenciales, sesiones, direcciones de navegador, pedidos operativos, telemetría, inventario/precios locales modificados, respaldos de lotes y configuración privada de la instancia permanecen en su almacenamiento local. No asumir que una instalación nueva reproduce el inventario privado ni copiar archivos de persistencia sobre una instancia que tenga movimientos posteriores.

Para operación real se necesitan capacidades y disponibilidad verificadas de la flota, una fuente de rutas si se quieren ETA de recogida comparables y convenios/accesos homologados para los proveedores externos. Las alertas actuales son internas, no push en segundo plano. BOLT Conductor es una pantalla web. La persistencia JSON y los bloqueos actuales requieren un único proceso escritor por almacenamiento; escalar a varias réplicas exige revisar la persistencia transaccional.

Rappi e inDrive siguen desactivados. Esta entrega no publica la app ni integra la rama a `main`.
