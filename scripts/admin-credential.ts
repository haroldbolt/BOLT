import fs from 'node:fs';
import path from 'node:path';
import { acquireCatalogWriterLock } from '../src/lib/catalogWriterLock';
import { AdminAuthService } from '../src/lib/adminAuthService';

// Trusted offline operation, with the same exclusive writers as the runtime.
function run() {
  const [action, runtime, ...rest] = process.argv.slice(2);
  const email = process.env.BOLT_ADMIN_MAINTENANCE_EMAIL?.trim();
  if (!runtime || !path.isAbsolute(runtime) || rest.length || !email || !['warn', 'rotate'].includes(action)) {
    throw Error('Configura BOLT_ADMIN_MAINTENANCE_EMAIL y usa admin-credential.ts warn|rotate /ruta/absoluta/al/runtime.');
  }
  const authFile = path.join(fs.realpathSync(runtime), 'src/data/persisted-admin-auth.json');
  if (!fs.lstatSync(authFile).isFile()) throw Error('Se requiere el almacén administrativo de la instalación.');
  // The pilot launcher holds this lock also across containers with different PID namespaces.
  const canonicalRuntime = fs.realpathSync(runtime);
  const managedPilot = fs.existsSync(path.join(canonicalRuntime, '.bolt-private/pilot.json'));
  const volume = process.env.BOLT_PILOT_VOLUME || process.env.BOLT_ADMIN_VOLUME_DIR;
  if (!volume || (managedPilot && fs.realpathSync(volume) !== path.dirname(canonicalRuntime))) {
    throw Error('Comprueba el volumen administrativo de esta instalación.');
  }
  const pilotLock = (managedPilot || process.env.BOLT_PILOT_VOLUME) && path.join(fs.realpathSync(volume), '.bolt-pilot-writer');
  if (pilotLock) fs.mkdirSync(pilotLock, { mode: 0o700 });
  try {
    const release = acquireCatalogWriterLock(runtime);
    try {
      const auth = new AdminAuthService(authFile);
      if (auth.setupState() !== 'closed') throw Error('La instalación administrativa requiere recuperación autorizada.');
      if (action === 'warn') {
        auth.maintainCredential(email);
      } else {
        if (process.stdin.isTTY) throw Error('Suministra el secreto por entrada estándar desde el gestor aprobado.');
        const secret = fs.readFileSync(0);
        try { auth.maintainCredential(email, secret.toString('utf8').replace(/\r?\n$/, '')); }
        finally { secret.fill(0); }
      }
    } finally { release(); }
  } finally { if (pilotLock) fs.rmdirSync(pilotLock); }
}
try { run(); console.log('Cambio administrativo guardado.'); }
catch { console.error('Operación administrativa rechazada. Comprueba la instalación, el modo de mantenimiento, la cuenta y la entrada privada.'); process.exitCode = 1; }
