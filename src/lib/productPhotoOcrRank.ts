import type { Product } from '../types';
import { searchableProduct } from './productPhotoSearch';

const commonWords = new Set([
  'a', 'al', 'alimento', 'alimentos', 'and', 'bolsa', 'cat', 'cats', 'comida',
  'con', 'de', 'del', 'dog', 'dogs', 'dry', 'el', 'en', 'feline', 'felino',
  'food', 'for', 'gato', 'gatos', 'kg', 'la', 'lb', 'para', 'perro', 'perros',
  'premium', 'raza', 'razas', 'seco', 'super', 'the', 'y',
]);

const aliases: Record<string, string> = {
  adult: 'adulto', adults: 'adulto', adulta: 'adulto', adultos: 'adulto',
  cachorros: 'cachorro', chicken: 'pollo', esterilizada: 'esterilizado',
  esterilizadas: 'esterilizado', esterilizados: 'esterilizado', gatitos: 'gatito',
  grandes: 'grande', kitten: 'gatito', kittens: 'gatito', lamb: 'cordero',
  large: 'grande', neutered: 'esterilizado', pequena: 'pequeno', pequenas: 'pequeno',
  pequenos: 'pequeno', puppies: 'cachorro', puppy: 'cachorro', small: 'pequeno',
  sterilised: 'esterilizado', sterilized: 'esterilizado', wet: 'humedo',
  humeda: 'humedo',
};

const weakTerms = new Set(['adulto', 'grande', 'pequeno', 'humedo']);
const catWords = new Set(['cat', 'cats', 'feline', 'felino', 'gato', 'gatos', 'gatito']);
const dogWords = new Set(['canine', 'canino', 'dog', 'dogs', 'perro', 'perros', 'cachorro']);

function normalize(text: string) {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
    .replace(/[’']/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}

function canonical(word: string) {
  return Object.hasOwn(aliases, word) ? aliases[word] : word;
}

function productTerms(product: Product, brand: string) {
  const brandWords = new Set(brand.split(' '));
  const name = product.name.replace(/\b\d+(?:[.,]\d+)?\s*(?:kg|lbs?|g|oz|ml|l)\b/gi, ' ');
  return [...new Set(normalize(name).split(' ')
    .filter(word => /[a-z]{2,}/.test(word) && !commonWords.has(word) && !brandWords.has(word))
    .map(canonical))];
}

function hasPhrase(text: string, phrase: string) {
  return phrase !== '' && ` ${text} `.includes(` ${phrase} `);
}

function hasTruncatedBrand(words: string[], brand: string) {
  const parts = brand.split(' ');
  if (parts.length < 2) return false;
  return words.some((_, start) => {
    if (start + parts.length > words.length) return false;
    let truncated = 0;
    for (const [offset, part] of parts.entries()) {
      const observed = words[start + offset];
      if (observed === part) continue;
      if (observed.length < 4 || part.length - observed.length > 3 ||
          !part.startsWith(observed) || ++truncated > 1) return false;
    }
    return truncated === 1;
  });
}

export function rankProductPhotoText(text: string, catalog: readonly Product[]) {
  const recognized = normalize(text);
  const observedWords = recognized.split(' ');
  const words = new Set(observedWords.map(canonical));
  const cat = [...catWords].some(word => words.has(word));
  const dog = [...dogWords].some(word => words.has(word));
  const species = cat === dog ? null : cat ? 'Gato' : 'Perro';

  const eligible = catalog.filter(searchableProduct).map(product => ({
    product,
    brand: normalize(product.brand),
  }));
  const catalogBrands = [...new Set(eligible.map(({ brand }) => brand))];
  const exactBrands = catalogBrands.filter(brand => hasPhrase(recognized, brand));
  const partialBrands = exactBrands.length ? [] : catalogBrands.filter(brand => hasTruncatedBrand(observedWords, brand));
  const observedBrands = exactBrands.length ? exactBrands : partialBrands.length === 1 ? partialBrands : [];
  const brands = observedBrands.filter(brand => !observedBrands.some(other =>
    other !== brand && hasPhrase(other, brand)));

  const ranked = eligible.flatMap(({ product, brand }) => {
    if (!brands.includes(brand) || (species && product.species !== 'Ambos' && product.species !== species)) {
      return [];
    }
    const terms = productTerms(product, brand);
    const matched = terms.filter(term => words.has(term));
    if (!matched.length && (!species || product.species !== species)) return [];
    return [{
      productId: product.id,
      matched: matched.length,
      missing: terms.length - matched.length,
      distinctive: matched.some(term => !weakTerms.has(term)),
    }];
  }).sort((left, right) => right.matched - left.matched || left.missing - right.missing ||
    left.productId.localeCompare(right.productId));

  const [first, second] = ranked;
  const confident = Boolean(first?.distinctive && first.missing === 0 && brands.length === 1 && exactBrands.length > 0 &&
    !(cat && dog) && (!second || first.matched > second.matched));
  const candidates = first?.matched ? ranked.filter(candidate => candidate.matched > 0) : ranked;
  return {
    matches: (confident ? [first] : candidates.slice(0, 3)).map(({ productId }) => ({ productId })),
    confident,
  };
}
