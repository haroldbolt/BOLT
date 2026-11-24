// Run from a checkout with dependencies installed. Playwright is an optional review tool.
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir } from 'node:fs/promises';
import { build } from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));
const { outputFiles } = await build({
  entryPoints: [join(here, 'addressMapReview.tsx')],
  bundle: true,
  write: false,
  format: 'iife',
  platform: 'browser',
  jsx: 'automatic',
  alias: { '@vis.gl/react-google-maps': join(here, 'mapsFixture.tsx') },
  define: {
    'process.env.NODE_ENV': '"production"',
    'import.meta.env': JSON.stringify({ VITE_GOOGLE_MAPS_API_KEY: 'fixture-map' }),
  },
});

const html = `<!doctype html><html lang="es"><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>BOLT · Prueba aislada del mapa</title>
<style>body{font:1rem system-ui;padding:1rem}pre{white-space:pre-wrap}button{min-height:2rem}</style>
<button id="run">Ejecutar recorridos del mapa</button>
<pre id="resultado" aria-live="polite">Listo</pre><div id="root"></div>
<script defer src="/bundle.js"></script></html>`;
const server = createServer((request, response) => {
  if (request.method !== 'GET' || !['/', '/bundle.js'].includes(request.url)) {
    response.writeHead(404).end();
    return;
  }
  const isPage = request.url === '/';
  response.writeHead(200, {
    'Content-Type': isPage ? 'text/html; charset=utf-8' : 'text/javascript',
    'Cache-Control': 'no-store',
    'Content-Security-Policy': "default-src 'none'; script-src 'self'; connect-src 'none'; style-src 'unsafe-inline'",
  });
  response.end(isPage ? html : outputFiles[0].contents);
});

await new Promise((ready, fail) => {
  server.once('error', fail);
  server.listen(Number(process.env.BOLT_TEST_PORT || 0), '127.0.0.1', ready);
});
const origin = `http://127.0.0.1:${server.address().port}`;
console.log('Prueba local', origin);

if (process.env.BOLT_BROWSER_SERVE !== '1') {
  let browser;
  try {
    const require = createRequire(import.meta.url);
    const { chromium } = require(process.env.BOLT_BROWSER_MODULE || 'playwright-core');
    browser = await chromium.launch({ executablePath: process.env.BOLT_TEST_CHROME || undefined });
    const page = await browser.newPage({
      viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, locale: 'es-CO',
    });
    await page.goto(origin);
    await page.getByRole('button', { name: 'Ejecutar recorridos del mapa' }).click();
    const results = page.locator('#resultado[data-done="true"]');
    await results.waitFor({ timeout: 60_000 });
    console.log(await results.innerText());
    if (await results.getAttribute('data-failures') !== '0') process.exitCode = 1;
    if (process.env.BOLT_TEST_SCREENSHOTS) {
      const dir = resolve(process.env.BOLT_TEST_SCREENSHOTS);
      await mkdir(dir, { recursive: true });
      await results.screenshot({ path: join(dir, 'mapa-recorridos.png') });
    }
  } finally {
    await browser?.close();
    server.close();
  }
}
