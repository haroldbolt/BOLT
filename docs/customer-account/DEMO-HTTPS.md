# Revisión del PR #16 en la demo HTTPS

Actualización autorizada por el usuario el 11 de noviembre de 2026, sin integrar a main.

Destino: https://bolt-demo-demo.up.railway.app/cuenta, protegido por la clave privada de la demo. El despliegue se fija al commit revisado de `codex/cuentas-clientes-legales`; no sigue automáticamente futuros cambios de la rama. La clave se conserva en el gestor de secretos y se comparte únicamente por el canal privado autorizado.

## Qué se puede revisar

- Bienvenida de BOLT, acceso como invitado, formularios de correo/login/recuperación, casillas de términos/privacidad/publicidad y páginas legales.
- Encabezado sin identidad ficticia, catálogo, variantes, carrito y las funciones existentes de la demo.
- La portada privada incluye el enlace «Registro y Mi cuenta» y explica el alcance.

**No se habilitan cuentas reales.** Esta instalación no tiene PostgreSQL de cuentas, SMTP, Google OAuth ni Apple configurados. Los métodos de autenticación permanecen deshabilitados y los textos legales siguen en borrador. La clave de acceso a la demo no es una cuenta de cliente. La simulación local con correo capturado es independiente y no se expone al público.

## Preparación y comprobaciones

Se verificó el despliegue anterior del PR #15, su volumen `/data`, dominio y variables existentes. Se guardó una comparación privada de los cuatro pedidos y de 3.636 productos activos (precios, existencias, reservas y variantes) antes de actualizar; nunca se incorpora esa copia ni las claves al repositorio.

La prueba del paquete compilado detectó que Node normaliza enlaces simbólicos en `import.meta.url`, mientras `argv[1]` puede conservar `/var` frente a `/private/var`. Se corrigió la comparación del punto de entrada con `realpathSync`, manteniendo la importación explícita del servidor para pruebas y un código de salida de error si falla el arranque.

Validación previa: TypeScript, build, test del gateway y test del runtime completo con volumen aislado. Este último comprueba métodos de registro deshabilitados, ausencia de identidad, API privada, permisos administrativos, compra ficticia idempotente, recuperación sin reabrir un pedido y reinicio conservando datos/códigos/cookie. No se crean pedidos de prueba en la demo alojada para verificar el despliegue.

Tras desplegar se debe comprobar el estado SUCCESS de Railway, `/api/customer/config`, `/cuenta`, formularios y documentos legales en navegador, y comparar nuevamente pedidos/catálogo con la captura previa. El resultado y el commit exacto quedan registrados en la revisión del PR.

## Conservación y reversión

El launcher reutiliza el volumen existente; no reinicializa los pedidos ni ejecuta una migración de clientes. No se cambian variables de acceso ni se habilitan servicios de pago o proveedores logísticos. Si fuera necesario volver al despliegue anterior del PR #15, conservar `/data` y cambiar solo la revisión de código: aquí no hay cuentas de cliente ni un esquema nuevo en producción que revertir. Si en el futuro se habilitan cuentas reales, aplicar las condiciones de reversión de SETUP.md antes de cambiar código.
