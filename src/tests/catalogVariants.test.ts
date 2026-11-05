import assert from 'node:assert/strict';
import { getOperationalCatalog, resolveCatalogProduct } from '../lib/catalogVariants';
import type { Product } from '../types';
import type { AdminPresentation } from '../types/admin';

let checks = 0;
function check(value: unknown, description: string) { assert.ok(value, description); checks++; }
const secondary: AdminPresentation = {
  varianteId: 'VAR-SECOND', nombre: '7 kg', sku: 'SKU-7', foto: 'https://example.com/7.jpg', bodegaIds: ['HUB_SUBA'],
  price: 47000, weightKg: 7, stockByStore: { HUB_SUBA: 4 }, reservedStockByStore: { HUB_SUBA: 1 }, inventoryVerifiedByStore: { HUB_SUBA: true },
};
const pending: AdminPresentation = { varianteId: 'VAR-PENDING', nombre: '15 kg', sku: '', foto: '', bodegaIds: [] };
const parent: Product = {
  id: 'PARENT', name: 'Alimento de prueba', sku: 'SKU-3', brand: 'Marca', species: 'Gato', category: 'Alimentos',
  requiresPrescription: false, storageCondition: 'LUGAR_FRESCO_Y_SECO', temperatureColdChain: false,
  price: 25000, weightKg: 3, presentation: '3 kg', image: 'https://example.com/3.jpg', description: '',
  stockByStore: { HUB_KENNEDY: 5 }, reservedStockByStore: { HUB_KENNEDY: 2 }, rating: 0, reviewsCount: 0, tags: [], status: 'ACTIVE',
  bodegaIds: ['HUB_KENNEDY'], originalPrice: 30000, discountPercent: 15, isLightningDeal: true,
  presentaciones: [
    { varianteId: 'VAR-FIRST', nombre: '3 kg', sku: 'SKU-3', foto: '', bodegaIds: ['HUB_KENNEDY'] },
    secondary, pending,
  ],
};
const catalog = getOperationalCatalog([parent]);
check(catalog.length === 3, 'Cada presentación produce exactamente una unidad de venta');
check(catalog[0] === parent, 'La presentación principal conserva la referencia usada para reservar');
check(catalog[0].id === 'PARENT' && catalog[0].variantId === 'VAR-FIRST', 'La principal mantiene el ID histórico y declara su variante');
check(catalog[1].id === 'VAR-SECOND' && catalog[1].parentProductId === 'PARENT', 'La secundaria se compra con ID independiente y padre trazable');
check(catalog[1].price === 47000 && catalog[1].weightKg === 7, 'Precio y peso secundarios no se heredan del padre');
check(catalog[1].presentation === '7 kg' && catalog[1].sku === 'SKU-7', 'Presentación y SKU corresponden al empaque comprado');
check(catalog[1].stockByStore === secondary.stockByStore && catalog[1].reservedStockByStore === secondary.reservedStockByStore, 'Las reservas secundarias escriben en su variante persistente');
catalog[1].reservedStockByStore.HUB_SUBA++;
check(secondary.reservedStockByStore!.HUB_SUBA === 2, 'Una reserva secundaria se refleja en el objeto original de variante');
check(parent.reservedStockByStore.HUB_KENNEDY === 2, 'Reservar una variante no altera la reserva principal ni otra bodega');
check(catalog[1].stockByStore.HUB_KENNEDY === undefined, 'Las existencias de Kennedy del padre no aparecen en la secundaria');
check(catalog[1].originalPrice === undefined && catalog[1].discountPercent === undefined && !catalog[1].isLightningDeal, 'Una variante no hereda una promoción exclusiva del precio principal');
check(catalog[2].price === 0 && catalog[2].weightKg === 0, 'Una presentación sin datos queda pendiente y no adopta precio ni peso base');
check(Object.keys(catalog[2].stockByStore).length === 0 && catalog[2].bodegaIds?.length === 0, 'La presentación pendiente no gana cantidades ni asociaciones inventadas');
check(catalog[2].stockByStore !== parent.stockByStore && catalog[2].reservedStockByStore !== parent.reservedStockByStore, 'Los mapas vacíos pendientes también están aislados');
check(resolveCatalogProduct([parent], 'PARENT') === parent, 'Los pedidos anteriores con ID agrupado siguen resolviendo');
check(resolveCatalogProduct([parent], 'VAR-FIRST') === parent, 'El ID de la variante principal resuelve al empaque histórico');
check(resolveCatalogProduct([parent], 'PARENT', 'VAR-SECOND')?.id === 'VAR-SECOND', 'Se admite selección explícita de variante del padre correcto');
check(resolveCatalogProduct([parent], 'VAR-SECOND')?.price === 47000, 'Se admite el ID independiente de una presentación secundaria');
check(resolveCatalogProduct([parent], 'PARENT', 'OTHER-VARIANT') === undefined, 'Una variante ajena nunca cae silenciosamente a la principal');
check(resolveCatalogProduct([parent], 'VAR-SECOND', 'VAR-FIRST') === undefined, 'Se rechazan los IDs cruzados de variante y producto');
check(resolveCatalogProduct([parent], 'UNKNOWN') === undefined, 'Un producto inexistente no se sustituye por uno disponible');
parent.status = 'ARCHIVED';
check(getOperationalCatalog([parent]).every(product => product.status === 'ARCHIVED'), 'Archivar el padre también retira sus presentaciones de venta');
console.log(`${checks} comprobaciones de catálogo y presentaciones aprobadas.`);
