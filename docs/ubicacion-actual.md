# Ubicación actual del cliente

El acceso está en **Mis direcciones → Usar mi ubicación actual** y en el formulario de dirección. Se conserva el acceso sutil a las direcciones en la esquina superior izquierda.

## Recorrido

1. La acción explícita del cliente solicita `navigator.geolocation.getCurrentPosition` en el dispositivo donde está abierta BOLT.
2. Pide alta precisión y una lectura nueva (`maximumAge: 0`). La espera tiene un límite y distingue permiso denegado, señal no disponible, tiempo agotado y navegador no compatible.
3. El punto se convierte en dirección mediante el endpoint existente `/api/v1/geocode/reverse`. La cotización vuelve a consultar `/api/v1/delivery/quote`; las coordenadas no autorizan cobertura por sí mismas.
4. Se muestra la precisión reportada. El cliente revisa la dirección, ajusta el punto y confirma. Guardarla con nombre sigue siendo una acción separada.
5. Al escribir, cambiar el punto o cerrar el formulario se descartan respuestas pendientes. No se crea un pedido, reserva inventario o modifica el carrito.

No se usa `watchPosition` ni hay seguimiento permanente. La ubicación corresponde al navegador/dispositivo actual; abrir BOLT en un computador no consulta remotamente un celular por su número.

## Requisitos para un celular real

- Servir BOLT por HTTPS y permitir geolocalización en la política de permisos de la instalación.
- Autorizar ubicación en el navegador y en el sistema operativo del celular.
- Mantener funcional la integración de mapas/geocodificación ya configurada. Esta función no registra claves nuevas ni contrata servicios.
- `http://127.0.0.1:3044/` es la previsualización local del computador. Ese enlace no permite acceder a este servidor desde otro teléfono. Falta comprobar Safari/iOS y Chrome/Android en una instalación HTTPS accesible.

Referencia: [Geolocation.getCurrentPosition, MDN](https://developer.mozilla.org/en-US/docs/Web/API/Geolocation/getCurrentPosition).

## Comprobaciones realizadas

- `npm run lint` y `npm run build`: aprobados; se mantienen los avisos existentes de Vite sobre configuración y tamaño del bundle.
- `npm run test:location`: 15 casos nuevos de ubicación, 18 de direcciones guardadas y 15 de cobertura municipal aprobados.
- Navegador: entrada desde direcciones, Cedritos → Usaquén/Suba, Chía y Cajicá → Programado/Suba, Cota fuera de cobertura, confirmación voluntaria, guardado separado, permisos/señal/tiempo/geocodificación fallidos y respuesta tardía después de editar coordenadas.
- Endpoint de geocodificación real: HTTP 200 con el fixture verificable de Cedritos; municipio Bogotá D.C., localidad Usaquén. No se utilizó la ubicación privada del usuario.

## Simulación aislada

`src/tests/deviceLocationReview.tsx` sustituye la geolocalización y la conversión de dirección por fixtures explícitos. Las cotizaciones se consultan con el backend local real. Las direcciones de prueba usan memoria aislada y no crean pedidos. `deviceLocationMapStub.tsx` impide consultas externas del mapa en esta revisión.

Estas entradas de prueba no se importan desde la aplicación, no se incluyen en `dist` de producción ni son endpoints del servidor. En la previsualización se compilan manualmente bajo `dist/__review/` para la revisión en navegador. Una recarga reinicia los datos ficticios del arnés.

## Archivos

- `src/App.tsx`: conecta la acción de ubicación con el formulario existente.
- `src/components/customer/SavedAddressesModal.tsx`: acceso desde direcciones guardadas.
- `src/components/customer/AddressConfirmationModal.tsx`: ubicación, revisión, cancelación y descarte de respuestas antiguas.
- `src/components/customer/CurrentLocationAction.tsx`: botón, espera y mensajes accesibles.
- `src/lib/deviceLocation.ts`: consulta puntual, validación y cancelación lógica.
- `src/tests/deviceLocation.test.tsx`: regresiones.
- `src/tests/deviceLocationReview.tsx` y `deviceLocationMapStub.tsx`: revisión aislada.
- `package.json`: ejecución de las nuevas comprobaciones.

Trabajo local basado en main `38ea7bf1966d6cef13cddb6d52e07d7620c003c4`, conservando el cambio previo de `Header.tsx`. No se ha fusionado ni subido este cambio a GitHub.
