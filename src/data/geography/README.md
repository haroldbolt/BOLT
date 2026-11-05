# Límites oficiales de localidades de Bogotá

`bogota-localities.json` contiene las 20 geometrías de localidades
publicadas por la **Secretaría Distrital de Planeación (SDP)** a través de IDECA,
Infraestructura de Datos Espaciales para el Distrito Capital / Catastro Bogotá.

- Catálogo y atribución: https://www.ideca.gov.co/recursos/mapas/localidad-bogota-dc
- Fuente: https://serviciosgis.catastrobogota.gov.co/arcgis/rest/services/ordenamientoterritorial/localidad/MapServer/0
- Descarga realizada el **2 de noviembre de 2026**:
  https://serviciosgis.catastrobogota.gov.co/arcgis/rest/services/ordenamientoterritorial/localidad/MapServer/0/query?where=1%3D1&outFields=LOCCODIGO%2CLOCNOMBRE&outSR=4326&returnGeometry=true&f=geojson
- Licencia indicada en el catálogo: **Creative Commons Attribution 4.0**,
  https://creativecommons.org/licenses/by/4.0/
- Sistema de referencia: EPSG:4326 / WGS84; orden GeoJSON **longitud, latitud**.
- Extensión publicada: oeste −74.449779528, sur 3.731030342,
  este −73.986534278, norte 4.836779095.
- SHA-256 del archivo conservado:
  `86de5ec6069dbb4356775b2612d33513791b090f1c076e11033f474d2af4220f`
- SHA-256 del GeoJSON original compactado, antes del redondeo:
  `581db3d811f168388956635afa843e15056358be9fff733406d59cccf521ced3`

Se descargaron los campos `LOCCODIGO`, `LOCNOMBRE` y las geometrías completas.
Se compactó el JSON y se redondearon las coordenadas a **7 decimales**
(desplazamiento máximo de cada componente: 0,00000005°, aproximadamente
0,6 cm). Se conservan todos los vértices y anillos;
no se simplificaron polígonos ni se sustituyeron por cajas o límites inventados.
Esto reduce el archivo de 2.181.667 a 1.377.979 bytes (36,8%), y su gzip
de 620.953 a 368.597 bytes. El margen de frontera del clasificador es mayor
que el desplazamiento del redondeo.
Los códigos de dos dígitos son los identificadores oficiales de localidad.
La interfaz de Bolt adapta los nombres a sus códigos internos y tildes.

Los polígonos incluyen territorio rural. Este archivo **identifica localidades**;
no declara cobertura, cupos, inventario ni accesibilidad de rutas. Esas decisiones
corresponden a la política de entregas y deben mantener sus otras restricciones.
En particular, conservar Sumapaz en el mapa permite reconocerla y excluirla de
envío programado explícitamente.

La clasificación se ejecuta localmente, sin enviar ubicaciones a terceros ni
consultar servicios cartográficos durante cada pedido. Los puntos sobre límites,
solapamientos o fuera de Bogotá devuelven ubicación no resuelta. Santa Fe tiene
un anillo interior que debe respetarse para identificar La Candelaria.

Para actualizar: descargar de nuevo la consulta oficial, verificar exactamente
20 localidades/códigos únicos, proyección, extensión y geometrías; actualizar
fecha/hash y ejecutar las pruebas geográficas y de cobertura antes de usarla.
