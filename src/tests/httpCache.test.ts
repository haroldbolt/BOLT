import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { IncomingMessage, ServerResponse } from 'node:http';
import { Socket } from 'node:net';
import { staticCacheHeaders } from '../lib/httpCache';

test('Solo los archivos versionados del manifiesto de Vite pueden quedar inmutables en el navegador o CDN', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bolt-cache-static-'));
  t.after(() => fs.rmSync(directory, {recursive:true,force:true}));
  fs.mkdirSync(path.join(directory, '.vite'));
  fs.writeFileSync(path.join(directory, '.vite/manifest.json'), JSON.stringify({
    'index.html': {file:'assets/index-A1b2c3d4.js',css:['assets/index-K2b4y7z1.css']},
  }));
  const setHeaders = staticCacheHeaders(directory);
  function header(file: string, prior?: string) {
    const res = new ServerResponse(new IncomingMessage(new Socket()));
    if (prior) res.setHeader('Cache-Control',prior);
    setHeaders(res, path.join(directory,file));
    return res.getHeader('Cache-Control') as string;
  }
  assert.match(header('assets/index-A1b2c3d4.js'),/max-age=31536000, immutable/);
  assert.match(header('assets/index-K2b4y7z1.css'),/immutable/);
  for (const file of ['index.html','manifest.json','assets/sin-hash.js','assets/importado-A1b2c3d4.js','uploads/catalog/presentacion.png']) {
    assert.match(header(file),/no-cache/);
  }
  assert.equal(header('assets/index-A1b2c3d4.js','private, no-store'),'private, no-store');
});
