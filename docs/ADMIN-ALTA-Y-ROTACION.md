# Alta inicial y rotación de personal de BOLT

R1 cambia el aprovisionamiento inicial de Coordinación. Los clientes y conductores conservan sus propios mecanismos de identidad. El titular del hosting autoriza una instalación concreta y una cuenta esperada desde mantenimiento. En el servidor, configurar el correo o la contraseña antiguos en el entorno no crea una cuenta. El equipo conserva los secretos y la evidencia de rotación en sus herramientas privadas.

## Antes de actualizar una instalación

1. Identificar el volumen, la revisión desplegada y la cuenta de Coordinación autorizada. Detener la escritura, obtener una copia privada verificada tanto de las cuentas como de los datos comerciales y conservar la trazabilidad. Comparar cantidades de cuentas por rol, pedidos, reservas, existencias por sede, precios y registros de auditoría.
2. Separar el almacenamiento de la carpeta de código. Si una instalación antigua todavía trabaja sobre un checkout de Git, copiar y comprobar **sus datos vigentes** antes de cambiar esa revisión. Esta rama retira archivos de instancia del índice de Git. Docker ya los excluía de la imagen. Los archivos vigentes se trasladan desde el respaldo privado de la instalación.
3. Si existen cuentas, adoptar la versión 1. La adopción exige la huella exacta del archivo privado y una cuenta de Coordinación presente. Conserva las cuentas, roles, sedes, sales y verificadores y añade la identidad de instalación. Las sesiones de personal en memoria finalizan al detener el proceso. Un archivo ilegible, cambiado o perdido requiere recuperación asistida.
4. Usar una identificación única en `BOLT_ADMIN_INSTALLATION_ID`, propia del entorno. Los secretos de configuración pertenecen al gestor del hosting. El directorio externo de preparación debe ser privado (0700), separado del volumen de cuentas, con enlaces duros POSIX y sincronización durable. El proceso no lo crea automáticamente.

## Un disco en el servicio, incluido el Blueprint de Render

El servidor web arranca con el alta cerrada. El permiso permanente de arranque está ligado al almacén ya constituido y registrado en `BOLT_ADMIN_CLOSED_RECEIPT` fuera del disco. Este recibo no inicia sesión ni autoriza otra alta.

1. Con la aplicación detenida y el disco montado, usar la imagen compilada desde un proceso de mantenimiento de confianza que tenga acceso **a ese disco**. Configurar la identidad, el volumen del piloto, el alcance de sedes y un `BOLT_ADMIN_CONTROL_DIR` privado para la preparación. Usar `BOLT_ADMIN_BOOTSTRAP_EMAIL` solo en mantenimiento. Custodiar el estado del control hasta verificar el arranque con el recibo, incluso si se interrumpe el proceso.
2. Para un almacén nuevo, usar `npm run admin:seal -- create RUTA_ABSOLUTA_CUENTAS RUTA_PRIVADA_RECIBO`. La contraseña inicial distinta y fuerte entra por entrada estándar desde el gestor, fuera de los argumentos e historial de shell. Para cuentas existentes, usar `adopt` en lugar de `create`. La ruta estándar bajo el runtime es `src/data/persisted-admin-auth.json`. Para el piloto de tres sedes se encuentra bajo `bolt-operacion` en el volumen.
3. Elegir para el recibo un archivo nuevo en un directorio privado ajeno al código, al control y al volumen. Importar su contenido en `BOLT_ADMIN_CLOSED_RECEIPT` del hosting sin imprimirlo. Si se interrumpe la exportación y el alta está constituida, conservar disco y control y usar `admin:seal -- export` con otra salida privada. Mantener el secreto de alta web ausente en este modo.
4. Reiniciar. `GET /api/v1/auth/status` debe indicar `closed` y `isSetupRequired=false`. BOLT Admin muestra el ingreso. Verificar que las cuentas y sedes coinciden con el registro previo. Un recibo que no concuerda o un volumen nuevo se rechazan, aun cuando sigan presentes las antiguas variables administrativas.

## Dos volúmenes independientes y alta guiada

Cuando el hosting ofrece ambos montajes, `BOLT_ADMIN_CONTROL_DIR` puede ser un segundo volumen duradero, privado y exclusivo de la instalación. El piloto con comprobación de montajes verifica el volumen de datos y el del control. En este modo dejar `BOLT_ADMIN_CLOSED_RECEIPT` sin definir.

- Con la instancia detenida, el operador de confianza usa `npm run admin:bootstrap -- prepare RUTA_ABSOLUTA_CUENTAS` para una primera instalación. La alternativa `adopt` autoriza expresamente la migración del archivo v1 presente. Fuera del lanzador del piloto se configura `BOLT_ADMIN_VOLUME_DIR` como raíz del volumen. El archivo de cuentas debe quedar dentro de él.
- Solo para el alta guiada nueva, configurar `BOLT_ADMIN_SETUP_TOKEN` aleatorio de al menos 32 caracteres. El titular tiene una hora desde la preparación para reservar el alta en Admin con su correo autorizado y el secreto. Una única solicitud puede reservar el permiso. Tras persistir la cuenta y confirmar el cierre, retirar el secreto de ambos entornos y comprobar el login normal.
- Si el proceso cae tras escribir la cuenta, el siguiente arranque completa la constancia externa usando la misma identidad y cuenta. Con el permiso reservado y la cuenta ausente, se requiere intervención. No borrar marcadores ni archivos de bloqueo para forzar otra alta. La simulación funciona solo en su instalación marcada y separada.

## Qué debe rotar el titular

| Elemento | Decisión |
|---|---|
| Clave histórica de Google Maps | Comprobar su estado, uso reciente, facturación y restricciones en Google Cloud. Si sigue activa, sustituirla y revocarla. Verificar por separado el mapa web, limitado por origen y API, y la geocodificación de servidor. |
| Contraseñas del personal y secreto de alta | Rotar las contraseñas de cuentas cuyos verificadores coincidan con material expuesto o cuya reutilización no se pueda descartar. Revocar sesiones mediante la parada del servicio. Retirar el secreto de alta usado; si pudo exponerse antes del alta, sustituirlo antes de abrir la ventana. Un entorno que vuelve a configurar el secreto no reabre una instalación cerrada. |
| Antigua clave de Resend compartida | Confirmar revocación en el panel de Resend. Si sigue activa, sustituirla, comprobar el correo autorizado y revocarla. |
| OpenAI, Gemini, Google OAuth, Apple, Wompi y Shopify | La inspección de la fase R no acreditó que sus secretos privados estuvieran en la historia de Git revisada. Cotejar con los titulares si hay evidencia adicional. La existencia de un nombre de variable no acredita exposición. |

Para avisar a una cuenta concreta, con el servicio detenido, configurar `BOLT_ADMIN_MAINTENANCE_EMAIL` en mantenimiento y usar `npm run admin:credential -- warn RUTA_ABSOLUTA_RUNTIME`. Para rotarla usar `rotate` con la contraseña nueva por entrada estándar privada, entre 16 y 256 caracteres. El nuevo ingreso conserva el ID, el rol y la sede. El aviso desaparece al completar la rotación. El acceso al mantenimiento corresponde al operador de infraestructura autorizado.

## Control de versiones, reversión y aceptación

- Esta rama limpia el árbol propuesto. Las ramas anteriores, revisiones históricas, forks, artefactos y copias requieren saneamiento coordinado con sus titulares. Antes de una eventual reescritura, custodiar evidencia y respaldos privados, revocar lo necesario y acordar la ventana con los colaboradores. La retirada del historial es una operación distinta.
- La escritura de cuentas v2 requiere una versión que entienda su vínculo con el control o recibo. Volver con los lectores v1 se considera incompatible. Ante una incidencia, mantener cerrado Admin y usar una revisión compatible o corregir hacia delante. Recuperar la copia vigente de las cuentas y su constancia concordante sin retroceder pedidos, reservas, cambios de credenciales ni revocaciones posteriores. Ante posible restauración de contraseñas antiguas, conciliar las rotaciones y completarlas antes de reabrir.
- La ingeniera puede reproducir en una copia aislada con Node 22: `npm run lint`, `npm run build`, `npm run test:r1`, `npm test` y `npm run test:bolt-admin`. Las pruebas crean almacenes temporales. Comprobar también el arranque con volumen correcto y el rechazo al sustituirlo, el login del titular después de reiniciar y la recuperación ante un control perdido. Solo el titular puede acreditar las rotaciones y la restauración en su hosting.
