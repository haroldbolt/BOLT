# CONTRATO DE INTEGRACIÓN API — BOLT CONDUCTOR (ANDROID) Y BACKEND BOLT PETS

**Versión:** 2.0.0 (Release 2026: Turbo 25 min, 6 km, Envíos Divididos >60 kg y Entregas Programadas)  
**Zona Horaria Oficial:** America/Bogota  
**Moneda Oficial:** COP (Pesos Colombianos)  
**Idioma Oficial:** Español de Colombia (`es-CO`)  

---

## 1. INTRODUCCIÓN Y ALCANCE

Este documento define el contrato de integración authoritative entre el backend unificado de **Bolt Pets** y la aplicación móvil nativa **Bolt Conductor** (Android). Establece los modelos de datos, endpoints REST, protocolos de telemetría GPS, flujos de recaudo en efectivo (Cash on Delivery / Contra entrega) y la gestión de envíos hijos resultantes de partición por sobrepeso (> 60 kg).

---

## 2. REGLAS LOGÍSTICAS AUTORITATIVAS

1. **Promesa Turbo:**
   - Radio geodésico máximo por bodega: **6.000 metros (6 km)**.
   - Tiempo total máximo de entrega: **1.500 segundos (25 minutos)** desde la aceptación del pedido.
   - Capacidad estándar por motocicleta: **25 kg (25.000 gramos)**.
2. **Pedidos Pesados (> 60 kg) — Turbo Dividido:**
   - Regla estricta: Se activa únicamente cuando `totalShipmentWeightGrams > 60000` (un pedido de exactamente 60.000 g no se divide; 60.001 g sí).
   - Empaque en **unidades enteras vendibles**: Queda terminantemente prohibido fraccionar o desempacar bultos individuales (ej. un bulto de 15 kg viaja entero).
   - **Plazo común único de 25 minutos:** Todos los envíos hijos (`SHP-XXXX-1`, `SHP-XXXX-2`, ...) se despachan simultáneamente o con salida coordinada, teniendo como límite improrrogable el mismo minuto 25 contado a partir de la confirmación del pedido padre.
3. **Entregas Programadas (Vehículo de Carga / Camioneta):**
   - Cobertura metropolitana Bogotá: radio de hasta **25 km** desde los centros de distribución.
   - Franjas horarias estándar:
     - `08:00 - 11:00`
     - `11:00 - 14:00`
     - `14:00 - 17:00`
     - `17:00 - 20:00`
   - Capacidad máxima por franja: 10 pedidos por vehículo cargo.

---

## 3. ENDPOINTS Y ESPECIFICACIÓN TÉCNICA

### 3.1. Consulta de Perfil y Turno del Conductor
- **`GET /api/v1/driver/profile`**
  - Retorna información del conductor, placa, calificación y saldo de efectivo en custodia.
- **`POST /api/v1/driver/shift`**
  - **Body:** `{ "action": "START" | "END" }`
  - Inicia o finaliza el turno del conductor.

---

### 3.2. Asignaciones Activas y Soporte para Envíos Divididos
- **`GET /api/v1/driver/assignments`**
  - Retorna la asignación activa del conductor. Si el pedido es dividido, retorna el envío hijo específico asignado al conductor (`childShipment`).
  - **Estructura de respuesta:**
    ```json
    {
      "activeAssignment": {
        "orderId": "ORD-2026-9050",
        "orderNumber": "#BP-9050",
        "isSplitOrder": true,
        "shipmentId": "SHP-9050-1",
        "shipmentIndex": 1,
        "shipmentCount": 2,
        "weightKg": 30.0,
        "items": [
          {
            "productId": "prod-rc-maxi-15k",
            "name": "Royal Canin Maxi Adult Perros Grandes",
            "quantity": 2,
            "weightKg": 15.0
          }
        ],
        "cashToCollect": 732600,
        "fulfillmentStatus": "EN_CAMINO",
        "customer": {
          "name": "Natalia Cárdenas",
          "phone": "+57 310 998 7766"
        },
        "deliveryAddress": {
          "address": "Calle 3 #78-20, Kennedy Central",
          "details": "Casa 4, Manzana B",
          "porteriaPolicy": "SUBIR_A_PUERTA",
          "coordinates": { "lat": 4.6365, "lng": -74.1448 }
        }
      }
    }
    ```

---

### 3.3. Transmisión de Telemetría GPS en Vivo
- **`POST /api/v1/driver/gps`**
  - **Cadencia obligatoria:** 1 paquete cada 5 segundos mientras el pedido esté en estado `EN_CAMINO`.
  - **Body:**
    ```json
    {
      "orderId": "ORD-2026-9050",
      "shipmentId": "SHP-9050-1",
      "assignmentId": "ASG-5510",
      "tripId": "TRP-8821",
      "latitude": 4.6312,
      "longitude": -74.1485,
      "accuracy": 4.5,
      "heading": 210,
      "speed": 28.5,
      "batteryLevel": 85,
      "timestamp": 1730000000000,
      "sequenceNumber": 142
    }
    ```

---

### 3.4. Verificación de Entrega Física con PIN Secreto
- **`POST /api/v1/orders/:orderId/verify-delivery`**
  - El conductor solicita el código PIN de 4 dígitos al cliente en el momento de la entrega en portería o puerta.
  - Para pedidos divididos, se incluye `shipmentId`. Cada envío hijo posee su propio código PIN independiente para garantizar que cada entrega sea verificada individualmente.
  - **Body:**
    ```json
    {
      "deliveryCode": "4821",
      "shipmentId": "SHP-9050-1"
    }
    ```
  - **Respuestas:**
    - `200 OK`: `{ "message": "Envío 1 de 2 verificado y entregado exitosamente" }`
    - `403 Forbidden`: `{ "error": "Código de entrega inválido para el envío 1 de 2." }`

---

## 4. CONCILIACIÓN DE EFECTIVO (CASH ON DELIVERY) EN PEDIDOS DIVIDIDOS

En pedidos con forma de pago `CASH_ON_DELIVERY`:
1. El monto total a cobrar se divide proporcionalmente entre los envíos hijos con base en los productos asignados a cada viaje.
2. Cada repartidor es financieramente responsable únicamente del monto `cashToCollect` registrado en su envío hijo.
3. El orden de cobro se efectúa a medida que cada repartidor entrega sus unidades al cliente.
4. La suma de los `cashToCollect` de todos los envíos hijos coincide exactamente con el `total` del pedido padre sin discrepancias de centavos ni pesos.

---

## 5. TABLA DE ESTADOS DEL CONDUCTOR Y PEDIDOS (STATE MACHINE)

| Estado en App Conductor | Evento Disparador | Estado en Backend |
|---|---|---|
| `DISPONIBLE` | Conductor inicia turno | `DISPONIBLE` |
| `ASIGNACION_OFERTADA` | Backend asigna pedido | `REPARTIDOR_ASIGNADO` |
| `EN_RUTA_A_HUB` | Conductor acepta pedido | `REPARTIDOR_ASIGNADO` |
| `EN_TIENDA_ALISTANDO` | Conductor llega a bodega | `EN_ALISTAMIENTO` |
| `RECOGIDA_CONFIRMADA` | Precintos verificados | `EN_CAMINO` (inicia GPS) |
| `LLEGADA_A_DOMICILIO` | Proximidad < 50m al destino | `EN_CAMINO` |
| `ENTREGA_VALIDADA` | PIN del cliente validado | `ENTREGADO` |
