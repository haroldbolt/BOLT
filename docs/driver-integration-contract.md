# BOLT CONDUCTOR — CONTRATO DE INTEGRACIÓN BACKEND Y ANDROID
**Versión:** 1.0.0 (Release Kennedy-Bogotá)  
**Entorno Autorizado:** Privado / Pre-producción  
**Zona Horaria:** America/Bogota  
**Moneda:** COP (Pesos Colombianos)

---

## 1. INTRODUCCIÓN Y ALCANCE
Este documento define el contrato de integración técnico entre el backend unificado de **Bolt Pets** y la aplicación nativa Android independiente **Bolt Conductor**.

La aplicación del conductor es parte integral del sistema operativo logístico de Bolt Pets. Su función es permitir a los repartidores de la flota propia recibir pedidos asignados, confirmar alistamiento y recogida en tienda, transmitir telemetría GPS continua durante entregas activas, reportar novedades e incidencias, y validar la entrega física mediante código secreto de seguridad proporcionado por el cliente.

---

## 2. CONFIGURACIÓN Y CREDENCIALES DEL SERVICIO
- **Servidor Base API:** `/api/v1` (relativo a la URL de despliegue `APP_URL`)
- **Autenticación:** Bearer Token JWT en cabecera HTTP `Authorization: Bearer <token_conductor>`
- **Firebase Auth & Firestore:**
  - `projectId`: Proyecto configurado en Firebase (ver `metadata.json` / configuración del entorno)
  - `databaseId`: `(default)`
  - Colección Autorizada de Telemetría: `/trips/{tripId}/telemetry`
  - Colección de Asignaciones: `/assignments/{assignmentId}`
  - Colección de Pedidos: `/orders/{orderId}`

---

## 3. CICLO DE VIDA DE LA ASIGNACIÓN Y VIAJE (STATE MACHINE)
```
[Oferta enviada] 
       │
       ├──► [Rechazada / Expirada (90s)] ──► Reasignación a siguiente conductor
       ▼
  [Aceptada] 
       ▼
 [Llegada a Sede / Hub] 
       ▼
 [Recogida Verificada (Pick-up)] ──► Inicio de transmisión GPS activa (cadencia 5s)
       ▼
 [En camino al Cliente] 
       ▼
 [Llegada a Dirección de Entrega] 
       ▼
 [Validación de Código Secreto del Cliente] 
       ▼
 [Entregado Exitosamente] ──► Cierre de sesión GPS y liquidación de efectivo
```

---

## 4. REGLAS DE TELEMETRÍA GPS Y PRIVACIDAD
1. **Cadencia de Transmisión:**
   - En movimiento: 1 posición cada **5 segundos**.
   - En detención / semáforo: 1 posición cada **15 segundos**.
2. **Detección de Señal:**
   - **Normal:** Señal recibida hace menos de 30 segundos.
   - **Desactualizada (Stale):** Sin reporte entre 30 y 60 segundos.
   - **Pérdida de Señal (Lost):** Más de 60 segundos sin actualización.
3. **Privacidad del Conductor y Cliente:**
   - La ubicación del conductor SOLO se transmite al cliente mientras el pedido esté en estado `EN_CAMINO`.
   - Tan pronto como la entrega finaliza o se cancela, se revoca inmediatamente el acceso del cliente al flujo de ubicación del conductor.
   - Durante turnos fuera de servicio, no se recolecta telemetría.
4. **Farmacia Veterinaria:**
   - El conductor visualiza sellos de seguridad, rótulos de fragilidad y temperatura recomendada, pero **NUNCA** tiene acceso al historial clínico ni a las imágenes de fórmulas veterinarias del cliente.

---

## 5. CATÁLOGO DE ENDPOINTS REST `/api/v1/driver`

### 5.1 Perfil y Estado de Turno
- `GET /api/v1/driver/profile`: Retorna datos del conductor, vehículo, capacidad máxima en kg y calificación.
- `POST /api/v1/driver/shift`: Inicia o finaliza turno (`{ "action": "START" | "END", "hubId": "HUB_KENNEDY" }`).

### 5.2 Asignaciones
- `GET /api/v1/driver/assignments`: Consulta asignaciones activas u ofertas pendientes.
- `POST /api/v1/driver/assignments/:assignmentId/accept`: Acepta la asignación (atómica; falla si ya expiró o fue reasignada).
- `POST /api/v1/driver/assignments/:assignmentId/reject`: Rechaza con motivo opcional.
- `POST /api/v1/driver/assignments/:assignmentId/arrived-hub`: Notifica llegada al hub de despacho.
- `POST /api/v1/driver/assignments/:assignmentId/pickup`: Confirma recogida física del paquete tras verificar número de bultos y precintos.

### 5.3 Telemetría GPS en Vivo
- `POST /api/v1/driver/gps`:
  ```json
  {
    "orderId": "ORD-2026-8941",
    "assignmentId": "ASG-5510",
    "tripId": "TRP-8821",
    "latitude": 4.6284,
    "longitude": -74.1539,
    "accuracy": 4.2,
    "heading": 185.0,
    "speed": 28.5,
    "batteryLevel": 85,
    "timestamp": 1729789320000,
    "sequenceNumber": 142
  }
  ```

### 5.4 Entrega y Código Secreto
- `POST /api/v1/driver/assignments/:assignmentId/delivered`:
  ```json
  {
    "deliveryCode": "4892",
    "recipientNotes": "Entregado a Juan en portería",
    "photoEvidenceUrl": null
  }
  ```
  *Nota Crítica:* El servidor valida `deliveryCode`. Si el código es incorrecto, la entrega es rechazada. El conductor no conoce el código de antemano.

### 5.5 Novedades e Incidencias
- `POST /api/v1/driver/assignments/:assignmentId/incident`:
  Permite reportar: `CLIENTE_NO_RESPONDE`, `DIRECCION_ERRONEA`, `PINCHAZO_VEHICULO`, `PAQUETE_DANADO`.

### 5.6 Recaudo y Liquidación de Efectivo (COD)
- `GET /api/v1/driver/settlement`: Resumen de dinero en efectivo recaudado pendiente de consignar en sede.

---

## 6. VERIFICACIÓN FÍSICA EN DISPOSITIVO ANDROID
Para homologar la aplicación nativa en pruebas de campo:
1. Conectar dispositivo Android con Google Play Services activados.
2. Iniciar sesión con credenciales de prueba (`conductor1@boltpets.co`).
3. Verificar que la pantalla de bloqueo o segundo plano mantiene el servicio foreground `LocationCallback` con notificación persistente.
4. Validar que la latencia entre envío de coordenadas GPS y refresco en el mapa web del cliente sea inferior a 2 segundos.
