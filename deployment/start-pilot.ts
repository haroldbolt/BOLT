import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { atomicJson, checkStorageRelease, FulfillmentStorage } from '../src/lib/fulfillmentStorage';
import { newDispatchState } from '../src/types/dispatch';

const source = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const marker = { version: 1, kind: 'BOLT_PILOT', storeId: 'HUB_SUBA' };
const pilotDirectory = 'bolt-piloto-suba';
const dataRelative = '.bolt-private/orders';

function isWithin(root: string, candidate: string) {
  return candidate === root || candidate.startsWith(root + path.sep);
}

function dedicatedVolume(sourceDir: string, env: NodeJS.ProcessEnv): string {
  if (env.BOLT_PILOT_STORE_ID !== marker.storeId) throw Error('El arranque del piloto requiere BOLT_PILOT_STORE_ID=HUB_SUBA.');
  if (env.BOLT_DISPATCH_SIMULATION === '1' || env.BOLT_DEMO_PASSWORD || env.RAILWAY_ENVIRONMENT_NAME?.toLowerCase() === 'demo') {
    throw Error('Selecciona el servicio independiente del piloto.');
  }
  if (!env.BOLT_PILOT_VOLUME || !path.isAbsolute(env.BOLT_PILOT_VOLUME)) throw Error('Configura BOLT_PILOT_VOLUME con la ruta absoluta del volumen montado.');
  const volume = fs.realpathSync(env.BOLT_PILOT_VOLUME);
  const code = fs.realpathSync(sourceDir);
  if (!fs.statSync(volume).isDirectory() || path.parse(volume).root === volume || isWithin(code, volume) || isWithin(volume, code)) {
    throw Error('Usa un volumen operativo independiente del código.');
  }
  if ((env.RAILWAY_PROJECT_ID || env.RAILWAY_VOLUME_MOUNT_PATH) &&
      (!env.RAILWAY_VOLUME_MOUNT_PATH || fs.realpathSync(env.RAILWAY_VOLUME_MOUNT_PATH) !== volume)) {
    throw Error('BOLT_PILOT_VOLUME debe coincidir con el volumen montado por Railway.');
  }
  const simulationMarkers = ['.bolt-private/hosted-demo.json', '.bolt-private/dispatch-simulation.json'];
  if (fs.readdirSync(volume).some(name => name.startsWith('bolt-dispatch-simulation-')) ||
      [volume, path.join(volume, pilotDirectory)].some(directory =>
        simulationMarkers.some(name => fs.existsSync(path.join(directory, name))))) {
    throw Error('El volumen contiene una instalación de simulación.');
  }
  return volume;
}

function linkReleaseData(sourceDir: string, runtime: string) {
  const local = path.join(runtime, 'src/data');
  for (const name of ['catalogo-local', 'geography']) {
    const bundled = path.join(sourceDir, 'src/data', name);
    if (!fs.statSync(bundled).isDirectory()) throw Error('Faltan los datos de la versión de BOLT.');
    const link = path.join(local, name);
    const entry = fs.lstatSync(link, { throwIfNoEntry: false });
    if (entry && !entry.isSymbolicLink()) throw Error(`Respalda los datos de ${name} del piloto antes de iniciar otra versión.`);
    if (entry && fs.readlinkSync(link) === bundled) continue;
    if (entry) fs.unlinkSync(link);
    fs.symlinkSync(bundled, link, 'dir');
  }
}

function checkAdmin(runtime: string, env: NodeJS.ProcessEnv) {
  const filename = path.join(runtime, 'src/data/persisted-admin-auth.json');
  if (fs.existsSync(filename)) {
    const data = JSON.parse(fs.readFileSync(filename, 'utf8'));
    if (data?.version !== '1.0.0' || !Array.isArray(data.admins) || !data.admins.length || data.admins.some((admin: {
      email?: unknown; passwordHash?: unknown; salt?: unknown; role?: unknown;
    } | null) =>
      typeof admin?.email !== 'string' || typeof admin.passwordHash !== 'string' || typeof admin.salt !== 'string' || admin.role !== 'ADMINISTRADOR')) {
      throw Error('Almacenamiento de administración inválido. Recupera la copia autorizada.');
    }
  } else if ((env.BOLT_ADMIN_SETUP_TOKEN?.trim().length ?? 0) < 32) {
    throw Error('Configura BOLT_ADMIN_SETUP_TOKEN para crear la cuenta administrativa inicial.');
  }
}

export function preparePilot(sourceDir: string, env: NodeJS.ProcessEnv) {
  const volume = dedicatedVolume(sourceDir, env);
  const runtime = path.join(volume, pilotDirectory);
  const data = path.join(runtime, dataRelative);
  const entry = path.join(sourceDir, 'server.js');
  if (!fs.existsSync(entry) || !fs.existsSync(path.join(sourceDir, 'dist/index.html'))) throw Error('Compila la versión del piloto antes de iniciar.');

  // This lock also excludes writers in different containers sharing the volume.
  const lock = path.join(volume, '.bolt-pilot-writer');
  try { fs.mkdirSync(lock, { mode: 0o700 }); }
  catch (error: any) {
    if (error?.code !== 'EEXIST') throw error;
    throw Error('El volumen del piloto tiene un bloqueo de escritura. Comprueba la instancia anterior.');
  }
  const release = () => fs.rmdirSync(lock);

  try {
    const current = fs.lstatSync(runtime, { throwIfNoEntry: false });
    if (!current) {
      checkAdmin(runtime, env);
      const stage = fs.mkdtempSync(path.join(volume, '.bolt-pilot-initializing-'));
      try {
        fs.mkdirSync(path.join(stage, 'src/data'), { recursive: true, mode: 0o700 });
        fs.mkdirSync(path.join(stage, 'public/uploads'), { recursive: true, mode: 0o700 });
        const initialData = path.join(stage, dataRelative);
        checkStorageRelease(initialData, sourceDir);
        new FulfillmentStorage(initialData).commit({ orders: [], drivers: [], audit: [], telemetry: {}, dispatch: newDispatchState() });
        atomicJson(path.join(stage, '.bolt-private/pilot.json'), marker);
        fs.renameSync(stage, runtime);
      } catch (error) {
        fs.rmSync(stage, { recursive: true, force: true });
        throw error;
      }
    } else if (!current.isDirectory()) {
      throw Error('El directorio del piloto debe estar dentro de su volumen.');
    }
    const actual = JSON.parse(fs.readFileSync(path.join(runtime, '.bolt-private/pilot.json'), 'utf8'));
    if (actual?.version !== marker.version || actual.kind !== marker.kind || actual.storeId !== marker.storeId) throw Error('Volumen incompatible con el piloto de Suba.');
    if (checkStorageRelease(data, sourceDir).sourceVersion !== 2) throw Error('No se encontró el almacenamiento operativo v2.');
    checkAdmin(runtime, env);
    linkReleaseData(sourceDir, runtime);
    return { data, entry, runtime, release };
  } catch (error) {
    release();
    throw error;
  }
}

function start() {
  const { data, entry, runtime, release } = preparePilot(source, process.env);
  const child = spawn(process.execPath, [entry], {
    cwd: runtime,
    env: { ...process.env, NODE_ENV: 'production', BOLT_DATA_DIR: data, BOLT_DISPATCH_SIMULATION: '0' },
    stdio: 'inherit',
  });
  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    child.kill('SIGTERM');
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
  child.on('error', () => { console.error('No se pudo iniciar BOLT en el volumen del piloto.'); });
  child.on('close', (code, signal) => {
    process.off('SIGTERM', stop);
    process.off('SIGINT', stop);
    if (child.pid) for (const directory of [runtime, data]) {
      const childLock = path.join(directory, '.bolt-private/catalog-writer.lock');
      if (fs.existsSync(childLock) && fs.readFileSync(childLock, 'utf8') === String(child.pid)) fs.unlinkSync(childLock);
    }
    release();
    process.exitCode = code ?? (stopping && signal === 'SIGTERM' ? 0 : 1);
  });
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) start();
