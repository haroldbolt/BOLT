import type { Product } from '../types';

const endpoint = '/api/v1/catalog/photo-search';

export type PhotoSearchResponse = {
  matches: { productId: string }[];
  confident: boolean;
};

export async function photoSearchAvailable(signal: AbortSignal): Promise<boolean> {
  const response = await fetch(`${endpoint}/status`, { cache: 'no-store', signal });
  if (!response.ok) return false;
  const data = await response.json();
  return data?.enabled === true;
}

export async function searchCatalogPhoto(photo: Blob, signal: AbortSignal): Promise<PhotoSearchResponse> {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'image/jpeg' },
    body: photo,
    cache: 'no-store',
    signal,
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw Error(typeof data?.error === 'string' ? data.error : 'La búsqueda por foto no está disponible. Intenta otra vez o busca por nombre.');
  }
  if (!Array.isArray(data?.matches) || data.matches.length > 3 || typeof data.confident !== 'boolean' ||
      !data.matches.every((match: { productId?: unknown } | null) => typeof match?.productId === 'string' && match.productId.trim())) {
    throw Error('No pudimos leer el resultado. Intenta de nuevo o busca por nombre.');
  }
  return data;
}

export function resolvePhotoMatches(response: PhotoSearchResponse, products: Product[]) {
  const visible = new Map(products.filter(product => !product.status || product.status === 'ACTIVE')
    .map(product => [product.id, product]));
  const ids = [...new Set(response.matches.map(match => match.productId))];
  const candidates = ids.map(id => visible.get(id)).filter((product): product is Product => !!product);
  const automatic = response.confident && response.matches.length === 1 ? candidates[0] : undefined;
  return { candidates, automatic };
}
