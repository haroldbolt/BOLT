import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test, type TestContext } from 'node:test';

// This file runs in its own Node test process. Isolate the module's default singleton too.
const source = process.cwd();
const singletonRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bolt-auth-module-'));
delete process.env.BOLT_ADMIN_EMAIL;
delete process.env.BOLT_ADMIN_PASSWORD;
process.chdir(singletonRoot);
const { AdminAuthService } = await import('../lib/adminAuthService');
process.chdir(source);
after(() => fs.rmSync(singletonRoot, { recursive: true, force: true }));
const master = { email: 'coordination@example.invalid', name: 'Coordinación de prueba', password: randomUUID() };

function fixture(t: TestContext) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bolt-private-auth-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'data/accounts.json');
  return { directory, file };
}

test('only valid persisted accounts may serve requests; broken files never trigger bootstrap', t => {
  const { file } = fixture(t);
  const auth = new AdminAuthService(file);
  assert.ok(auth.setupMasterAdmin(master).success);
  const existing = JSON.parse(fs.readFileSync(file, 'utf8'));
  const user = existing.admins[0];
  const malformed = [
    '{broken', JSON.stringify({}), JSON.stringify({ version: '1.0.0', admins: [] }),
    JSON.stringify({ ...existing, admins: [user, user] }),
    JSON.stringify({ ...existing, admins: [{ ...user, passwordHash: 'invalid' }] }),
    JSON.stringify({ ...existing, admins: [{ ...user, role: 'OTHER' }] }),
  ];
  process.env.BOLT_ADMIN_EMAIL = 'bootstrap@example.invalid';
  process.env.BOLT_ADMIN_PASSWORD = randomUUID();
  t.after(() => { delete process.env.BOLT_ADMIN_EMAIL; delete process.env.BOLT_ADMIN_PASSWORD; });
  assert.equal(new AdminAuthService(file).getAdminCount(), 1);
  for (const content of malformed) {
    fs.writeFileSync(file, content);
    assert.throws(() => new AdminAuthService(file), /Recupera la copia/);
    assert.equal(fs.readFileSync(file, 'utf8'), content);
  }
});

test('secrets are absent from account projections and sessions, active bearer returned only at login/setup', t => {
  const { file } = fixture(t);
  const auth = new AdminAuthService(file);
  const setup = auth.setupMasterAdmin(master);
  const login = auth.login(master.email, master.password);
  assert.ok(setup.token && login.token && setup.token !== login.token);
  for (const view of [setup.user, login.user, auth.verifyStaffSession(login.token)]) {
    assert.ok(view);
    assert.equal('token' in view, false);
    assert.equal('salt' in view, false);
    assert.equal('passwordHash' in view, false);
  }
  assert.ok(!fs.readFileSync(file, 'utf8').includes(login.token));
  assert.ok(auth.logout(login.token));
  assert.equal(auth.verifySession(login.token), null);
});

test('a failed administrative write closes active access until restart from durable data', t => {
  const { file, directory } = fixture(t);
  const auth = new AdminAuthService(file);
  const setup = auth.setupMasterAdmin(master);
  const original = fs.readFileSync(file, 'utf8');
  const parent = path.dirname(file);
  const backup = path.join(directory, 'retained');
  fs.renameSync(parent, backup);
  fs.writeFileSync(parent, 'fixture prevents writing this directory');
  assert.throws(() => auth.login(master.email, master.password), /escritura/);
  assert.equal(auth.verifySession(setup.token), null);
  assert.throws(() => auth.isSetupRequired(), /recuperación/);
  fs.unlinkSync(parent);
  fs.renameSync(backup, parent);
  assert.equal(fs.readFileSync(file, 'utf8'), original);
  const restarted = new AdminAuthService(file);
  assert.ok(restarted.login(master.email, master.password).success);
  assert.equal(restarted.verifySession(setup.token), null);
});
