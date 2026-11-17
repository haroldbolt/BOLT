# Arranque operativo del piloto en Suba

Prepara un servicio y un volumen dedicados. Usa una réplica con HTTPS, conserva la configuración vigente de la demo en su propio servicio y elige una revisión que incluya este lanzador.

| Ajuste | Valor |
| --- | --- |
| Compilación | Dockerfile del repositorio |
| Comando de inicio | `node --import tsx deployment/start-pilot.ts` |
| Verificación de salud | `/api/v1/health` |
| Réplicas | 1 |
| `BOLT_PILOT_STORE_ID` | `HUB_SUBA` |
| `BOLT_PILOT_VOLUME` | Ruta absoluta del volumen montado para el piloto |
| `BOLT_ADMIN_SETUP_TOKEN` | Secreto independiente de al menos 32 caracteres mientras exista una cuenta administrativa por configurar |

Configura el servicio del piloto con el comando indicado y revisa su configuración efectiva antes de arrancar. La configuración existente de la demo usa otro lanzador y otra verificación de salud. [Comando de inicio en Railway](https://docs.railway.com/deployments/start-command)

Al iniciar en un volumen nuevo, el sistema crea pedidos, conductores y telemetría vacíos. El volumen conserva la cuenta administrativa creada mediante BOLT Admin, las ediciones del catálogo, la configuración de transporte, las imágenes cargadas y el seguimiento. Cada revisión aporta el catálogo base y los límites geográficos empaquetados. El directorio de operación queda en `$BOLT_PILOT_VOLUME/bolt-piloto-suba`.

Para actualizar, detén la instancia anterior y usa el mismo volumen con una revisión compatible con el esquema de pedidos v2. Si una caída abrupta deja el directorio `.bolt-pilot-writer`, retíralo únicamente después de verificar que todos los procesos de ese volumen estén detenidos. Ante archivos operativos faltantes o inválidos, restaura un respaldo autorizado antes de iniciar.

El checkout del piloto conserva el carrito y rechaza la confirmación con `RAPPI_CASH_UNCONFIRMED` mientras se verifica el recaudo y se conecta el adaptador de producción con Cotización y Despachos. Para el primer pedido, confirma el precio y las existencias del producto, el acceso de producción de Cargo en Colombia, el punto de recogida de Suba, la capacidad y las condiciones de recaudo y liquidación para Agrocentro.

En una copia de trabajo, ejecuta `npm run lint`, `npm run build`, `node --import tsx --test deployment/start-pilot.test.ts` y `node --import tsx src/tests/pilotCashOrderHttp.test.ts`. La última prueba usa datos temporales y un conductor propio ficticio para comprobar la reserva, los estados y la liquidación en efectivo.
