import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { AdminAuthService } from '../lib/adminAuthService';
import { adminBootstrapFixture } from './adminBootstrapFixture.mjs';
import { acquireCatalogWriterLock } from '../lib/catalogWriterLock';

test('offline rotation keeps roles and accounts, rejects a live writer and invalidates the previous credential', t => {
  const runtime = fs.mkdtempSync(path.join(os.tmpdir(), 'bolt-rotate-fixture-'));
  t.after(() => fs.rmSync(runtime, { recursive: true, force: true }));
  const email = 'staff-rotation@example.invalid';
  const fixture = adminBootstrapFixture(runtime, email);
  t.after(fixture.dispose);
  const file = path.join(runtime, 'src/data/persisted-admin-auth.json');
  const options = { mode: 'managed' as const, env: fixture.env };
  const auth = new AdminAuthService(file, options);
  const original = randomBytes(32).toString('hex');
  const next = randomBytes(32).toString('hex');
  const setup = auth.setupMasterAdmin({ name: 'Coordinación de prueba', email, password: original });
  assert.equal(setup.success, true);
  const run = (action: string, input?: string) => spawnSync(process.execPath,
    ['--import','tsx','scripts/admin-credential.ts',action,runtime], {
      env: { PATH: process.env.PATH, ...fixture.env, BOLT_ADMIN_MAINTENANCE_EMAIL: email },
      input, encoding: 'utf8',
    });
  const release = acquireCatalogWriterLock(runtime);
  try { assert.notEqual(run('warn').status, 0); } finally { release(); }
  assert.equal(run('warn').status, 0);
  const marked = new AdminAuthService(file, options).login(email, original);
  assert.equal(marked.user?.rotationRecommended, true);
  assert.notEqual(run('rotate', original).status, 0);
  const rotation = run('rotate', next);
  assert.equal(rotation.status, 0);
  assert.ok(!rotation.stdout.includes(next) && !rotation.stderr.includes(next));
  const restarted = new AdminAuthService(file, options);
  assert.equal(restarted.setupState(), 'closed');
  assert.equal(restarted.getAdminCount(), 1);
  assert.equal(restarted.verifySession(marked.token), null);
  assert.equal(restarted.login(email, original).success, false);
  const signIn = restarted.login(email, next);
  assert.equal(signIn.user?.role, 'ADMINISTRADOR');
  assert.equal(signIn.user?.id, setup.user?.id);
  assert.equal(signIn.user?.rotationRecommended, undefined);
});
