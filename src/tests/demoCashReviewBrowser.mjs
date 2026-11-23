import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { createThreeStoreCashFixture, testStores } from './threeStoreCashFixture.ts';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.BOLT_BROWSER_MODULE || 'playwright-core');
const app = await createThreeStoreCashFixture({ simulation: true });
const captures = process.env.BOLT_TEST_SCREENSHOTS;

async function capture(page, store, mode, stage) {
  if (captures) await page.screenshot({
    path: path.join(captures, [store, mode, stage].join('-') + '.png'),
    animations: 'disabled',
  });
}

async function check(browser, store, mode) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
    locale: 'es-CO', timezoneId: 'America/Bogota', serviceWorkers: 'block',
  });
  try {
    await context.route('**/*', route =>
      new URL(route.request().url()).origin === app.origin ? route.continue() : route.abort());
    await context.routeWebSocket('**/*', socket => socket.close());
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    if (store.id === 'HUB_SUBA' && mode === 'TURBO') {
      const quoteResponse = page.waitForResponse(response =>
        response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/v1/delivery/quote');
      await page.goto(app.origin + '/demo/efectivo-suba');
      const response = await quoteResponse;
      assert.ok(response.ok());
      const quote = await response.json();
      assert.equal(quote.assignedStoreId, store.id);
      assert.equal(quote.recommendedMode, 'TURBO');
      await page.getByRole('heading', { name: 'Confirmar Pedido Turbo', exact: true }).waitFor();
    }
    await page.goto(app.origin + '/demo/efectivo');
    await page.getByRole('button', { name: store.name, exact: true }).click();
    if (mode === 'PROGRAMADO') {
      await page.getByText('📅 Envío Programado', { exact: true }).click();
      const windows = page.locator('div.cursor-pointer span.font-extrabold')
        .filter({ hasText: /^[^()]+\([^()]*\d[^()]*\)$/ });
      await windows.first().click();
    } else {
      await page.getByText('⚡ Entrega Turbo', { exact: true }).click();
    }
    await page.getByLabel('Nombre completo', { exact: true }).fill('Cliente de prueba');
    await page.getByLabel('Teléfono móvil', { exact: true }).fill('3000000000');
    await page.getByLabel('Correo electrónico', { exact: true }).fill('checkout@rdi.invalid');
    assert.equal(await page.getByRole('radio', { name: 'Efectivo contra entrega' }).isChecked(), true);
    assert.equal(await page.locator('input[name="paymentMethod"]:enabled').count(), 1);
    assert.ok(await page.locator('input[name="paymentMethod"]:disabled').count() > 0);

    const confirm = page.getByRole('button', { name: 'Confirmar pedido', exact: true });
    await confirm.and(page.locator('button:enabled')).waitFor();
    const summary = page.getByText('Total de prueba:', { exact: true }).locator('..');
    const total = Number((await summary.innerText()).replace(/[^0-9]/g, ''));
    assert.ok(total > 0);
    await capture(page, store.id, mode, 'checkout');
    const [response] = await Promise.all([
      page.waitForResponse(r => r.request().method() === 'POST' && new URL(r.url()).pathname === '/api/v1/orders'),
      confirm.click(),
    ]);
    assert.equal(response.status(), 201);
    const order = await response.json();
    assert.equal(order.storeId, store.id);
    assert.equal(order.deliveryMode, mode);
    assert.equal(order.payment.method, 'CASH_ON_DELIVERY');
    assert.equal(order.payment.cashToCollect, 0);
    assert.equal(order.demoCustomerCheckout, true);
    assert.equal(order.totals.total, total);
    if (mode === 'PROGRAMADO') assert.ok(order.scheduledWindow?.date && order.scheduledWindow?.slotId);
    assert.ok(order.purchaseCode);
    await page.getByText('Pedido ' + order.purchaseCode, { exact: true }).waitFor();
    await page.getByText(/^Total a cobrar:\s*\$\s*0$/).waitFor();
    await capture(page, store.id, mode, 'cliente');

    const admin = page.getByRole('link', { name: 'Abrir en BOLT Admin' });
    const target = new URL(await admin.getAttribute('href'), app.origin);
    assert.equal(target.origin, app.origin);
    assert.equal(target.searchParams.get('sede'), store.id);
    assert.equal(target.searchParams.get('pedido'), order.id);
    assert.equal(target.searchParams.get('view'), mode === 'PROGRAMADO' ? 'scheduled' : 'turbo');
    await admin.click();
    await page.getByRole('button', { name: /Coordinación.*Todas las sedes/i }).click();
    const detail = page.getByRole('region', { name: 'Detalle del pedido' });
    await detail.getByRole('heading', { name: order.purchaseCode, exact: true }).waitFor();
    assert.equal(await page.getByRole('combobox', { name: 'Sede activa' }).inputValue(), store.id);
    await detail.getByText(/Pedido de prueba.*Recaudo\s*\$\s*0$/).waitFor();
    if (mode === 'PROGRAMADO') await detail.getByText('Franja', { exact: true }).waitFor();
    await capture(page, store.id, mode, 'admin');
    console.log('PASS móvil', store.id, mode, order.purchaseCode, 'recaudo COP 0 en Cliente y Admin');
    return order.purchaseCode;
  } catch (cause) {
    throw new Error('Checkout de prueba ' + store.id + ' ' + mode, { cause });
  } finally {
    await context.close();
  }
}

let browser;
try {
  if (captures) await mkdir(captures, { recursive: true });
  await app.start(false);
  const server = new URL(app.origin);
  assert.equal(server.protocol, 'http:');
  assert.equal(server.hostname, '127.0.0.1');
  const review = await app.request('/simulation/cash-review');
  assert.equal(review.enabled, true);
  assert.deepEqual(review.stores.map(s => s.id), testStores.map(s => s.id));
  browser = await chromium.launch({ executablePath: process.env.BOLT_TEST_CHROME || undefined });
  const codes = new Set();
  for (const store of review.stores) {
    for (const mode of ['TURBO', 'PROGRAMADO']) codes.add(await check(browser, store, mode));
  }
  assert.equal(codes.size, 6);
  app.verifyNoEgress();
} finally {
  try { await browser?.close(); } finally { await app.dispose(); }
}
