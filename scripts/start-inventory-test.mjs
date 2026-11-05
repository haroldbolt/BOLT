import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const directory = path.join(root, '.bolt-private', 'inventory-100-test');
const runtimePath = path.join(directory, 'server.json');
const logPath = path.join(directory, 'server.log');
const markerPath = path.join(directory, 'test-environment.json');
const ENVIRONMENT = 'INVENTORY_100_TEST';

function readConfiguration() {
  try {
    const configuration = JSON.parse(fs.readFileSync(runtimePath, 'utf8'));
    if (configuration.environment !== ENVIRONMENT || !Number.isInteger(configuration.port) || configuration.port < 4330 || configuration.port > 4349 ||
        configuration.baseUrl !== `http://localhost:${configuration.port}` || path.resolve(configuration.root) !== root) return null;
    return configuration;
  } catch { return null; }
}

async function probe() {
  const configuration = readConfiguration();
  if (!configuration) return null;
  try {
    const response = await fetch(`${configuration.baseUrl}/api/v1/health`, { signal: AbortSignal.timeout(2000) });
    if (!response.ok || response.headers.get('x-bolt-environment') !== ENVIRONMENT) return null;
    const info = await response.json();
    return info.appId === 'bolt-pets-actual' && info.status === 'ok' ? configuration : null;
  } catch { return null; }
}

function ensureClientBuild() {
  let latestSource = 0;
  const visit = directoryName => {
    for (const entry of fs.readdirSync(directoryName, { withFileTypes: true })) {
      const full = path.join(directoryName, entry.name);
      if (entry.isDirectory()) visit(full);
      else if (/\.(ts|tsx|css|json)$/.test(entry.name)) latestSource = Math.max(latestSource, fs.statSync(full).mtimeMs);
    }
  };
  visit(path.join(root, 'src'));
  for (const name of ['package.json', 'index.html', 'vite.config.ts', 'tsconfig.json']) latestSource = Math.max(latestSource, fs.statSync(path.join(root, name)).mtimeMs);
  const index = path.join(root, 'dist', 'index.html');
  if (fs.existsSync(index) && fs.statSync(index).mtimeMs >= latestSource) return;
  console.log('Preparando la vista actualizada de la copia de prueba…');
  const result = spawnSync(process.execPath, [path.join(root, 'node_modules', 'vite', 'bin', 'vite.js'), 'build'], { cwd: root, stdio: 'inherit', windowsHide: true });
  if (result.status !== 0) throw new Error('No se pudo compilar el cliente de la copia de prueba.');
}

try {
  if (!fs.existsSync(markerPath)) throw new Error('Primero prepara la copia de inventario de prueba. Este acceso no modifica ni copia la base operativa.');
  const marker = JSON.parse(fs.readFileSync(markerPath, 'utf8'));
  if (marker.environment !== ENVIRONMENT || marker.ready !== true) throw new Error('La preparación de esta copia todavía no está terminada.');
  ensureClientBuild();
  let configuration = await probe();
  if (!configuration) {
    const log = fs.openSync(logPath, 'a');
    let child;
    let failure;
    try {
      child = spawn(process.execPath, ['--import', 'tsx', path.join(root, 'scripts', 'inventory-test-server.mjs')], {
        cwd: root, detached: true, windowsHide: true, stdio: ['ignore', log, log],
      });
      child.once('error', error => { failure = new Error(`No se pudo iniciar la copia: ${error.message}`); });
      child.once('exit', () => { failure = new Error('La copia terminó durante el inicio. Revisa el registro privado.'); });
      child.unref();
    } finally { fs.closeSync(log); }
    const deadline = Date.now() + 90_000;
    let nextProgress = Date.now() + 10_000;
    while (!configuration && Date.now() < deadline) {
      configuration = await probe();
      if (configuration) break;
      // Dos accesos simultáneos pueden reutilizar la instancia ganadora del bloqueo.
      if (failure) throw failure;
      if (Date.now() >= nextProgress) { console.log('La copia de prueba sigue iniciándose…'); nextProgress += 10_000; }
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    if (!configuration) throw new Error('La copia aún no responde. Vuelve a abrir este acceso para comprobar su estado.');
  }
  const targetUrl = configuration.baseUrl + (process.argv.includes('--admin') ? '/operacion' : '/');
  console.log('Tienda de prueba: ' + configuration.baseUrl + '/');
  console.log('Administrador de prueba: ' + configuration.baseUrl + '/operacion');
  console.log('Usa el usuario administrativo de la copia. La base operativa permanece separada.');
  if (process.argv.includes('--open') && process.platform === 'win32') {
    spawn('explorer.exe', [targetUrl], { detached: true, windowsHide: true, stdio: 'ignore' }).unref();
  }
} catch (error) {
  console.error(error.message);
  console.error('Registro privado: ' + logPath);
  process.exitCode = 1;
}
