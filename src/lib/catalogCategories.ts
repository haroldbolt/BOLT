const fleaSubcategory = 'Antipulgas y garrapatas';

interface CatalogCategoryProduct {
  id?: string;
  productoId?: string;
  name?: string;
  category?: string;
  pharmacySubcategory?: string;
  tags?: readonly string[];
}

// Catalog entries whose tags and titles do not identify their flea or tick indication.
// Keep these exceptions tied to product IDs so unrelated products from the same brand stay separate.
const verifiedFleaProductIds = new Set([
  'gid://shopify/Product/9496657363224', // NexGard Spectra, product description in BOLT
  'gid://shopify/Product/9496685969688', // NexGard Combo para gatos, product description in BOLT
  'gid://shopify/Product/9497779962136', // Bravecto 1 Mes, product description in BOLT
  // https://mimascotayyo.elanco.com/co/nuestros-productos/advocate
  'gid://shopify/Product/10416240296216', // Advocate Gatos
  'gid://shopify/Product/10416240328984', // Advocate Perros
  // https://pets.ceva.com.ar/productos/spinomax-duo/
  'gid://shopify/Product/10416240787736', // Spinomax Dúo
  // https://labyes.com/productos/feline-fullspot-col/
  'gid://shopify/Product/10416241344792', // Feline Fullspot
  // https://labyes.com/productos/canes-fullspot/
  'gid://shopify/Product/10416241443096', // Canes Fullspot
  // https://assets.elanco.com/8e0bf1c2-1ae4-001f-9257-f2be3c683fb1/1051f72c-42bf-40c4-8256-b6d5c703c89a/FT_Credelio%20Plus%20MX%202023.pdf
  'gid://shopify/Product/10416241475864', // Credelio Plus
  // https://www.agrovetmarket.com/es/noticias-salud-animal/detalle/atrevia-la-proteccion-irresistible-contra-pulgas-garrapatas-y-acaros-llega-a-colombia
  'gid://shopify/Product/10416241639704', // Atrevia One
  'gid://shopify/Product/10416241705240', // Atrevia XR
  // https://www.zoetispetcare.com/products/revolution
  'gid://shopify/Product/10416265036056', // Combo de alimento + Revolution 6%
  // https://www.ica.gov.co/getattachment/Areas/Pecuaria/Servicios/Regulacion-y-Control-de-Medicamentos-Veterinarios/LISTADOS-VIGENTES/Base-productos-veterinarios.pdf.aspx?lang=es-CO
  'gid://shopify/Product/10416284041496', // Jabón insecticida CanAmor
  // https://www.zoetispetcare.com/products/revolution-plus
  'gid://shopify/Product/10416347742488', // Revolution Plus
  // https://canamor.com/producto/shampoo-insecticida/
  'gid://shopify/Product/10416350167320', // Shampoo insecticida CanAmor
]);

function normalizeLabel(value: string): string {
  return value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

const fleaLabel = /\b(?:anti ?pulgas?|anti ?garrapatas?|pulguicidas?|garrapaticidas?|(?:control|contra) (?:de )?(?:pulgas?|garrapatas?))\b/;
const fleaTopic = /^(?:pulgas?|garrapatas?)$/;

export function isFleaTreatment(product: CatalogCategoryProduct): boolean {
  if (product.category === 'Antipulgas' || product.pharmacySubcategory === fleaSubcategory) return true;
  if ((product.id && verifiedFleaProductIds.has(product.id)) ||
      (product.productoId && verifiedFleaProductIds.has(product.productoId))) return true;

  const labels = [product.category, product.pharmacySubcategory, ...(product.tags ?? [])];
  if (labels.some(label => {
    if (!label) return false;
    const normalized = normalizeLabel(label);
    return fleaLabel.test(normalized) || fleaTopic.test(normalized);
  })) return true;
  return !!product.name && fleaLabel.test(normalizeLabel(product.name));
}

export function matchesCatalogCategory(product: CatalogCategoryProduct, category: string): boolean {
  if (category === 'Todo' || product.category === category || product.pharmacySubcategory === category) return true;
  if (category === 'Farmacia') return !!product.pharmacySubcategory || isFleaTreatment(product);
  if (category === 'Antipulgas' || category === fleaSubcategory) return isFleaTreatment(product);
  return false;
}
