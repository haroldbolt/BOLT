# Fotografías del catálogo — revisión del 7 de noviembre de 2026

## Resultado y alcance

Se auditó la estructura de 3.853 productos y 5.667 presentaciones del catálogo local, incluidos 8 productos de simulación existentes. Se consultó Shopify de solo lectura: 3.830 productos, todas sus variantes y galerías, sin paginación pendiente. Se comprobaron por HTTP y firma de archivo 4.799 URLs distintas: todas respondieron con imágenes. Esto **no demuestra por sí solo** que cada empaque sea correcto.

Se inspeccionaron visualmente 49 imágenes. Se retiraron las fotos genéricas de los 15 productos semilla; 7 recibieron fotos verificadas (NexGard Spectra 7,5–15 kg, Bravecto 10–20 kg, Simparica Trio 5–10 kg, FortiFlora caja x30, Churu atún/pollo pack x4, OdourLock sin olor 12 kg y Royal Canin Maxi Adult). La imagen de Royal Canin no muestra un peso impreso legible: la presentación de 15 kg se cotejó con la variante de Shopify y el formato del fabricante. No se afirma que ninguna foto sea el empaque más reciente.

Se detectaron diferencias reales: Apoquel x10 ilustrado con caja masticable x20, FortiFlora de un sobre ilustrado con caja x30 y Churu de 14 g ilustrado con paquete x4. Esas fotografías no se reutilizan para la presentación individual. Simparica Trio >40–60 kg se vinculó con su foto específica de la galería, leída visualmente.

El lote local aplicó metadatos de imagen a 544 productos, incluidos 8 productos ficticios ya existentes. No son 544 fotos nuevas: la mayor parte de cambios elimina herencias ambiguas entre presentaciones. El plan versionado excluye los 8 productos ficticios y contiene 536 productos del catálogo base. El retiro de otras fotos semilla queda en `seedData.ts`.

El CSV principal contiene 9.520 registros (principal + variante): 85 con comprobación visual registrada, 24 originalmente genéricos/ajenos, 11 con presentación incorrecta, 4 originalmente sin foto y 9.396 pendientes de verificación visual detallada. Existen 1.413 campos de imagen vacíos que se muestran como **Imagen por confirmar**. Se conservaron las fotografías existentes vinculadas al mismo ID de Shopify cuando no se detectó una contradicción. No se presenta esa conservación como certificación visual exhaustiva.

## Comportamiento

- `ProductImage` muestra el empaque completo (`object-contain`), rechaza URLs conocidas de demostración y sustituye errores por un marcador accesible sin reintentos recursivos.
- Una variante con fotografía pendiente no hereda silenciosamente el envase de otra presentación.
- `CategoryCollageCard` usa productos activos de la categoría, elimina URLs repetidas, adapta el mosaico a 1–4 imágenes y prueba la siguiente candidata si una falla. Sin candidatas conserva el enlace, conteo e icono neutro.
- Administración permite seleccionar imagen principal o variante por ID/SKU, subir una fotografía o elegir una ya existente en la galería. El selector muestra la foto de esa variante.
- Se limita el montaje inicial a 48 tarjetas y se añaden otras con **Ver más productos**; las secciones horizontales muestran hasta 12. La búsqueda, filtros y conteos siguen usando el catálogo completo. Esto corrige el bloqueo del navegador observado al montar miles de tarjetas.
- Se conserva la clasificación de categorías del catálogo actual. Algunas asignaciones preexistentes necesitan una revisión de taxonomía independiente; no se cambiaron productos de categoría durante este ajuste de fotografías.

## Persistencia y aplicación

La autoridad sigue siendo `CatalogRepository`, con almacenamiento en `src/data/persisted-catalog-overrides.json`. `variantImages` es un mapa de sobrescrituras de foto por ID de variante; no sustituye la variante ni sus datos comerciales.

`POST /api/v1/admin/catalog/images/apply` exige la sesión administrativa existente (`Authorization: Bearer ...`). Admite exclusivamente producto, cambios de imagen/galería/variantes, fuente, fecha y motivo. No acepta precios ni inventario. Comprueba los valores anteriores para detectar ediciones simultáneas, valida todo el lote antes de escribir, persiste mediante renombrado atómico y registra `SET_IMAGE`. Un reintento idéntico devuelve `changed: 0`.

Para aplicar el plan en otra instalación, revisar primero las fuentes y detener su servidor para respetar el bloqueo de escritor único:

```sh
node --import tsx scripts/catalog-images.ts check src/data/catalog-image-corrections.json
BOLT_IMAGE_ACTOR='Operador autorizado' node --import tsx scripts/catalog-images.ts apply src/data/catalog-image-corrections.json
```

No ejecutarlo junto a otro servidor escritor del mismo archivo. Una discrepancia con una fotografía editada recientemente detiene el lote para revisión; no sobrescribir a ciegas. El servidor en ejecución debe usar el endpoint autenticado. El plan no se aplica automáticamente al iniciar ni sincroniza Shopify.

El operador CLI guarda `before.json`, `plan.json` y `result.json` en `.bolt-private/image-batches/<id>/`. El lote local original es `imagenes-20261107`; el plan portable es `catalogo-fotografias-20261107`. Mantener estos respaldos privados: pueden contener otros datos administrativos.

Para revertir, preparar un parche inverso **solo de imágenes** y comprobar que cada valor actual aún coincide con el aplicado. Conservar las ediciones posteriores. No restaurar el JSON administrativo completo sobre una instalación con ventas o ajustes nuevos. No recuperar fotografías de demostración o presentaciones ya identificadas como incorrectas; dejarlas pendientes hasta disponer de la foto apropiada.

## Verificación

- `npm run lint` y `npm run build`: correctos. Persisten los avisos de tamaño del paquete y configuración de Vite; no impiden construir.
- `npm run test:images`: 8 comprobaciones de componentes/modelo y recorrido HTTP aislado correctos: autenticación, rechazo de campos comerciales, variantes ajenas, conflictos, reintento, persistencia, auditoría y reinicio real del servidor.
- Regresiones `catalogPurchase`, `presentationSelection` y `guestCart`: 43 casos correctos.
- Navegador a 390×844 y 1280×900: categorías y tarjetas sin desbordamiento horizontal; 24 imágenes de las 6 categorías cargan, sin recortar empaques.
- Seleccionar NexGard 7,5–15 y 30–60 kg cambia a las fotos correspondientes; ficha, carrito y administración conservan el mismo vínculo por variante.
- Copia aislada: URL 404 intencional produce marcador neutro y la categoría usa otra foto; carrito ficticio restaura fotos de NexGard y Bravecto; administración muestra la foto exacta de la variante 7,5–15 kg.
- Comparación de los 3.853 productos: todos los campos no relacionados con imágenes permanecen idénticos. Ocho archivos existentes de pedidos, conductores, autenticación, catálogo base y configuración conservaron sus hashes.

## Fuentes

Las fuentes por producto e identificador constan en `catalog-image-corrections.json` y en el informe CSV local. Shopify se consultó mediante el acceso autorizado, sin modificaciones. Las fotos oficiales de OdourLock se obtuvieron de [Intersand](https://odourlock.com/en/products/clay-litters/unscented-odourlock/). El formato de FortiFlora se contrastó con [Purina](https://www.purina.com/es/perros/comprar/pro-plan-suplementos-veterinarios-fortiflora) y el producto Maxi Adult con [Royal Canin](https://www.royalcanin.com/co/dogs/products/retail-products/maxi-adult-3007).

Pendiente: confirmar visualmente el resto de empaques y obtener fotografías específicas para los campos marcados. No se inventaron presentaciones, dimensiones, precios ni imágenes generadas.
