import path from 'node:path';
import { AdminBootstrap } from '../src/lib/adminBootstrap';

const [operation, authFile, ...rest] = process.argv.slice(2);
const email = process.env.BOLT_ADMIN_BOOTSTRAP_EMAIL?.trim();
if ((operation !== 'prepare' && operation !== 'adopt') || !authFile || !path.isAbsolute(authFile) || rest.length || !email) {
  console.error('Usa admin-bootstrap.ts prepare|adopt /ruta/absoluta/al/archivo-de-cuentas. Configura BOLT_ADMIN_BOOTSTRAP_EMAIL en el entorno de mantenimiento.');
  process.exitCode = 2;
} else {
  try {
    AdminBootstrap.fromEnvironment(process.env, authFile).prepare(operation, email);
    console.log('Autorización preparada para esta instalación. El plazo inicial de una hora comienza en la primera preparación.');
  } catch {
    console.error('No se preparó el alta. Verifica la identidad, el volumen, la cuenta y el control externo privado antes de recuperar la instalación.');
    process.exitCode = 1;
  }
}
