import assert from 'node:assert/strict';
import { test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AccountPage } from '../customer/AccountPages';

test('la pantalla explica la verificación de Google y conserva los otros métodos de acceso', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'window');
  function page(query: string) {
    Object.defineProperty(globalThis, 'window', {
      configurable: true, value: { location: new URL('/cuenta' + query, 'http://127.0.0.1') },
    });
    return renderToStaticMarkup(<AccountPage />);
  }
  try {
    const refused = page('?proveedor=google&error=unable_to_get_user_info&error_description=mensaje-privado-del-proveedor');
    assert.match(refused, /no pudimos verificar tu identidad con Google/);
    assert.doesNotMatch(refused, /mensaje-privado-del-proveedor/);
    assert.match(refused, /Continuar con correo electrónico/);
    assert.match(refused, /Continuar con Apple/);
    assert.doesNotMatch(page('?proveedor=google'), /no pudimos verificar/);
    assert.match(page('?proveedor=google&error=access_denied'), /No se completó la autorización/);
    assert.match(page('?error=oauth&error=unable_to_get_user_info'), /No se completó la autorización/);
  } finally {
    if (original) Object.defineProperty(globalThis, 'window', original);
    else Reflect.deleteProperty(globalThis, 'window');
  }
});
