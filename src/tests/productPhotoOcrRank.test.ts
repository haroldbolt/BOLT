import assert from 'node:assert/strict';
import { test } from 'node:test';
import { INITIAL_PRODUCTS } from '../data/seedData';
import { rankProductPhotoText } from '../lib/productPhotoOcrRank';
import type { Product } from '../types';

const cat: Product = {
  ...INITIAL_PRODUCTS[0], id: 'gato', name: 'Agility Gold Gato',
  brand: 'Agility Gold', category: 'Alimentos', species: 'Gato',
  requiresPrescription: false, pharmacySubcategory: undefined, status: 'ACTIVE',
};
const kitten: Product = { ...cat, id: 'gatitos', name: 'Agility Gold Gatitos' };
const sterilized: Product = { ...cat, id: 'esterilizado', name: 'Agility Gold Gato Esterilizado' };
const dog: Product = {
  ...cat, id: 'perro', name: 'Agility Gold Adulto Raza Grande', species: 'Perro',
};
const catalog = [kitten, sterilized, dog, cat];

test('ordinary cat package text suggests the right species and lists generic food first', () => {
  assert.deepEqual(rankProductPhotoText('SUPER PREMIUM CAT FOOD\nAGILITY\nGOLD\nGatos\n1,5 kg', catalog), {
    matches: [{ productId: cat.id }, { productId: sterilized.id }, { productId: kitten.id }],
    confident: false,
  });
});

test('visible kitten or sterilized label selects the respective product', () => {
  assert.deepEqual(rankProductPhotoText('Agility GOLD\nKITten\n3 kg', catalog), {
    matches: [{ productId: kitten.id }], confident: true,
  });
  assert.deepEqual(rankProductPhotoText('AGILITY GOLD\nGatos Esterilizados\n3 kg', catalog), {
    matches: [{ productId: sterilized.id }], confident: true,
  });
  assert.deepEqual(rankProductPhotoText('AGILITY GOLD\nSUPER PREMIUM DOG FOOD\nGrandes Adultos', catalog), {
    matches: [{ productId: dog.id }], confident: false,
  });
});

test('brand alone, inactive products, and pharmacy cannot open a product', () => {
  assert.deepEqual(rankProductPhotoText('AGILITY GOLD\n1,5 kg', catalog), {
    matches: [], confident: false,
  });
  const inactive = { ...kitten, status: 'INACTIVE' };
  const pharmacy: Product = { ...kitten, id: 'farmacia', category: 'Farmacia' };
  const otherBrand = { ...kitten, id: 'marca', brand: 'Otro Nombre' };
  assert.deepEqual(rankProductPhotoText('AGILITY GOLD GATITOS', [inactive, pharmacy, otherBrand]), {
    matches: [], confident: false,
  });
});

test('tied product labels and distinct visible brands stay ambiguous', () => {
  const duplicate = { ...kitten, id: 'otro-gatito' };
  assert.equal(rankProductPhotoText('AGILITY GOLD KITTEN', [kitten, duplicate]).confident, false);
  const another = { ...kitten, id: 'otra-marca', brand: 'Otra Marca', name: 'Otra Marca Gatitos' };
  assert.equal(rankProductPhotoText('AGILITY GOLD KITTEN\nOTRA MARCA', [kitten, another]).confident, false);
});
