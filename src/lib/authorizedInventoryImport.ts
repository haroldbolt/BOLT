import { createHash } from 'node:crypto';
import type { AdminRepository } from './adminRepository';
import type { AdminUser, AdminProduct, AdminPresentation } from '../types/admin';

const MARKER = 'authorized_inventory_v1';
const SOURCE = 'OWNER_AUTHORIZED_100_UNITS';
const REASON = 'Importación inicial de inventario autorizado por el propietario: 100 unidades físicas por referencia y bodega asociada.';
const DEFAULT_ACTOR: AdminUser = { id: 'OWNER-AUTHORIZED-INVENTORY', username: 'importacion.inventario', displayName: 'Importación inicial autorizada por el propietario' };

export interface AuthorizedInventorySnapshot {
  version: 1;
  source: typeof SOURCE;
  authorizedDate: string;
  physicalQuantity: 100;
  stores: Array<{ id: string; shopifyLocationGid?: string; name: string; isActive: boolean }>;
  products: Array<{ id: string; presentations: Array<{ variantId: string; price: number | null; weightKg: number | null; stockByStore: Record<string, 100> }> }>;
}
export interface AuthorizedInventoryImportReport {
  products: number;
  presentations: number;
  warehousePairs: number;
  pricedPresentations: number;
  weighedPresentations: number;
  alreadyImported: boolean;
  fingerprint: string;
}
type ProductPlan = { id: string; presentations: Array<{ variantId: string; index: number; price: number | null; weightKg: number | null; storeIds: string[] }> };
type Plan = { snapshot: AuthorizedInventorySnapshot; products: ProductPlan[]; report: AuthorizedInventoryImportReport };
const stable = (value: unknown): string => JSON.stringify(value, (_key, nested) => nested && typeof nested === 'object' && !Array.isArray(nested)
  ? Object.fromEntries(Object.entries(nested).sort(([left], [right]) => left.localeCompare(right))) : nested);
const fingerprint = (value: unknown) => createHash('sha256').update(stable(value)).digest('hex');
const record = (value: unknown): value is Record<string, any> => !!value && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const requiredText = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0 && value.length <= 500 && !/[\u0000-\u001f]/.test(value);

function positiveOrPending(value: unknown, maximum: number, label: string): asserts value is number | null {
  if (value !== null && (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > maximum)) throw new Error(`${label} debe ser positivo o null si está pendiente.`);
}

function buildPlan(repository: AdminRepository, value: unknown): Plan {
  if (!record(value) || value.version !== 1 || value.source !== SOURCE || value.physicalQuantity !== 100 ||
      typeof value.authorizedDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value.authorizedDate) ||
      !Number.isFinite(Date.parse(value.authorizedDate)) || new Date(value.authorizedDate).toISOString().slice(0, 10) !== value.authorizedDate ||
      !Array.isArray(value.stores) || !value.stores.length || !Array.isArray(value.products) || !value.products.length) {
    throw new Error('El archivo de inventario autorizado no tiene una estructura válida.');
  }
  const snapshot = value as AuthorizedInventorySnapshot;
  const report: AuthorizedInventoryImportReport = { products: snapshot.products.length, presentations: 0, warehousePairs: 0,
    pricedPresentations: 0, weighedPresentations: 0, alreadyImported: false, fingerprint: fingerprint(snapshot) };
  const saved = repository.db.prepare('SELECT value FROM admin_metadata WHERE name=?').get(MARKER);
  if (saved) {
    let previous: { report: AuthorizedInventoryImportReport };
    try { previous = JSON.parse(String(saved.value)); } catch { throw new Error('La marca de importación anterior es inválida; requiere revisión.'); }
    if (!record(previous?.report) || previous.report.fingerprint !== report.fingerprint) throw new Error('Ya se importó otra versión de inventario. Se necesita una migración explícita; no se reemplazan existencias.');
    return { snapshot, products: [], report: { ...previous.report, alreadyImported: true } };
  }

  const stores = new Map(repository.stores.map(store => [store.id, store]));
  const storeIds = new Set<string>();
  for (const store of snapshot.stores) {
    if (!record(store) || !requiredText(store.id) || storeIds.has(store.id) || !stores.has(store.id)) throw new Error('El inventario contiene una bodega inexistente o repetida.');
    const actual = stores.get(store.id)!;
    if (typeof store.isActive !== 'boolean' || store.isActive !== actual.isActive ||
        (store.shopifyLocationGid !== undefined && store.shopifyLocationGid !== actual.shopifyLocationGid)) throw new Error('La identificación o actividad de una bodega no coincide con el catálogo.');
    storeIds.add(store.id);
  }
  const aliases = new Map<string, string>();
  for (const store of repository.stores) {
    aliases.set(store.id, store.id);
    if (store.shopifyLocationGid) aliases.set(store.shopifyLocationGid, store.id);
  }
  const actualProducts = new Map(repository.products.map(product => [product.id, product]));
  const products: ProductPlan[] = [];
  const seenProducts = new Set<string>();
  for (const product of snapshot.products) {
    if (!record(product) || !requiredText(product.id) || seenProducts.has(product.id) || !actualProducts.has(product.id) || !Array.isArray(product.presentations)) throw new Error('El inventario contiene un producto inexistente, repetido o inválido.');
    seenProducts.add(product.id);
    const actual = actualProducts.get(product.id)!;
    const parentAssociations = new Set((actual.bodegaIds || []).map(id => aliases.get(id)).filter(Boolean));
    const actualPresentations = actual.presentaciones?.length ? actual.presentaciones : [{ varianteId: actual.id, bodegaIds: actual.bodegaIds || [] }];
    if (product.presentations.length !== actualPresentations.length) throw new Error('El inventario debe conservar todas las presentaciones del producto.');
    const seenVariants = new Set<string>();
    const planned: ProductPlan = { id: actual.id, presentations: [] };
    for (const presentation of product.presentations) {
      if (!record(presentation) || !requiredText(presentation.variantId) || seenVariants.has(presentation.variantId) || !record(presentation.stockByStore)) throw new Error('La presentación de inventario no es válida o está repetida.');
      const index = actualPresentations.findIndex(variant => variant.varianteId === presentation.variantId);
      if (index < 0) throw new Error('La presentación no pertenece al producto indicado.');
      seenVariants.add(presentation.variantId);
      positiveOrPending(presentation.price, 1_000_000_000, 'El precio');
      positiveOrPending(presentation.weightKg, 100000, 'El peso');
      const activeAssociations = new Set((actualPresentations[index].bodegaIds || []).map(id => aliases.get(id)).filter((id): id is string => !!id && stores.get(id)?.isActive === true));
      const targetStores = Object.keys(presentation.stockByStore);
      for (const storeId of targetStores) {
        if (!storeIds.has(storeId) || !stores.get(storeId)?.isActive || !activeAssociations.has(storeId) || !parentAssociations.has(storeId)) throw new Error('La importación no puede activar bodegas ni agregar asociaciones nuevas.');
        if (presentation.stockByStore[storeId] !== 100) throw new Error('La cantidad autorizada debe ser exactamente 100 unidades físicas.');
      }
      if (targetStores.length !== activeAssociations.size || [...activeAssociations].some(id => !targetStores.includes(id))) throw new Error('El inventario debe incluir todas las bodegas activas asociadas a cada presentación.');
      planned.presentations.push({ variantId: presentation.variantId, index, price: presentation.price, weightKg: presentation.weightKg, storeIds: targetStores });
      report.presentations++;
      report.warehousePairs += targetStores.length;
      if (presentation.price !== null) report.pricedPresentations++;
      if (presentation.weightKg !== null) report.weighedPresentations++;
    }
    products.push(planned);
  }
  if (seenProducts.size !== actualProducts.size) throw new Error('El inventario autorizado debe cubrir el catálogo completo, sin omitir productos.');
  return { snapshot, products, report };
}

function assertUninitialized(repository: AdminRepository): void {
  const state = repository.readOperationalState();
  if (state && (!Array.isArray(state.orders) || state.orders.length > 0)) throw new Error('La base contiene pedidos u operaciones existentes. Restaura una base nueva; no se reemplazará inventario operativo.');
  if (Number(repository.db.prepare('SELECT COUNT(*) count FROM inventory_movements').get()?.count || 0) > 0) throw new Error('La base ya tiene movimientos de inventario; la importación inicial no puede reemplazarlos.');
  for (const product of repository.products as AdminProduct[]) {
    const version = repository.db.prepare('SELECT version FROM managed_products WHERE id=?').get(product.id);
    if (Number(version?.version) !== 1) throw new Error('El catálogo ya fue editado; importa únicamente sobre una base nueva antes de modificar productos.');
    for (const source of [product, ...(product.presentaciones || [])]) {
      for (const quantity of Object.values(source.stockByStore || {})) if (!Number.isSafeInteger(quantity) || quantity !== 0) throw new Error('La base ya contiene cantidades de inventario; se requiere una base nueva.');
      for (const quantity of Object.values(source.reservedStockByStore || {})) if (!Number.isSafeInteger(quantity) || quantity !== 0) throw new Error('La base tiene reservas; no se reemplazan ni se eliminan.');
      if (Object.values(source.inventoryVerifiedByStore || {}).some(Boolean)) throw new Error('La base ya contiene existencias verificadas; se requiere una base nueva.');
    }
    const row = repository.db.prepare('SELECT payload FROM managed_products WHERE id=?').get(product.id);
    if (!row || fingerprint(JSON.parse(String(row.payload))) !== fingerprint(product)) throw new Error('El catálogo cambió desde otra instancia; vuelve a cargar antes de importar.');
  }
}

/** Validates the complete owner-authorized snapshot without changing database or memory. */
export function validateAuthorizedInventorySnapshot(repository: AdminRepository, value: unknown): AuthorizedInventoryImportReport {
  const plan = buildPlan(repository, value);
  if (!plan.report.alreadyImported) assertUninitialized(repository);
  return plan.report;
}

/** Initial import only. The stored fingerprint makes later runs no-ops, including after sales. */
export function importAuthorizedInventory(repository: AdminRepository, value: unknown, actor: AdminUser = DEFAULT_ACTOR): AuthorizedInventoryImportReport {
  if (!actor || !requiredText(actor.id) || !requiredText(actor.displayName)) throw new Error('Identifica al responsable de la importación.');
  const originals = new Map(repository.products.map(product => [product.id, structuredClone(product)]));
  try {
    return repository.transaction(() => {
      const plan = buildPlan(repository, value);
      if (plan.report.alreadyImported) return plan.report;
      assertUninitialized(repository);
      for (const productPlan of plan.products) {
        let current = repository.getProduct(productPlan.id);
        const primary = productPlan.presentations.find(presentation => presentation.index === 0)!;
        const changes: Record<string, unknown> = {};
        if (primary.price !== null && primary.price !== current.price) changes.price = primary.price;
        if (primary.weightKg !== null && primary.weightKg !== current.weightKg) changes.weightKg = primary.weightKg;
        const secondaryChanges = productPlan.presentations.some(presentation => presentation.index > 0 &&
          ((presentation.price !== null && presentation.price !== current.presentaciones![presentation.index].price) ||
           (presentation.weightKg !== null && presentation.weightKg !== current.presentaciones![presentation.index].weightKg)));
        if (secondaryChanges) changes.presentaciones = (current.presentaciones as AdminPresentation[]).map((presentation, index) => {
          const imported = productPlan.presentations.find(item => item.index === index)!;
          return { ...presentation, ...(imported.price !== null ? { price: imported.price } : {}), ...(imported.weightKg !== null ? { weightKg: imported.weightKg } : {}) };
        });
        if (Object.keys(changes).length) current = repository.updateProduct(current.id, { ...changes, version: current.version }, actor);
        for (const presentation of productPlan.presentations) for (const storeId of presentation.storeIds) {
          current = repository.adjustInventory(current.id, { version: current.version,
            ...(current.presentaciones?.length ? { variantId: presentation.variantId } : {}), storeId, quantity: 100, reason: REASON }, actor);
        }
      }
      repository.db.prepare('INSERT INTO admin_metadata(name,value) VALUES (?,?)').run(MARKER, JSON.stringify({ report: plan.report, importedAt: new Date().toISOString() }));
      repository.audit('AUTHORIZED_INVENTORY_IMPORTED', plan.report.fingerprint, actor, `${plan.report.presentations} presentaciones, ${plan.report.warehousePairs} pares por bodega; importación inicial de 100 físicas autorizada.`);
      return plan.report;
    });
  } catch (error) {
    for (const product of repository.products) {
      const before = originals.get(product.id)!;
      for (const key of Object.keys(product)) if (!Object.hasOwn(before, key)) delete (product as any)[key];
      Object.assign(product, structuredClone(before));
    }
    throw error;
  }
}
