# Cambio Automático Inteligente entre Turbo y Envío Programado

Sistema de alternancia automática entre entregas rápidas (Turbo / Turbo Dividido hasta 25 min) y Envío Programado según la localidad real de Bogotá (Kennedy, Suba y Engativá para Turbo; resto de Bogotá para Programado) y condiciones operativas, abriendo el selector de franjas horarias con mensaje de continuidad y sincronizando la cabecera y el checkout en tiempo real.

### User Review & Critical Decisions

> [!IMPORTANT]
> **Decisiones confirmadas en la fase de clarificación:**
> - **Apertura de selector de franja**: Al detectar que la dirección no aplica para Turbo o está fuera de Kennedy/Suba/Engativá, se activa inmediatamente el modal/selector de fechas y franjas con el mensaje explicativo: *"Para esta dirección, continuamos con envío programado. Elige cuándo recibir tu pedido"*, sin estados de rechazo ni callejones sin salida.
> - **Validación de localidad**: Detección combinada mediante coordenadas georreferenciadas (polígonos y cuadrícula de Bogotá) y análisis del texto de la dirección, con confirmación visual de la localidad en el modal de dirección.

---

### 1. Overview & Core Concept

- **Qué hace**: Evalúa en cliente y servidor la elegibilidad de entrega para cualquier dirección en Bogotá.
  - Si la dirección se ubica en **Kennedy, Suba o Engativá** Y cumple con el radio $\le$ 6 km, tiempo $\le$ 25 min, peso y stock: habilita **Turbo** (o **Turbo Dividido** si el pedido supera 60 kg en unidades enteras).
  - Si la dirección se ubica en **cualquier otra localidad de Bogotá** (Usaquén, Chapinero, Teusaquillo, Fontibón, Santa Fe, etc.) O si Turbo no está disponible en las 3 localidades permitidas (por distancia > 6 km, tiempo > 25 min o inventario): conmuta automáticamente a **Envío Programado** sin rechazar al cliente ni perder el carrito.
- **Mensaje de continuidad**: Presenta *"Para esta dirección, continuamos con envío programado. Elige cuándo recibir tu pedido"* y despliega las franjas vigentes de Bogotá.
- **Franjas autoritativas**:
  - `09:00–14:00` (corte a las 10:00 a. m.)
  - `14:00–18:00` (corte a las 12:00 m.)
  - `18:00–22:00` (corte a las 4:00 p. m. / 16:00)
  - Solo franjas vigentes con cupo; si hoy vencieron los cortes, ofrece automáticamente mañana y días siguientes.
- **Sincronización total**: Cabecera, modal de dirección, barra flotante y checkout reflejan de inmediato la modalidad activa, fecha, franja horaria seleccionada y costo de envío.

---

### 2. User Experience & Visual Design

#### Key User Flows
1. **Flujo dentro de localidades Turbo (Kennedy, Suba, Engativá)**:
   - El cliente ingresa o mueve el pin a una dirección en Kennedy, Suba o Álamos/Engativá.
   - El cotizador detecta la localidad Turbo autorizada y evalúa la bodega más cercana.
   - Si $\le$ 6 km y $\le$ 25 min, mantiene la modalidad **Turbo** (⚡ hasta 25 min).
   - En el encabezado y checkout se visualiza la promesa Turbo en minutos.

2. **Flujo fuera de localidades Turbo (ej. Usaquén, Chapinero, Centro, Fontibón)**:
   - El cliente selecciona o escribe una dirección en una localidad no-Turbo de Bogotá.
   - El sistema detecta la localidad y activa el cambio automático a **Envío Programado**.
   - No se muestra ningún error de "fuera de cobertura", sino el banner suave:
     *"Para esta dirección, continuamos con envío programado. Elige cuándo recibir tu pedido"*.
   - Se abre el selector interactivo de fechas y franjas horarias vigentes.
   - El cliente elige su franja con un clic y confirma.
   - El encabezado actualiza inmediatamente el badge: *"Envío Programado: Hoy 2:00–6:00 p. m."* (o la fecha elegida).

3. **Flujo de contingencia en Kennedy/Suba/Engativá si Turbo no está disponible**:
   - Si la dirección está en Kennedy pero el tráfico proyectado excede 25 min o no hay stock local para despacho inmediato:
   - Conmuta fluidamente a **Envío Programado** con el mismo mensaje amigable.

4. **Flujo de Checkout**:
   - Al abrir el carrito y el checkout, el resumen de despacho muestra la modalidad activa (Turbo vs Programado), la franja elegida con opción de modificarla rápidamente, y la tarifa de envío correspondiente ($0 para compras $\ge \$70.000$ o tarifa estándar).

#### Visual Identity & Theme (Frontend Design Constitution)
- **Cero pantallas de error o bloqueo**: Se eliminan diálogos de callejón sin salida; la experiencia siempre guía a una solución de entrega viable.
- **Tipografía y Jerarquía**: Display en `Plus Jakarta Sans`, datos numéricos y horarios en `font-mono tabular-nums`.
- **Feedback visual**: Tarjetas de franjas con indicador de disponibilidad, cuenta regresiva sutil (*"⏰ Últimos 35 minutos"*) para cortes inminentes, y badge de localidad validada (*"Localidad: Usaquén · Cobertura Programada"*).

---

### 3. Key Product Decisions & Trade-Offs

- **Detección y Validación de Localidad Híbrida**:
  - *Enfoque*: Implementar una función autoritativa `detectBogotaLocality(coordinates, addressText)` compartida entre cliente y servidor.
    - Utiliza límites geográficos precisos de las 20 localidades del Distrito Capital de Bogotá.
    - Complementa con coincidencia de texto (regex para "Kennedy", "Suba", "Engativá", "Álamos", "Normandía", "Chapinero", "Usaquén", etc.).
    - En el servidor, extrae además el componente `sublocality_level_1` del geocodificador de Google Maps si está presente.
  - *Por qué*: Garantiza que las reglas de negocio sean infalibles sin requerir que el usuario llene formularios complejos.

- **Persistencia del Carrito y Dirección**:
  - *Enfoque*: El cambio de modalidad no resetea los productos en el carrito ni limpia la dirección ni las notas de entrega.
  - *Por qué*: Evita la frustración del cliente y maximiza la tasa de conversión.

- **Gestión de Franjas Horarias en Tiempo Real**:
  - *Enfoque*: Regla estricta basada en la hora local oficial de Bogotá (`America/Bogota`).
    - Horario 1 (9–14): oculta para hoy a las 10:00 a. m.
    - Horario 2 (14–18): oculta para hoy a las 12:00 m.
    - Horario 3 (18–22): oculta para hoy a las 4:00 p. m. (16:00).
    - Si todas las franjas de hoy cerraron: pasa automáticamente a "Mañana" y días subsiguientes.

---

### 4. Technical Architecture & Data Strategy

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                       Cliente Web (React + Vite)                            │
│                                                                             │
│  State en App.tsx:                                                          │
│  - customerAddress, customerCoordinates                                     │
│  - selectedDeliveryMode ('TURBO' | 'PROGRAMADO' | 'TURBO_DIVIDIDO')        │
│  - selectedScheduledWindow (ScheduledDeliveryWindow)                        │
│  - deliveryQuote (DeliveryQuote)                                            │
│                                                                             │
│  Validación y Auto-Switch:                                                  │
│  - detectBogotaLocality(coords, address)                                    │
│  - isTurboLocality: ['KENNEDY', 'SUBA', 'ENGATIVA'].includes(loc)           │
│  - Si !isTurboLocality o quote.availableModes.turbo === false:              │
│      -> autoSwitchToScheduled(quote, triggerModal = true)                  │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │ POST /api/v1/delivery/quote
                                       │ POST /api/v1/orders
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                       Servidor Express (server.ts)                          │
│                                                                             │
│  1. /api/v1/delivery/quote:                                                 │
│     - Ejecuta evaluateDeliveryQuote con validación de localidad Bogotá     │
│     - Restringe turbo y turboDividido exclusivamente a Kennedy, Suba y      │
│       Engativá. Para otras localidades retorna recommendedMode: PROGRAMADO │
│     - Retorna franjas vigentes de generateScheduledSlots(now)              │
│                                                                             │
│  2. /api/v1/orders:                                                         │
│     - Valida consistencia de localidad en la dirección                      │
│     - Para PROGRAMADO valida corte horario estricto y capacidad <= 10      │
│     - Transacción de reserva de inventario local                            │
└─────────────────────────────────────────────────────────────────────────────┘
```

#### Cambios en Archivos del Proyecto
1. **`src/lib/deliveryService.ts`**:
   - Incorporar `TURBO_ALLOWED_LOCALITIES = ['KENNEDY', 'SUBA', 'ENGATIVA']`.
   - Implementar `detectBogotaLocality(coords, addressText)`.
   - Modificar `evaluateDeliveryQuote`:
     - Si la localidad detectada no está en `TURBO_ALLOWED_LOCALITIES`, forzar `availableModes.turbo = false`, `availableModes.turboDividido = false`, `availableModes.scheduled = true`, `recommendedMode = 'PROGRAMADO'`.
     - Devolver mensaje oficial de transición: *"Para esta dirección, continuamos con envío programado. Elige cuándo recibir tu pedido"*.
     - Asegurar la hora y cortes exactos en `generateScheduledSlots` y `validateScheduledBooking`.
2. **`server.ts`**:
   - Utilizar las nuevas reglas de localidad en `/api/v1/delivery/quote` y `/api/v1/orders`.
3. **`src/components/customer/AddressConfirmationModal.tsx`**:
   - Integrar la detección y visualización de la localidad de Bogotá.
   - Al detectar cambio automático hacia Programado, mostrar el banner explicativo amigable y conectar con la selección de franjas.
4. **`src/components/customer/ScheduledDeliveryModal.tsx`** (o selector dedicado):
   - Modal/selector con banner explicativo, selector de fecha (Hoy, Mañana, Días futuros) y las 3 franjas con cuenta regresiva.
5. **`src/App.tsx`**:
   - Control centralizado del cambio de modalidad, persistencia del carrito y dirección, y actualización inmediata de la cabecera.
6. **`src/components/customer/Header.tsx` & `src/components/customer/CheckoutModal.tsx`**:
   - Reflejar inmediatamente la modalidad activa, fecha, franja y costo de envío sin pantallas de rechazo.
