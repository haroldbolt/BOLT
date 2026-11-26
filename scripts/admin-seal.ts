import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { AdminAuthService } from '../src/lib/adminAuthService';
import { AdminBootstrap } from '../src/lib/adminBootstrap';
import { acquireCatalogWriterLock } from '../src/lib/catalogWriterLock';
import { pilotScope } from '../src/lib/pilotScope';
import { preparePilot } from '../deployment/start-pilot';

const source = fileURLToPath(new URL('../', import.meta.url));
function invalid(): never { throw new Error('Ceremonia de alta no autorizada.'); }

function within(directory: string, candidate: string) {
  const rel = path.relative(directory, candidate);
  return rel === '' || (rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel));
}

function privateOutput(file: string, control: string, volume: string) {
  const directory = fs.realpathSync(path.dirname(file));
  const stat = fs.statSync(directory);
  if (!stat.isDirectory() || (stat.mode & 0o077) !== 0 || within(fs.realpathSync(source), directory) ||
      within(control, directory) || within(volume, directory)) invalid();
  const target = path.join(directory, path.basename(file));
  if (fs.lstatSync(target, { throwIfNoEntry: false })) invalid();
  return target;
}

function publish(file: string, receipt: string) {
  const directory = path.dirname(file);
  const tmp = path.join(directory, '.bolt-receipt-' + randomUUID());
  const fd = fs.openSync(tmp, 'wx', 0o600);
  try {
    try { fs.writeFileSync(fd, receipt + '\n'); fs.fsyncSync(fd); }
    finally { fs.closeSync(fd); }
    // The link publishes a complete receipt and refuses to replace an existing output.
    fs.linkSync(tmp, file);
    const parent = fs.openSync(directory, 'r');
    try { fs.fsyncSync(parent); } finally { fs.closeSync(parent); }
  } finally { fs.unlinkSync(tmp); }
}

function passwordFromStdin() {
  if (process.stdin.isTTY) invalid();
  const bytes = Buffer.alloc(1030);
  try {
    let used = 0;
    while (used < bytes.length) {
      const count = fs.readSync(0, bytes, used, bytes.length - used, null);
      if (count === 0) break;
      used += count;
    }
    const value = bytes.subarray(0, used).toString('utf8').replace(/\r?\n$/, '');
    if (used === bytes.length || value.length < 16 || value.length > 256 ||
        value.trim() !== value || /[\x00-\x1f\x7f]/.test(value)) invalid();
    return value;
  } finally { bytes.fill(0); }
}

function run() {
  const [operation, accountArg, outputArg, ...rest] = process.argv.slice(2);
  if (!['create', 'adopt', 'export'].includes(operation) || rest.length ||
      !accountArg || !path.isAbsolute(accountArg) || !outputArg || !path.isAbsolute(outputArg)) invalid();
  const email = process.env.BOLT_ADMIN_BOOTSTRAP_EMAIL?.trim();
  const configuredVolume = process.env.BOLT_PILOT_VOLUME || process.env.BOLT_ADMIN_VOLUME_DIR;
  const configuredControl = process.env.BOLT_ADMIN_CONTROL_DIR;
  if (!email || !configuredVolume || !configuredControl || !path.isAbsolute(configuredVolume) ||
      !path.isAbsolute(configuredControl) || (operation !== 'export' && process.env.BOLT_ADMIN_CLOSED_RECEIPT)) invalid();
  const volume = fs.realpathSync(configuredVolume);
  const controlDir = fs.realpathSync(configuredControl);
  if (within(fs.realpathSync(source), controlDir) || within(fs.realpathSync(source), volume)) invalid();
  const output = privateOutput(outputArg, controlDir, volume);
  const authFile = path.resolve(accountArg);
  const env = { ...process.env };
  delete env.BOLT_ADMIN_CLOSED_RECEIPT;
  delete env.BOLT_ADMIN_SETUP_TOKEN;
  const control = AdminBootstrap.fromEnvironment(env, authFile);
  const password = operation === 'create' ? passwordFromStdin() : undefined;

  const authorize = () => {
    if (operation === 'create') {
      control.prepare('prepare', email);
    } else if (operation === 'adopt') {
      const raw = fs.readFileSync(authFile, 'utf8');
      if (JSON.parse(raw)?.version !== '1.0.0') invalid();
      // A reservation bound to these exact legacy bytes can resume after interruption.
      let pending = false;
      try { pending = control.inspect(undefined, raw) === 'adopt'; } catch {}
      if (!pending) control.prepare('adopt', email);
    } else if (JSON.parse(fs.readFileSync(authFile, 'utf8'))?.version !== '2.0.0') {
      invalid();
    }
  };
  const seal = () => {
    const staff = new AdminAuthService(authFile, { mode: 'managed', env, offlineBootstrap: true });
    if (operation === 'create' && !staff.setupMasterAdmin({ email, password: password!, name: 'Administración BOLT' }).success) invalid();
    if (staff.setupState() !== 'closed') invalid();
    const binding = JSON.parse(fs.readFileSync(authFile, 'utf8')).bootstrap;
    const receipt = control.closedReceipt(binding, email);
    if (process.env.BOLT_ADMIN_CLOSED_RECEIPT && process.env.BOLT_ADMIN_CLOSED_RECEIPT !== receipt) invalid();
    publish(output, receipt);
  };

  if (env.BOLT_PILOT_VOLUME) {
    const scope = pilotScope(env);
    if (!scope) invalid();
    const expectedFile = path.join(path.resolve(configuredVolume), scope.directory, 'src/data/persisted-admin-auth.json');
    if (authFile !== expectedFile) invalid();
    // The launcher owns the mount lock during both authorization and initialization of its runtime.
    const pilot = preparePilot(source, env, { offlineAdminBootstrap: true, authorize });
    try { seal(); } finally { pilot.release(); }
  } else {
    const lock = path.join(volume, '.bolt-pilot-writer');
    fs.mkdirSync(lock, { mode: 0o700 });
    try {
      const suffix = path.join('src', 'data', 'persisted-admin-auth.json');
      const runtime = authFile.endsWith(path.sep + suffix) ? path.resolve(authFile, '../../..') : volume;
      const release = acquireCatalogWriterLock(runtime);
      try { authorize(); seal(); } finally { release(); }
    } finally { fs.rmdirSync(lock); }
  }
}
try {
  run();
  console.log('Recibo de alta cerrada exportado al archivo privado.');
} catch {
  console.error('Operación rechazada. Verifica la instalación detenida, el control privado y la ruta de salida vacía. Si ya existe el almacén v2, utiliza export con el control original.');
  process.exitCode = 1;
}
