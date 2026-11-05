import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { occupiedPortError, probeBoltHealth, trackStartup } from './local-startup.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.PORT || 4327);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Puerto local no válido.');
const url = `http://127.0.0.1:${port}`;
const privateDir = path.join(root, '.bolt-private', 'local');
const logFile = path.join(privateDir, 'server.log');
const metadataFile = path.join(privateDir, 'server.json');
const targetUrl = `${url}${process.argv.includes('--admin') ? '/operacion' : '/'}`;
fs.mkdirSync(privateDir, { recursive: true });
const writeMetadata = record => fs.writeFileSync(metadataFile, JSON.stringify(record, null, 2));

function newestSource() {
  let newest = 0;
  function visit(dir) {
    for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, item.name);
      if (item.isDirectory()) visit(full);
      else if (/\.(ts|tsx|css|json)$/.test(item.name)) newest = Math.max(newest, fs.statSync(full).mtimeMs);
    }
  }
  visit(path.join(root, 'src'));
  for (const name of ['server.ts', 'package.json', 'index.html', 'vite.config.ts', 'tsconfig.json']) {
    newest = Math.max(newest, fs.statSync(path.join(root, name)).mtimeMs);
  }
  return newest;
}

function ensureBuild() {
  const server = path.join(root, 'server.js');
  const index = path.join(root, 'dist', 'index.html');
  const lastSource = newestSource();
  if (fs.existsSync(server) && fs.existsSync(index) && Math.min(fs.statSync(server).mtimeMs, fs.statSync(index).mtimeMs) >= lastSource) return;
  if (!fs.existsSync(path.join(root, 'node_modules', 'vite'))) {
    throw new Error('Faltan las dependencias del proyecto. Ejecuta npm install en la carpeta de Bolt Pets.');
  }
  console.log('Preparando la versión local actualizada…');
  for (const args of [
    [path.join(root, 'node_modules/vite/bin/vite.js'), 'build'],
    [path.join(root, 'node_modules/esbuild/bin/esbuild'), 'server.ts', '--bundle', '--platform=node', '--format=esm', '--packages=external', '--outfile=server.js'],
  ]) {
    const result = spawnSync(process.execPath, args, { cwd: root, stdio: 'inherit', windowsHide: true });
    if (result.status !== 0) throw new Error('No se pudo preparar Bolt Pets. Revisa el mensaje de compilación anterior.');
  }
}

try {
  const initial = await probeBoltHealth(url);
  if (initial.status === 'foreign') throw occupiedPortError(url);
  if (initial.status === 'ready') {
    // El proceso puede haberse iniciado por otra terminal; no conservar un PID viejo.
    writeMetadata({ pid: null, url, root, status: 'ready', reused: true, checkedAt: new Date().toISOString() });
    console.log(`Bolt Pets ya está disponible: ${targetUrl}`);
  } else {
    ensureBuild();
    const output = fs.openSync(logFile, 'a');
    let child;
    try {
      child = spawn(process.execPath, [path.join(root, 'server.js')], {
        cwd: root, detached: true, windowsHide: true, stdio: ['ignore', output, output],
        env: { ...process.env, NODE_ENV: 'production', HOST: '127.0.0.1', PORT: String(port) },
      });
      child.unref();
    } finally { fs.closeSync(output); }
    await trackStartup({ child, url, root, writeMetadata, onProgress: seconds => console.log(`Bolt Pets sigue iniciándose (${seconds} segundos)…`) });
    console.log(`Bolt Pets listo: ${targetUrl}`);
  }
  // El servidor queda separado del terminal que lo inició.
  if (process.argv.includes('--open')) {
    if (process.platform === 'win32') spawn('explorer.exe', [targetUrl], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  }
} catch (error) {
  console.error(error.message);
  console.error(`Registro privado del servidor: ${logFile}`);
  process.exitCode = 1;
}
