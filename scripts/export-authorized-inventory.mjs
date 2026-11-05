import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

// Manual export of the owner's explicit 100-unit instruction. No orders,
// customer details, reservations, accounts or credentials belong in this file.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);
const sourceFile = path.join(root, '.bolt-private', 'inventory-100-test', 'data', 'admin.sqlite');
const destination = path.join(root, 'src', 'data', 'inventario-autorizado.json');
const { localCatalogService } = await import('../src/lib/localCatalogService.ts');
const stores = localCatalogService.getStores();
const originals = new Map(localCatalogService.getAllGroupedProducts().map(product => [product.id, product]));
const aliases = new Map(stores.flatMap(store => [[store.id, store.id], [store.shopifyLocationGid, store.id]]));
const confirmedPositive = value => typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
const presentationIdentity = ({ varianteId, nombre, sku, foto }, index, parentSku) => ({ varianteId, nombre: nombre || '', sku: sku || (index === 0 ? parentSku : '') || '', foto: foto || '' });
const db = new DatabaseSync(sourceFile, { readOnly: true });
try {
  const products = db.prepare('SELECT payload FROM managed_products ORDER BY id').all().map(row => JSON.parse(row.payload));
  let presentationCount = 0, warehousePairs = 0;
  for (const product of products) {
    const original = originals.get(product.id);
    if (!original) throw new Error('Hay un producto nuevo fuera del catálogo base. Debe incorporarse su ficha antes de exportar solo existencias.');
    for (const field of ['name', 'brand', 'category', 'description', 'image', 'status', 'presentation']) {
      if (JSON.stringify(product[field]) !== JSON.stringify(original[field])) throw new Error(`La ficha pública de un producto cambió en ${field}; incorpora primero esa actualización al catálogo.`);
    }
    if (JSON.stringify(product.presentaciones?.map((value, index) => presentationIdentity(value, index, product.sku))) !==
        JSON.stringify(original.presentaciones?.map((value, index) => presentationIdentity(value, index, original.sku)))) throw new Error(`Una presentación de ${product.id} cambió respecto al catálogo público; actualiza su ficha antes de exportar.`);
  }
  const snapshot = { version: 1, source: 'OWNER_AUTHORIZED_100_UNITS', authorizedDate: '2026-11-04', physicalQuantity: 100,
    stores: stores.map(({ id, shopifyLocationGid, name, isActive }) => ({ id, shopifyLocationGid, name, isActive })),
    products: products.map(product => ({ id: product.id, presentations: product.presentaciones.map((presentation, index) => {
      const current = index === 0 ? product : presentation;
      const associated = [...new Set(presentation.bodegaIds.map(id => aliases.get(id)))];
      if (associated.some(id => !id)) throw new Error('Se encontró una asociación de bodega sin identificar.');
      const active = associated.filter(id => stores.find(store => store.id === id)?.isActive);
      if (!active.length) throw new Error('Una presentación no tiene una bodega activa asociada; se conserva sin inventar una relación.');
      presentationCount++; warehousePairs += active.length;
      return { variantId: presentation.varianteId, price: confirmedPositive(current.price), weightKg: confirmedPositive(current.weightKg),
        stockByStore: Object.fromEntries(active.map(id => [id, 100])) };
    }) })) };
  fs.writeFileSync(destination, JSON.stringify(snapshot) + '\n');
  console.log(JSON.stringify({ products: snapshot.products.length, presentations: presentationCount, warehousePairs,
    physicalQuantity: 100, publicCatalogMatches: true, includesCustomers: false, includesReservations: false, includesCredentials: false }));
} finally { db.close(); }
