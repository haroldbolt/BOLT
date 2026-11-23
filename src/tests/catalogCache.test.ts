import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { catalogCacheTtlMs } from '../lib/catalogCache';
import { LocalCatalogService } from '../lib/localCatalogService';
import { CatalogRepository } from '../lib/catalogRepository';
import { CatalogOperations } from '../lib/catalogOperations';
import type { Order } from '../types';

const actor = {name: 'Inventario fixture', email: 'fixture@example.invalid'};
const product = {
  productoId: 'producto-fixture', nombre: 'Fixture inicial', productType: 'Alimento',
  status: 'ACTIVE', bodegaIds: ['HUB_SUBA'], presentaciones: [
    {varianteId: 'variante-fixture', sku: 'SKU-FIXTURE', nombre: '1 kg', foto: '', bodegaIds: ['HUB_SUBA']},
  ],
};
function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bolt-cache-'));
  const write = (name: string, data: unknown) => fs.writeFileSync(path.join(directory, name), JSON.stringify(data));
  write('productos.json', [product]);
  write('bodegas.json', []);
  let time = 1000;
  const now = () => time;
  const source = new LocalCatalogService(directory, 100, now);
  const repo = () => new CatalogRepository(source, path.join(directory, 'overrides.json'), 100, now);
  return {directory, write, source, repo, tick: () => { time += 100; }, remove: () => fs.rmSync(directory, {recursive: true, force: true})};
}

test('TTL configurable dentro de límites explícitos', () => {
  assert.equal(catalogCacheTtlMs(''), 60000);
  assert.equal(catalogCacheTtlMs('2'), 2000);
  for (const value of ['0', '-1', 'Infinity', '61s', '3601']) assert.throws(() => catalogCacheTtlMs(value));
});

test('revalida fuentes al vencer, preserva altas en runtime y conserva la última lectura completa si falla la siguiente', () => {
  const f = fixture();
  try {
    const repo = f.repo();
    const old = f.source.getAllGroupedProducts();
    const added = {...repo.getProductById(product.productoId)!, id: 'solo-en-demo'};
    repo.registerBaselineProduct(added);
    f.write('productos.json', [{...product, nombre: 'Actualizado'}]);
    assert.equal(repo.getProductById(product.productoId)?.name, product.nombre);
    f.tick();
    assert.equal(repo.getProductById(product.productoId)?.name, 'Actualizado');
    assert.notEqual(f.source.getAllGroupedProducts(), old);
    assert.equal(repo.getProductById(added.id)?.id, added.id);

    const fresh = repo.getAllProducts();
    f.tick();
    assert.equal(repo.getAllProducts(), fresh, 'no reconstruir si todos los archivos son idénticos');
    f.write('productos.json', [{...product, nombre: 'Siguiente versión'}]);
    fs.writeFileSync(path.join(f.directory, 'bodegas.json'), '{');
    f.tick();
    assert.equal(repo.getAllProducts(), fresh, 'no publicar una lectura parcial');
    f.write('bodegas.json', []);
    f.tick();
    assert.equal(repo.getProductById(product.productoId)?.name, 'Siguiente versión');
  } finally { f.remove(); }
});

test('alta, edición, estado y lote de fotos se ven inmediatamente y sobreviven al reinicio', () => {
  const f = fixture();
  try {
    const repo = f.repo();
    const secondReader = f.repo();
    const created = repo.createProduct({name:'Extra fixture', sku:'EXTRA-FIXTURE', price:1000}, actor).product!;
    assert.ok(repo.getAllProducts(false).some(item => item.id === created.id));
    assert.ok(repo.updateProduct(product.productoId, {name:'Nombre editado'}, actor).success);
    assert.equal(repo.getProductById(product.productoId)?.name, 'Nombre editado');
    const photo = 'https://example.invalid/verified-fixture.jpg';
    assert.equal(repo.applyImagePatches([{
      productId:product.productoId, variants:[{variantId:'variante-fixture', before:'', after:photo}],
      source:'fixture', checkedAt:'2026-01-01', reason:'Prueba aislada',
    }], actor).changed, 1);
    assert.equal(repo.getProductById(product.productoId)?.presentaciones?.[0].foto, photo);
    assert.equal(repo.toggleProductStatus(created.id, actor).newStatus, 'INACTIVE');
    assert.ok(!repo.getAllProducts(false).some(item => item.id === created.id));
    assert.equal(secondReader.getProductById(product.productoId)?.name, product.nombre);
    f.tick();
    assert.equal(secondReader.getProductById(product.productoId)?.name, 'Nombre editado');
    const restored = f.repo();
    assert.equal(restored.getProductById(product.productoId)?.presentaciones?.[0].foto, photo);
    assert.equal(restored.getProductById(created.id)?.status, 'INACTIVE');
  } finally { f.remove(); }
});

test('una lectura caliente respeta precios, reservas, cancelaciones y ventas posteriores por presentación y sede', () => {
  const f = fixture();
  try {
    const repo = f.repo();
    const orders: Order[] = [];
    const operations = new CatalogOperations({
      file:path.join(f.directory, 'comercio.json'), products:() => [repo.getProductById(product.productoId)!],
      stores:() => f.source.getStores(), orders:() => orders,
    });
    operations.initializeOrderTracking();
    const read = () => operations.getSalesProducts()[0];
    assert.equal(read().price, 0);
    operations.edit(product.productoId, {priceCOP:12000, stockByStore:{HUB_SUBA:5}, expectedRevision:read().commerceRevision}, actor);
    assert.equal(read().price, 12000);
    orders.push({storeId:'HUB_SUBA', items:[{productId:product.productoId, quantity:1}], fulfillmentStatus:'CONFIRMADO'} as Order);
    assert.equal(read().reservedStockByStore.HUB_SUBA, 1);
    assert.equal(read().reservedStockByStore.HUB_KENNEDY, 0);
    orders[0].fulfillmentStatus = 'CANCELADO';
    assert.equal(read().reservedStockByStore.HUB_SUBA, 0);
    orders.push({...orders[0], fulfillmentStatus:'ENTREGADO'});
    assert.equal(read().stockByStore.HUB_SUBA, 4);
  } finally { f.remove(); }
});
