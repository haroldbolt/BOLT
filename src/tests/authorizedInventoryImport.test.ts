import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { AdminRepository } from '../lib/adminRepository';
import { INITIAL_PRODUCTS, INITIAL_STORES } from '../data/seedData';
import type { AdminProduct, AdminPresentation } from '../types/admin';
import { importAuthorizedInventory, validateAuthorizedInventorySnapshot, type AuthorizedInventorySnapshot } from '../lib/authorizedInventoryImport';

let checks = 0;
function check(label: string, action: () => void) { action(); checks++; console.log('PASS: ' + label); }
const stores = structuredClone(INITIAL_STORES);
const stock = () => Object.fromEntries(stores.map(store => [store.id, 0]));
const gid = (id: string) => stores.find(store => store.id === id)!.shopifyLocationGid!;
const actor = { id: 'FIXTURE-OWNER', username: 'propietario.ficticio', displayName: 'Propietario de ensayo' };
function product(id: string, variants: boolean): AdminProduct {
  const result = structuredClone(INITIAL_PRODUCTS[0]) as AdminProduct;
  Object.assign(result, { id, name: 'Producto de ensayo ' + id, sku: id, status: 'ARCHIVED', price: 0, weightKg: 0,
    stockByStore: stock(), reservedStockByStore: stock(), inventoryVerifiedByStore: {}, bodegaIds: [gid('HUB_KENNEDY'), 'HUB_ALAMOS', gid('HUB_SUBA'), gid('HUB_CENTRO')], presentaciones: [] });
  if (variants) result.presentaciones = [
    { varianteId: id + '-P', nombre: 'Presentación principal', sku: id + '-P', foto: result.image, bodegaIds: [gid('HUB_KENNEDY'), 'HUB_ALAMOS'] },
    { varianteId: id + '-S', nombre: 'Presentación secundaria', sku: id + '-S', foto: result.image, bodegaIds: [gid('HUB_SUBA')], price: 0, weightKg: 0, stockByStore: {}, reservedStockByStore: {} },
  ];
  else result.bodegaIds = ['HUB_CENTRO'];
  return result;
}
function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bolt-authorized-inventory-'));
  const products = [product('AUTH-A', true), product('AUTH-B', false)];
  let repository = new AdminRepository({ dataDir: dir, products, stores: structuredClone(stores) });
  const snapshot: AuthorizedInventorySnapshot = { version: 1, source: 'OWNER_AUTHORIZED_100_UNITS', authorizedDate: '2026-11-04', physicalQuantity: 100,
    stores: stores.map(store => ({ id: store.id, shopifyLocationGid: store.shopifyLocationGid, name: store.name, isActive: store.isActive })),
    products: [
      { id: 'AUTH-A', presentations: [
        { variantId: 'AUTH-A-P', price: null, weightKg: null, stockByStore: { HUB_KENNEDY: 100, HUB_ALAMOS: 100 } },
        { variantId: 'AUTH-A-S', price: 25000, weightKg: 4, stockByStore: { HUB_SUBA: 100 } },
      ] },
      { id: 'AUTH-B', presentations: [{ variantId: 'AUTH-B', price: 30000, weightKg: 3, stockByStore: { HUB_CENTRO: 100 } }] },
    ] };
  return { snapshot, get repository() { return repository; }, reopen() { repository.close(); repository = new AdminRepository({ dataDir: dir, products: [], stores: structuredClone(stores) }); },
    close() { repository.close(); const resolved = path.resolve(dir); if (!resolved.startsWith(path.resolve(os.tmpdir()) + path.sep) || !path.basename(resolved).startsWith('bolt-authorized-inventory-')) throw Error('Ruta temporal de ensayo inválida'); fs.rmSync(resolved, { recursive: true, force: true }); } };
}
const canonicalAssociations = (ids: string[] | undefined) => [...new Set((ids || []).map(id => stores.find(store => store.id === id || store.shopifyLocationGid === id)?.id || id))].sort();

const successful = fixture();
try {
  const before = structuredClone(successful.repository.products);
  check('la validación completa no escribe stock, movimientos ni marca de importación', () => {
    const report = validateAuthorizedInventorySnapshot(successful.repository, successful.snapshot);
    assert.equal(report.products, 2); assert.equal(report.presentations, 3); assert.equal(report.warehousePairs, 4);
    assert.deepEqual(successful.repository.products, before); assert.equal(successful.repository.listMovements().total, 0);
    assert.equal(successful.repository.db.prepare("SELECT COUNT(*) n FROM admin_metadata WHERE name='authorized_inventory_v1'").get()!.n, 0);
  });
  const report = importAuthorizedInventory(successful.repository, successful.snapshot, actor);
  check('importa 100 físicas por presentación y bodega asociada sin duplicar la principal', () => {
    const current = successful.repository.getProduct('AUTH-A');
    assert.equal(current.stockByStore.HUB_KENNEDY, 100); assert.equal(current.stockByStore.HUB_ALAMOS, 100);
    assert.equal(current.stockByStore.HUB_SUBA, 0); assert.equal(current.presentaciones![1].stockByStore!.HUB_SUBA, 100);
    assert.equal(successful.repository.listMovements().total, 4); assert.equal(report.alreadyImported, false);
  });
  check('sincroniza el espejo principal y marca las cantidades autorizadas verificadas', () => {
    const current = successful.repository.getProduct('AUTH-A');
    assert.deepEqual(current.presentaciones![0].stockByStore, current.stockByStore);
    assert.equal(current.inventoryVerifiedByStore!.HUB_KENNEDY, true);
    assert.equal(current.presentaciones![1].inventoryVerifiedByStore!.HUB_SUBA, true);
  });
  check('conserva precio y peso pendientes y restaura únicamente valores positivos autorizados', () => {
    const current = successful.repository.getProduct('AUTH-A');
    assert.equal(current.price, 0); assert.equal(current.weightKg, 0);
    assert.equal(current.presentaciones![1].price, 25000); assert.equal(current.presentaciones![1].weightKg, 4);
    assert.equal(successful.repository.getProduct('AUTH-B').price, 30000);
    assert.equal(successful.repository.getProduct('AUTH-B').weightKg, 3);
  });
  check('mantiene nombres, fotos, estados y conjunto de bodegas sin activar Centro Turbo', () => {
    for (const [index, current] of successful.repository.products.entries()) {
      for (const key of ['name', 'image', 'status', 'description'] as const) assert.equal(current[key], before[index][key]);
      assert.deepEqual(canonicalAssociations(current.bodegaIds), canonicalAssociations(before[index].bodegaIds));
      current.presentaciones?.forEach((variant, variantIndex) => assert.deepEqual(canonicalAssociations(variant.bodegaIds), canonicalAssociations(before[index].presentaciones![variantIndex].bodegaIds)));
    }
    assert.equal(successful.repository.stores.find(store => store.id === 'HUB_CENTRO')!.turboEnabled, false);
    assert.equal(successful.repository.stores.find(store => store.id === 'HUB_FONTIBON')!.isActive, false);
  });
  check('la segunda importación idéntica no crea movimientos ni aumenta cantidades', () => {
    const before = successful.repository.listMovements().total;
    assert.equal(importAuthorizedInventory(successful.repository, successful.snapshot).alreadyImported, true);
    assert.equal(successful.repository.listMovements().total, before);
  });
  check('reabrir y ejecutar después de consumir unidades conserva el saldo y los pedidos', () => {
    const current = successful.repository.getProduct('AUTH-A');
    successful.repository.adjustInventory(current.id, { version: current.version, storeId: 'HUB_KENNEDY', quantity: 95, reason: 'Consumo ficticio en una copia temporal' }, actor);
    successful.repository.writeOperationalState({ version: 1, orders: [{ id: 'PEDIDO-FICTICIO' }], drivers: [], auditHistory: [], telemetryHistory: {} });
    successful.reopen();
    const movements = successful.repository.listMovements().total;
    assert.equal(importAuthorizedInventory(successful.repository, successful.snapshot).alreadyImported, true);
    assert.equal(successful.repository.getProduct('AUTH-A').stockByStore.HUB_KENNEDY, 95);
    assert.equal(successful.repository.listMovements().total, movements);
    assert.equal(successful.repository.readOperationalState().orders[0].id, 'PEDIDO-FICTICIO');
  });
  check('otra versión de inventario exige una migración explícita sin tocar saldos', () => {
    const changed = structuredClone(successful.snapshot); changed.authorizedDate = '2026-11-05';
    assert.throws(() => importAuthorizedInventory(successful.repository, changed), /migración explícita/);
    assert.equal(successful.repository.getProduct('AUTH-A').stockByStore.HUB_KENNEDY, 95);
  });
} finally { successful.close(); }

function rejects(label: string, modify: (snapshot: AuthorizedInventorySnapshot, repository: AdminRepository) => void, pattern?: RegExp) {
  const test = fixture();
  try {
    modify(test.snapshot, test.repository);
    const before = structuredClone(test.repository.products);
    const count = test.repository.listMovements().total;
    check(label, () => {
      if (pattern) assert.throws(() => importAuthorizedInventory(test.repository, test.snapshot), pattern);
      else assert.throws(() => importAuthorizedInventory(test.repository, test.snapshot));
      assert.deepEqual(test.repository.products, before);
      assert.equal(test.repository.listMovements().total, count);
      assert.equal(test.repository.db.prepare("SELECT COUNT(*) n FROM admin_metadata WHERE name='authorized_inventory_v1'").get()!.n, 0);
    });
  } finally { test.close(); }
}
rejects('rechaza una cantidad distinta a las 100 físicas autorizadas', snapshot => { snapshot.products[0].presentations[0].stockByStore.HUB_KENNEDY = 101 as any; }, /exactamente 100/);
rejects('rechaza productos y variantes de otra identidad', snapshot => { snapshot.products[0].id = 'OTRO-PRODUCTO'; }, /producto inexistente/);
rejects('rechaza una presentación ajena al producto', snapshot => { snapshot.products[0].presentations[0].variantId = 'AUTH-B'; }, /no pertenece/);
rejects('rechaza variantes duplicadas sin reemplazar la secundaria', snapshot => { snapshot.products[0].presentations[1].variantId = 'AUTH-A-P'; }, /repetida/);
rejects('no omite silenciosamente productos o presentaciones del catálogo', snapshot => { snapshot.products.pop(); }, /catálogo completo/);
rejects('rechaza una bodega no asociada aunque sea activa', snapshot => { snapshot.products[0].presentations[0].stockByStore.HUB_SUBA = 100; }, /asociaciones nuevas/);
rejects('no activa una bodega inactiva para cargar stock', snapshot => { snapshot.products[0].presentations[0].stockByStore.HUB_FONTIBON = 100; }, /activar bodegas/);
rejects('requiere todas las asociaciones activas de la presentación', snapshot => { delete snapshot.products[0].presentations[0].stockByStore.HUB_ALAMOS; }, /todas las bodegas/);
rejects('no convierte precios cero o tipos incorrectos en valores autorizados', snapshot => { snapshot.products[0].presentations[0].price = 0; }, /positivo o null/);
rejects('rechaza fechas inexistentes en el archivo autorizado', snapshot => { snapshot.authorizedDate = '2026-02-31'; }, /estructura válida/);
rejects('protege una base con pedidos antes de importar', (_snapshot, repository) => repository.writeOperationalState({ orders: [{ id: 'PREEXISTENTE' }] }), /contiene pedidos/);
rejects('protege reservas preexistentes aunque el stock físico esté a cero', (_snapshot, repository) => {
  const product = repository.products[0]; product.reservedStockByStore.HUB_KENNEDY = 1; repository.persistCatalog();
}, /catálogo ya fue editado|reservas/);
rejects('protege cantidades y movimientos operativos existentes', (_snapshot, repository) => {
  const product = repository.getProduct('AUTH-A'); repository.adjustInventory(product.id, { version: product.version, quantity: 4, storeId: 'HUB_KENNEDY', reason: 'Cantidad previa ficticia' }, actor);
}, /movimientos de inventario/);
rejects('protege ediciones comerciales anteriores aun sin stock o reservas', (_snapshot, repository) => {
  const product = repository.getProduct('AUTH-A'); repository.updateProduct(product.id, { version: product.version, price: 12000 }, actor);
}, /catálogo ya fue editado/);

const rollback = fixture();
try {
  const before = structuredClone(rollback.repository.products);
  rollback.repository.db.exec("CREATE TRIGGER fail_authorized BEFORE INSERT ON inventory_movements WHEN NEW.product_id='AUTH-B' BEGIN SELECT RAISE(ABORT,'fallo deliberado de importación'); END");
  check('un fallo intermedio revierte precios, existencias, versiones, auditoría y objetos en memoria', () => {
    assert.throws(() => importAuthorizedInventory(rollback.repository, rollback.snapshot), /fallo deliberado/);
    assert.deepEqual(rollback.repository.products, before);
    assert.equal(rollback.repository.listMovements().total, 0); assert.equal(rollback.repository.listAudit().length, 0);
    assert.equal(rollback.repository.getProduct('AUTH-B').price, 0);
    assert.equal(rollback.repository.getProduct('AUTH-A').version, 1);
    assert.equal(rollback.repository.db.prepare("SELECT COUNT(*) n FROM admin_metadata WHERE name='authorized_inventory_v1'").get()!.n, 0);
  });
  rollback.repository.db.exec('DROP TRIGGER fail_authorized');
  check('la misma copia puede importar correctamente después de revertir el fallo', () => {
    assert.equal(importAuthorizedInventory(rollback.repository, rollback.snapshot).warehousePairs, 4);
  });
} finally { rollback.close(); }

console.log(`INVENTARIO AUTORIZADO: ${checks} comprobaciones aprobadas; importación inicial en SQLite temporal sin datos privados.`);
