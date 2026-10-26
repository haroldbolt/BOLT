# Bolt Pets — Bodegas Independientes, Calibración de Entrada en Google Maps y Sincronización Shopify

Implementación de tres bodegas operativas con inventario estrictamente independiente (Kennedy, Álamos, Suba), exclusión de Sede Centro de la red Turbo, calibración de entrada física vehicular mediante Google Maps Platform con recálculo inmediato de rutas, integración de solo lectura con Shopify (`1c76bc-08.myshopify.com` / `cultivacenter.com`) y simulador interactivo de webhooks para pruebas seguras.

## User Review & Critical Decisions

> [!IMPORTANT]
> Se han adoptado las decisiones de arquitectura confirmadas por el usuario:
> - **Visualización en Cabecera Turbo**: Se preserva el indicador Turbo limpio y enfocado según la referencia visual adjunta (`IMG_2741`): `⚡ Entrega en X min` cuando Turbo está seleccionado, o `Envío programado` con calendario cuando aplica, sin saturar con nombres de bodega.
> - **Simulador de Webhooks de Shopify**: Se agrega un botón interactivo en la pestaña **SHOPIFY** del panel operativo (`/operacion`) para simular eventos entrantes `inventory_levels/update`, permitiendo verificar en vivo cómo cambia el stock de una bodega específica sin alterar la tienda de producción en Shopify.
> - **Recálculo Inmediato de Rutas**: Al ajustar y guardar el pin de entrada vehicular en Google Maps, el sistema notifica y recalcula de inmediato las rutas viales, la distancia real y el ETA de entrega tanto en el panel como en la vista del cliente.

## 1. Overview & Core Concept

- **Qué hace**: Establece una separación física y digital completa de las tres bodegas Turbo de Bogotá (Kennedy, Álamos y Suba) con existencias reales no compartidas, puntos de entrada de despacho calibrados en mapa vectorial para cálculo de rutas de motocicletas, y sincronización segura de solo lectura con la tienda Shopify de Agrocentro Pets.
- **Audiencia objetivo**: Operadores logísticos de Bolt Pets, coordinadores de bodega, conductores de despacho y clientes finales en Bogotá.
- **Valor clave**: Elimina por completo las ventas de inventario inexistente (evita roturas de stock y compras cruzadas no autorizadas), optimiza el cálculo del tiempo de entrega de 25 minutos desde el portón real de salida de los domiciliarios, y prepara la tienda para integrarse con Shopify de forma segura y auditable.

## 2. User Experience & Visual Design

- **Flujo en el Panel de Operaciones (`/operacion`)**:
  - **Pestaña BODEGAS**:
    - Selector individual para inspeccionar Kennedy, Álamos y Suba (o vista consolidada).
    - Mapa de Google Maps con dos pines diferenciados: azul para la dirección postal de Shopify y verde arrastrable para el portón de despacho vehicular.
    - Alarma visual si la entrada física se separa más de 200 m de la dirección postal.
    - Botón *"Guardar Punto de Despacho Verificado"* que audita fecha (`America/Bogota`), usuario y coordenadas exactas, disparando el recálculo dinámico de rutas.
    - Tabla de existencias independientes (Físico, Comprometido, Reservado Bolt, Stock de Seguridad y Venta Neta).
    - Cola de picking local de esa sede y control de saturación/pausa de Turbo independiente.
  - **Pestaña SHOPIFY**:
    - Indicador de estado de conexión: *“Sin configurar”*, *“Pendiente de autorización”*, *“Conectado”*, *“Sincronizando”*, *“Error de sincronización”*.
    - Guía paso a paso para el propietario en español colombiano para configurar la app en Shopify Dev Dashboard (`read_products`, `read_inventory`, `read_locations`).
    - Tabla de mapeo de sedes físicas con sus `Location GID` oficiales.
    - Botón de conciliación manual periódica de inventario.
    - **Simulador Interactivo de Webhooks**: Botón para simular la recepción de un webhook `inventory_levels/update` de una variante específica en una sede seleccionada, mostrando el registro de auditoría y la actualización instantánea del inventario sin tocar Shopify real.

- **Flujo en la Aplicación del Cliente (`/`)**:
  - Preserva íntegramente la estética de la referencia adjunta (`IMG_2741`): cabecera verde esmeralda con indicador dinámico de tiempo Turbo, carrusel de categorías collage, barra de beneficios dorada (`100% OFF en Tarifa de Servicio`) y navegación inferior flotante.
  - El cliente compra exclusivamente el inventario disponible en la sede asignada automáticamente. Si un producto está agotado en Kennedy, se muestra *"Agotado en esta sede"* sin sustituciones ficticias desde Suba.

## 3. Key Product Decisions & Trade-Offs

- **Decisión 1: Aislamiento Total de Bodegas**:
  - *Enfoque*: Cada bodega maneja su propio registro de stock `stockByStore[storeId]`. Una venta en Kennedy nunca disminuye el inventario en Suba ni en Álamos.
  - *Por qué*: Refleja la realidad operativa de tres almacenes físicos separados en Bogotá.
- **Decisión 2: Sede Centro Excluida de Turbo**:
  - *Enfoque*: `HUB_CENTRO` mantiene `turboEnabled: false`. Se conserva en la base de datos para operaciones administrativas y envíos tradicionales, sin interferir en la red Turbo inicial de 3 hubs.
- **Decisión 3: Modo Solo Lectura de Shopify con Simulador Local**:
  - *Enfoque*: Ningún pedido de prueba ni ajuste local modifica el inventario real de producción en Shopify hasta que el propietario otorgue autorización explícita para flujos de escritura. Las pruebas se ejecutan de manera transparente con el simulador de webhooks y reservas locales.

## 4. Technical Architecture & Data Strategy

```
┌────────────────────────────────────────────────────────────────────────┐
│                        Shopify Admin API                               │
│  Agrocentro Pets (1c76bc-08.myshopify.com / cultivacenter.com)         │
│  GraphQL 2025-01 (read_products, read_inventory, read_locations)       │
└──────────────────────────────────┬─────────────────────────────────────┘
                                   │  (Webhooks / Sincronización)
                                   ▼
┌────────────────────────────────────────────────────────────────────────┐
│                    Bolt Pets Backend (server.ts)                       │
│                                                                        │
│  - POST /api/v1/stores/:id/verify-entrance (Guarda coordenadas portón) │
│  - GET  /api/v1/shopify/status (Estado conexión y mapeo GIDs)          │
│  - POST /api/v1/shopify/sync (Conciliación periódica)                  │
│  - POST /api/v1/shopify/webhook (Procesador webhooks con firma HMAC)   │
│  - POST /api/v1/shopify/simulate-webhook (Simulador para pruebas)      │
└──────────────────┬──────────────────────────────────┬──────────────────┘
                   │                                  │
                   ▼                                  ▼
┌───────────────────────────────────┐ ┌──────────────────────────────────┐
│   WarehouseManagerTab.tsx         │ │    ShopifySyncTab.tsx            │
│                                   │ │                                  │
│ - Mapa Google Maps con pin verde  │ │ - Estado de conexión             │
│   arrastrable para entrada        │ │ - Guía paso a paso propietario   │
│ - Alerta discrepancia > 200m      │ │ - Tabla Location GID y SKUs      │
│ - Inventario desacoplado por SKU  │ │ - Botón sincronización manual    │
│ - Cola de picking local           │ │ - Simulador interactivo webhooks │
└───────────────────────────────────┘ └──────────────────────────────────┘
```

### Componentes y Tareas Concretas:
1. **`server.ts`**:
   - Agregar endpoint `POST /api/v1/shopify/simulate-webhook` que procesa un evento sintético `inventory_levels/update` para una sede y SKU dados.
2. **`src/lib/api.ts` & `src/lib/shopifyService.ts`**:
   - Agregar método `simulateShopifyWebhook(storeId, sku, newAvailableQuantity)` para disparar la prueba desde la UI.
3. **`src/components/operations/ShopifySyncTab.tsx`**:
   - Incorporar el módulo visual de simulación de webhooks con selector de sede, selector de SKU, campo de nueva cantidad y botón *"Simular Webhook de Shopify"*, mostrando la respuesta en tiempo real.
4. **`src/components/operations/WarehouseManagerTab.tsx`**:
   - Asegurar que al guardar la entrada verificada, se emita un evento de recálculo global de rutas para actualizar la cotización activa de entrega.
5. **Pruebas Automatizadas**:
   - Expandir `src/tests/deliveryQuote.test.ts` para verificar la recepción y procesamiento de webhooks simulados y el recálculo dinámico.
   - Ejecutar suite de pruebas (garantizar 100% PASS), `lint_applet` y `compile_applet`.
   - Entregar el informe en español colombiano respondiendo los 7 puntos de la Sección 12 junto con el apéndice obligatorio de Google Maps Platform.
