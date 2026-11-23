# Revisión del checkout en efectivo de las tres sedes

La rama de prueba integra el PR #38 (`0731f54`) y el PR #39 (`caca09c`), ambos basados en `d2e2054`. Cliente y Admin utilizan una API común. El arranque de producción comprueba el volumen, el bloqueo del único proceso escritor y el alcance de las tres sedes. El volumen antiguo de Suba conserva su identidad y requiere una transición explícita para ampliar el alcance. [Instalación](OPERACION-PWA.md) · [Almacenamiento y Render](HOSTING-PRODUCCION.md)

## Cómo repetir la revisión

Usar Node 22 y las dependencias de `bun.lock`, con una copia del repositorio y espacio temporal local. Las pruebas crean sus directorios fuera de los datos operativos. No proporcionar claves de Rappi, datos de clientes ni acceso a las sedes.

1. Ejecutar `npm run lint`, `npm run build` y `npm test`. La suite `npm run test:pilot` puede repetirse por separado.
2. Ejecutar `npm run test:bolt-admin` y `node --test deployment/production-runtime.test.mjs`. El arranque se prueba dos veces en el mismo disco temporal y las consultas de salud, sedes y restricciones usan únicamente lecturas.
3. La comprobación del PR construye el contenedor y abre el sitio compilado con Chrome. Recorre Cliente y Admin en ventanas de 390 × 844 y 1440 × 900, con un navegador y una instalación temporales para cada combinación. Parte de un carrito y una dirección de invitado preparados en el dispositivo. El navegador envía el formulario de compra y entra en Admin con credenciales propias del fixture. Las capturas del checkout y de Admin se conservan siete días en el resultado de la comprobación. Estas dimensiones prueban el diseño adaptable. La instalación en Safari/iPhone y Chrome/Android requiere los dispositivos y dominios de pruebas definitivos.
4. Para repetir la prueba visual local tras compilar, instalar `playwright-core@1.65.1` en un directorio de herramientas separado. Configurar `BOLT_BROWSER_MODULE` con su ruta, `BOLT_TEST_CHROME` con un Chrome ejecutable y, opcionalmente, `BOLT_TEST_SCREENSHOTS` con el directorio de capturas. Ejecutar `node --import tsx src/tests/threeStoreCashBrowser.mjs`. Este comando siempre arranca un servidor en la interfaz local y genera una identidad administrativa temporal.

## Resultado de las seis confirmaciones HTTP

Cada fila parte de una instalación vacía con ocho unidades de una presentación ficticia de $59.000 por sede. La consulta no modificó inventario. El POST del checkout creó una compra confirmada y repetir su clave devolvió el mismo identificador. El pedido apareció en Admin en la sede asignada. El proveedor externo se mantuvo inaccesible en esta matriz. Los importes siguientes son obligaciones ficticias de efectivo antes de entregar.

| Sede | Modalidad | Total del fixture | Disponibles en la sede tras confirmar | Otras sedes | Transporte y recaudo previstos |
| --- | --- | ---: | --- | --- | --- |
| Álamos | Turbo | $69.000 | 7 y 1 reservada | 8 y 0 reservadas | Flota propia, efectivo pendiente |
| Álamos | Programado | $63.900 | 7 y 1 reservada | 8 y 0 reservadas | Flota propia, franja 09:00–14:00, efectivo pendiente |
| Kennedy | Turbo | $69.000 | 7 y 1 reservada | 8 y 0 reservadas | Flota propia, efectivo pendiente |
| Kennedy | Programado | $63.900 | 7 y 1 reservada | 8 y 0 reservadas | Flota propia, franja 09:00–14:00, efectivo pendiente |
| Suba | Turbo | $69.000 | 7 y 1 reservada | 8 y 0 reservadas | Flota propia, efectivo pendiente |
| Suba | Programado | $63.900 | 7 y 1 reservada | 8 y 0 reservadas | Flota propia, franja 09:00–14:00, efectivo pendiente |

La matriz HTTP también ejecutó los seis pedidos en una misma instalación. Al terminar quedaron dos reservas en cada sede, seis códigos de compra distintos y $0 recaudados. Los reintentos después del reinicio conservaron los seis códigos y reservas. Las seis solicitudes sin autorización de recaudo quedaron bloqueadas. Wompi y la confirmación de Programado sin franja fueron rechazados.

GitHub Actions completó los doce recorridos en Chrome, con una pasada de cada caso en móvil y otra en escritorio. En cada uno se confirmó el pedido desde el formulario de Cliente, se abrió su seguimiento privado y se encontró el mismo código en el apartado Turbo o Programados de la sede en Admin. [Ejecución y capturas de la integración](https://github.com/haroldbolt/BOLT/actions/runs/45114556511)

En la regresión de Suba también se siguió una compra ficticia desde preparación y reserva hasta entrega con PIN, registro de efectivo y liquidación por separado. Se probaron las restricciones por sede, el acceso privado, la competencia por la última unidad, la cancelación y la entrega parcial con sus suites operativas.

## Qué representa el efectivo

En una compra confirmada, el importe por cobrar al entregar queda pendiente. El cliente no ha pagado por confirmar el checkout. La asignación, la entrega física, el recibo de efectivo y la liquidación bancaria son eventos independientes. Programado necesita una franja vigente. En las seis combinaciones se comprueba la reserva en el inventario de la sede asignada. Los precios, las cantidades, las ubicaciones de prueba y las capacidades de este ensayo no acreditan disponibilidad comercial.

Cargo puede respaldar en Despachos una compra Turbo ya confirmada. El checkout conserva la exigencia de flota propia apta. Si falta vehículo, una configuración de Cargo por sí sola no ofrece Turbo ni Programado. La prueba con el proveedor simulado conserva una única contratación después de preparar el pedido y comprueba que la aceptación del servicio no acredita dinero. [Contrato y controles Cargo](RAPPI-CARGO-OPERACION.md)

## Vigilancia y recuperación

La prueba `node --test deployment/notify-availability.test.mjs` utiliza un receptor HTTPS independiente en la máquina de pruebas: simula caída, recuperación y pérdida del acuse de recibo. La configuración del destinatario de guardia y del programador externo corresponde a la instalación. [Configurar el aviso](MONITOREO.md)

Se ensayó la transición de almacenamiento interrumpida, la reanudación, una reversión compatible que conserva movimientos posteriores y el bloqueo de lectores incompatibles. También se comprobó la persistencia de fotos tras reiniciar. Las pruebas de cuentas se ejecutan con PGlite local. Queda por restaurar conjuntamente una copia externa de los archivos y la base PostgreSQL de la instalación elegida.

El ensayo de carga local sostuvo 1.000 usuarios virtuales durante un minuto. Completaron 4.908 consultas de catálogo, sedes y cotización con cero errores. Se mantuvieron en cero pedidos y despachos. La medición de capacidad de compra y escritura en el hosting elegido sigue pendiente.

## Antes de abrir ventas

| Responsable | Comprobación pendiente | Evidencia para cerrar |
| --- | --- | --- |
| Responsables de Álamos, Kennedy y Suba | Existencias por referencia, personal autorizado, capacidad, horarios, franjas y flota reales | Conteo, permisos y configuración aprobados por cada sede |
| Harold y comercial de Rappi | Convenio de recaudo, tres puntos de recogida, capacidad, montos máximos, comisiones y liquidación | Confirmación de Rappi para Agrocentro y para cada punto antes de abrir efectivo |
| Harold e ingeniera | Dominio, hosting, presupuesto y volumen persistente | HTTPS en los dominios definitivos, copia y restauración ensayadas, rol de base de datos restringido y un solo escritor operativo |
| Ingeniera y responsable de guardia | Canal de alertas, recuperación, restricciones de Maps y monitoreo externo | Aviso de caída y recuperación recibido fuera de BOLT, y comprobación de permisos en el proyecto |
| Ingeniera | Rendimiento e instalación móvil | Medición en el hosting aprobado con historial, confirmaciones concurrentes y seguimiento representativos, además de instalación y actualización en iPhone y Android |

Wompi, la integración con el POS y nuevos proveedores pertenecen a fases posteriores. Para abrir o publicar el piloto se requiere una decisión comercial independiente de esta revisión.
