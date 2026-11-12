import assert from 'node:assert/strict';
import { test } from 'node:test';
import { matchesCatalogCategory } from '../lib/catalogCategories';
import { localCatalogService } from '../lib/localCatalogService';
import { searchableProduct } from '../lib/productPhotoSearch';

test('Antipulgas incluye categorías, subcategorías, etiquetas y nombres explícitos', () => {
  const treatments = [
    { category: 'Antipulgas' },
    { category: 'Farmacia', pharmacySubcategory: 'Antipulgas y garrapatas' },
    { category: 'Farmacia', tags: ['ANTÍ-PULGAS y desparasitantes'] },
    { category: 'Farmacia', tags: ['Garrapatas'] },
    { category: 'Higiene', name: 'Jabón para control de garrapatas' },
  ];
  for (const product of treatments) {
    assert.ok(matchesCatalogCategory(product, 'Antipulgas'));
    assert.ok(matchesCatalogCategory(product, 'Antipulgas y garrapatas'));
    assert.ok(matchesCatalogCategory(product, 'Farmacia'));
  }
});

test('Antipulgas conserva fuera los desparasitantes internos y los productos sin indicación', () => {
  const dewormer = { category: 'Farmacia', pharmacySubcategory: 'Desparasitación', name: 'Drontal Gatos' };
  assert.ok(matchesCatalogCategory(dewormer, 'Farmacia'));
  assert.ok(matchesCatalogCategory(dewormer, 'Desparasitación'));
  assert.ok(!matchesCatalogCategory(dewormer, 'Antipulgas'));
  assert.ok(!matchesCatalogCategory({ category: 'Farmacia', name: 'Antiparasitario externo para ácaros' }, 'Antipulgas'));
  assert.ok(!matchesCatalogCategory({ category: 'Higiene', name: 'Shampoo para perro' }, 'Antipulgas'));
});

test('el filtro del catálogo real reúne tratamientos y combinaciones sin cambiar su categoría base', () => {
  const { products } = localCatalogService.getCatalog({ category: 'Antipulgas', limit: 0 });
  const aliases = localCatalogService.getCatalog({ category: 'Antipulgas y garrapatas', limit: 0 }).products;
  const ids = new Set(products.map(product => product.id));
  assert.deepEqual(ids, new Set(aliases.map(product => product.id)));
  for (const id of [
    '9496657363224', // NexGard Spectra
    '9496685969688', // NexGard Combo para gatos
    '9512533786904', // Simparica TRIO
    '10416241475864', // Credelio Plus
    '10416242065688', // Bravecto + Endal
    '10416240296216', // Advocate
    '10416241344792', // Feline Fullspot
    '10416241443096', // Canes Fullspot
    '10416241639704', // Atrevia One
    '10416283910424', // Jabón Asuntol
    '10416350167320', // Shampoo CanAmor
    '10416347742488', // Revolution Plus
  ]) {
    assert.ok(ids.has(`gid://shopify/Product/${id}`), id);
  }
  for (const id of ['10416240754968', '10416241082648', '10417607573784']) {
    assert.ok(!ids.has(`gid://shopify/Product/${id}`), id);
  }

  const foodCombo = products.find(product => product.id === 'gid://shopify/Product/10416265036056');
  assert.ok(foodCombo);
  assert.notEqual(foodCombo.category, 'Farmacia');
  assert.ok(matchesCatalogCategory(foodCombo, 'Farmacia'));
  assert.ok(!searchableProduct(foodCombo));
  assert.ok(products.every(product => product.status === 'ACTIVE'));
});
