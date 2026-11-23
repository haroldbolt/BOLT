import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from 'vite';
import { assertPublicBuild } from '../scripts/assert-public-build.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const output = process.argv[2] && path.resolve(process.argv[2]);
const apiOrigin = new URL(process.env.VITE_BOLT_API_ORIGIN ?? 'https://invalid.invalid');
const logo = 'assets/aistudio/Bolt_Pets_logo_original__1__ce47c0d5.jpg';
const iconSizes = [180, 192, 512];
// Exact html-static scaffold returned by AppDeploy MCP 2.12. New-app source
// changes are diffs against this scaffold, while the local package stays usable.
const templateIndex = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>APP_TITLE</title>
    <link rel="stylesheet" href="./src/styles.css">
</head>
<body>
    <div id="app">APP_CONTENT</div>
    <script type="module" src="./src/main.ts"></script>
</body>
</html>
`;
const templatePackage = `{
    "name": "html-static-app",
    "private": true,
    "version": "0.0.1",
    "type": "module",
    "scripts": {
        "dev": "vite",
        "build": "vite build",
        "preview": "vite preview"
    },
    "dependencies": {
        "lucide": "^0.469.0"
    },
    "devDependencies": {
        "autoprefixer": "^10.4.0",
        "postcss": "^8.4.0",
        "tailwindcss": "^3.4.0",
        "typescript": "^5.7.0",
        "vite": "^8.0.0"
    }
}
`;
const customerPages = [
  '/cuenta',
  '/eliminar-cuenta',
  '/recuperar-seguimiento',
  '/legal/terminos',
  '/legal/privacidad',
  '/legal/eliminacion',
];

assert.ok(output, 'Uso: VITE_BOLT_API_ORIGIN=https://api.ejemplo.com node deployment/appdeploy-package.mjs <directorio-nuevo>');
assert.equal(apiOrigin.protocol, 'https:', 'El origen compartido de BOLT debe usar HTTPS.');
assert.ok(process.env.VITE_BOLT_API_ORIGIN && apiOrigin.href === apiOrigin.origin + '/',
  'VITE_BOLT_API_ORIGIN debe contener exclusivamente el origen HTTPS publicado.');
assert.ok(!fs.existsSync(output), 'El directorio de destino ya existe.');
const staged = fs.mkdtempSync(path.join(path.dirname(output), '.bolt-appdeploy-'));
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'bolt-appdeploy-build-'));

function write(base, filename, content) {
  const target = path.join(base, filename);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

function json(base, filename, value) {
  write(base, filename, JSON.stringify(value, null, 2) + '\n');
}

function roleTests(role) {
  return role === 'cliente' ? [{
    name: 'Consultar BOLT Cliente sin enviar un pedido',
    viewport: 'mobile',
    sanity: true,
    covers: ['catálogo', 'búsqueda', 'navegación de marcas'],
    description: 'Verifica la navegación y la búsqueda del catálogo sin crear compras.',
    steps: [
      'Abre la portada y verifica que aparece la búsqueda de productos de BOLT.',
      'Abre Marcas, consulta una marca y vuelve a Todo.',
      'Escribe una búsqueda sin coincidencias y luego bórrala para recuperar el catálogo.',
    ],
    expected: 'El catálogo permite navegar por marcas y recupera sus resultados al borrar una búsqueda sin coincidencias.',
  }, {
    name: 'Consultar el carrito vacío desde un celular',
    viewport: 'mobile',
    covers: ['carrito vacío', 'navegación móvil', 'ausencia de compras automáticas'],
    description: 'Verifica que abrir el carrito y recargar no agregue artículos ni confirme un pedido.',
    steps: [
      'Abre la portada en un contexto nuevo sin seleccionar productos.',
      'Abre el carrito para comprobar que la vista está disponible.',
      'Cierra el carrito, recarga la página y vuelve a abrirlo.',
    ],
    expected: 'El carrito permanece vacío y permite volver al catálogo sin crear una compra.',
  }, {
    name: 'Leer privacidad y proteger un seguimiento privado',
    viewport: 'desktop',
    covers: ['privacidad pública', 'seguimiento privado', 'rechazo de acceso sin credencial', 'recarga de rutas'],
    description: 'Verifica los documentos públicos y el rechazo de un identificador de compra inexistente.',
    steps: [
      'Visita /legal/privacidad y verifica que puedas leer la política de privacidad.',
      'Visita /?vista=%2Fpedido%2FVERIFICACION-SIN-COMPRA y recarga. Comprueba que se abre seguimiento y permite volver al catálogo.',
    ],
    expected: 'La política es pública y el seguimiento del identificador inexistente muestra un error de acceso sin revelar pedidos.',
  }] : [{
    name: 'Proteger BOLT Admin antes de iniciar sesión',
    viewport: 'mobile',
    sanity: true,
    covers: ['acceso protegido', 'datos privados de administración', 'validación de campos'],
    description: 'Verifica que una sesión anónima necesite credenciales para acceder a la operación.',
    steps: [
      'Abre la portada de BOLT Admin sin credenciales.',
      'Intenta enviar el formulario vacío y comprueba que solicita los campos obligatorios.',
    ],
    expected: 'Se exige una cuenta administrativa y no se muestran inventarios, ventas ni pedidos privados.',
  }, {
    name: 'Mantener protegido el acceso de BOLT Conductor',
    viewport: 'mobile',
    covers: ['acceso de conductor', 'separación de permisos', 'recarga de ruta'],
    description: 'Verifica el acceso independiente de conductor sin iniciar una sesión ni aceptar tareas.',
    steps: [
      'Visita /conductor en el mismo origen y comprueba el formulario de acceso.',
      'Recarga la página e intenta enviar el formulario vacío.',
    ],
    expected: 'Se mantiene el formulario de BOLT Conductor y exige credenciales antes de mostrar o aceptar un despacho.',
  }, {
    name: 'Solicitar autenticación en los accesos de sede y modalidad',
    viewport: 'desktop',
    covers: ['tres sedes', 'pedidos Turbo', 'pedidos programados', 'despachos protegidos'],
    description: 'Verifica que los enlaces operativos conservan el acceso privado para las tres sedes.',
    steps: [
      'Visita /?view=turbo&sede=HUB_ALAMOS y /?view=scheduled&sede=HUB_KENNEDY sin credenciales.',
      'Visita /?view=dispatch&sede=HUB_SUBA y recarga.',
    ],
    expected: 'Los accesos muestran el formulario administrativo y no exponen pedidos ni despachos de las sedes.',
  }];
}

function bundle(html) {
  const match = html.match(/<script\b[^>]*\btype="module"[^>]*\bsrc="(\/assets\/[\w.-]+\.js)"[^>]*><\/script>/);
  assert.ok(match, 'Falta el módulo de producción de Vite.');
  const styles = [...html.matchAll(/<link\b[^>]*\brel="stylesheet"[^>]*\bhref="(\/assets\/[\w.-]+\.css)"[^>]*>/g)]
    .map(link => link[1]);
  assert.ok(styles.length, 'Falta la hoja de estilo del módulo.');
  return { entry: match[1], styles };
}

function page(title, color, description) {
  return `<!doctype html>
<html lang="es-CO">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
    ${title === 'BOLT Admin' ? '<meta name="robots" content="noindex,nofollow" />' : ''}
    <meta name="description" content="${description}" />
    <meta name="theme-color" content="${color}" />
    <title>${title}</title>
    <link rel="manifest" href="/manifest.webmanifest" />
    <link rel="icon" type="image/png" href="/resources/bolt-192.png" />
    <link rel="apple-touch-icon" sizes="180x180" href="/resources/bolt-180.png" />
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/bootstrap.js"></script>
  </body>
</html>
`;
}

function bootstrap(role, customer, admin) {
  return `const customer = ${JSON.stringify(customer)};
const admin = ${JSON.stringify(admin)};
const pathname = location.pathname;
const canonical = pathname.replace(/(?:\\/index\\.html|\\/)$/, '');
const conductor = ${role === 'admin'} && canonical === '/conductor';
const customerPage = ${role === 'cliente'} && ${JSON.stringify(customerPages)}.includes(canonical);
if ((conductor || customerPage) && canonical !== pathname) {
  history.replaceState(history.state, '', canonical + location.search + location.hash);
}
if (conductor) {
  document.title = 'BOLT Conductor';
}
const app = ${role === 'admin' ? 'conductor ? customer : admin' : 'customer'};
for (const href of app.styles) {
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = href;
  document.head.append(link);
}
import(/* @vite-ignore */ app.entry).catch(() => {
  document.getElementById('root').textContent = 'No se pudo iniciar BOLT. Recarga la página para volver a intentarlo.';
});
`;
}

try {
  const dist = path.join(scratch, 'dist');
  const vite = path.join(root, 'node_modules/vite/bin/vite.js');
  const build = spawnSync(process.execPath, [vite, 'build', '--minify=false', '--outDir', dist, '--emptyOutDir'], {
    cwd: root,
    env: { ...process.env, VITE_BOLT_API_ORIGIN: apiOrigin.origin },
    stdio: 'inherit',
  });
  if (build.error) throw build.error;
  assert.equal(build.status, 0, 'Falló la compilación de las interfaces de BOLT.');

  assertPublicBuild(dist, loadEnv('production', root, ''));

  const customer = bundle(fs.readFileSync(path.join(dist, 'index.html'), 'utf8'));
  const admin = bundle(fs.readFileSync(path.join(dist, 'admin/nuevo/index.html'), 'utf8'));
  // The hashed first level contains the browser bundle, while public assets
  // include development reference material that must stay outside the package.
  const assets = fs.readdirSync(path.join(dist, 'assets'), { withFileTypes: true })
    .filter(item => item.isFile() && /^[\w.-]+\.(?:js|css)$/.test(item.name))
    .map(item => item.name);
  assert.ok(assets.length > 0);
  const originPresent = assets.filter(filename => filename.endsWith('.js'))
    .some(filename => fs.readFileSync(path.join(dist, 'assets', filename), 'utf8').includes(apiOrigin.origin));
  assert.ok(originPresent, 'El bundle no contiene el origen compartido de la API de BOLT.');

  for (const role of ['cliente', 'admin']) {
    const dest = path.join(staged, role);
    const name = role === 'cliente' ? 'BOLT Cliente' : 'BOLT Admin';
    const color = role === 'cliente' ? '#DC2626' : '#151c2d';
    const description = role === 'cliente'
      ? 'Compra en BOLT en Álamos, Kennedy y Suba.'
      : 'Panel de operación, despachos y acceso de conductores de BOLT.';
    const files = [];
    function source(filename, content, template) {
      const serialized = typeof content === 'string' ? content : JSON.stringify(content, null, 2) + '\n';
      files.push(template
        ? { filename, diffs: [{ from: template, to: serialized }] }
        : { filename, content: serialized, encoding: 'utf-8' });
      write(dest, filename, serialized);
    }
    const html = page(name, color, description);
    source('index.html', html, templateIndex);
    // Directory pages also work on static hosts that do not rewrite named URLs.
    const pages = role === 'admin' ? ['/admin/nuevo', '/conductor'] : customerPages;
    for (const route of pages) source('public' + route + '/index.html', html);
    source('package.json', {
      name: 'bolt-' + role,
      version: '1.0.0',
      private: true,
      type: 'module',
      scripts: { build: 'vite build', preview: 'vite preview' },
      devDependencies: { vite: '^8.0.0', esbuild: '0.28.2' },
    }, templatePackage);
    source('vite.config.mjs', fs.readFileSync(path.join(root, 'deployment/appdeploy-vite.config.mjs'), 'utf8'));
    source('public/bootstrap.js', bootstrap(role, customer, admin));
    source('public/manifest.webmanifest', {
      id: '/',
      name,
      short_name: name,
      description,
      lang: 'es-CO',
      start_url: '/',
      scope: '/',
      display: 'standalone',
      background_color: color,
      theme_color: color,
      icons: iconSizes.filter(size => size !== 180).map(size => ({
        src: '/resources/bolt-' + size + '.png',
        sizes: size + 'x' + size,
        type: 'image/png',
        purpose: 'any maskable',
      })),
    });
    source('tests/tests.json', roleTests(role));
    for (const filename of assets.sort()) {
      const asset = fs.readFileSync(path.join(dist, 'assets', filename), 'utf8');
      source('public/assets/' + filename, asset.replaceAll('/' + logo, '/resources/bolt-logo.jpg'));
    }
    const resources = [
      ...iconSizes.map(size => ({ target_path: 'public/resources/bolt-' + size + '.png', accept: 'image/png' })),
      { target_path: 'public/resources/bolt-logo.jpg', accept: 'image/jpeg' },
    ];
    for (const size of iconSizes) {
      write(dest, 'public/resources/bolt-' + size + '.png', fs.readFileSync(path.join(root, 'public/icons/bolt-' + size + '.png')));
    }
    write(dest, 'public/resources/bolt-logo.jpg', fs.readFileSync(path.join(root, 'public', logo)));
    json(staged, role + '.resources.json', { resources });
    json(staged, role + '.deploy.json', {
      app_id: null,
      app_name: name,
      description,
      app_type: 'frontend-only',
      frontend_template: 'html-static',
      intent: 'Publicar la PWA de ' + name + ' con la API compartida de BOLT',
      initiator: 'user',
      type: 'feature',
      model: 'chat',
      files,
    });
  }
  fs.renameSync(staged, output);
  console.log('Paquetes independientes de BOLT Cliente y BOLT Admin, con API ' + apiOrigin.origin + ', en ' + output);
} finally {
  fs.rmSync(scratch, { recursive: true, force: true });
  fs.rmSync(staged, { recursive: true, force: true });
}
