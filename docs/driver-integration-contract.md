# BOLT Conductor — contrato vigente

La versión anterior de este documento describía JWT, Firebase, un conductor fijo y GPS en segundo plano que no estaban implementados en el servidor. No debe utilizarse como garantía de esas funciones.

El contrato implementado está en [DESPACHOS-Y-CONDUCTORES.md](./DESPACHOS-Y-CONDUCTORES.md): autenticación propia con tokens opacos, autorización por despacho, ofertas de 30 segundos configurables, aceptación atómica, telemetría con vigencia, PIN protegido, recaudo por despacho y transferencia de custodia.

La app Android debe conectar ese contrato y homologar permisos y servicio de ubicación en segundo plano. Rappi e inDrive permanecen desactivados para operación real. Los simuladores se usan únicamente en pruebas aisladas.
