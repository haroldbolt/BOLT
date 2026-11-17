# Rappi Cargo en BOLT Despachos

BOLT Despachos prioriza un vehículo propio apto y disponible. Cargo es un respaldo para Turbo y Turbo Dividido cuando la capacidad, el plazo y el presupuesto lo permiten. Programado sigue usando la flota propia y la sede territorial. El adaptador de producción usa exclusivamente el gateway oficial de Colombia y queda desactivado por defecto. [Documentación oficial de Cargo](https://cargo-docs.dev.rappi.com/api/) · [Ambientes](https://cargo-docs.dev.rappi.com/getting-started/environments)

## Autorización de efectivo de Agrocentro

Obtener del ejecutivo de Cargo la confirmación operativa del recaudo para la cuenta de Agrocentro en Colombia y la credencial de producción con acceso a validación, creación, estado y cancelación. Los correos anteriores contienen un borrador de convenio y acceso de desarrollo.

Para Álamos, Kennedy y Suba se necesita el ID de recogida autorizado, su correspondencia con la dirección y ciudad de la sede, el tipo de vehículo admitido, la carga útil y el volumen útil con embalaje. Confirmar además el límite por despacho, las restricciones de mercancía, el costo de envío, los recargos, la comisión e impuestos del recaudo, y el calendario y cuenta de liquidación. El precio estimado que devuelve Cargo se usa para el presupuesto de transporte. Confirmar las comisiones y la liquidación en el acuerdo comercial.

## Variables del servidor

- `BOLT_RAPPI_CARGO_ENABLED=1` una vez que la empresa haya autorizado la operación.
- `BOLT_RAPPI_CARGO_USER_TOKEN` como variable privada del servidor. La credencial debe corresponder al ambiente de producción en Colombia.
- `BOLT_RAPPI_CARGO_SETTINGS` como JSON con los campos de la tabla. Los valores deben corresponder a los datos aprobados por Cargo y la operación de BOLT.
- `BOLT_PILOT_CHECKOUT_ENABLED=1` es la apertura del checkout en producción. Configúrala después de verificar las tres sedes, el recaudo y la flota propia con cupos y capacidad.

| Campo | Valor requerido |
| --- | --- |
| `cashCollectionApproved` | `true` después de recibir la autorización de recaudo |
| `cashApprovalReference` | Referencia del acuerdo operativo, sin credenciales |
| `maxCashCOP` | Límite entero de recaudo en COP por despacho |
| `externalBudgetCOP` | Presupuesto de transporte externo en COP para la compra |
| `sites` | Configuración independiente de `HUB_ALAMOS`, `HUB_KENNEDY` y `HUB_SUBA` |

Cada entrada de `sites` requiere `pickingPointId` (ID numérico de Cargo o identificador externo de cadena), `vehicleType` (`BIKE` o `CAR`), `maxLoadGrams`, `cargoDimensionsCm` (largo, ancho y alto), `maxVolumeCm3` y `packagingGrams`. Los tres puntos deben ser distintos. Las variables permanecen en el backend. Cliente y Admin acceden a la operación de BOLT mediante su API.

## Verificación sin crear pedidos

1. Con el token de producción, consulta `GET /picking-point/list/` y `GET /picking-point/view/{id}/` cuando se conoce el ID numérico. Confirma que cada sede existe y corresponde a la dirección aprobada.
2. Con una dirección y contacto autorizados, usa `POST /v3/order-validate/` con `payment_method: "CASH"` para cada sede. Solicita un servicio inmediato en moneda colombiana. Valida cobertura, tarifa, recargos y el límite del importe, sin usar el endpoint de creación.
3. Verifica de forma separada la consignación, el soporte que emitirá Cargo y la conciliación bancaria. La consulta de disponibilidad y el estado de entrega solo confirman el servicio reportado.

BOLT envía como `total_value` el saldo de efectivo ya calculado para ese despacho y deja `user_tip` en cero para evitar sumarlo dos veces. Cada solicitud real usa la referencia estable de BOLT. Si la creación no responde, Despachos consulta esa misma referencia y conserva la solicitud pendiente mientras el resultado siga inconcluyente. Los cambios de custodia y el recaudo requieren conciliación en BOLT. La entrega reportada por Cargo requiere evidencia de recaudo antes de registrar el pago. [Referencia de Cargo v3](https://cargo-docs.dev.rappi.com/api/)

En Despachos, Coordinación confirma la recogida reportada por Cargo. Para cerrar la entrega verifica el PIN y la referencia de recaudo con el importe exacto del despacho. La liquidación bancaria registra por separado la línea del comprobante, el neto y las deducciones verificadas. Un retorno libera inventario cuando Coordinación confirma la devolución física y que el despacho no recaudó. Programado y el cálculo de disponibilidad del checkout siguen dependiendo de la flota propia.
