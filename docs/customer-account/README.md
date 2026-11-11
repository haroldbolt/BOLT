# Cuentas de Bolt by Agrocentro

- [Plan, base y dependencias](INTEGRATION.md).
- [Configuración de PostgreSQL, Google, Apple, correo y reversión](SETUP.md).
- [Pruebas, evidencia y límites](VERIFICATION.md).
- [Checklist de App Store / Google Play y fuentes oficiales](PLATFORM-CHECKLIST.md).
- [Términos y condiciones — borrador](../legal/terminos-2026-11-10-draft-1.md).
- [Privacidad y tratamiento — borrador](../legal/privacidad-2026-11-10-draft-1.md).
- [Eliminación de cuentas — borrador](../legal/eliminacion-2026-11-10-draft-1.md).

## Archivos principales

`src/customer/` contiene autenticación, base PostgreSQL, correo cifrado, consentimientos, permisos y pantallas. `scripts/customer/` contiene el esquema, migración explícita, revocaciones pendientes, generación privada del secreto Apple y simulación local. Las cinco suites `src/tests/customer*.test.ts` son independientes de los datos operativos.

La integración modifica `server.ts`, `src/main.tsx`, `src/App.tsx`, `src/lib/api.ts`, `src/lib/dispatchRoutes.ts`, `src/lib/notifications.ts`, `src/types/index.ts` y los componentes de cliente Header, CheckoutModal, OrderHistoryModal, SavedAddressesModal, AddressConfirmationModal, useGuestCart y useGuestAddresses. Se conservan los selectores de presentación y los datos del catálogo. Dependencias fijadas en `package.json`/`bun.lock`; secretos vacíos documentados en `.env.customer.example`.

## Revisar localmente

Instalar dependencias con el lockfile. Ejecutar `npm run lint`, `npm test`, `npm run build`. Para UI: `npm run customer:review` y abrir la URL local que indica el proceso. Se identifica visiblemente como simulación y usa una copia separada. No tiene OAuth ni SMTP real. No publicar esta copia ni sus archivos privados.

Para una instalación real, seguir SETUP, aprobar los documentos, crear los servicios empresariales y completar las pruebas pendientes. No basta con habilitar los botones ni marcar una variable para considerar aprobada la operación.
