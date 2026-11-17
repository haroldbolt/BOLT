export const adminEntryPath = '/admin/nuevo/';

const adminAliases = new Set(['/admin', '/admin/', '/operacion', '/operacion/', '/admin/nuevo', adminEntryPath]);
const legacyViews = { PEDIDOS: 'orders', PROGRAMADAS: 'scheduled', INVENTARIO: 'inventory', DESPACHOS: 'dispatch', EFECTIVO: 'dispatch', INFORMES: 'dispatch' };
const views = new Set(['home', 'orders', 'turbo', 'scheduled', 'inventory', 'sales', 'dispatch', 'tools', 'permissions']);
const operationalTools = new Set(['PEDIDOS', 'BODEGAS', 'CATALOGO', 'SHOPIFY', 'FARMACIA', 'FLOTA', 'INVENTARIO']);

export function adminEntry(url) {
  if (!adminAliases.has(url.pathname)) return null;
  const normalized = new URLSearchParams();
  const tab = url.searchParams.get('tab');
  const preferred = url.searchParams.get('view');
  if (views.has(preferred)) normalized.set('view', preferred);
  else if (tab && Object.hasOwn(legacyViews, tab)) normalized.set('view', legacyViews[tab]);
  else if (operationalTools.has(tab)) normalized.set('view', 'tools');

  const tool = url.searchParams.get('tool') ?? tab;
  if (normalized.get('view') === 'tools' && operationalTools.has(tool)) normalized.set('tool', tool);
  const store = url.searchParams.get('sede');
  if (store && /^[a-zA-Z0-9_-]{1,100}$/.test(store)) normalized.set('sede', store);
  const order = url.searchParams.get('pedido');
  if (order && /^[a-zA-Z0-9_-]{1,100}$/.test(order)) normalized.set('pedido', order);
  return adminEntryPath + (normalized.size ? '?' + normalized : '');
}
