import type { CartItem, Product } from '../types';
import { formatCOP } from './formatters';

export interface CustomerCartResult {
  items: CartItem[];
  issues: string[];
  priceChanges: string[];
}

function validQuantity(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

function availableQuantity(product: Product, storeId: string): number {
  const stock = product.stockByStore?.[storeId] ?? 0;
  const reserved = product.reservedStockByStore?.[storeId] ?? 0;
  if (!Number.isSafeInteger(stock) || stock < 0 || !Number.isSafeInteger(reserved) || reserved < 0) return 0;
  return Math.max(0, stock - reserved);
}

function saleDataIssues(product: Product): string[] {
  const issues: string[] = [];
  if (product.status && product.status !== 'ACTIVE') issues.push(`${product.name} no está activo para la venta.`);
  if (!Number.isFinite(product.price) || product.price <= 0) issues.push(`${product.name} tiene su precio pendiente de verificación.`);
  if (!Number.isFinite(product.weightKg) || product.weightKg <= 0) issues.push(`${product.name} tiene su peso pendiente de verificación.`);
  return issues;
}

function requestedInCart(cart: CartItem[], productId: string): number {
  let quantity = 0;
  for (const line of cart) {
    if (line.product.id !== productId) continue;
    if (!validQuantity(line.quantity) || !Number.isSafeInteger(quantity + line.quantity)) return NaN;
    quantity += line.quantity;
  }
  return quantity;
}

/** Refreshes display data without deleting, reducing or reserving any existing cart line. */
export function reconcileCustomerCart(cart: CartItem[], selling: Product[], storeId: string): CustomerCartResult {
  const catalog = new Map(selling.map(product => [product.id, product]));
  const issues = new Set<string>();
  const priceChanges = new Set<string>();
  const items = cart.map(line => {
    const fresh = catalog.get(line.product.id);
    if (!fresh) {
      issues.add(`${line.product.name} ya no está disponible en la bodega seleccionada. Conservamos la línea para que puedas revisarla.`);
      if (!validQuantity(line.quantity)) issues.add(`Revisa la cantidad de ${line.product.name}.`);
      return { ...line, product: { ...structuredClone(line.product), status: 'ARCHIVED', stockByStore: {}, reservedStockByStore: {} } };
    }
    for (const issue of saleDataIssues(fresh)) issues.add(issue);
    if (line.product.price !== fresh.price && Number.isFinite(fresh.price) && fresh.price > 0) {
      const previous = Number.isFinite(line.product.price) && line.product.price > 0 ? formatCOP(line.product.price) : 'pendiente';
      const change = `El precio de ${fresh.name} cambió de ${previous} a ${formatCOP(fresh.price)}. Revisa el total actualizado.`;
      issues.add(change);
      priceChanges.add(change);
    }
    const total = requestedInCart(cart, fresh.id);
    const available = availableQuantity(fresh, storeId);
    if (!validQuantity(line.quantity) || !Number.isSafeInteger(total)) issues.add(`Revisa la cantidad de ${fresh.name}.`);
    if (available <= 0) issues.add(`${fresh.name} no tiene unidades disponibles para esta bodega.`);
    else if (total > available) issues.add(`Solicitaste ${total} unidades de ${fresh.name}, pero esta bodega dispone de ${available}. Ajusta la cantidad.`);
    return { ...line, product: structuredClone(fresh) };
  });
  return { items, issues: [...issues], priceChanges: [...priceChanges] };
}

/** Adds whole, consolidated requests using only the selected warehouse's fresh availability. */
export function addCustomerCartLines(
  cart: CartItem[], requests: { productId: string; quantity: number }[], selling: Product[], storeId: string,
): CustomerCartResult {
  const reconciled = reconcileCustomerCart(cart, selling, storeId);
  const items = reconciled.items;
  const issues = new Set(reconciled.issues);
  const catalog = new Map(selling.map(product => [product.id, product]));
  const grouped = new Map<string, { quantity: number; valid: boolean }>();
  for (const request of requests) {
    if (!request || typeof request.productId !== 'string' || !request.productId.trim()) {
      issues.add('No se pudo identificar uno de los productos solicitados.');
      continue;
    }
    const group = grouped.get(request.productId) || { quantity: 0, valid: true };
    if (!validQuantity(request.quantity) || !Number.isSafeInteger(group.quantity + request.quantity)) group.valid = false;
    else group.quantity += request.quantity;
    grouped.set(request.productId, group);
  }
  for (const [id, group] of grouped) {
    const product = catalog.get(id);
    if (!group.valid) {
      issues.add(`Revisa la cantidad solicitada de ${product?.name || 'este producto'}. No se agregó ninguna unidad de esa solicitud.`);
      continue;
    }
    if (!product) {
      issues.add('Uno de los productos solicitados ya no está disponible en la bodega seleccionada. No se agregó al carrito.');
      continue;
    }
    const dataIssues = saleDataIssues(product);
    if (dataIssues.length) { for (const issue of dataIssues) issues.add(issue); continue; }
    const existing = requestedInCart(items, id);
    if (!Number.isSafeInteger(existing) || !Number.isSafeInteger(existing + group.quantity)) {
      issues.add(`Revisa la cantidad de ${product.name} que ya está en el carrito. No se agregaron más unidades.`);
      continue;
    }
    const available = availableQuantity(product, storeId);
    if (existing + group.quantity > available) {
      issues.add(`No se agregaron las ${group.quantity} unidades de ${product.name}: esta bodega dispone de ${available} y ya tienes ${existing} en el carrito.`);
      continue;
    }
    const index = items.findIndex(line => line.product.id === id);
    if (index >= 0) items[index] = { ...items[index], quantity: items[index].quantity + group.quantity };
    else items.push({ product: structuredClone(product), quantity: group.quantity });
  }
  return { items, issues: [...issues], priceChanges: reconciled.priceChanges };
}
