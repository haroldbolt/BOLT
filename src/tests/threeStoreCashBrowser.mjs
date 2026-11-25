import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { createThreeStoreCashFixture, testStores, testSku } from './threeStoreCashFixture.ts';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.BOLT_BROWSER_MODULE || 'playwright-core');
const browser = await chromium.launch({ executablePath: process.env.BOLT_TEST_CHROME || undefined });
const captures = process.env.BOLT_TEST_SCREENSHOTS;
if (captures) await mkdir(captures, { recursive: true });
const sizes = { movil: { width: 390, height: 844 }, escritorio: { width: 1440, height: 900 } };

async function check(store, mode, profile) {
  const app = await createThreeStoreCashFixture({ ownFleetOnly: true });
  let context, staffContext;
  let stage = 'inicio';
  try {
    await app.start(true);
    const token = await app.login();
    await app.registerFleet(token);
    context = await browser.newContext({ viewport: sizes[profile], locale: 'es-CO',
      timezoneId: 'America/Bogota', serviceWorkers: 'block' });
    await context.route('**/*', route =>
      new URL(route.request().url()).origin === app.origin ? route.continue() : route.abort());
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    stage = 'restaurar una dirección y un carrito de invitado';
    await page.goto(app.origin);
    const catalog = await app.request('/catalog');
    const product = catalog.find(row => row.id === testSku);
    const variantId = product?.presentaciones?.[0]?.varianteId;
    assert.ok(variantId, 'Debe existir la presentación de prueba en el catálogo publicado');
    await page.evaluate(({ destination, productId, variantId }) => {
      localStorage.setItem('bolt_pets_tour_completed', 'true');
      localStorage.setItem('bolt_pets_guest_addresses_v1', JSON.stringify({ version: 1, addresses: [], current: destination }));
      localStorage.setItem('bolt_pets_guest_cart_v1', JSON.stringify({ version: 1, items: [{ productId, variantId, quantity: 1 }] }));
    }, { destination: store.destination, productId: testSku, variantId });
    await page.reload();
    await page.getByText('Ver carrito', { exact: true }).click();
    await page.getByRole('button', { name: 'Continuar con el pedido' }).click();
    stage = 'elegir modalidad';
    if (mode === 'PROGRAMADO') {
      await page.getByText('📅 Envío Programado', { exact: true }).click();
      // The UI shows official server windows as "name (hh:mm – hh:mm)".
      await page.locator('span').filter({ hasText: /^[^()]+\([^()]*\d[^()]*\)$/ }).and(
        page.locator('div.cursor-pointer span.font-extrabold')
      ).first().click();
    } else {
      await page.getByText('⚡ Entrega Turbo', { exact: true }).click();
    }
    stage = 'identidad y efectivo';
    await page.getByLabel('Nombre completo', { exact: true }).fill('Cliente de revisión');
    await page.getByLabel('Teléfono móvil', { exact: true }).fill('3000000000');
    await page.getByLabel('Correo electrónico', { exact: true }).fill('checkout@rdi.invalid');
    assert.equal(await page.locator('input[name="paymentMethod"]:enabled').count(), 1);
    assert.equal(await page.getByRole('radio', { name: 'Efectivo contra entrega' }).isChecked(), true);
    assert.ok(await page.locator('input[name="paymentMethod"]:disabled').count() > 0);
    const zeroTip = page.getByRole('button', { name: '$0', exact: true });
    await zeroTip.click();
    // Capture the settled choice and compare exactly what the customer sees to the order.
    await zeroTip.evaluate(async button => {
      await Promise.all(button.parentElement.getAnimations({ subtree: true }).map(animation => animation.finished));
    });
    const summary = page.getByText('Total final:', { exact: true }).locator('..');
    const displayedTotal = Number((await summary.innerText()).replace(/[^0-9]/g, ''));
    assert.ok(displayedTotal > 0);

    if (captures) await page.screenshot({ animations: 'disabled', path: path.join(captures, [store.id, mode, profile, 'checkout.png'].join('-')) });
    stage = 'abrir Admin antes de la compra';
    staffContext = await browser.newContext({ viewport: sizes.escritorio, locale: 'es-CO', serviceWorkers: 'block' });
    await staffContext.route('**/*', route =>
      new URL(route.request().url()).origin === app.origin ? route.continue() : route.abort());
    const admin = await staffContext.newPage();
    const view = mode === 'PROGRAMADO' ? 'scheduled' : 'turbo';
    const adminEvents = admin.waitForResponse(r => new URL(r.url()).pathname === '/api/v1/bolt-admin/orders/events');
    await admin.goto(app.origin + '/admin/nuevo/?view=' + view + '&sede=' + store.id);
    await admin.locator('input[type=email]').fill(app.adminCredentials.email);
    await admin.locator('input[type=password]').fill(app.adminCredentials.password);
    await admin.getByRole('button', { name: 'Ingresar', exact: true }).click();
    assert.equal((await adminEvents).status(), 200);
    stage = 'confirmar y abrir el seguimiento';
    const posted = page.waitForResponse(r => r.request().method() === 'POST' && new URL(r.url()).pathname === '/api/v1/orders', { timeout: 18000 });
    const [response] = await Promise.all([posted, page.getByRole('button', { name: 'Confirmar pedido', exact: true }).click()]);
    const order = await response.json();
    assert.ok(response.ok(), String(order.code || order.error || response.status()));
    assert.equal(order.storeId, store.id);
    assert.equal(order.deliveryMode, mode);
    assert.equal(order.payment.method, 'CASH_ON_DELIVERY');
    assert.equal(order.payment.status, 'PENDIENTE');
    assert.equal(order.payment.cashToCollect, displayedTotal);
    assert.equal(order.totals.total, displayedTotal);
    if (mode === 'PROGRAMADO') assert.ok(order.scheduledWindow?.date && order.scheduledWindow?.slotId);
    const row = admin.getByRole('button', { name: 'Ver pedido ' + order.purchaseCode, exact: true });
    await row.waitFor({ timeout: 4000 });
    await page.waitForURL('**/pedido/' + order.id);
    await page.getByRole('region', { name: 'Avance del pedido' }).waitFor();
    assert.equal(await admin.getByRole('combobox', { name: 'Sede activa' }).inputValue(), store.id);
    await row.click();
    await admin.getByRole('heading', { name: order.purchaseCode, exact: true }).waitFor();
    const clock = page.locator('time[aria-label="Tiempo estimado restante"]');
    assert.equal(await clock.count(), 0);
    stage = 'preparación y listo en Admin con seguimiento abierto en otro dispositivo';
    await admin.getByRole('button', { name: 'Iniciar alistamiento' }).click();
    await page.getByRole('heading', { name: 'Preparando tu pedido…' }).waitFor({ timeout: 4000 });
    assert.equal(await clock.count(), 0);
    if (captures) await page.screenshot({ animations: 'disabled', path: path.join(captures, [store.id, mode, profile, 'preparando.png'].join('-')) });
    await admin.getByRole('button', { name: 'Marcar listo para despacho' }).click();
    if (mode === 'TURBO') {
      await clock.waitFor({ timeout: 4000 });
      const seconds = async () => Number((await clock.getAttribute('datetime')).match(/^PT(\d+)S$/)[1]);
      const first = await seconds();
      assert.ok(first > 0);
      await page.waitForFunction(initial => {
        const t = document.querySelector('time[aria-label="Tiempo estimado restante"]');
        return t && Number(t.dateTime.slice(2, -1)) < initial;
      }, first);
      const beforeReload = await seconds();
      await page.reload({ waitUntil: 'domcontentloaded' });
      await clock.waitFor();
      assert.ok(await seconds() <= beforeReload);
    } else {
      await page.getByRole('heading', { name: 'Tu pedido está listo para recoger' }).waitFor({ timeout: 4000 });
      assert.equal(await clock.count(), 0);
    }
    if (captures) await page.screenshot({ animations: 'disabled', path: path.join(captures, [store.id, mode, profile, 'listo.png'].join('-')) });
    if (captures) await admin.screenshot({ animations: 'disabled', path: path.join(captures, [store.id, mode, profile, 'admin.png'].join('-')) });
    app.verifyNoEgress();
    console.log('PASS navegador', profile, store.id, mode, 'efectivo pendiente COP', order.payment.cashToCollect);
  } catch (error) {
    throw new Error([profile, store.id, mode, stage].join(' · '), { cause: error });
  } finally {
    try { await Promise.all([context?.close(), staffContext?.close()]); } finally { await app.dispose(); }
  }
}

try {
  for (const profile of Object.keys(sizes)) {
    for (const store of testStores) {
      for (const mode of ['TURBO', 'PROGRAMADO']) await check(store, mode, profile);
    }
  }
} finally { await browser.close(); }
