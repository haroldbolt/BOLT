import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { build } from 'esbuild';

// Exercises the two actual entry components with an isolated HTTP contract.
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.BOLT_BROWSER_MODULE || 'playwright-core');
const bundle = await build({
  stdin: {
    contents: `
      import React from 'react';
      import { createRoot } from 'react-dom/client';
      import { BoltAdminApp } from './src/components/admin-next/BoltAdminApp';
      import { AdminAuthModal } from './src/components/operations/AdminAuthModal';
      createRoot(document.getElementById('root')).render(location.pathname === '/operations'
        ? <AdminAuthModal isOpen onClose={() => {}} onAuthenticated={() => {}} /> : <BoltAdminApp />);
    `,
    loader: 'tsx', resolveDir: process.cwd(),
  },
  outfile: 'app.js', write: false, bundle: true, jsx: 'automatic',
  loader: { '.css': 'empty' }, define: { 'import.meta.env': '{}', 'process.env.NODE_ENV': '"production"' },
});
const browser = await chromium.launch({ executablePath: process.env.BOLT_TEST_CHROME || undefined });
const origin = 'https://bolt-ui.invalid';

try {
  for (const entry of ['/admin', '/operations']) {
    const context = await browser.newContext();
    const page = await context.newPage();
    page.setDefaultTimeout(6000);
    let status = 'open';
    let setupRequests = 0;
    let loginRequests = 0;
    let releaseStatus;
    const gate = new Promise(resolve => { releaseStatus = resolve; });
    const blankSession = { mode: 'live', actor: null, profiles: [], stores: [] };
    await page.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin !== origin) return route.abort();
      if (url.pathname === entry) return route.fulfill({ contentType: 'text/html', body: '<main id="root"></main><script src="/app.js"></script>' });
      if (url.pathname === '/app.js') return route.fulfill({ contentType: 'application/javascript', body: bundle.outputFiles[0].text });
      if (url.pathname === '/api/v1/bolt-admin/session') return route.fulfill({ json: blankSession });
      if (url.pathname === '/api/v1/auth/status') {
        await gate;
        return route.fulfill({ json: { setupState: status, isSetupRequired: status === 'open', isAuthenticated: false } });
      }
      if (url.pathname === '/api/v1/auth/setup-admin') {
        setupRequests++;
        assert.ok(route.request().headers()['x-bolt-admin-setup-token']);
        status = 'closed';
        return route.fulfill({ status: 409, json: { error: 'Alta completada' } });
      }
      if (url.pathname === '/api/v1/auth/login') {
        loginRequests++;
        status = 'recovery-required';
        return route.fulfill({ status: 503, json: { code: 'ADMIN_RECOVERY_REQUIRED' } });
      }
      return route.fulfill({ status: 404, json: {} });
    });
    try {
      await Promise.all([
        page.waitForRequest(request => new URL(request.url()).pathname === '/api/v1/auth/status'),
        page.goto(origin + entry),
      ]);
      assert.equal(await page.locator('form').count(), 0);
      releaseStatus();
      await page.locator('input[autocomplete="name"]').fill('Coordinación');
      await page.locator('input[type="email"]').fill('coordinacion@example.invalid');
      const fixturePassword = crypto.randomUUID();
      for (const input of await page.locator('input[autocomplete="new-password"]').all()) await input.fill(fixturePassword);
      await page.locator('input[autocomplete="off"]').fill(crypto.randomUUID());
      await page.locator('form button').last().click();
      await page.getByText('El alta inicial ya se completó. Ingresa con tu cuenta.').waitFor();
      assert.equal(setupRequests, 1);
      assert.equal(await page.locator('input[autocomplete="off"]').count(), 0);
      await page.locator('input[autocomplete="current-password"]').fill(fixturePassword);
      await page.locator('form button').last().click();
      await page.getByText(/respaldo autorizado/).waitFor();
      assert.equal(loginRequests, 1);
      assert.equal(await page.locator('form').count(), 0);
      status = 'closed';
      await page.getByRole('button', { name: 'Volver a comprobar' }).click();
      await page.locator('input[autocomplete="current-password"]').waitFor();
      assert.equal(await page.locator('input[autocomplete="off"]').count(), 0);
      console.log('PASS', entry, 'alta autorizada, cierre concurrente, recuperación y regreso al ingreso');
    } finally {
      releaseStatus();
      await context.close();
    }
  }
} finally {
  await browser.close();
}
