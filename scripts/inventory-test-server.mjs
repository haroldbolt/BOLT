import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const directory = path.join(root, '.bolt-private', 'inventory-100-test');
const dataDir = path.join(directory, 'data');
const markerPath = path.join(directory, 'test-environment.json');
const runtimePath = path.join(directory, 'server.json');
const lockPath = path.join(directory, 'instance.lock');
const ENVIRONMENT = 'INVENTORY_100_TEST';
const normalize = value => path.resolve(value).replace(/[\\/]+$/, '').toLowerCase();
const samePath = (left, right) => normalize(left) === normalize(right);

function assertPreparedCopy() {
  if (!fs.existsSync(markerPath)) throw new Error('Primero prepara la copia privada de inventario de prueba.');
  const marker = JSON.parse(fs.readFileSync(markerPath, 'utf8'));
  if (marker.environment !== ENVIRONMENT || marker.ready !== true || !marker.sourceDataDir || !marker.dataDir ||
      !samePath(marker.dataDir, dataDir) || samePath(marker.sourceDataDir, dataDir)) {
    throw new Error('La marca de preparación de esta copia de prueba no es válida. No se abrió ninguna base.');
  }
  if (!fs.existsSync(path.join(dataDir, 'admin.sqlite'))) throw new Error('Falta la base privada preparada de esta copia.');
  const realDataDir = fs.realpathSync(dataDir);
  const realSource = fs.realpathSync(marker.sourceDataDir);
  const operational = path.join(root, '.bolt-private', 'operations');
  if (samePath(realDataDir, realSource) || (fs.existsSync(operational) && samePath(realDataDir, fs.realpathSync(operational)))) {
    throw new Error('La ruta de prueba apunta a datos operativos. Se rechazó el inicio.');
  }
  // Tampoco se acepta una carpeta de prueba redirigida fuera de este espacio privado.
  const realDirectory = fs.realpathSync(directory);
  if (!samePath(realDirectory, path.join(fs.realpathSync(path.join(root, '.bolt-private')), 'inventory-100-test'))) throw new Error('La carpeta de prueba no puede redirigirse fuera del espacio privado.');
  if (!samePath(path.dirname(realDataDir), realDirectory)) throw new Error('La carpeta de datos de prueba no está aislada.');
  const testFile = path.join(dataDir, 'admin.sqlite');
  const sourceFile = path.join(realSource, 'admin.sqlite');
  if (fs.lstatSync(testFile).isSymbolicLink()) throw new Error('La base de prueba no puede ser un enlace.');
  if (fs.existsSync(sourceFile)) {
    const original = fs.statSync(sourceFile, { bigint: true });
    const copied = fs.statSync(testFile, { bigint: true });
    if (original.ino !== 0n && original.ino === copied.ino && original.dev === copied.dev) throw new Error('La base de prueba apunta al archivo operativo.');
  }
  return marker;
}

function writeRuntime(record) {
  const temporary = runtimePath + '.tmp';
  fs.writeFileSync(temporary, JSON.stringify(record, null, 2), { mode: 0o600 });
  fs.renameSync(temporary, runtimePath);
}

function obtainLock() {
  if (fs.existsSync(lockPath)) {
    const owner = Number(fs.readFileSync(lockPath, 'utf8'));
    let alive = false;
    if (Number.isSafeInteger(owner) && owner > 0) {
      try { process.kill(owner, 0); alive = true; } catch (error) { if (error.code !== 'ESRCH') alive = true; }
    }
    if (alive) throw new Error('La copia de prueba ya está iniciada o iniciándose. Vuelve a usar su acceso directo.');
    fs.unlinkSync(lockPath);
  }
  fs.writeFileSync(lockPath, String(process.pid), { flag: 'wx', mode: 0o600 });
  process.on('exit', () => {
    try { if (fs.readFileSync(lockPath, 'utf8') === String(process.pid)) fs.unlinkSync(lockPath); } catch { /* No retirar otro bloqueo. */ }
  });
}

async function start() {
  assertPreparedCopy();
  if (!fs.existsSync(path.join(root, 'dist', 'index.html'))) throw new Error('Falta compilar el cliente. Usa el acceso directo de la copia de prueba.');
  obtainLock();
  process.chdir(root);
  process.env.NODE_ENV = 'production';
  process.env.BOLT_DATA_DIR = dataDir;
  delete process.env.BOLT_PUBLIC_ORIGIN;

  const { localCatalogService } = await import('../src/lib/localCatalogService.ts');
  const { AdminRepository } = await import('../src/lib/adminRepository.ts');
  const { OrdersRepository } = await import('../src/lib/ordersRepository.ts');
  const { createBoltApp } = await import('../server.ts');
  const products = structuredClone(localCatalogService.getAllGroupedProducts());
  const stores = structuredClone(localCatalogService.getStores());
  const administration = new AdminRepository({ dataDir, products, stores });
  let application;
  let server;
  try {
    // La carga de 100 no se ejecuta aquí: los cambios de un ensayo deben persistir.
    const repository = new OrdersRepository({ dataDir, initialOrders: [], initialDrivers: [] });
    application = await createBoltApp({ products, stores, repository, adminRepository: administration, serveFrontend: false });
    const wrapper = express();
    wrapper.disable('x-powered-by');
    wrapper.use((req, res, next) => {
      res.set('X-Bolt-Environment', ENVIRONMENT);
      res.set('Cache-Control', 'no-store');
      if (/^\/api\/v1\/(?:shopify|integrations|payments?|transport|providers|webhooks?)(?:\/|$)/i.test(req.path)) {
        return res.status(409).json({ error: 'Conexiones comerciales desactivadas en esta copia de prueba.', code: 'TEST_ENVIRONMENT_ONLY' });
      }
      next();
    });
    wrapper.use(application);
    wrapper.use(express.static(path.join(root, 'dist'), { index: false }));
    const banner = '<aside id="inventory-test-banner" role="note"><strong>INVENTARIO DE PRUEBA</strong> · Cantidades ficticias · Sin cobros ni despachos reales <nav><a href="/">Cliente</a> · <a href="/operacion">Administración</a></nav></aside>';
    const style = '<style>#inventory-test-banner{position:fixed;top:0;left:0;right:0;z-index:2147483647;background:#fff3c4;color:#523300;border-bottom:2px solid #edb400;padding:7px 12px;font:12px/1.35 system-ui;text-align:center;min-height:43px;box-sizing:border-box}#inventory-test-banner nav{display:inline;margin-left:8px}#inventory-test-banner a{font-weight:700;text-decoration:underline}body{padding-top:62px!important}.fixed.inset-0{top:62px!important}header.sticky.top-0{top:62px!important}</style>';
    wrapper.get('*', (req, res) => {
      if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Ruta no encontrada.' });
      const html = fs.readFileSync(path.join(root, 'dist', 'index.html'), 'utf8');
      res.type('html').send(html.replace('</head>', style + '</head>').replace(/(<body[^>]*>)/, '$1' + banner));
    });

    let previous;
    try { previous = JSON.parse(fs.readFileSync(runtimePath, 'utf8')); } catch { /* Primera apertura. */ }
    const candidates = [...new Set([previous?.port, ...Array.from({ length: 20 }, (_, index) => 4330 + index)])];
    let port;
    for (const candidate of candidates) {
      if (!Number.isInteger(candidate) || candidate < 4330 || candidate > 4349) continue;
      try {
        process.env.BOLT_PUBLIC_ORIGIN = `http://localhost:${candidate}`;
        server = await new Promise((resolve, reject) => {
          const listening = wrapper.listen(candidate, '127.0.0.1', () => resolve(listening));
          listening.once('error', reject);
        });
        port = candidate;
        break;
      } catch (error) { if (error.code !== 'EADDRINUSE') throw error; }
    }
    if (!server) throw new Error('No hay un puerto libre para la copia de prueba; no se cerró ningún otro programa.');
    const baseUrl = `http://localhost:${port}`;
    writeRuntime({ pid: process.pid, root, dataDir, port, baseUrl, environment: ENVIRONMENT, status: 'ready', startedAt: new Date().toISOString() });
    console.log(`Copia de inventario de prueba lista: ${baseUrl}/ · Administración: ${baseUrl}/operacion`);
    const stop = () => {
      server.close(() => { application.locals.closeAdmin(); process.exit(0); });
      server.closeAllConnections?.();
    };
    process.once('SIGTERM', stop);
    process.once('SIGINT', stop);
  } catch (error) {
    if (server) server.close();
    if (application) application.locals.closeAdmin(); else administration.close();
    throw error;
  }
}

start().catch(error => { console.error(error.message); process.exitCode = 1; });
