import fs from 'node:fs';
import path from 'node:path';
import { AdminRepository } from './adminRepository';
import type { AdminUser, AdminProduct, AdminPresentation } from '../types/admin';

export const TEST_INVENTORY_ENVIRONMENT = 'INVENTORY_100_TEST';
export const TEST_PHYSICAL_QUANTITY = 100;
const ADJUSTMENT_REASON = 'Carga de inventario de prueba: 100 unidades físicas. Cantidad ficticia exclusiva de esta copia aislada.';

export interface TestInventorySeedException {
  productId: string;
  variantId?: string;
  storeId?: string;
  code: 'UNKNOWN_STORE' | 'INACTIVE_STORE' | 'NO_ACTIVE_ASSOCIATION' | 'INVALID_RESERVATION' | 'RESERVATION_OVER_TARGET' | 'INVALID_PRESENTATION';
  message: string;
}
export interface TestInventorySeedReport {
  environment: typeof TEST_INVENTORY_ENVIRONMENT;
  targetPhysicalQuantity: 100;
  products: number;
  presentations: number;
  activeStores: number;
  associatedPairs: number;
  eligiblePairs: number;
  changedPairs: number;
  unchangedPairs: number;
  affectedProducts: number;
  byStore: Record<string, { name: string; eligible: number; changed: number; unchanged: number }>;
  exceptions: TestInventorySeedException[];
  pendingData: Array<{ productId: string; variantId?: string; missing: Array<'price' | 'weightKg' | 'activeStatus'> }>;
}
type Pair = { productId: string; variantId?: string; storeId: string; change: boolean };
const canonical = (value: string) => {
  const resolved = fs.realpathSync.native(value);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
};
const isWithin = (target: string, parent: string) => target === parent || target.startsWith(parent + path.sep);

/** A manifest plus physical path checks keep this manual utility out of the operational database. */
function assertTestEnvironment(repository: AdminRepository): void {
  const dataDir = canonical(repository.dataDir);
  const segments = dataDir.split(path.sep);
  if (!segments.includes('.bolt-private')) throw new Error('La carga de prueba requiere una carpeta .bolt-private aislada.');
  if (segments.some((segment, index) => segment === '.bolt-private' && segments[index + 1] === 'operations')) throw new Error('No se permite cargar inventario ficticio en la base operativa.');
  const operational = path.resolve(process.cwd(), '.bolt-private', 'operations');
  if (fs.existsSync(operational) && isWithin(dataDir, canonical(operational))) throw new Error('No se permite cargar inventario ficticio en la base operativa.');
  const manifestPath = path.join(path.dirname(repository.dataDir), 'test-environment.json');
  const stat = fs.lstatSync(manifestPath);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 10000) throw new Error('El marcador de la copia de pruebas no es válido.');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (manifest.environment !== TEST_INVENTORY_ENVIRONMENT || typeof manifest.dataDir !== 'string' ||
      typeof manifest.sourceDataDir !== 'string' || canonical(manifest.dataDir) !== dataDir) {
    throw new Error('La base no está identificada como copia de inventario de prueba.');
  }
  const sourceDir = canonical(manifest.sourceDataDir);
  if (isWithin(dataDir, sourceDir) || isWithin(sourceDir, dataDir)) throw new Error('La copia de prueba debe estar separada de la carpeta original.');
  const sourceDb = path.join(sourceDir, 'admin.sqlite');
  const testDb = path.join(dataDir, 'admin.sqlite');
  if (fs.existsSync(sourceDb)) {
    const source = fs.statSync(sourceDb, { bigint: true });
    const target = fs.statSync(testDb, { bigint: true });
    if (source.ino !== 0n && source.ino === target.ino && source.dev === target.dev) throw new Error('La copia y la base original apuntan al mismo archivo.');
  }
}

function buildPlan(repository: AdminRepository): { report: TestInventorySeedReport; pairs: Pair[] } {
  assertTestEnvironment(repository);
  const report: TestInventorySeedReport = {
    environment: TEST_INVENTORY_ENVIRONMENT, targetPhysicalQuantity: TEST_PHYSICAL_QUANTITY,
    products: repository.products.length, presentations: 0, activeStores: repository.stores.filter(store => store.isActive).length,
    associatedPairs: 0, eligiblePairs: 0, changedPairs: 0, unchangedPairs: 0, affectedProducts: 0,
    byStore: Object.fromEntries(repository.stores.filter(store => store.isActive).map(store => [store.id, { name: store.name, eligible: 0, changed: 0, unchanged: 0 }])),
    exceptions: [], pendingData: [],
  };
  const aliases = new Map<string, string>();
  for (const store of repository.stores) {
    aliases.set(store.id, store.id);
    if (store.shopifyLocationGid) {
      const previous = aliases.get(store.shopifyLocationGid);
      if (previous && previous !== store.id) throw new Error('Dos bodegas comparten un identificador histórico; revisa la asociación antes de cargar.');
      aliases.set(store.shopifyLocationGid, store.id);
    }
  }
  const pairs: Pair[] = [];
  const changedProducts = new Set<string>();
  for (const product of repository.products as AdminProduct[]) {
    const presentations: Array<AdminPresentation | undefined> = product.presentaciones?.length ? product.presentaciones : [undefined];
    const seenVariants = new Set<string>();
    for (const [index, presentation] of presentations.entries()) {
      const primary = index === 0;
      const variantId = presentation?.varianteId;
      if (presentation && (typeof variantId !== 'string' || !variantId || seenVariants.has(variantId))) {
        report.exceptions.push({ productId: product.id, variantId, code: 'INVALID_PRESENTATION', message: 'Presentación sin identificador único; no se puede ajustar con seguridad.' });
        continue;
      }
      if (variantId) seenVariants.add(variantId);
      report.presentations++;
      const source = primary ? product : presentation!;
      const missing: TestInventorySeedReport['pendingData'][number]['missing'] = [];
      if (!(typeof source.price === 'number' && Number.isFinite(source.price) && source.price > 0)) missing.push('price');
      if (!(typeof source.weightKg === 'number' && Number.isFinite(source.weightKg) && source.weightKg > 0)) missing.push('weightKg');
      if (product.status && product.status !== 'ACTIVE') missing.push('activeStatus');
      if (missing.length) report.pendingData.push({ productId: product.id, variantId, missing });
      // A parent's associations may be the union of several variants: do not use it for a different presentation.
      const associations = presentation ? presentation.bodegaIds : product.bodegaIds;
      const storeIds = new Set<string>();
      for (const association of Array.isArray(associations) ? associations : []) {
        const resolved = typeof association === 'string' ? aliases.get(association) : undefined;
        if (!resolved) {
          report.exceptions.push({ productId: product.id, variantId, storeId: typeof association === 'string' ? association : undefined, code: 'UNKNOWN_STORE', message: 'Asociación histórica sin una bodega identificada; se conserva sin asignar.' });
        } else storeIds.add(resolved);
      }
      let activeAssociations = 0;
      for (const storeId of storeIds) {
        const store = repository.stores.find(item => item.id === storeId)!;
        if (!store.isActive) {
          report.exceptions.push({ productId: product.id, variantId, storeId, code: 'INACTIVE_STORE', message: 'Bodega inactiva; no se modifica su inventario.' });
          continue;
        }
        activeAssociations++;
        report.associatedPairs++;
        const reserved = source.reservedStockByStore && Object.hasOwn(source.reservedStockByStore, storeId) ? source.reservedStockByStore[storeId] : 0;
        if (!Number.isSafeInteger(reserved) || reserved < 0) {
          report.exceptions.push({ productId: product.id, variantId, storeId, code: 'INVALID_RESERVATION', message: 'Reserva inválida, negativa o fraccionaria; se omite el ajuste.' });
          continue;
        }
        if (reserved > TEST_PHYSICAL_QUANTITY) {
          report.exceptions.push({ productId: product.id, variantId, storeId, code: 'RESERVATION_OVER_TARGET', message: 'Las reservas superan 100; no se reducen ni se eliminan.' });
          continue;
        }
        const first = primary ? presentation : undefined;
        const mirrorDiffers = !!first && (JSON.stringify(first.stockByStore || {}) !== JSON.stringify(product.stockByStore || {}) ||
          JSON.stringify(first.reservedStockByStore || {}) !== JSON.stringify(product.reservedStockByStore || {}) ||
          JSON.stringify(first.inventoryVerifiedByStore || {}) !== JSON.stringify(product.inventoryVerifiedByStore || {}));
        const change = source.stockByStore?.[storeId] !== TEST_PHYSICAL_QUANTITY || source.inventoryVerifiedByStore?.[storeId] !== true || mirrorDiffers;
        pairs.push({ productId: product.id, variantId, storeId, change });
        report.eligiblePairs++;
        report.byStore[storeId].eligible++;
        if (change) {
          report.changedPairs++;
          report.byStore[storeId].changed++;
          changedProducts.add(product.id);
        } else {
          report.unchangedPairs++;
          report.byStore[storeId].unchanged++;
        }
      }
      if (!activeAssociations) report.exceptions.push({ productId: product.id, variantId, code: 'NO_ACTIVE_ASSOCIATION', message: 'La presentación no tiene ninguna bodega activa identificada; no se inventa una asociación.' });
    }
  }
  report.affectedProducts = changedProducts.size;
  return { report, pairs };
}

/** Inspection only: no writes, movements, product changes or inventory reservations. */
export function previewTestInventorySeed(repository: AdminRepository): TestInventorySeedReport {
  return buildPlan(repository).report;
}

/** Manual operation only; importing this module never seeds or resets inventory. */
export function applyTestInventorySeed(repository: AdminRepository, actor: AdminUser): TestInventorySeedReport {
  const { report, pairs } = buildPlan(repository);
  if (!actor || typeof actor.id !== 'string' || !actor.id || typeof actor.displayName !== 'string' || !actor.displayName) throw new Error('Identifica al responsable de la carga de prueba.');
  const snapshots = new Map(repository.products.map(product => [product.id, structuredClone(product)]));
  const restoreMemory = () => {
    for (const product of repository.products) {
      const before = snapshots.get(product.id)!;
      for (const key of Object.keys(product)) if (!Object.hasOwn(before, key)) delete (product as any)[key];
      Object.assign(product, structuredClone(before));
    }
  };
  try {
    repository.transaction(() => {
      // Refuse stale in-memory objects before the first write, while holding SQLite's write lock.
      for (const product of repository.products) {
        const row = repository.db.prepare('SELECT payload FROM managed_products WHERE id=?').get(product.id);
        if (!row || row.payload !== JSON.stringify(product)) throw new Error('El catálogo de esta copia cambió; vuelve a abrirlo antes de cargar inventario.');
      }
      for (const pair of pairs.filter(item => item.change)) {
        const current = repository.getProduct(pair.productId);
        repository.adjustInventory(pair.productId, { version: current.version, variantId: pair.variantId,
          storeId: pair.storeId, quantity: TEST_PHYSICAL_QUANTITY, reason: ADJUSTMENT_REASON }, actor);
      }
      // adjustInventory may add a normalized HUB alias for the same already-associated
      // warehouse; no new semantic warehouse association is introduced by this plan.
    });
  } catch (error) {
    restoreMemory();
    throw error;
  }
  return report;
}
