import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AdminRepository } from '../lib/adminRepository';
import { INITIAL_PRODUCTS, INITIAL_STORES } from '../data/seedData';
import type { AdminProduct, AdminPresentation, AdminUser } from '../types/admin';
import { applyTestInventorySeed, previewTestInventorySeed, TEST_INVENTORY_ENVIRONMENT } from '../lib/testInventorySeed';

const actor: AdminUser = { id: 'TEST-INVENTORY-ACTOR', username: 'ensayo.inventario', displayName: 'Carga aislada de inventario' };
const stores = structuredClone(INITIAL_STORES);
const gid = (id: string) => stores.find(store => store.id === id)!.shopifyLocationGid!;
const zeroes = () => Object.fromEntries(stores.map(store => [store.id, 0]));
let checks = 0;
function check(label: string, action: () => void) { action(); checks++; console.log('PASS: ' + label); }

function product(id: string, variants = true): AdminProduct {
  const result = structuredClone(INITIAL_PRODUCTS[0]) as AdminProduct;
  Object.assign(result, { id, name: 'Producto aislado ' + id, status: 'ACTIVE', price: 20000, weightKg: 3,
    stockByStore: { ...zeroes(), HUB_KENNEDY: 8 }, reservedStockByStore: { ...zeroes(), HUB_KENNEDY: 3 },
    inventoryVerifiedByStore: {}, bodegaIds: [gid('HUB_KENNEDY'), gid('HUB_SUBA'), gid('HUB_CENTRO'), gid('HUB_FONTIBON')], presentaciones: [] });
  if (variants) result.presentaciones = [
    { varianteId: id + '-PRIMARY', nombre: '3 kg', sku: id + '-3', foto: result.image, bodegaIds: [gid('HUB_KENNEDY')], price: result.price, weightKg: result.weightKg,
      stockByStore: structuredClone(result.stockByStore), reservedStockByStore: structuredClone(result.reservedStockByStore), inventoryVerifiedByStore: {} },
    { varianteId: id + '-SECONDARY', nombre: '7 kg', sku: id + '-7', foto: result.image, bodegaIds: ['HUB_SUBA', gid('HUB_SUBA')], price: 0, weightKg: 0, stockByStore: {}, reservedStockByStore: {} },
    { varianteId: id + '-CENTRO', nombre: '5 kg', sku: id + '-5', foto: result.image, bodegaIds: [gid('HUB_CENTRO')], price: 30000, weightKg: 5, stockByStore: {}, reservedStockByStore: {} },
    { varianteId: id + '-INACTIVE', nombre: '10 kg', sku: id + '-10', foto: result.image, bodegaIds: [gid('HUB_FONTIBON')], price: 40000, weightKg: 10, stockByStore: {}, reservedStockByStore: {} },
  ];
  else result.bodegaIds = ['HUB_ALAMOS'];
  return result;
}
function fixture(products = [product('TEST-A')]) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'bolt-test-inventory-seed-'));
  const home = path.join(temp, '.bolt-private', 'inventory-100-test');
  const dataDir = path.join(home, 'data');
  const sourceDataDir = path.join(temp, '.bolt-private', 'source-operations');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(sourceDataDir, { recursive: true });
  fs.writeFileSync(path.join(sourceDataDir, 'admin.sqlite'), 'Base original ficticia: no escribir');
  const marker = { environment: TEST_INVENTORY_ENVIRONMENT, ready: false, dataDir, sourceDataDir };
  const markerPath = path.join(home, 'test-environment.json');
  fs.writeFileSync(markerPath, JSON.stringify(marker));
  let repository = new AdminRepository({ dataDir, products, stores: structuredClone(stores) });
  return { temp, home, dataDir, sourceDataDir, markerPath, marker,
    get repository() { return repository; },
    reopen() { repository.close(); repository = new AdminRepository({ dataDir, products: [], stores: structuredClone(stores) }); },
    close() {
      repository.close();
      const checked = path.resolve(temp);
      if (!checked.startsWith(path.resolve(os.tmpdir()) + path.sep) || !path.basename(checked).startsWith('bolt-test-inventory-seed-')) throw new Error('Ruta temporal de ensayo no válida');
      fs.rmSync(checked, { recursive: true, force: true });
    } };
}
const canonicalAssociations = (ids: string[] | undefined) => [...new Set((ids || []).map(id => stores.find(store => store.id === id || store.shopifyLocationGid === id)?.id || id))].sort();

const first = fixture();
try {
  const before = structuredClone(first.repository.products);
  const preview = previewTestInventorySeed(first.repository);
  check('la vista previa cuenta cada presentación y deduplica GID/HUB sin tocar datos', () => {
    assert.equal(preview.products, 1); assert.equal(preview.presentations, 4);
    assert.equal(preview.eligiblePairs, 3); assert.equal(preview.changedPairs, 3);
    assert.deepEqual(first.repository.products, before);
    assert.equal(first.repository.listMovements().total, 0);
    assert.equal(first.repository.listAudit().length, 0);
  });
  const applied = applyTestInventorySeed(first.repository, actor);
  check('se fijan 100 físicas por presentación y bodega sin sumar ni usar la unión del padre', () => {
    const current = first.repository.getProduct('TEST-A');
    assert.equal(current.stockByStore.HUB_KENNEDY, 100);
    assert.equal(current.stockByStore.HUB_SUBA, 0);
    assert.equal(current.presentaciones![1].stockByStore!.HUB_SUBA, 100);
    assert.equal(current.presentaciones![1].stockByStore!.HUB_KENNEDY, undefined);
    assert.equal(applied.changedPairs, 3);
  });
  check('principal y su espejo comparten existencias, reservas y verificación coherentes', () => {
    const current = first.repository.getProduct('TEST-A');
    assert.deepEqual(current.presentaciones![0].stockByStore, current.stockByStore);
    assert.deepEqual(current.presentaciones![0].reservedStockByStore, current.reservedStockByStore);
    assert.deepEqual(current.presentaciones![0].inventoryVerifiedByStore, current.inventoryVerifiedByStore);
    assert.equal(current.reservedStockByStore.HUB_KENNEDY, 3);
    assert.equal(current.stockByStore.HUB_KENNEDY - current.reservedStockByStore.HUB_KENNEDY, 97);
  });
  check('Centro activo recibe ensayo y Fontibón inactivo conserva sus cantidades', () => {
    const current = first.repository.getProduct('TEST-A');
    assert.equal(current.presentaciones![2].stockByStore!.HUB_CENTRO, 100);
    assert.equal(current.presentaciones![3].stockByStore!.HUB_FONTIBON, undefined);
    assert.ok(applied.exceptions.some(item => item.code === 'INACTIVE_STORE' && item.storeId === 'HUB_FONTIBON'));
    assert.equal(stores.find(store => store.id === 'HUB_CENTRO')!.turboEnabled, false);
  });
  check('las bodegas asociadas siguen siendo las mismas aunque se normalicen aliases', () => {
    const current = first.repository.getProduct('TEST-A');
    assert.deepEqual(canonicalAssociations(current.bodegaIds), canonicalAssociations(before[0].bodegaIds));
    for (const [index, variant] of current.presentaciones!.entries()) assert.deepEqual(canonicalAssociations(variant.bodegaIds), canonicalAssociations(before[0].presentaciones![index].bodegaIds));
  });
  check('se conservan nombres, fotos, precio y peso y se informan los pendientes', () => {
    const current = first.repository.getProduct('TEST-A');
    for (const key of ['name', 'image', 'description', 'price', 'weightKg', 'status'] as const) assert.equal(current[key], before[0][key]);
    assert.equal(current.presentaciones![1].price, 0); assert.equal(current.presentaciones![1].weightKg, 0);
    assert.deepEqual(applied.pendingData.find(item => item.variantId === 'TEST-A-SECONDARY')?.missing, ['price', 'weightKg']);
  });
  check('cada cambio registra movimiento y responsable como cantidad ficticia de ensayo', () => {
    const movements = first.repository.listMovements().movements;
    assert.equal(movements.length, 3); assert.equal(first.repository.listAudit().length, 3);
    assert.ok(movements.every(movement => movement.quantity === 100 && movement.actorId === actor.id && movement.reason.includes('ficticia')));
  });
  check('repetir la carga sin cambios no crea movimientos, auditorías ni suma existencias', () => {
    const report = applyTestInventorySeed(first.repository, actor);
    assert.equal(report.changedPairs, 0); assert.equal(report.unchangedPairs, 3);
    assert.equal(first.repository.listMovements().total, 3); assert.equal(first.repository.listAudit().length, 3);
  });
  first.reopen();
  check('el reinicio conserva 100, reservas y la idempotencia en SQLite', () => {
    assert.equal(first.repository.getProduct('TEST-A').stockByStore.HUB_KENNEDY, 100);
    assert.equal(first.repository.getProduct('TEST-A').reservedStockByStore.HUB_KENNEDY, 3);
    assert.equal(applyTestInventorySeed(first.repository, actor).changedPairs, 0);
  });
  const current = first.repository.getProduct('TEST-A');
  first.repository.adjustInventory('TEST-A', { version: current.version, storeId: 'HUB_KENNEDY', quantity: 99, reason: 'Consumo ficticio del ensayo' }, actor);
  first.reopen();
  check('abrir o consultar la copia no vuelve a sembrar 100 después de consumir una unidad', () => {
    assert.equal(first.repository.getProduct('TEST-A').stockByStore.HUB_KENNEDY, 99);
    assert.equal(previewTestInventorySeed(first.repository).changedPairs, 1);
    assert.equal(first.repository.getProduct('TEST-A').stockByStore.HUB_KENNEDY, 99);
    assert.equal(fs.readFileSync(path.join(first.sourceDataDir, 'admin.sqlite'), 'utf8'), 'Base original ficticia: no escribir');
  });
} finally { first.close(); }

const invalidProducts = [101, -1, 1.5, '2', null].map((reserved, index) => {
  const item = product('RESERVATION-' + index, false);
  item.bodegaIds = ['HUB_KENNEDY'];
  item.reservedStockByStore.HUB_KENNEDY = reserved as any;
  return item;
});
const invalid = fixture(invalidProducts);
try {
  const before = structuredClone(invalid.repository.products);
  check('reservas superiores a 100 e inválidas se omiten sin eliminar, redondear o inventar reservas', () => {
    const result = applyTestInventorySeed(invalid.repository, actor);
    assert.equal(result.changedPairs, 0);
    assert.equal(result.exceptions.filter(item => item.code === 'RESERVATION_OVER_TARGET').length, 1);
    assert.equal(result.exceptions.filter(item => item.code === 'INVALID_RESERVATION').length, 4);
    assert.deepEqual(invalid.repository.products, before);
    assert.equal(invalid.repository.listMovements().total, 0);
  });
} finally { invalid.close(); }

const omitted = product('OMITTED');
omitted.presentaciones![0].bodegaIds = [];
omitted.presentaciones![1].bodegaIds = ['gid://shopify/Location/desconocido'];
omitted.status = 'ARCHIVED';
const noVariant = product('NO-VARIANT', false); noVariant.status = 'DRAFT';
const omittedFixture = fixture([omitted, noVariant]);
try {
  check('una asociación vacía o desconocida no se convierte en disponibilidad en todas las sedes', () => {
    const result = applyTestInventorySeed(omittedFixture.repository, actor);
    assert.ok(result.exceptions.some(item => item.code === 'NO_ACTIVE_ASSOCIATION' && item.variantId === 'OMITTED-PRIMARY'));
    assert.ok(result.exceptions.some(item => item.code === 'UNKNOWN_STORE' && item.variantId === 'OMITTED-SECONDARY'));
    assert.equal(omittedFixture.repository.getProduct('OMITTED').stockByStore.HUB_KENNEDY, 8);
  });
  check('se incluyen productos sin variantes sin reactivar archivados o borradores', () => {
    assert.equal(omittedFixture.repository.getProduct('NO-VARIANT').stockByStore.HUB_ALAMOS, 100);
    assert.equal(omittedFixture.repository.getProduct('NO-VARIANT').status, 'DRAFT');
    assert.equal(omittedFixture.repository.getProduct('OMITTED').status, 'ARCHIVED');
    assert.ok(previewTestInventorySeed(omittedFixture.repository).pendingData.some(item => item.productId === 'NO-VARIANT' && item.missing.includes('activeStatus')));
  });
} finally { omittedFixture.close(); }

const rollback = fixture([product('ROLLBACK-A', false), product('ROLLBACK-B', false)]);
try {
  rollback.repository.writeOperationalState({ orders: [{ id: 'Pedido-historico-ficticio', total: 1000 }], drivers: [], auditHistory: [], telemetryHistory: {} });
  const beforeProducts = structuredClone(rollback.repository.products);
  const beforeState = rollback.repository.readOperationalState();
  const beforeVersions = beforeProducts.map(item => rollback.repository.getProduct(item.id).version);
  rollback.repository.db.exec("CREATE TRIGGER fail_test_seed BEFORE INSERT ON inventory_movements WHEN NEW.product_id='ROLLBACK-B' BEGIN SELECT RAISE(ABORT,'fallo deliberado carga de ensayo'); END");
  check('un fallo intermedio revierte todo el lote, versiones, movimientos y objetos en memoria', () => {
    assert.throws(() => applyTestInventorySeed(rollback.repository, actor), /fallo deliberado/);
    assert.deepEqual(rollback.repository.products, beforeProducts);
    assert.deepEqual(beforeProducts.map(item => rollback.repository.getProduct(item.id).version), beforeVersions);
    assert.equal(rollback.repository.listMovements().total, 0); assert.equal(rollback.repository.listAudit().length, 0);
    assert.deepEqual(rollback.repository.readOperationalState(), beforeState);
  });
  rollback.repository.db.exec('DROP TRIGGER fail_test_seed');
  check('después del rollback se puede ejecutar el lote y los pedidos históricos siguen idénticos', () => {
    assert.equal(applyTestInventorySeed(rollback.repository, actor).changedPairs, 2);
    assert.deepEqual(rollback.repository.readOperationalState(), beforeState);
  });
  check('un catálogo cambiado por otra instancia no se sobrescribe desde objetos antiguos', () => {
    const row = rollback.repository.db.prepare('SELECT payload FROM managed_products WHERE id=?').get('ROLLBACK-A')!;
    const replacement = { ...JSON.parse(String(row.payload)), name: 'Edición posterior ficticia' };
    rollback.repository.db.prepare('UPDATE managed_products SET payload=? WHERE id=?').run(JSON.stringify(replacement), 'ROLLBACK-A');
    const movements = rollback.repository.listMovements().total;
    assert.throws(() => applyTestInventorySeed(rollback.repository, actor), /catálogo.*cambió/);
    assert.equal(rollback.repository.listMovements().total, movements);
    assert.equal(JSON.parse(String(rollback.repository.db.prepare('SELECT payload FROM managed_products WHERE id=?').get('ROLLBACK-A')!.payload)).name, replacement.name);
  });
} finally { rollback.close(); }

const guarded = fixture();
try {
  check('sin marcador de pruebas no se permite ni previsualizar ni ajustar cantidades', () => {
    fs.renameSync(guarded.markerPath, guarded.markerPath + '.disabled');
    assert.throws(() => previewTestInventorySeed(guarded.repository));
    assert.throws(() => applyTestInventorySeed(guarded.repository, actor));
    fs.renameSync(guarded.markerPath + '.disabled', guarded.markerPath);
    assert.equal(guarded.repository.listMovements().total, 0);
  });
  check('un marcador de otro entorno o de otra carpeta no autoriza la carga', () => {
    for (const replacement of [{ ...guarded.marker, environment: 'PRODUCTION' }, { ...guarded.marker, dataDir: guarded.sourceDataDir }]) {
      fs.writeFileSync(guarded.markerPath, JSON.stringify(replacement));
      assert.throws(() => applyTestInventorySeed(guarded.repository, actor));
    }
    fs.writeFileSync(guarded.markerPath, JSON.stringify(guarded.marker));
  });
  check('la carpeta original y una copia dentro de ella se rechazan aunque el marcador lo afirme', () => {
    const operationalDir = path.join(guarded.temp, '.bolt-private', 'operations');
    fs.mkdirSync(operationalDir, { recursive: true });
    const operationalAlias = Object.create(guarded.repository) as AdminRepository;
    Object.defineProperty(operationalAlias, 'dataDir', { value: operationalDir });
    assert.throws(() => previewTestInventorySeed(operationalAlias), /base operativa/);
    const publicDir = path.join(guarded.temp, 'public'); fs.mkdirSync(publicDir);
    const publicAlias = Object.create(guarded.repository) as AdminRepository;
    Object.defineProperty(publicAlias, 'dataDir', { value: publicDir });
    assert.throws(() => previewTestInventorySeed(publicAlias), /carpeta .bolt-private aislada/);
    fs.writeFileSync(guarded.markerPath, JSON.stringify({ ...guarded.marker, sourceDataDir: guarded.dataDir }));
    assert.throws(() => applyTestInventorySeed(guarded.repository, actor), /separada/);
    fs.writeFileSync(guarded.markerPath, JSON.stringify({ ...guarded.marker, sourceDataDir: guarded.home }));
    assert.throws(() => applyTestInventorySeed(guarded.repository, actor), /separada/);
    fs.writeFileSync(guarded.markerPath, JSON.stringify(guarded.marker));
  });
  check('un enlace duro hacia el archivo original no se acepta como copia aislada', () => {
    const home = path.join(guarded.temp, '.bolt-private', 'hardlink-test');
    const dataDir = path.join(home, 'data'); fs.mkdirSync(dataDir, { recursive: true });
    fs.linkSync(path.join(guarded.sourceDataDir, 'admin.sqlite'), path.join(dataDir, 'admin.sqlite'));
    fs.writeFileSync(path.join(home, 'test-environment.json'), JSON.stringify({ ...guarded.marker, dataDir }));
    const aliased = Object.create(guarded.repository) as AdminRepository;
    Object.defineProperty(aliased, 'dataDir', { value: dataDir });
    assert.throws(() => previewTestInventorySeed(aliased), /mismo archivo/);
  });
  check('no se admite un responsable ausente ni se escriben movimientos sin atribución', () => {
    assert.throws(() => applyTestInventorySeed(guarded.repository, null as any), /responsable/);
    assert.equal(guarded.repository.listMovements().total, 0);
  });
} finally { guarded.close(); }

console.log(`INVENTARIO DE PRUEBA: ${checks} comprobaciones aprobadas; SQLite temporal, sin modificar bases operativas.`);
