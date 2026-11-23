# Aislamiento de datos y transición en producción

Hay dos esquemas independientes. La versión 2 de clientes cambia las políticas de PostgreSQL. La versión 2 de operación sigue siendo un archivo de pedidos y despachos. Ejecutar la migración de clientes solo afecta la base indicada por `BOLT_CUSTOMER_DATABASE_URL`.

## Acceso vigente

| Datos | Autoridad y acceso |
| --- | --- |
| Direcciones, favoritos y carrito de cuenta | `customer_data`. El backend usa el ID de la sesión verificada. La revisión de la fila impide sobrescribir silenciosamente cambios concurrentes. |
| Importaciones de invitado y vínculos a compras | `customer_imports` y `customer_order_links`. Cada vínculo requiere verificar acceso privado a la compra. El código visible y la coincidencia de datos de contacto no demuestran titularidad. |
| Identidad, sesiones y credenciales | Better Auth y las rutas del servidor operan sobre `customer_user`, `customer_account`, `customer_session`, `customer_verification` y `customer_rate_limit`. El servidor necesita atender también consultas previas a la autenticación. |
| Correo, auditoría, eliminación y versión | `customer_mail`, `customer_audit`, `customer_deletions` y `customer_schema` son tablas internas de servicio. Los navegadores no reciben acceso SQL. |
| Pedidos, conductores, telemetría y despachos | Tras la transición de archivos, `persisted-fulfillment.json` es la fuente de estas entidades. Express verifica el permiso en el servidor. El cliente accede por compra vinculada o por credencial privada del invitado. El conductor accede con su sesión y asignación. Los operadores usan permisos administrativos y el alcance de su sede. |
| Catálogo | El cliente necesita productos publicados, sus presentaciones, precios y disponibilidad comercial. Las ediciones, existencias operativas, lotes, auditoría y artículos sin publicar pertenecen a administración. Los identificadores y filtros que envía un navegador no conceden permisos. |

Las doce tablas de clientes tienen RLS habilitada y privilegios revocados a `PUBLIC`. En v2, **tres** aplican `FORCE ROW LEVEL SECURITY` con una política por `user_id` para lectura y escritura. Son `customer_data`, `customer_imports` y `customer_order_links`. `withCustomerScope` establece `bolt.customer_id` dentro de la transacción para que una conexión reutilizada no herede la identidad anterior. En las otras nueve tablas el propietario sigue pudiendo operar para autenticación y tareas internas. El servicio debe ser propietario de sus tablas, con un rol exclusivo sin superusuario ni `BYPASSRLS`. Dar credenciales SQL a clientes permitiría alterar el contexto de sesión y rompe este modelo. [Esquema y contexto](../src/customer/database.ts) · [política de propietario](../scripts/customer/002-user-scope.sql) · [rutas de cuenta](../src/customer/routes.ts)

## Actualizar el esquema de clientes de v1 a v2

1. Identificar la instalación, base, rol propietario y versión actuales. Validar el procedimiento en una restauración privada. Guardar la revisión del código, fecha del respaldo y punto de recuperación de PostgreSQL. Usar un respaldo administrado o un rol de copias con acceso completo. Un volcado realizado con el contexto de un solo cliente puede omitir datos.
2. Preparar el código v2 y una revisión de retorno capaz de trabajar con el mismo esquema. Mantener bajo custodia las variables y claves que permiten reabrir sesiones, correo cifrado y datos operativos. Probar la restauración del respaldo en otra base y comparar los recuentos por tabla con el mismo punto de recuperación. Los datos y copias permanecen fuera de Git.
3. En la ventana de mantenimiento, drenar las instancias y trabajadores que acceden a clientes. Suministrar la configuración desde el gestor de secretos. Ejecutar `npm run customer:migrate -- --apply` con el rol propietario restringido de la aplicación. El comando adquiere un bloqueo transaccional, migra v1 a v2 y confirma el conjunto en una sola transacción. En una base nueva crea el esquema completo. Si se interrumpe, comprobar la versión y repetir el mismo comando. Una v2 ya publicada devuelve `already-applied`. Una versión desconocida requiere revisión.
4. Verificar en PostgreSQL la versión 2 y los tres indicadores de RLS forzada. Ejecutar estas consultas con el esquema de clientes en el `search_path` de la instalación. Comprobar también que el rol del backend tenga ambos indicadores de privilegio en falso.

   ```sql
   SELECT version FROM customer_schema WHERE id = 1;
   SELECT relname, relrowsecurity, relforcerowsecurity
   FROM pg_class
   WHERE relnamespace = (SELECT relnamespace FROM pg_class WHERE oid = 'customer_schema'::regclass)
     AND relkind = 'r' AND left(relname, 9) = 'customer_'
   ORDER BY relname;
   SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user;
   ```

5. En la copia privada, comprobar con dos sesiones distintas la lectura y edición de datos propios, el rechazo de escrituras ajenas y el aislamiento cuando se reutiliza una conexión. Una vez superadas estas pruebas, iniciar el servicio v2. El inicio comprueba rol y versión. [Migrador](../src/customer/migration.ts) · [configuración de cuentas](./customer-account/SETUP.md)

**Retorno después de la migración.** Antes del commit, PostgreSQL deshace una transacción fallida. Después del commit, una reversión de aplicación requiere código que acepte v2 y establezca el contexto del cliente. Volver al binario de v1 puede ocultar filas o impedir escrituras. Si todavía no existe una revisión v2 compatible con el fallo que se investiga, detener las escrituras afectadas, conservar la base actual y corregir hacia delante. Un respaldo anterior se restaura en una base separada para investigar o reconciliar movimientos. Reemplazar la única base actual con ese respaldo perdería aceptaciones, sesiones o cambios posteriores.

## Operación en JSON hasta el cambio de almacenamiento

Mantener una sola instancia escritora y un volumen persistente privado. El bloqueo de escritor, la revisión del snapshot y la publicación mediante renombrado protegen el archivo de fulfillment. Su atomicidad no abarca por sí sola el catálogo, las imágenes, la configuración de transporte ni PostgreSQL. El directorio de operación, registros históricos y fotos privadas de entradas debe quedar fuera de los directorios estáticos y de las respuestas públicas. La evaluación de autorización se realiza al leer, antes de mutar y al proyectar la respuesta, incluso cuando el solicitante conoce el ID.

Antes de tocar el volumen, drenar checkout, administración y trabajadores, cerrar el escritor y obtener una copia consistente del volumen completo. `npm run storage -- check "$BOLT_DATA_DIR" .` comprueba el contrato de lectura del código candidato. `npm run storage -- backup "$BOLT_DATA_DIR" .` puede materializar el estado de fulfillment y producir una copia local de esa revisión. Utilizarlo con el escritor detenido después de la copia del volumen. Este comando por sí solo no incluye el catálogo ni PostgreSQL ni ofrece recuperación ante la pérdida del volumen. Conservar el diario de transición, identificadores, claves y copias cifradas en un destino separado con acceso restringido. Para operar tras volver de versión, usar el estado más reciente con una revisión cuyo contrato acepte el formato. [Contrato operativo](../storage-contract.json) · [comandos y recuperación anteriores](./INTEGRACION-SEGURA.md)

## Traslado propuesto de la operación a PostgreSQL

Esta parte describe una migración futura. Requiere un importador, repositorios SQL, políticas, trabajos de fondo compatibles y pruebas de concurrencia antes de aceptar tráfico en varias réplicas.

1. Inventariar los datos por instalación. Registrar revisión y hashes del origen, conteos y estados por pedido, despacho y sede. Separar catálogo público, configuración, stock, reservas, cobros, auditoría y material secreto. Definir objetivos de pérdida y tiempo de recuperación con Harold y practicar la restauración.
2. Crear un esquema operativo separado y roles de mínimos privilegios. Conservar IDs de origen y claves de idempotencia. Modelar relaciones compra–despacho–línea–sede, asignaciones, reservas y auditoría. Definir unicidad, integridad referencial y políticas por propietario, conductor asignado y sede autorizada. Reservar el acceso agregado a permisos explícitos de coordinación. Las vistas públicas del catálogo deben exponer solo los campos comerciales aprobados.
3. Construir el importador por lotes con una marca persistente por revisión e ID de origen. Reanudar una interrupción sin duplicar registros. Conservar los históricos que requieren conciliación. Validar cantidades, saldos, códigos, asignaciones y vínculos privados en una copia. No deducir conductores, custodias ni titulares faltantes.
4. Copiar a tablas de ensayo mientras JSON continúa como única autoridad. Comparar respuestas de solo lectura, incluida la matriz de permisos de cliente, invitado, conductor y operador, usando datos aislados. Las lecturas comparativas no deben enviar notificaciones, reservar stock ni solicitar un repartidor. Preparar la confirmación, reserva, auditoría y evento de despacho en una transacción SQL y una cola transaccional con consumo idempotente.
5. Para el corte inicial, drenar escrituras y detener los trabajadores. Capturar la revisión final, importar los cambios restantes y comparar las entidades y los saldos nuevamente. Conservar ambos orígenes y el manifiesto. Tras la validación, conmutar a un único escritor SQL. Dejar el JSON como histórico de solo lectura. Si algo falla antes de aceptar una escritura SQL, volver al escritor JSON de la revisión congelada.
6. Tras la primera escritura SQL, una vuelta a JSON exige exportar y reconciliar **todos** los movimientos posteriores, transacciones pendientes, estados, reservas, recibos y auditoría. Hace falta un conversor y un ensayo de retorno con equivalencia comprobada antes del corte si ese retorno se considera necesario. Mientras dicho conversor no exista, la recuperación operativa será sobre PostgreSQL con un binario compatible y el estado más reciente. Reanudar tráfico únicamente después de verificar la consistencia y que hay un solo consumidor por trabajo.
7. Antes de ampliar las réplicas, probar con carga aislada el objetivo de 1.000 usuarios concurrentes, solicitudes de compra concurrentes sobre la última unidad, reintentos, cambio de líder de trabajadores y reinicio. Acordar con Harold la combinación de recorridos, latencias aceptables, duración y tasa de error. Registrar las mediciones sobre la topología seleccionada.


### Acceso del equipo de sede

Coordinación inicia sesión en BOLT Admin con su propia cuenta. Con su sesión puede enviar `POST /api/v1/admin/store-operators` con `email`, `name`, `password` y el `storeId` activo. El operador recibe credenciales individuales por un canal privado y entra por la misma pantalla de BOLT Admin. El servidor limita sus consultas de pedidos, ventas, inventario y acciones de preparación a la sede asignada. Los precios y las fotos se administran desde Coordinación. El servidor conserva el hash de la contraseña y la sede en el volumen privado. Los perfiles de simulación siguen limitados al entorno de demostración.

Para retirar el permiso, Coordinación usa `DELETE /api/v1/admin/store-operators/:id`. La respuesta de alta incluye ese ID. La revocación invalida las sesiones abiertas de ese operador. Los pedidos y la auditoría conservan su identificador histórico. Si se incorpora personal de sede, cualquier reversión de código debe utilizar una versión que conozca el rol `OPERADOR_SEDE`; el lanzador antiguo rechaza ese archivo durante el arranque.
