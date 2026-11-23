// AppDeploy receives readable modules. Vite copies files in public verbatim,
// so minify the emitted modules in the final hosting build.
import fs from 'node:fs/promises';
import path from 'node:path';
import { transform } from 'esbuild';

export default {
  build: { sourcemap: false },
  plugins: [{
    name: 'bolt-compact-static-assets',
    apply: 'build',
    async writeBundle({ dir }) {
      const assets = path.join(dir, 'assets');
      const files = (await fs.readdir(assets))
        .filter(name => /\.(js|css)$/.test(name))
        .map(name => path.join(assets, name));
      files.push(path.join(dir, 'bootstrap.js'));
      for (const file of files) {
        const loader = path.extname(file) === '.css' ? 'css' : 'js';
        const source = await fs.readFile(file, 'utf8');
        const {code} = await transform(source, {loader, format: loader === 'js' ? 'esm' : undefined, minify: true, sourcemap: false});
        await fs.writeFile(file, code);
      }
    },
  }],
};
