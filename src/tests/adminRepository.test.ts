import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { AdminRepository, AdminError } from '../lib/adminRepository';
import { INITIAL_PRODUCTS, INITIAL_STORES } from '../data/seedData';

const dir = mkdtempSync(path.join(tmpdir(), 'bolt-admin-repo-'));
const products = structuredClone(INITIAL_PRODUCTS.slice(0, 2));
for (const product of products) {
  product.price = 0;
  product.weightKg = 0;
  product.stockByStore = Object.fromEntries(INITIAL_STORES.map(s => [s.id, 0]));
  product.reservedStockByStore = Object.fromEntries(INITIAL_STORES.map(s => [s.id, 0]));
}
let repository = new AdminRepository({ dataDir: dir, products, stores: structuredClone(INITIAL_STORES) });
let passed = 0;
async function check(label: string, test: () => void | Promise<void>) { await test(); passed++; console.log(`PASS: ${label}`); }
function rejects(test: () => unknown, status?: number) {
  assert.throws(test, error => error instanceof AdminError && (status === undefined || error.status === status));
}
const secret = 'Solo-Prueba-Aislada-2026';
const replacement = 'Nueva-Clave-Aislada-2026';
try {
  await check('la base nueva conserva los datos pendientes sin inventar precio, peso o inventario', () => {
    assert.equal(repository.hasAdministrator(), false);
    const product = repository.getProduct(products[0].id);
    assert.equal(product.price, 0);
    assert.equal(product.weightKg, 0);
    assert.deepEqual(Object.values(product.stockByStore), INITIAL_STORES.map(() => 0));
    assert.ok(product.dataPending.includes('Precio') && product.dataPending.includes('Peso') && product.dataPending.some(value => value.startsWith('Existencias')));
  });
  await check('rechaza credenciales iniciales débiles sin crear una cuenta', () => {
    rejects(() => repository.createAdministrator('qa', secret));
    rejects(() => repository.createAdministrator('qa.admin', 'corta'));
    assert.equal(repository.hasAdministrator(), false);
  });
  const admin = repository.createAdministrator('QA.Admin', secret, 'Administrador de prueba');
  await check('normaliza el usuario y protege la contraseña con sal y hash', () => {
    assert.equal(admin.username, 'qa.admin');
    const row = repository.db.prepare('SELECT password_hash FROM admin_users WHERE id=?').get(admin.id)!;
    assert.ok(String(row.password_hash).startsWith('scrypt$'));
    assert.equal(String(row.password_hash).includes(secret), false);
    rejects(() => repository.createAdministrator('qa.admin', secret), 409);
  });
  await check('usuario inexistente y contraseña incorrecta reciben el mismo error de acceso', async () => {
    await assert.rejects(() => repository.login('inexistente', secret, 'prueba-ip'), error => error instanceof AdminError && error.status === 401);
    await assert.rejects(() => repository.login(admin.username, 'incorrecta', 'prueba-ip'), error => error instanceof AdminError && error.status === 401);
  });
  const session = await repository.login('QA.ADMIN', secret, 'prueba-ip');
  await check('sesión aleatoria persistida sin guardar el token sin cifrar', () => {
    assert.equal(repository.getSession(session.token)?.user.id, admin.id);
    assert.ok(session.token.length >= 40 && session.csrfToken.length >= 40);
    const rows = repository.db.prepare('SELECT token_hash FROM admin_sessions').all();
    assert.equal(rows.some(row => row.token_hash === session.token), false);
    assert.equal(repository.getSession('token-inventado'), null);
  });
  await check('el cierre de sesión invalida el token inmediatamente', async () => {
    const temporary = await repository.login(admin.username, secret, 'logout-ip');
    repository.logout(temporary.token);
    assert.equal(repository.getSession(temporary.token), null);
    assert.ok(repository.getSession(session.token));
  });
  await check('una sesión vencida no conserva permisos', async () => {
    const temporary = await repository.login(admin.username, secret, 'expiry-ip');
    repository.db.prepare('UPDATE admin_sessions SET expires_at=? WHERE user_id=? AND csrf_token=?').run(Date.now() - 1, admin.id, temporary.csrfToken);
    assert.equal(repository.getSession(temporary.token), null);
  });
  await check('limita intentos repetidos aunque cambie la dirección del atacante', async () => {
    for (let i = 0; i < 8; i++) await assert.rejects(() => repository.login('objetivo', 'incorrecta', `ip-${i}`), error => error instanceof AdminError && error.status === 401);
    await assert.rejects(() => repository.login('objetivo', 'incorrecta', 'otra-ip'), error => error instanceof AdminError && error.status === 429);
  });

  let product = repository.createProduct({ name: 'Producto aislado QA', sku: 'QA-UNICO', brand: 'QA', category: 'Alimentos', species: 'Perro', image: 'https://example.invalid/producto.webp', description: 'Producto creado únicamente en la base temporal de pruebas.', presentation: '1 kg', price: 20000, weightKg: 1, status: 'ACTIVE', bodegaIds: ['HUB_KENNEDY'] }, admin);
  await check('crear un producto no toma cantidades del navegador como inventario verificado', () => {
    assert.equal(product.stockByStore.HUB_KENNEDY, 0);
    assert.equal(product.reservedStockByStore.HUB_KENNEDY, 0);
    assert.equal(products.find(item => item.id === product.id)?.name, product.name);
  });
  await check('valida importes, peso, URL de foto y SKU duplicado', () => {
    for (const invalid of [-1, NaN, Infinity, '1000']) rejects(() => repository.updateProduct(product.id, { version: product.version, price: invalid }, admin));
    rejects(() => repository.updateProduct(product.id, { version: product.version, weightKg: -1 }, admin));
    rejects(() => repository.updateProduct(product.id, { version: product.version, image: 'javascript:alert(1)' }, admin));
    rejects(() => repository.updateProduct(product.id, { version: product.version, image: 'file:///datos/privados' }, admin));
    rejects(() => repository.createProduct({ name: 'Otro producto', sku: 'QA-UNICO' }, admin), 409);
    assert.equal(repository.getProduct(product.id).price, 20000);
  });
  product = repository.updateProduct(product.id, { version: product.version, name: 'Producto QA editado', stockByStore: { HUB_KENNEDY: 999 }, reservedStockByStore: { HUB_KENNEDY: -99 }, id: 'OTRO-ID', rating: 5 }, admin);
  await check('no permite asignar campos internos mediante el editor de productos', () => {
    assert.notEqual(product.id, 'OTRO-ID');
    assert.equal(product.stockByStore.HUB_KENNEDY, 0);
    assert.equal(product.reservedStockByStore.HUB_KENNEDY, 0);
    assert.equal(product.rating, 0);
  });
  await check('evita sobrescribir una edición más reciente', () => {
    rejects(() => repository.updateProduct(product.id, { version: product.version - 1, name: 'Edición vieja' }, admin), 409);
    assert.equal(repository.getProduct(product.id).name, 'Producto QA editado');
  });
  await check('no ajusta inventario sin motivo, con fracciones o en una bodega inactiva', () => {
    rejects(() => repository.adjustInventory(product.id, { version: product.version, storeId: 'HUB_KENNEDY', quantity: 1, reason: '' }, admin));
    rejects(() => repository.adjustInventory(product.id, { version: product.version, storeId: 'HUB_KENNEDY', quantity: 1.5, reason: 'Prueba' }, admin));
    rejects(() => repository.adjustInventory(product.id, { version: product.version, storeId: 'HUB_FONTIBON', quantity: 1, reason: 'Prueba' }, admin));
    assert.equal(repository.listMovements().total, 0);
  });
  product = repository.adjustInventory(product.id, { version: product.version, storeId: 'HUB_KENNEDY', quantity: 8, reason: 'Conteo físico de prueba' }, admin);
  await check('cada ajuste mantiene independientes las bodegas y registra usuario y motivo', () => {
    assert.equal(product.stockByStore.HUB_KENNEDY, 8);
    assert.equal(product.stockByStore.HUB_SUBA, 0);
    const movement = repository.listMovements({ productId: product.id }).movements[0];
    assert.equal(movement.actorId, admin.id);
    assert.equal(movement.previousQuantity, 0);
    assert.equal(movement.quantity, 8);
    assert.equal(movement.reason, 'Conteo físico de prueba');
  });
  const liveProduct = products.find(p => p.id === product.id)!;
  liveProduct.reservedStockByStore.HUB_KENNEDY = 3;
  repository.persistCatalog();
  product = repository.getProduct(product.id);
  await check('no reduce existencias físicas por debajo de lo reservado', () => {
    rejects(() => repository.adjustInventory(product.id, { version: product.version, storeId: 'HUB_KENNEDY', quantity: 2, reason: 'No autorizado' }, admin), 409);
    assert.equal(repository.getProduct(product.id).stockByStore.HUB_KENNEDY, 8);
    assert.equal(repository.listMovements().total, 1);
  });
  await check('una escritura que falla revierte producto, versión y auditoría', () => {
    const before = repository.getProduct(product.id);
    repository.db.exec("CREATE TRIGGER qa_fail_update BEFORE INSERT ON admin_audit WHEN NEW.payload LIKE '%PRODUCT_UPDATED%' BEGIN SELECT RAISE(ABORT, 'fallo deliberado de prueba'); END");
    try { assert.throws(() => repository.updateProduct(product.id, { version: before.version, name: 'No debe guardarse' }, admin), /fallo deliberado/); }
    finally { repository.db.exec('DROP TRIGGER qa_fail_update'); }
    assert.equal(repository.getProduct(product.id).name, before.name);
    assert.equal(repository.getProduct(product.id).version, before.version);
    assert.equal(repository.listAudit().some(entry => entry.detail.includes('No debe guardarse')), false);
  });
  const snapshot = { version: 1, orders: [{ id: 'QA-ORDER', items: [{ productId: product.id, name: product.name, price: 20000 }], total: 26400 }], drivers: [], auditHistory: [], telemetryHistory: {} };
  repository.writeOperationalState(snapshot);
  product = repository.getProduct(product.id);
  product = repository.setArchived(product.id, true, product.version, admin);
  await check('archivar conserva el producto y las compras históricas', () => {
    assert.equal(product.status, 'ARCHIVED');
    assert.equal(repository.listProducts({ status: 'ACTIVE', q: 'Producto QA editado' }).total, 0);
    assert.deepEqual(repository.readOperationalState(), snapshot);
  });
  product = repository.setArchived(product.id, false, product.version, admin);

  let variantProduct = repository.createProduct({ name: 'QA presentaciones independientes', sku: 'QA-BASE', price: 10000, weightKg: 1, image: 'https://example.invalid/variantes.webp', presentaciones: [
    { varianteId: 'VAR-QA-UNO', nombre: '1 kg', sku: 'QA-BASE', foto: 'https://example.invalid/uno.webp', bodegaIds: ['HUB_KENNEDY'], price: 10000, weightKg: 1 },
    { varianteId: 'VAR-QA-TRES', nombre: '3 kg', sku: 'QA-TRES', foto: 'https://example.invalid/tres.webp', bodegaIds: ['HUB_KENNEDY'], price: 27000, weightKg: 3 },
  ] }, admin);
  variantProduct = repository.adjustInventory(variantProduct.id, { version: variantProduct.version, variantId: 'VAR-QA-TRES', storeId: 'HUB_KENNEDY', quantity: 7, reason: 'Conteo de presentación de 3 kg' }, admin);
  await check('una presentación conserva precio, peso y existencias propios sin trasladarlos a otra', () => {
    const variants = variantProduct.presentaciones!;
    assert.equal(variants[1].price, 27000);
    assert.equal(variants[1].weightKg, 3);
    assert.equal(variants[1].stockByStore!.HUB_KENNEDY, 7);
    assert.equal(variants[0].stockByStore!.HUB_KENNEDY, 0);
    assert.equal(variantProduct.stockByStore.HUB_KENNEDY, 0);
  });
  await check('no elimina una presentación que todavía tiene mercancía', () => {
    rejects(() => repository.updateProduct(variantProduct.id, { version: variantProduct.version, presentaciones: [variantProduct.presentaciones![0]] }, admin));
    assert.equal(repository.getProduct(variantProduct.id).presentaciones!.length, 2);
  });
  variantProduct = repository.adjustInventory(variantProduct.id, { version: variantProduct.version, storeId: 'HUB_KENNEDY', quantity: 0, reason: 'Conteo físico confirmado en cero' }, admin);
  await check('un conteo confirmado en cero se distingue de inventario todavía desconocido', () => {
    assert.equal(variantProduct.stockByStore.HUB_KENNEDY, 0);
    assert.equal(variantProduct.inventoryVerifiedByStore!.HUB_KENNEDY, true);
    assert.equal(variantProduct.dataPending.some(value => value.startsWith('Existencias')), false);
  });

  const start = Date.parse('2026-10-29T09:00:00-05:00');
  const end = Date.parse('2026-10-29T18:00:00-05:00');
  const promoInput = { name: 'Oferta de prueba', type: 'PERCENTAGE', value: 10, productIds: [product.id], variantIds: [], storeIds: ['HUB_KENNEDY'], startsAt: new Date(start).toISOString(), endsAt: new Date(end).toISOString(), minSubtotal: 15000, active: true };
  let promo = repository.savePromotion(promoInput, admin);
  const line = [{ productId: product.id, price: 20000, quantity: 1 }];
  await check('promoción respeta inicio inclusivo y final exclusivo según fecha absoluta', () => {
    assert.equal(repository.calculateDiscount(line, 'HUB_KENNEDY', start - 1).discount, 0);
    assert.equal(repository.calculateDiscount(line, 'HUB_KENNEDY', start).discount, 2000);
    assert.equal(repository.calculateDiscount(line, 'HUB_KENNEDY', end).discount, 0);
  });
  await check('aplica la promoción solo a bodega, productos y compra mínima elegibles', () => {
    assert.equal(repository.calculateDiscount(line, 'HUB_SUBA', start).discount, 0);
    assert.equal(repository.calculateDiscount([{ ...line[0], productId: products[0].id }], 'HUB_KENNEDY', start).discount, 0);
    assert.equal(repository.calculateDiscount([{ ...line[0], price: 10000 }], 'HUB_KENNEDY', start).discount, 0);
    assert.equal(repository.calculateDiscount([...line, { productId: products[0].id, price: 10000, quantity: 2 }], 'HUB_KENNEDY', start).discount, 2000);
  });
  promo = repository.savePromotion({ ...promo, productIds: [], variantIds: ['VAR-QA-TRES'], minSubtotal: 0 }, admin, promo.id);
  await check('una promoción de presentación no descuenta otra presentación del mismo producto', () => {
    assert.equal(repository.calculateDiscount([{ productId: variantProduct.id, variantId: 'VAR-QA-UNO', price: 10000, quantity: 1 }], 'HUB_KENNEDY', start).discount, 0);
    assert.equal(repository.calculateDiscount([{ productId: variantProduct.id, variantId: 'VAR-QA-TRES', price: 27000, quantity: 1 }], 'HUB_KENNEDY', start).discount, 2700);
  });
  promo = repository.savePromotion({ ...promo, ...promoInput, version: promo.version }, admin, promo.id);
  await check('rechaza descuentos fuera de rango, bodegas desconocidas y fechas sin zona', () => {
    rejects(() => repository.savePromotion({ ...promoInput, value: 101 }, admin));
    rejects(() => repository.savePromotion({ ...promoInput, storeIds: ['NO-EXISTE'] }, admin));
    rejects(() => repository.savePromotion({ ...promoInput, startsAt: '2026-10-29T09:00:00' }, admin));
    rejects(() => repository.savePromotion({ ...promoInput, endsAt: promoInput.startsAt }, admin));
  });
  const fixed = repository.savePromotion({ ...promoInput, name: 'Descuento fijo QA', type: 'FIXED', value: 25000 }, admin);
  await check('no acumula promociones y nunca descuenta más del producto elegible', () => {
    const applied = repository.calculateDiscount(line, 'HUB_KENNEDY', start);
    assert.equal(applied.discount, 20000);
    assert.equal(applied.promotionId, fixed.id);
  });
  repository.savePromotion({ ...fixed, active: false }, admin, fixed.id);
  promo = repository.savePromotion({ ...promo, active: false }, admin, promo.id);
  await check('una promoción pausada deja de aplicar y exige versión vigente al editar', () => {
    assert.equal(repository.calculateDiscount(line, 'HUB_KENNEDY', start).discount, 0);
    rejects(() => repository.savePromotion({ ...promo, version: promo.version - 1, active: true }, admin, promo.id), 409);
  });

  const beforeRestart = repository.getProduct(product.id);
  repository.close();
  const restartedProducts = structuredClone(INITIAL_PRODUCTS.slice(0, 2));
  repository = new AdminRepository({ dataDir: dir, products: restartedProducts, stores: structuredClone(INITIAL_STORES) });
  await check('reiniciar conserva catálogo administrado, cantidades, reservas, promociones y pedidos', () => {
    const restored = repository.getProduct(product.id);
    assert.equal(restored.name, beforeRestart.name);
    assert.equal(restored.stockByStore.HUB_KENNEDY, 8);
    assert.equal(restored.reservedStockByStore.HUB_KENNEDY, 3);
    assert.equal(repository.listPromotions().length, 2);
    assert.equal(repository.getProduct(variantProduct.id).presentaciones![1].stockByStore!.HUB_KENNEDY, 7);
    assert.deepEqual(repository.readOperationalState(), snapshot);
    assert.ok(repository.getSession(session.token));
  });
  await check('cambiar contraseña revoca todas las sesiones y conserva el catálogo', async () => {
    await assert.rejects(() => repository.changePassword(admin, 'equivocada', replacement), AdminError);
    await repository.changePassword(admin, secret, replacement);
    assert.equal(repository.getSession(session.token), null);
    await assert.rejects(() => repository.login(admin.username, secret, 'password-ip'), error => error instanceof AdminError && error.status === 401);
    assert.ok((await repository.login(admin.username, replacement, 'password-ip')).token);
    assert.equal(repository.getProduct(product.id).name, beforeRestart.name);
  });
  await check('rotar la contraseña también invalida un inicio de sesión que ya estaba calculando el hash', async () => {
    const raceUser = repository.createAdministrator('qa.race', secret);
    const loginInFlight = repository.login(raceUser.username, secret, 'race-ip');
    repository.resetPassword(raceUser.username, replacement);
    await assert.rejects(() => loginInFlight, error => error instanceof AdminError && error.status === 401);
  });
  await check('dos cambios simultáneos de contraseña no se sobrescriben mutuamente', async () => {
    const raceUser = repository.createAdministrator('qa.password-race', secret);
    const oldSession = await repository.login(raceUser.username, secret, 'password-race-ip');
    const results = await Promise.allSettled([
      repository.changePassword(raceUser, secret, 'Cambio-Concurrente-Uno-2026'),
      repository.changePassword(raceUser, secret, 'Cambio-Concurrente-Dos-2026'),
    ]);
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal(results.filter(result => result.status === 'rejected').length, 1);
    assert.equal(repository.getSession(oldSession.token), null);
  });
  await check('el respaldo SQLite es legible y no sobrescribe una copia existente', () => {
    const filename = repository.backup();
    const backup = new DatabaseSync(filename, { readOnly: true });
    try { assert.equal(Number(backup.prepare('SELECT COUNT(*) AS count FROM managed_products').get()!.count), restartedProducts.length); }
    finally { backup.close(); }
    rejects(() => repository.backup(filename));
  });
  console.log(`ADMIN REPOSITORY: ${passed} comprobaciones aprobadas.`);
} finally {
  repository.close();
  if (path.dirname(dir) !== path.resolve(tmpdir()) || !path.basename(dir).startsWith('bolt-admin-repo-')) throw new Error('Directorio temporal inválido');
  rmSync(dir, { recursive: true, force: true });
}
