# Cobertura urbana: fuentes y actualización

Estos archivos son datos geográficos públicos, leídos únicamente por el servidor mediante `serverGeography.ts`. No contienen pedidos, inventario ni ubicaciones privadas de clientes. Coordenadas EPSG:4326, orden GeoJSON `[longitud, latitud]`. Se conservan las geometrías completas, incluidos sus huecos; no se aproximan mediante radios.

Consultados el 6 de noviembre de 2026:

- `localities.json`: 20 localidades. Catastro Distrital / IDECA, campo `LOCNOMBRE`: https://serviciosgis.catastrobogota.gov.co/arcgis/rest/services/Mapa_Referencia/mapa_base_3857/MapServer/4
- `urban-soil.json`: cinco geometrías de clasificación `SUECSUELO=1` (Área urbana). Secretaría Distrital de Planeación, POT Decreto 555 de 2021: https://serviciosgis.catastrobogota.gov.co/arcgis/rest/services/ordenamientoterritorial/suelo/MapServer/0
- `soacha-urban.json`: 21 polígonos de usos del suelo urbano de Soacha, POT 2000, publicados por Gobernación de Cundinamarca / IDER. Fuente y metadatos: https://www.arcgis.com/home/item.html?id=5642371f0a3a4a1c8e66a1654330df6c ; servicio: https://services7.arcgis.com/lsxbLWF2l19Rmhqj/arcgis/rest/services/7_2_Uso_suelo_urbano_magna/FeatureServer/0

Soacha se habilita únicamente en la intersección de esos polígonos urbanos con la zona que ya tenía configurada BOLT (`lat 4.540–4.605`, `lng -74.240–-74.195`). Esta corrección no amplía esa zona. Fuera de ella se conserva la exclusión. La cartografía de Soacha es histórica: ampliar o actualizar su zona requiere revisar el instrumento territorial vigente y una decisión de cobertura operativa.

La asignación de las 19 localidades cubiertas sigue centralizada en `src/lib/territoryConfig.ts`, con los IDs existentes `HUB_KENNEDY`, `HUB_ALAMOS`, `HUB_SUBA`. Sumapaz y suelo no urbano se excluyen expresamente. Las coordenadas del destino prevalecen sobre nombres de barrio o localidad escritos por el cliente; nunca se utiliza la ubicación del teléfono.

Para actualizar manualmente los snapshots: `node scripts/update-coverage-geography.mjs`. Revisar los cambios de geometría y ejecutar `npm test` antes de adoptar la nueva cartografía. El script rechaza respuestas truncadas o vacías y escribe solo después de validar todas las descargas. Mantener la atribución de las fuentes oficiales y sus condiciones de reutilización.

## Dirección de regresión verificable

Calle 150 #16-56, Centro Comercial Cedritos 151, Usaquén. Coordenadas del fixture obtenidas de Google Maps Geocoding: `4.731531, -74.041785`. Verificación independiente de dirección y localidad en Registraduría (coordenada de puesto electoral `4.731578892040405, -74.04140919698529`): https://www.registraduria.gov.co/IMG/pdf/2025_divipole_congreso_corte_2025-09-17.pdf . Sitio del centro comercial: https://www.cedritos151oficial.com/ . Las dos coordenadas corresponden a referencias diferentes del mismo establecimiento y no se sustituyen por estimaciones de una cuadrícula.

Los fixtures de `src/tests/coverage-address-fixtures.json` conservan la respuesta real del proveedor anterior a la corrección. Por eso el fixture Chía refleja el antiguo municipio erróneo `Bogotá D.C.`; la validación geométrica del servidor lo rechaza correctamente. Las pruebas de asignación por nombre y de límite de ETA son fixtures de unidad explícitos, no domicilios reales inventados.
