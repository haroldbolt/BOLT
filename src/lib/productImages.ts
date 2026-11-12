import type { MainCategory, Product } from '../types';
import { matchesCatalogCategory } from './catalogCategories';

// A loadable URL is not evidence of the contents of a photograph.
export function usableProductImage(src?: string): boolean {
  if (!src?.trim()) return false;
  if (src.startsWith('/uploads/catalog/')) return !src.includes('..');
  try {
    const url = new URL(src);
    return url.protocol === 'https:' && !/(^|\.)(unsplash\.com|picsum\.photos|placehold\.co|via\.placeholder\.com)$/.test(url.hostname);
  } catch { return false; }
}

export function categoryImageCandidates(products: Product[], category: MainCategory) {
  const seen = new Set<string>();
  return products.filter(p => (!p.status || p.status === 'ACTIVE') &&
    matchesCatalogCategory(p, category))
    .flatMap(p => [p.image, ...(p.gallery || [])].filter(usableProductImage).map(src => ({src, alt:p.name, productId:p.id})))
    .filter(({src}) => {
      const canonical = src.split('?')[0];
      if (seen.has(canonical)) return false;
      seen.add(canonical); return true;
    });
}
