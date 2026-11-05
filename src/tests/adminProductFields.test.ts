import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import express from 'express';
import { AdminRepository } from '../lib/adminRepository';
import { createAdminRouter } from '../lib/adminRouter';
import { INITIAL_PRODUCTS, INITIAL_STORES } from '../data/seedData';

const dir = mkdtempSync(path.join(tmpdir(), 'bolt-admin-fields-'));
const products = structuredClone(INITIAL_PRODUCTS.slice(0, 1));
products[0].presentaciones = [{ varianteId: 'VAR-LEGACY', nombre: 'Presentación histórica', sku: 'SKU-LEGACY', foto: 'https://example.invalid/historica.webp', bodegaIds: [] }];
const repository = new AdminRepository({ dataDir: dir, products, stores: structuredClone(INITIAL_STORES) });
const actor = { id: 'QA-FIELDS', username: 'qa.fields', displayName: 'Prueba de campos' };
const previousOrigin = process.env.BOLT_PUBLIC_ORIGIN;
let passed = 0;
let server: ReturnType<ReturnType<typeof express>['listen']> | undefined;
function check(label: string, operation: () => void) { operation(); passed++; console.log(`PASS: ${label}`); }
try {
  check('crear la cuenta antes del primer arranque conserva catálogo, productos locales y usuario', () => {
    const bootstrapDir = path.join(dir, 'bootstrap');
    let bootstrap = new AdminRepository({ dataDir: bootstrapDir, products: [], stores: structuredClone(INITIAL_STORES) });
    const user = bootstrap.createAdministrator('qa.bootstrap', 'Clave-Bootstrap-Aislada-2026');
    assert.equal(bootstrap.db.prepare("SELECT value FROM admin_metadata WHERE name='catalog_imported'").get(), undefined);
    const local = bootstrap.createProduct({ name: 'Producto local previo a importar', sku: 'BOOTSTRAP-LOCAL' }, user);
    const seed = structuredClone(INITIAL_PRODUCTS.slice(0, 2));
    const firstSeed = seed[0];
    const secondSeedId = seed[1].id;
    const editedBase = bootstrap.createProduct({ name: 'Registro temporal para probar conservación', sku: 'BOOTSTRAP-EDITED' }, user);
    // Representa un producto administrado que ya comparte ID con el catálogo base.
    const persisted = { ...editedBase, id: firstSeed.id, name: 'Nombre editado conservado' };
    bootstrap.db.prepare('INSERT INTO managed_products(id,payload,version,updated_at) VALUES (?,?,?,?)').run(persisted.id, JSON.stringify(persisted), 9, new Date().toISOString());
    bootstrap.close();
    bootstrap = new AdminRepository({ dataDir: bootstrapDir, products: seed, stores: structuredClone(INITIAL_STORES) });
    try {
      assert.equal(bootstrap.products.length, 4);
      assert.equal(bootstrap.hasAdministrator(), true);
      assert.equal(bootstrap.getProduct(local.id).name, local.name);
      assert.equal(bootstrap.getProduct(firstSeed.id).name, 'Nombre editado conservado');
      assert.equal(bootstrap.getProduct(firstSeed.id).version, 9);
      assert.ok(bootstrap.getProduct(secondSeedId));
      assert.ok(bootstrap.db.prepare("SELECT value FROM admin_metadata WHERE name='catalog_imported'").get());
      assert.equal(bootstrap.products.find(p => p.id === firstSeed.id), firstSeed);
    } finally { bootstrap.close(); }
  });
  check('recupera un marcador antiguo de catálogo vacío sin perder la cuenta administrativa', () => {
    const bootstrapDir = path.join(dir, 'legacy-empty-bootstrap');
    let bootstrap = new AdminRepository({ dataDir: bootstrapDir, products: [], stores: structuredClone(INITIAL_STORES) });
    bootstrap.createAdministrator('qa.legacy', 'Clave-Legacy-Aislada-2026');
    bootstrap.db.prepare("INSERT INTO admin_metadata(name,value) VALUES ('catalog_imported',?)").run('marca anterior vacía');
    bootstrap.close();
    const seed = structuredClone(INITIAL_PRODUCTS.slice(0, 2));
    bootstrap = new AdminRepository({ dataDir: bootstrapDir, products: seed, stores: structuredClone(INITIAL_STORES) });
    try {
      assert.equal(bootstrap.products.length, 2);
      assert.equal(bootstrap.hasAdministrator(), true);
      assert.equal(bootstrap.products[0], seed[0]);
    } finally { bootstrap.close(); }
  });
  let product = repository.getProduct(products[0].id);
  product = repository.updateProduct(product.id, { version: product.version, concentration: '10 mg/ml', pharmaceuticalForm: 'Solución oral', authorizedInfo: 'Información autorizada de prueba', icaRegistration: 'QA-ICA', activeIngredient: 'Principio de prueba', pharmacySubcategory: 'Medicamentos veterinarios', temperatureColdChain: true, storageCondition: 'CADENA_FRIO_2_8' }, actor);
  check('la ficha guarda los campos de Farmacia y almacenamiento que permite editar', () => {
    assert.equal(product.concentration, '10 mg/ml');
    assert.equal(product.pharmaceuticalForm, 'Solución oral');
    assert.equal(product.authorizedInfo, 'Información autorizada de prueba');
    assert.equal(product.icaRegistration, 'QA-ICA');
    assert.equal(product.activeIngredient, 'Principio de prueba');
    assert.equal(product.pharmacySubcategory, 'Medicamentos veterinarios');
    assert.equal(product.temperatureColdChain, true);
    assert.equal(product.storageCondition, 'CADENA_FRIO_2_8');
  });
  product = repository.setArchived(product.id, true, product.version, actor);
  check('archivar conserva la foto, SKU y nombre históricos de la presentación principal', () => {
    assert.equal(product.presentaciones![0].foto, 'https://example.invalid/historica.webp');
    assert.equal(product.presentaciones![0].sku, 'SKU-LEGACY');
    assert.equal(product.presentaciones![0].nombre, 'Presentación histórica');
  });
  product = repository.updateProduct(product.id, { version: product.version, image: 'https://example.invalid/nueva.webp', presentation: 'Presentación actualizada', sku: 'SKU-ACTUALIZADO' }, actor);
  check('editar explícitamente foto, presentación y SKU principales actualiza sus datos de compra', () => {
    assert.equal(product.presentaciones![0].foto, product.image);
    assert.equal(product.presentaciones![0].nombre, product.presentation);
    assert.equal(product.presentaciones![0].sku, product.sku);
  });
  const originalList = repository.listPromotions.bind(repository);
  repository.listPromotions = () => { throw new Error('No debe consultar la base una vez por cada producto.'); };
  check('el cálculo del catálogo puede reutilizar una lista de promociones sin consultas repetidas', () => {
    for (let i = 0; i < 100; i++) assert.equal(repository.calculateDiscount([{ productId: product.id, price: 10000, quantity: 1 }], 'HUB_KENNEDY', Date.now(), []).discount, 0);
  });
  repository.listPromotions = originalList;

  const user = repository.createAdministrator('qa.cookies', 'Clave-Cookies-Aislada-2026');
  const app = express();
  app.use(express.json());
  app.use('/api/v1/admin', createAdminRouter(repository));
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server!.once('listening', resolve));
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/v1/admin/login`;
  async function cookie() {
    const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: user.username, password: 'Clave-Cookies-Aislada-2026' }) });
    assert.equal(response.status, 200);
    return response.headers.get('set-cookie')!;
  }
  delete process.env.BOLT_PUBLIC_ORIGIN;
  const localCookie = await cookie();
  check('la sesión HTTP local no exige una cookie Secure que impediría usar el panel local', () => assert.doesNotMatch(localCookie, /;\s*Secure(?:;|$)/i));
  process.env.BOLT_PUBLIC_ORIGIN = 'https://bolt.example.invalid';
  const proxyCookie = await cookie();
  check('el origen público HTTPS exige cookie Secure aun detrás de un proxy en loopback', () => assert.match(proxyCookie, /;\s*Secure(?:;|$)/i));
  console.log(`ADMIN FIELDS: ${passed} comprobaciones aprobadas.`);
} finally {
  if (previousOrigin === undefined) delete process.env.BOLT_PUBLIC_ORIGIN; else process.env.BOLT_PUBLIC_ORIGIN = previousOrigin;
  if (server) await new Promise<void>((resolve, reject) => server!.close(error => error ? reject(error) : resolve()));
  repository.close();
  if (path.dirname(dir) !== path.resolve(tmpdir()) || !path.basename(dir).startsWith('bolt-admin-fields-')) throw new Error('Directorio temporal inválido');
  rmSync(dir, { recursive: true, force: true });
}
