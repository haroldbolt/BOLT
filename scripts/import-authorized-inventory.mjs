import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);
const snapshotPath = path.join(root, 'src', 'data', 'inventario-autorizado.json');
let repository;
try {
  if (process.argv.slice(2).some(argument => !['--apply', '--preview'].includes(argument))) throw new Error('Usa --preview para revisar o --apply para la importación inicial.');
  if (!fs.existsSync(snapshotPath)) throw new Error('No se encontró el inventario autorizado incluido en el repositorio.');
  const snapshot = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'));
  const { AdminRepository } = await import('../src/lib/adminRepository.ts');
  const { localCatalogService } = await import('../src/lib/localCatalogService.ts');
  const { importAuthorizedInventory, validateAuthorizedInventorySnapshot } = await import('../src/lib/authorizedInventoryImport.ts');
  const dataDir = path.resolve(process.env.BOLT_DATA_DIR || path.join(root, '.bolt-private', 'operations'));
  repository = new AdminRepository({ dataDir, products: structuredClone(localCatalogService.getAllGroupedProducts()), stores: structuredClone(localCatalogService.getStores()) });
  const applying = process.argv.includes('--apply');
  const report = applying ? importAuthorizedInventory(repository, snapshot) : validateAuthorizedInventorySnapshot(repository, snapshot);
  console.log(JSON.stringify({ applied: applying && !report.alreadyImported, ...report }, null, 2));
  console.log(report.alreadyImported ? 'Esta versión ya estaba importada: se conservaron las cantidades actuales.' : applying ? 'Inventario inicial guardado. Los precios y pesos pendientes continúan pendientes.' : 'Revisión terminada sin cargar cantidades. Usa --apply únicamente sobre una base nueva.');
} catch (error) { console.error(error.message); process.exitCode = 1; }
finally { repository?.close(); }
