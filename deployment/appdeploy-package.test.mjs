import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'bolt-appdeploy-package-'));
const destination = path.join(sandbox, 'apps');
const apiOrigin = 'https://api.package-bolt.invalid';
const directPages = {
  cliente: ['/cuenta', '/eliminar-cuenta', '/recuperar-seguimiento', '/legal/terminos', '/legal/privacidad', '/legal/eliminacion'],
  admin: ['/admin/nuevo', '/conductor'],
};
try {
  execFileSync(process.execPath, ['deployment/appdeploy-package.mjs', destination], {
    cwd: root, env: { ...process.env, VITE_BOLT_API_ORIGIN: apiOrigin }, stdio: 'pipe',
  });
  for (const [role, pages] of Object.entries(directPages)) {
    const directory = path.join(destination, role);
    const descriptor = JSON.parse(fs.readFileSync(path.join(destination, role + '.deploy.json'), 'utf8'));
    assert.equal(descriptor.app_type, 'frontend-only');
    assert.equal(descriptor.frontend_template, 'html-static');
    const { resources } = JSON.parse(fs.readFileSync(path.join(destination, role + '.resources.json'), 'utf8'));
    assert.equal(resources.length, 4);
    resources.forEach(resource => assert.ok(fs.existsSync(path.join(directory, resource.target_path))));
    execFileSync(process.execPath, [path.join(root, 'node_modules/vite/bin/vite.js'), 'build'], {
      cwd: directory, env: process.env, stdio: 'pipe',
    });
    const dist = path.join(directory, 'dist');
    const read = name => fs.readFileSync(path.join(dist, name), 'utf8');
    const manifest = JSON.parse(read('manifest.webmanifest'));
    assert.equal(manifest.name, role === 'admin' ? 'BOLT Admin' : 'BOLT Cliente');
    assert.equal(manifest.start_url, '/');
    for (const icon of manifest.icons) {
      const png = fs.readFileSync(path.join(dist, icon.src));
      assert.equal(png.readUInt32BE(16) + 'x' + png.readUInt32BE(20), icon.sizes);
    }
    const script = read('bootstrap.js').replace('import(/* @vite-ignore */ app.entry)', 'loadBundle(app.entry)');
    for (const route of ['/', ...pages]) {
      if (route !== '/') assert.ok(read(route + '/index.html').includes('src="/bootstrap.js"'));
      const alternatives = route === '/' ? ['/'] : [route, route + '/', route + '/index.html'];
      for (const pathname of alternatives) {
        let module;
        let canonical;
        vm.runInNewContext(script, {
          location: { pathname, search: '?keep=1', hash: '#keep' },
          document: { title: '', head: { append() {} }, createElement: () => ({}) },
          history: { replaceState(_state, _title, value) { canonical = value; } },
          loadBundle(entry) { module = entry; return Promise.resolve(); },
        });
        const entryName = role === 'cliente' || route.startsWith('/conductor') ? 'index-' : 'boltAdmin-';
        assert.ok(module.startsWith('/assets/' + entryName), module);
        assert.ok(fs.existsSync(path.join(dist, module)));
        if (pathname !== route && route !== '/admin/nuevo') assert.equal(canonical, route + '?keep=1#keep');
      }
    }
    const browserCode = descriptor.files.filter(entry => entry.filename.startsWith('public/assets/'))
      .map(entry => entry.content).join('\n');
    assert.ok(browserCode.includes(apiOrigin));
    assert.ok(browserCode.includes('https://cultivacenter.com/cdn/shop/files/agro-logo-acana-oficial.svg'));
    assert.ok(browserCode.includes('/resources/bolt-logo.jpg'));
    assert.ok(!browserCode.includes('/assets/aistudio/Bolt_Pets_logo_original__1__ce47c0d5.jpg'));
  }
  console.log('PASS paquetes PWA, API compartida, 8 rutas estáticas y acceso independiente de Conductor; sin solicitudes de red ni pedidos.');
} finally {
  fs.rmSync(sandbox, { recursive: true, force: true });
}
