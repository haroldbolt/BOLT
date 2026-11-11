/** Versioned drafts. Changing any text requires a new version and legal approval. */
export const LEGAL_VERSION = "2026-11-10-draft-1";
export const BUSINESS = {
  name: "Agrocentro Abastos S.A.S.",
  brand: "Bolt by Agrocentro",
  nit: "901079198",
  address: "Carrera 79F #2-10",
  email: "agroabastossas@gmail.com",
  approver: "Harold Herra",
};
export type LegalKind = "terminos" | "privacidad" | "eliminacion";
export const legalDocuments: Record<
  LegalKind,
  { title: string; sections: { title: string; text: string }[] }
> = {
  terminos: {
    title: "Términos y condiciones de uso",
    sections: [
      {
        title: "Responsable y alcance",
        text: "Bolt by Agrocentro es una plataforma de comercio electrónico de productos para mascotas y coordinación de entregas. Agrocentro Abastos S.A.S., NIT 901079198 (dígito de verificación pendiente), es responsable comercial y de facturación. Domicilio informado: Carrera 79F #2-10; municipio pendiente de confirmación. Atención: agroabastossas@gmail.com. Este borrador requiere aprobación empresarial y revisión jurídica antes de habilitar registros reales.",
      },
      {
        title: "Registro y uso",
        text: "Puedes explorar el catálogo sin cuenta. Para crear una cuenta debes tener capacidad legal para contratar, aportar información veraz, aceptar estos términos y autorizar el tratamiento necesario. No se exige recibir publicidad. Conserva tus credenciales y reporta accesos no autorizados. No uses la plataforma para fraude, suplantación, vulneración de sistemas o actividades ilegales. No hay beneficios VIP, puntos ni membresías implícitos por registrarte.",
      },
      {
        title: "Identidad y seguridad",
        text: "Los métodos de correo, Google y Apple solo estarán disponibles cuando estén configurados. Una cuenta Google o Apple no se vincula a otra únicamente por compartir correo. La identidad del cliente es independiente de administración y conductores. El número visible de compra no concede acceso privado a su seguimiento. La recuperación de pedidos anteriores exige prueba de titularidad por el mecanismo seguro de BOLT o revisión asistida.",
      },
      {
        title: "Productos, precios y disponibilidad",
        text: "Cada presentación conserva su precio en pesos colombianos (COP), cantidad y disponibilidad. El catálogo puede cambiar; el servidor verifica precio, inventario y condiciones al cotizar y confirmar. Los impuestos que correspondan y los cargos de entrega o servicio deben informarse en el resumen previo. No se aplican promociones, precios comparativos ni beneficios que no tengan respaldo vigente. Una ausencia de inventario no significa que el municipio esté fuera de cobertura.",
      },
      {
        title: "Compra, pago y factura",
        text: "Selecciona productos y presentaciones, confirma tu dirección, modalidad y horario disponible, revisa cantidades, precio total, entrega y medio de pago y confirma la compra. La respuesta exitosa del servidor y el código de compra identifican su registro; abrir el carrito o cotizar no crea pedidos. Solo se ofrecen los medios de pago realmente habilitados. En contraentrega, el importe y responsable de recaudo deben estar identificados, sin duplicar el cobro si hay varias entregas. Los datos necesarios para factura se solicitan cuando corresponda; la cuenta no exige anticipadamente cédula o teléfono. No se almacenan números completos de tarjetas en el perfil.",
      },
      {
        title: "Cobertura y entregas",
        text: "Se atienden únicamente zonas habilitadas de Bogotá D. C., Soacha, Chía y Cajicá; Sumapaz y las exclusiones rurales o territoriales configuradas quedan fuera de la cobertura estándar. La dirección de destino determina las modalidades, no la ubicación del teléfono. Chía y Cajicá utilizan Programado desde Suba. Turbo depende de horario, capacidad real, inventario y disponibilidad verificada; no se garantiza un tiempo universal. La cotización muestra la sede, costo, fechas y tiempos aplicables antes de confirmar. Una compra puede agrupar varios despachos, con seguimiento independiente y sin cobrar o reservar dos veces sus productos. No se promete disponibilidad de Rappi o inDrive: sus integraciones reales siguen pendientes.",
      },
      {
        title: "Retrasos e incidencias",
        text: "Los tiempos informados son estimaciones sujetas a preparación, tránsito, condiciones de acceso y disponibilidad real. Un cambio relevante se informa y cualquier aumento del cargo al cliente requiere autorización. Proporciona una dirección verificable y las instrucciones necesarias; geolocalización y fotografía de entrada son opcionales. Si no es posible cumplir una entrega se gestionará una alternativa real o la solución que legalmente corresponda, sin eliminar tus derechos.",
      },
      {
        title: "Cancelaciones, retracto y devoluciones",
        text: "Solicita cancelación o devolución por el canal de atención indicando el código de compra y los productos afectados, sin enviar claves privadas. Se revisará el estado real de preparación, recogida y entrega. El derecho de retracto en ventas a distancia, cuando resulte aplicable, se ejerce dentro de los cinco días hábiles legalmente previstos; sus excepciones se determinan por la naturaleza efectiva del artículo y la ley, no mediante una exclusión general de todos los productos para mascotas. El procedimiento, costos de devolución que legalmente correspondan y reembolso se informarán en cada caso conforme al Estatuto del Consumidor vigente. No se condicionan garantías a conservar la caja cuando la ley no lo exige ni se excluyen derechos por comprar en promoción.",
      },
      {
        title: "Garantías y reversión de pagos",
        text: "Si un producto es defectuoso, inseguro, no corresponde a lo comprado o falta una unidad, contacta atención con la evidencia disponible. Se aplican la garantía legal y sus remedios según el producto y el caso. Para pagos electrónicos, podrá solicitarse reversión en los supuestos legales, como fraude, operación no solicitada, no entrega o producto defectuoso o distinto, realizando los avisos al proveedor y emisor dentro del término legal aplicable (cinco días hábiles desde el hecho que lo activa). No se promete una reversión automática de cualquier pago. La revisión jurídica debe confirmar el procedimiento operativo y los términos de reembolso vigentes antes de publicación.",
      },
      {
        title: "Productos veterinarios",
        text: "Las descripciones del catálogo no sustituyen evaluación veterinaria. Respeta indicaciones, dosis, conservación y restricciones del fabricante y la autoridad competente. Cuando un artículo requiera prescripción o una validación legal, no debe despacharse sin cumplirla. El sistema no anuncia una verificación de receta automatizada que no exista; los controles operativos y responsables deben ser aprobados antes de vender artículos restringidos.",
      },
      {
        title: "Peticiones, quejas y cambios",
        text: "Presenta solicitudes en agroabastossas@gmail.com. Se acusará recibo y tramitará conforme al régimen aplicable. No compartas contraseñas ni PIN con atención. Conservas el derecho de acudir a las autoridades competentes, incluida la Superintendencia de Industria y Comercio cuando corresponda. Las modificaciones se publican con versión y fecha; los cambios que requieran nueva aceptación se comunicarán antes de aplicarse. No alteran retroactivamente condiciones de pedidos confirmados. Rige la legislación colombiana y los derechos imperativos del consumidor prevalecen.",
      },
    ],
  },
  privacidad: {
    title: "Política de privacidad y tratamiento de datos",
    sections: [
      {
        title: "Responsable, contacto y estado",
        text: "Agrocentro Abastos S.A.S., NIT 901079198 (dígito de verificación por confirmar), opera Bolt by Agrocentro. Domicilio informado: Carrera 79F #2-10, municipio por confirmar. Canal informado para atención y privacidad: agroabastossas@gmail.com. Contacto de aprobación empresarial: Harold Herra. Texto sujeto a revisión jurídica y confirmación de los datos pendientes. Se aplican la Ley 1581 de 2012, su reglamentación y las demás normas colombianas pertinentes.",
      },
      {
        title: "Datos de cuenta y acceso",
        text: "Tratamos identificador estable, nombre real o elegido, correo, proveedor de acceso, fecha de creación y evidencias de consentimiento. El teléfono es opcional hasta que una operación justifique solicitarlo. Para correo y contraseña se conserva un hash seguro, no la contraseña legible. Google o Apple pueden aportar identificador, correo verificado y nombre; Apple puede proporcionar un correo privado y el nombre solo en la primera autorización. No se solicita acceso a contactos, archivos o correos del proveedor. Los métodos sin configurar permanecen deshabilitados.",
      },
      {
        title: "Direcciones y ubicación",
        text: "Tratamos las direcciones que guardes y selecciones, municipio, localidad cuando corresponda, coordenadas e instrucciones opcionales para validar cobertura y entregar. La ubicación del dispositivo solo se solicita al pulsar la función y conceder permiso; puedes escribir y confirmar una dirección sin concederlo. No se realiza seguimiento continuo del cliente. Una fotografía opcional de la entrada ayuda a reconocer el destino: evita rostros, documentos, interiores privados y datos ajenos innecesarios. Las fotos se comparten únicamente mediante los mecanismos de acceso autorizados para cumplir la entrega; no se usan como publicidad.",
      },
      {
        title: "Compras y operación",
        text: "Tratamos productos, presentaciones, importes, estado, facturación, dirección, instrucciones y eventos de entrega para preparar, despachar, atender incidencias y conservar evidencia comercial. El personal y conductores autorizados reciben solo la información necesaria para su función. El cliente ve estados de su propia compra. Los pedidos históricos no se asocian a una cuenta por una coincidencia de nombre, correo o teléfono: se exige acreditar su titularidad.",
      },
      {
        title: "Finalidades y autorización",
        text: "Las finalidades necesarias son crear y proteger tu cuenta, guardar datos que elijas, gestionar compras, pagos y entregas, prevenir fraude, responder solicitudes, cumplir obligaciones legales y mantener la seguridad. Registramos versión, huella del documento, usuario y fecha de las aceptaciones. La autorización de tratamiento y aceptación contractual son independientes del consentimiento comercial. Las promociones requieren una casilla opcional inicialmente desmarcada; puedes retirarlas en Mi cuenta sin perder acceso al servicio. No se presenta un canal de publicidad como activo si aún no está implementado.",
      },
      {
        title: "Almacenamiento local y sincronización",
        text: "Como invitado, carrito y direcciones se guardan en este navegador; no se promete sincronización entre dispositivos. Al crear una cuenta puedes importar voluntariamente esas selecciones. Al autenticarte, los datos de cuenta se conservan en el servidor y se recuperan en otros dispositivos con tu sesión. Las cookies de sesión son necesarias para autenticación y seguridad. Los precios del navegador no son autoritativos. Cerrar sesión impide continuar consultando la cuenta; no borra automáticamente los datos legítimos de invitado ni información de otras aplicaciones.",
      },
      {
        title: "Encargados y proveedores",
        text: "La app utiliza su backend y alojamiento configurado para operar. Google Maps participa en búsqueda de direcciones y mapas cuando está habilitado. La demo utiliza Railway; no debe cargarse información sensible de clientes reales en una simulación. PostgreSQL, el proveedor de correo transaccional y Google/Apple para acceso aún requieren contratación o configuración; no se afirma que ya reciban datos de cuentas reales. Antes de activar cada servicio se deben registrar proveedor, país de tratamiento, finalidad, contrato, medidas y condiciones de transmisión o transferencia internacional aplicables. Rappi e inDrive no están activados como proveedores logísticos reales. La habilitación de un proveedor no amplía la cobertura autorizada.",
      },
      {
        title: "Seguridad y conservación",
        text: "Aplicamos controles de acceso por usuario y función, verificación del servidor, sesiones con vencimiento, secretos solo en servidor y minimización de datos. Ningún sistema garantiza riesgo cero. No deben registrarse contraseñas, tokens de recuperación, PIN ni secretos OAuth en informes. Los datos de perfil, favoritos y direcciones se conservan mientras la cuenta esté activa y se eliminan al completarse una solicitud verificada, salvo necesidad legal documentada. Los documentos comerciales que deban conservarse se separan del perfil y se restringe su uso. El plazo de diez años para libros y papeles comerciales del artículo 28 de la Ley 962 de 2005 no se aplica indiscriminadamente a fotos, ubicaciones o perfiles. La matriz final de retención, respaldos, incidentes y supresión debe ser aprobada antes de operación real.",
      },
      {
        title: "Derechos y procedimiento",
        text: "Puedes conocer, acceder, actualizar y rectificar tus datos; solicitar prueba de autorización e información del uso, revocar la autorización o pedir supresión cuando proceda y presentar quejas ante la SIC previo trámite correspondiente. Escribe a agroabastossas@gmail.com identificando la solicitud. Se verifica titularidad proporcionalmente; conocer un nombre o correo no concede acceso. Las consultas se atienden en máximo diez días hábiles desde su recibo; si no es posible, se informa el motivo y nueva fecha, con hasta cinco días hábiles adicionales. Los reclamos se atienden en máximo quince días hábiles desde el día siguiente a su recibo; si se requiere ampliación se informa antes del vencimiento, con hasta ocho días hábiles adicionales. Si falta información, se solicitará completar conforme al procedimiento legal. Las obligaciones legales o contractuales pueden impedir suprimir ciertos registros; se informa cuáles, motivo y período aplicable.",
      },
      {
        title: "Menores y modificaciones",
        text: "El servicio de cuentas y contratación está dirigido a personas con capacidad legal para contratar; no se diseña para recolectar datos de menores. Cualquier situación que involucre datos de niños o adolescentes requiere las salvaguardas legales y revisión específica. Las nuevas versiones se publicarán con fecha; cambios de finalidades o tratamientos que exijan autorización adicional no se aplicarán por una aceptación genérica anterior.",
      },
    ],
  },
  eliminacion: {
    title: "Política de eliminación de cuentas y datos",
    sections: [
      {
        title: "Cómo solicitarla",
        text: "Puedes iniciar la eliminación permanente desde Mi cuenta → Eliminar cuenta o desde esta página pública mediante el acceso a tu cuenta. Si perdiste el acceso, utiliza recuperación de contraseña o escribe a agroabastossas@gmail.com para verificación asistida. No se exige conservar la app instalada. No envíes contraseñas, códigos de entrega o tokens privados por correo. Se comprueba la sesión y se requiere una verificación reciente antes de una operación irreversible.",
      },
      {
        title: "Verificación y ejecución",
        text: "Una solicitud se verifica con el mecanismo de autenticación disponible; ni un correo, nombre, teléfono ni número de compra conocido son suficientes. Se revocan sesiones y accesos de cuenta y se elimina el perfil, direcciones sincronizadas, favoritos, preferencias y credenciales de la cuenta. Cuando se haya utilizado Apple, debe revocarse la autorización correspondiente; un fallo externo se registra como pendiente, no como eliminación completada. Las solicitudes se tramitan conforme a los términos legales aplicables informados en la política de privacidad. No se anuncia un borrado instantáneo de servicios o respaldos cuyo plazo no esté configurado y comprobado.",
      },
      {
        title: "Información retenida y límites",
        text: "Se conservan únicamente los registros necesarios por obligaciones legales, seguridad o controversias justificadas, con acceso restringido. Los libros y papeles comerciales comprendidos en el artículo 28 de la Ley 962 de 2005 deben conservarse diez años desde la última entrada, documento o comprobante. Esto puede comprender facturas y evidencia comercial de pedidos; no autoriza conservar todas tus direcciones, fotos o preferencias. La revisión jurídica debe definir por clase de dato cualquier otro término aplicable y el tratamiento de respaldos. Una reclamación vigente puede requerir conservación limitada de evidencia y se informará su fundamento. Eliminar la cuenta no cancela automáticamente una compra ni altera inventario, entregas, importes, garantías o derechos pendientes.",
      },
      {
        title: "Dispositivos, invitados y seguimiento",
        text: "La eliminación de cuenta no implica borrar todas las claves de tu navegador, las sesiones administrativas ni carritos o direcciones de invitados ajenos a la cuenta. Puedes administrar esos datos locales desde la app o tu navegador. Un acceso privado anterior de invitado es independiente de la sesión: si deseas su revocación, solicita revisión acreditando titularidad. No se vinculan ni borran pedidos de otras personas por coincidencia de contacto.",
      },
      {
        title: "Estado y reclamaciones",
        text: "El sistema informa si la solicitud está recibida, pendiente de una acción necesaria o completada. Si no puedes verificarla automáticamente, se ofrece asistencia por el canal de privacidad. La empresa debe confirmar la supresión realizada y explicar las retenciones. NIT 901079198; Carrera 79F #2-10, municipio y dígito de verificación pendientes. Texto en borrador, pendiente de aprobación empresarial por Harold Herra y revisión jurídica.",
      },
    ],
  },
};
