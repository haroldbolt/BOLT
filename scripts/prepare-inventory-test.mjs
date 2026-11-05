import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);
const sourceDir = path.join(root, '.bolt-private', 'operations');
const directory = path.join(root, '.bolt-private', 'inventory-100-test');
const dataDir = path.join(directory, 'data');
const markerPath = path.join(directory, 'test-environment.json');
const sourceFile = path.join(sourceDir, 'admin.sqlite');
const targetFile = path.join(dataDir, 'admin.sqlite');
const environment = 'INVENTORY_100_TEST';
const apply = process.argv.includes('--apply');
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const writePrivate = (filename, value) => fs.writeFileSync(filename, JSON.stringify(value, null, 2), { mode: 0o600 });
const canonical = value => fs.realpathSync.native(value).toLowerCase();

function sourceSnapshot() {
  const source = new DatabaseSync(sourceFile, { readOnly: true });
  try {
    const products = source.prepare('SELECT id,payload,version,updated_at FROM managed_products ORDER BY id').all();
    const state = source.prepare('SELECT payload FROM operational_state WHERE id=1').get();
    const promotions = source.prepare('SELECT * FROM promotions ORDER BY id').all();
    return { products: products.length, orders: state ? JSON.parse(state.payload).orders.length : 0,
      productsHash: digest(products), stateHash: digest(state?.payload), promotionsHash: digest(promotions) };
  } finally { source.close(); }
}

function vacuumCopy(sourceFileName, destination) {
  if (fs.existsSync(destination)) throw new Error('El respaldo ya existe; no se sobrescribe.');
  const source = new DatabaseSync(sourceFileName, { readOnly: true });
  try { source.prepare('VACUUM INTO ?').run(destination); } finally { source.close(); }
  try { fs.chmodSync(destination, 0o600); } catch { /* Windows usa permisos de la carpeta privada. */ }
}

let administration;
try {
  if (process.argv.slice(2).some(argument => !['--apply', '--preview'].includes(argument))) throw new Error('Usa --preview o --apply; la carga nunca se ejecuta al abrir la tienda.');
  if (!fs.existsSync(sourceFile)) throw new Error('No se encontró la base operativa que se debe copiar.');
  fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const privateRoot = canonical(path.join(root, '.bolt-private'));
  if (canonical(directory) !== path.join(privateRoot, 'inventory-100-test') || canonical(dataDir) !== path.join(privateRoot, 'inventory-100-test', 'data') || canonical(sourceDir) === canonical(dataDir)) {
    throw new Error('Las rutas físicas de la copia no están aisladas de los datos originales.');
  }
  const lockFile = path.join(directory, 'instance.lock');
  if (fs.existsSync(lockFile)) {
    const owner = Number(fs.readFileSync(lockFile, 'utf8'));
    if (Number.isSafeInteger(owner) && owner > 0) {
      try { process.kill(owner, 0); throw new Error('Cierra exclusivamente el servidor de esta copia de prueba antes de cargar existencias.'); }
      catch (error) { if (error.code !== 'ESRCH') throw error; }
    }
  }
  const sourceBefore = sourceSnapshot();
  const backups = path.join(directory, 'backups');
  fs.mkdirSync(backups, { recursive: true, mode: 0o700 });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  let marker;
  if (!fs.existsSync(targetFile)) {
    if (fs.existsSync(markerPath)) throw new Error('Hay una preparación anterior incompleta; no se reemplazará su marca automáticamente.');
    const backupFile = path.join(backups, `source-before-stock-${stamp}.sqlite`);
    vacuumCopy(sourceFile, backupFile);
    assert.deepEqual(sourceSnapshot(), sourceBefore, 'La base original cambió durante la copia; no se publica un ensayo desactualizado.');
    fs.copyFileSync(backupFile, targetFile, fs.constants.COPYFILE_EXCL);
    marker = { environment, ready: false, sourceDataDir: sourceDir, dataDir, createdAt: new Date().toISOString(), backupFile };
    writePrivate(markerPath, marker);
    writePrivate(path.join(directory, 'source-before.json'), sourceBefore);
    // Conserva las cuentas, pero la copia exige iniciar sesión de nuevo.
    const copied = new DatabaseSync(targetFile);
    try { copied.exec('DELETE FROM admin_sessions; DELETE FROM admin_login_attempts;'); } finally { copied.close(); }
  } else {
    marker = JSON.parse(fs.readFileSync(markerPath, 'utf8'));
    if (marker.environment !== environment || canonical(marker.dataDir) !== canonical(dataDir) || canonical(marker.sourceDataDir) !== canonical(sourceDir)) throw new Error('Esta base no corresponde a la copia de prueba esperada.');
    if (apply) vacuumCopy(targetFile, path.join(backups, `test-before-stock-${stamp}.sqlite`));
  }
  const originalIdentity = fs.statSync(sourceFile, { bigint: true });
  const copyIdentity = fs.statSync(targetFile, { bigint: true });
  if (fs.lstatSync(targetFile).isSymbolicLink() || (originalIdentity.ino !== 0n && originalIdentity.ino === copyIdentity.ino && originalIdentity.dev === copyIdentity.dev)) throw new Error('La base de prueba no puede ser un enlace al archivo original.');
  const { AdminRepository } = await import('../src/lib/adminRepository.ts');
  const { localCatalogService } = await import('../src/lib/localCatalogService.ts');
  const { previewTestInventorySeed, applyTestInventorySeed } = await import('../src/lib/testInventorySeed.ts');
  const stores = structuredClone(localCatalogService.getStores());
  administration = new AdminRepository({ dataDir, products: [], stores });
  if (!administration.products.length) throw new Error('La copia no contiene productos; no se inventará un catálogo.');
  const aliases = new Map(stores.flatMap(store => [[store.id, store.id], [store.shopifyLocationGid, store.id]]));
  const preservedCatalog = () => digest(administration.db.prepare('SELECT id,payload FROM managed_products ORDER BY id').all().map(row => ({ id: row.id,
    product: JSON.parse(JSON.stringify(JSON.parse(row.payload), (key, value) => {
      if (key === 'stockByStore' || key === 'inventoryVerifiedByStore') return undefined;
      if (key === 'bodegaIds' && Array.isArray(value)) return [...new Set(value.map(id => aliases.get(id) || id))].sort();
      return value;
    })) })));
  const catalogBefore = preservedCatalog();
  const stateBefore = digest(administration.db.prepare('SELECT payload FROM operational_state WHERE id=1').get());
  if (apply) writePrivate(markerPath, { ...marker, ready: false });
  const report = apply ? applyTestInventorySeed(administration, { id: 'LOCAL-INVENTORY-TEST', username: 'carga.prueba', displayName: 'Carga manual de inventario de prueba' }) : previewTestInventorySeed(administration);
  assert.equal(preservedCatalog(), catalogBefore, 'La carga no puede cambiar reservas, precios, pesos, estados ni asociaciones reales.');
  assert.equal(digest(administration.db.prepare('SELECT payload FROM operational_state WHERE id=1').get()), stateBefore, 'La carga no puede modificar pedidos, pagos o GPS.');
  assert.deepEqual(sourceSnapshot(), sourceBefore, 'La base operativa original debe permanecer intacta.');
  const following = previewTestInventorySeed(administration);
  if (apply) assert.equal(following.changedPairs, 0, 'Repetir una carga sin operaciones intermedias no debe modificar cantidades.');
  const summary = { applied: apply, environment, products: report.products, presentations: report.presentations,
    warehousePairs: report.eligiblePairs, updatedPairs: report.changedPairs, alreadyAt100: report.unchangedPairs,
    exceptions: report.exceptions.length, pendingPresentations: report.pendingData.length,
    missingPrice: report.pendingData.filter(row => row.missing.includes('price')).length,
    missingWeight: report.pendingData.filter(row => row.missing.includes('weightKg')).length,
    nonActive: report.pendingData.filter(row => row.missing.includes('activeStatus')).length, byStore: report.byStore,
    sourceUnchanged: true, ordersAndReservationsPreserved: true, checkedAt: new Date().toISOString() };
  writePrivate(path.join(directory, apply ? 'load-report.json' : 'preview-report.json'), { summary, report });
  if (apply) writePrivate(markerPath, { ...marker, ready: true, lastManualLoadAt: summary.checkedAt, summary });
  writePrivate(path.join(directory, 'source-verified.json'), sourceSnapshot());
  console.log(JSON.stringify(summary, null, 2));
  console.log('Acceso administrativo: usa tu mismo usuario y contraseña local; la copia tiene sesiones independientes.');
} catch (error) { console.error(error.message); process.exitCode = 1; }
finally { administration?.close(); }
