# Bolt Pets Colombia — Plataforma Integrada de Domicilios Turbo y Programados

Plataforma full-stack de comercio electrónico y operaciones logísticas para la entrega ultra-rápida (Turbo en ≤ 25 min y radio de 6 km) y programada de alimentos, farmacia veterinaria y accesorios para mascotas en Bogotá, Colombia.

## Arquitectura y Componentes
- **Frontend**: React 19 SPA con Vite y Tailwind CSS v4.
- **Backend**: Servidor Express modular (`server.ts`) con middlewares de Vite en desarrollo y API REST `/api/v1/*`.
- **Zonas Horarias y Moneda**: Zona horaria oficial `America/Bogota` (GMT-5) y moneda Pesos Colombianos (`$ COP`).
- **Mapeo y Rutas**: Google Maps Platform (`@vis.gl/react-google-maps`) con geocodificación, cálculo de distancias geodésicas (Haversine) y estimación de ruta vial para motocicletas.

## Bodegas de Despacho (Hubs)
1. **Bolt Pets Kennedy** (`HUB_KENNEDY`): Carrera 79A #2-05, Bogotá (`gid://shopify/Location/115617857816`).
2. **Bolt Pets Álamos** (`HUB_ALAMOS`): Calle 72 #97A-18, Bogotá (`gid://shopify/Location/115617890584`).
3. **Bolt Pets Suba** (`HUB_SUBA`): Carrera 107 #143-31, Bogotá (`gid://shopify/Location/115617923352`).
4. **Sede Centro** (`HUB_CENTRO`): Calle 11 #15-53. Excluida de la red Turbo inicial, preservada para operaciones administrativas y envíos programados tradicionales.

## Reglas de Negocio
- **Turbo**: Radio máximo de 6.000 metros (6 km) y tiempo de entrega estimado ≤ 25 minutos (1.500 segundos).
- **Turbo Dividido**: Pedidos elegibles cuyo peso total supera los 60 kg son particionados automáticamente en múltiples envíos de motocicletas (≤ 25 kg c/u) con plazo común de 25 min.
- **Envíos Programados**: Tres franjas oficiales:
  - Horario 1: 09:00–14:00 (Corte el mismo día: 10:00).
  - Horario 2: 14:00–18:00 (Corte el mismo día: 12:00).
  - Horario 3: 18:00–22:00 (Corte el mismo día: 16:00).
- **Inventario Desacoplado**: Cada sede administra de forma independiente sus cantidades físicas (`onHand`), comprometidas (`committed`), reservadas (`reservedBolt`), stock de seguridad (`safetyStock`) y vendibles (`sellable`). Sin suplantación ni robo entre bodegas.
- **Integración Shopify**: Agrocentro Pets (`1c76bc-08.myshopify.com` / `cultivacenter.com`) en modo de solo lectura (`read_products`, `read_inventory`, `read_locations`).
