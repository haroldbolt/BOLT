import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { normalizeShopifySnapshot, type ShopifySnapshot } from '../src/lib/shopifyMapper';

export type ShopifyInventory = ReturnType<typeof normalizeShopifySnapshot>;

const within = (directory: string, file: string) => {
  const relative = path.relative(directory, file);
  return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative));
};

/** Server-only import. Missing or invalid real data must never silently become seed inventory. */
export async function loadShopifyInventory(
  projectRoot: string,
  env: Record<string, string | undefined> = process.env,
): Promise<ShopifyInventory> {
  const root = path.resolve(projectRoot);
  const snapshotPath = path.resolve(root, env.BOLT_SHOPIFY_SNAPSHOT_PATH || '.bolt-private/shopify/snapshot.json');
  if (within(path.join(root, 'public'), snapshotPath) || within(path.join(root, 'dist'), snapshotPath)
    || (within(root, snapshotPath) && !within(path.join(root, '.bolt-private'), snapshotPath))) {
    throw new Error('La instantánea Shopify debe guardarse en una ruta privada del servidor.');
  }
  let snapshot: ShopifySnapshot;
  try {
    snapshot = JSON.parse(await readFile(snapshotPath, 'utf8'));
  } catch {
    throw new Error('No se pudo leer la instantánea privada de Shopify. No se cargará inventario de demostración.');
  }
  if (snapshot?.complete !== true || !snapshot.shop
    || !/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(snapshot.shop.myshopifyDomain || '')
    || snapshot.shop.currencyCode !== 'COP') {
    throw new Error('La instantánea Shopify está incompleta o no corresponde a una tienda en COP.');
  }
  const inventory = normalizeShopifySnapshot(snapshot);
  if (!inventory.status.complete || inventory.products.length === 0 || inventory.status.locationsCount === 0) {
    throw new Error('La instantánea Shopify no contiene un inventario completo. No se cargará inventario de demostración.');
  }
  return inventory;
}
