# Buscador por foto de BOLT

La búsqueda identifica el producto del catálogo. El cliente elige el peso, sabor o presentación en la ficha existente y agrega el producto mediante el flujo habitual.

## Recorrido del cliente

1. Toca la cámara al lado de la búsqueda de texto.
2. Toma una foto del frente del empaque o elige una de la galería.
3. BOLT prepara la foto y empieza la búsqueda automáticamente.
4. Si BOLT encuentra una coincidencia clara, abre la ficha. Si hay varias posibilidades, elige entre las fichas sugeridas. Si la foto no permite identificar el producto, repítela o escribe el nombre.
5. Selecciona la presentación en la ficha y consulta su precio y disponibilidad.

## Activación en una instancia de pruebas

1. Configura `BOLT_PHOTO_SEARCH_OPENAI_API_KEY` como secreto del servicio Express. Usa una credencial dedicada a BOLT con acceso a la API de Responses.
2. Define `BOLT_PHOTO_SEARCH_ENABLED=true` y reinicia la instancia. El modelo predeterminado es `gpt-5.4-nano`. Se puede cambiar con `BOLT_PHOTO_SEARCH_MODEL` por un modelo compatible con imágenes y salida estructurada.
3. Comprueba que `GET /api/v1/catalog/photo-search/status` devuelve `{"enabled":true}`. Abre la tienda, toca la cámara y prueba una foto legible de un alimento que esté publicado.
4. Prueba una foto con el peso tapado, dos empaques similares y una foto de un producto ajeno al catálogo. Repite desde la cámara y la galería de Safari en iPhone y Chrome en Android.
5. Para desactivar, configura `BOLT_PHOTO_SEARCH_ENABLED=false` y reinicia. La búsqueda de texto sigue disponible.

Las pruebas de la API y del cliente se ejecutan con `npm run test:photo-search`. Usan un proveedor simulado y JPEG de prueba.

## Datos y consumo

El navegador prepara la imagen antes de enviarla. Express valida y normaliza el JPEG, y pide al proveedor los datos visibles del empaque. BOLT resuelve las coincidencias contra los productos activos y devuelve identificadores del catálogo. El precio, la disponibilidad y la compra se resuelven en la ficha y el checkout existentes. El piloto excluye farmacia.

BOLT procesa la foto temporalmente. OpenAI recibe la imagen con `store: false`. Su retención estándar para monitoreo de abuso puede alcanzar 30 días. Revisa las condiciones del proveedor antes de habilitar la función para clientes. [Controles de datos de OpenAI](https://developers.openai.com/api/docs/guides/your-data)

El límite predeterminado es de cinco solicitudes por minuto por dirección IP y cien llamadas diarias al proveedor por proceso. Configura esos valores con `BOLT_PHOTO_SEARCH_REQUESTS_PER_MINUTE` y `BOLT_PHOTO_SEARCH_DAILY_LIMIT`. En un despliegue con proxy, varios clientes pueden compartir la IP que ve Express. Un reinicio restablece los contadores y cada réplica tiene su propio límite. Para ampliar el piloto, mide los intentos por búsqueda, los aciertos por producto, los fallos y la latencia.
