# Rappi Cargo en el ambiente de desarrollo

BOLT conserva el pedido, la reserva y el seguimiento. Cargo se ofrece como respaldo de la flota propia en el simulador aislado. Solo se consideran pedidos Turbo generados por ese simulador, con carga compatible y sin importe por recaudar o artículos sujetos a receta.

## Preparación del entorno

1. Pide a Cargo confirmar el punto de recogida de desarrollo, una dirección y un contacto de prueba que puedan recibir notificaciones del sandbox, y las capacidades admitidas del vehículo. Valida la moneda de la estimación y los recargos antes de usar el presupuesto del piloto.
2. Guarda el token de desarrollo como `BOLT_RAPPI_CARGO_SANDBOX_TOKEN` en el entorno privado del proceso. El servidor nunca usa la URL de producción de Cargo.
3. Configura `BOLT_RAPPI_CARGO_SANDBOX_SETTINGS` con un objeto JSON con `externalBudgetCOP`, `vehicleType` (`BIKE` o `CAR`), `pickingPoints`, `vehicle`, `testClient` y `testDestination`. Usa un identificador numérico para un punto identificado por Cargo o una cadena para el identificador externo registrado en Cargo. Las claves del mapa corresponden a los ID de la sede en BOLT. `vehicle` usa los mismos campos que `TransportVehicle`: `driverId`, `storeIds`, `enabled`, `modes`, `maxLoadGrams`, `cargoDimensionsCm`, `maxVolumeCm3`, `packagingGrams` y `scheduledSlots`. `testClient` incluye `firstName`, `lastName`, `email` y `phone` (móvil colombiano de diez dígitos). `testDestination` contiene `address`, `city` y `coordinates` (`lat`, `lng`) de la ubicación de prueba acordada con Cargo.
4. En una instalación local nueva de `npm run dispatch:simulation`, inicia el proceso con `BOLT_RAPPI_CARGO_SANDBOX=1`. El marcador y el directorio de datos del simulador siguen siendo obligatorios. La demo compartida de Railway y el entorno normal no reciben estas variables por defecto.

## Recorrido de prueba

- Con el token en el entorno privado, ejecuta `node scripts/rappi-cargo-sandbox-check.mjs` para probar la autenticación o agrega el ID numérico del punto para comprobar su acceso. Usa solicitudes GET al dominio de desarrollo y muestra solo el código HTTP. Consulta en el portal que el punto pertenece a la cuenta y coincide con la sede.
- Crea un pedido ficticio, deja el despacho listo y comprueba que un conductor propio apto obtiene la oferta. Sin conductor propio apto, Cargo recibe una validación de la ruta y solo se solicita si la estimación cabe en el presupuesto por compra y la carga cabe en el vehículo. Comprueba que la dirección de prueba del simulador haya sido acordada con Cargo.
- Si se pierde la respuesta al crear, consulta el estado por ID externo. Una solicitud aceptada no equivale a un repartidor asignado. Comprueba el estado del repartidor y la cancelación. Las señales de recogida, entrega o devolución quedan para revisión de Coordinación antes de cambiar la custodia o cerrar el pedido.

El proveedor devuelve una estimación de entrega al cliente. BOLT no la presenta como tiempo de recogida. El piloto conserva el importe del pedido, rechaza cotizaciones con recargos ambiguos y mantiene un presupuesto interno. Fuera del piloto, quedan por habilitar y probar las rutas, franjas programadas, recaudo, webhooks, límites y tarifa efectiva convenidos con Cargo. Las pruebas locales del adaptador simulan respuestas HTTP.

[Referencia de Cargo v3](https://cargo-docs.dev.rappi.com/docs.yaml) · [Guía de ambientes](https://cargo-docs.dev.rappi.com/getting-started/environments)
