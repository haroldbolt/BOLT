import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const script = fileURLToPath(new URL('./check-repository-secrets.mjs', import.meta.url));

test('revisa el índice y la historia nueva del PR sin revelar datos', t => {
  const cwd = mkdtempSync(path.join(os.tmpdir(), 'bolt-git-check-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const run = (...args) => spawnSync(process.execPath, [script, ...args], { cwd, encoding: 'utf8' });
  const write = (file, body) => { writeFileSync(path.join(cwd, file), body); git('add', '-f', '--', file); };
  git('init', '-q');
  git('config', 'user.name', 'Fixture');
  git('config', 'user.email', 'fixture@example.invalid');
  write('.env.example', 'BOLT_ADMIN_PASSWORD=""\n');
  write('guide.md', 'GOOGLE_MAPS_SERVER_API_KEY\n');
  git('commit', '-qm', 'base');
  const base = git('rev-parse', 'HEAD');
  assert.equal(run().status, 0);

  const sample = 'AIza' + 'X'.repeat(35);
  write('guide.md', 'https://example.invalid/?key=' + sample);
  write('persisted-orders.json', '[]');
  write('.env.example', 'BOLT_ADMIN_PASSWORD="fixture-only"\n');
  const rejection = run();
  assert.equal(rejection.status, 1);
  assert.match(rejection.stderr, /rutas privadas: 1, archivos con material de credencial: 1, valores sensibles en plantillas: 1/);
  assert.doesNotMatch(rejection.stdout + rejection.stderr, new RegExp(sample + '|fixture-only'));
  git('commit', '-qm', 'datos simulados');

  git('rm', '-q', 'persisted-orders.json');
  write('guide.md', 'estado limpio');
  write('.env.example', "BOLT_ADMIN_PASSWORD=''\n");
  git('commit', '-qm', 'limpiar');
  writeFileSync(path.join(cwd, '.env'), sample);
  assert.equal(run().status, 0);
  assert.equal(run('--pr', base, git('rev-parse', 'HEAD')).status, 1);
});
