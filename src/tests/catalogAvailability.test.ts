import assert from 'node:assert/strict';
import type { Product } from '../types';
import { INITIAL_PRODUCTS } from '../data/seedData';
import { filterCustomerCatalog, getCatalogAvailableQuantity, isCustomerCatalogProductVisible, reconcileCartForCatalog } from '../lib/catalogAvailability';
import { getProductPurchaseBlock, getProductSellableQuantity } from '../lib/productAvailability';

const fixture = (id: string, kennedy: number, suba: number): Product => ({
  ...structuredClone(INITIAL_PRODUCTS[0]), id, sku: '', source: 'SHOPIFY', shopifyStatus: 'ACTIVE',
  shopifyVariantGid: `gid://shopify/ProductVariant/${id}`, stockByStore: { HUB_KENNEDY: kennedy, HUB_SUBA: suba },
  reservedStockByStore: { HUB_KENNEDY: 0, HUB_SUBA: 0 },
  inventoryByStore: {
    HUB_KENNEDY: { locationGid: 'kennedy', available: kennedy, onHand: kennedy + 4, committed: 4, quantities: { available: kennedy } },
    HUB_SUBA: { locationGid: 'suba', available: suba, onHand: suba, committed: 0, quantities: { available: suba } },
  },
  pricePending: false, inventoryPending: false, weightVerified: true, compliancePending: false,
  logisticsBlocked: false, requiresShipping: true,
});
let passed = 0;
const check = (condition: unknown, title: string) => { assert.ok(condition, title); passed++; };
const first = fixture('101', 6, 0), second = fixture('102', 3, 8);
const source = [first, second];
const before = JSON.stringify(source);
check(filterCustomerCatalog(source, null).length === 0, 'Sin dirección confirmada no se inventa una bodega ni se muestra inventario');
check(filterCustomerCatalog(source, 'HUB_KENNEDY').length === 2, 'Kennedy muestra sus dos variantes con existencias');
check(filterCustomerCatalog(source, 'HUB_SUBA').map(product => product.id).join() === '102', 'Suba oculta la variante que solo tiene Kennedy');
check(filterCustomerCatalog(source, 'UNKNOWN').length === 0, 'Una bodega sin cantidades conocidas no hereda las de otra sede');
check(new Set(filterCustomerCatalog(source, 'HUB_KENNEDY').map(product => product.id)).size === 2, 'SKU vacíos no colisionan: identidad por variante');
const pending = { ...first, weightVerified: false, weightKg: 0, inventoryPending: true, logisticsBlocked: true };
check(isCustomerCatalogProductVisible(pending, 'HUB_KENNEDY'), 'Peso o revisión pendientes no se confunden con ausencia de existencias');
check(!!getProductPurchaseBlock(pending) && getProductSellableQuantity(pending, 'HUB_KENNEDY') === 0, 'Los bloqueos de compra del punto 2 permanecen intactos');
const reserved = { ...first, reservedStockByStore: { HUB_KENNEDY: 2 } };
check(getCatalogAvailableQuantity(reserved, 'HUB_KENNEDY') === 4, 'Available ya descuenta comprometidos; solo se restan reservas locales adicionales');
for (const quantity of [0, -3, NaN]) {
  const product = fixture('103', quantity, 2);
  check(!isCustomerCatalogProductVisible(product, 'HUB_KENNEDY'), 'Cantidad no vendible o no finita queda oculta');
}
const unknown = fixture('104', 9, 2);
unknown.inventoryByStore!.HUB_KENNEDY.available = null;
check(!isCustomerCatalogProductVisible(unknown, 'HUB_KENNEDY'), 'Disponible desconocido no se trata como existencia confirmada');
for (const shopifyStatus of ['DRAFT', 'ARCHIVED']) check(!isCustomerCatalogProductVisible({ ...first, shopifyStatus }, 'HUB_KENNEDY'), 'Variantes no activas quedan fuera del catálogo cliente');
check(JSON.stringify(source) === before, 'Filtrar no cambia los datos que conserva Administración');
const initialCart = [{ product: first, quantity: 5 }, { product: second, quantity: 2 }];
const reduced = { ...first, stockByStore: { HUB_KENNEDY: 3, HUB_SUBA: 0 } };
const refresh = reconcileCartForCatalog(initialCart, [reduced, second], 'HUB_KENNEDY');
check(refresh.items[0].quantity === 3 && refresh.items[1].quantity === 2, 'Una actualización reduce lo que excede stock y conserva el resto del carrito');
check(refresh.notices.length === 1 && refresh.changed, 'El ajuste de cantidad incluye explicación para el cliente');
const switched = reconcileCartForCatalog(initialCart, source, 'HUB_SUBA');
check(switched.items.length === 1 && switched.items[0].product.id === second.id, 'Cambiar de bodega retira exclusivamente los artículos sin disponibilidad');
check(switched.items[0].quantity === 2 && switched.notices.length === 1, 'El resto del carrito permanece y se explica lo retirado');
const unchanged = reconcileCartForCatalog(switched.items, source, 'HUB_SUBA');
check(!unchanged.changed && unchanged.items === switched.items, 'Consultar de nuevo la misma lectura no reinicia el carrito');
const unconfirmed = reconcileCartForCatalog(initialCart, [], null);
check(!unconfirmed.changed && unconfirmed.items === initialCart, 'Editar la dirección sin confirmar otra no borra el carrito existente');
const newSnapshot = reconcileCartForCatalog(initialCart, [{ ...first, inventoryPending: true }, second], 'HUB_KENNEDY');
check(newSnapshot.items[0].product.inventoryPending && !!getProductPurchaseBlock(newSnapshot.items[0].product), 'El carrito recibe los nuevos datos sin saltarse revisiones pendientes');
console.log(`${passed} comprobaciones de catálogo por bodega y carrito aprobadas.`);
