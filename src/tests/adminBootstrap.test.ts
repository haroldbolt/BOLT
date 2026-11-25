import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';
import { promisify } from 'node:util';
import { ADMIN_VOLUME_MARKER, AdminBootstrap, type AdminBinding } from '../lib/adminBootstrap';

function writeBoundAccount(file: string, email: string, bootstrap: AdminBinding) {
  fs.writeFileSync(file, JSON.stringify({version:'2.0.0', bootstrap, admins:[{id:'fixture-master', role:'ADMINISTRADOR', email}]}), {mode:0o600});
}

function fixture(t: TestContext) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bolt-admin-binding-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const volume = path.join(root, 'volume'), control = path.join(root, 'control');
  fs.mkdirSync(volume, {mode: 0o700});
  fs.mkdirSync(control, {mode: 0o700});
  const authFile = path.join(volume, 'accounts.json');
  const env = {BOLT_ADMIN_VOLUME_DIR: volume, BOLT_ADMIN_CONTROL_DIR: control, BOLT_ADMIN_INSTALLATION_ID: crypto.randomUUID()};
  const email = crypto.randomUUID() + '@example.invalid';
  const open = () => AdminBootstrap.fromEnvironment(env, authFile);
  return {control, volume, authFile, env, email, open};
}

test('only explicit offline preparation of a matching account and installation opens setup', t => {
  const f = fixture(t);
  assert.throws(() => f.open().inspect());
  assert.deepEqual(fs.readdirSync(f.control), []);
  f.open().prepare('prepare', f.email);
  assert.equal(f.open().inspect(), 'open');
  f.open().prepare('prepare', f.email);
  assert.throws(() => f.open().reserve('other@example.invalid'));
  assert.equal(f.open().inspect(), 'open');
  assert.throws(() => AdminBootstrap.fromEnvironment({...f.env, BOLT_ADMIN_INSTALLATION_ID: crypto.randomUUID()}, f.authFile).inspect());
  assert.throws(() => AdminBootstrap.fromEnvironment(f.env, path.join(f.volume, 'other.json')).inspect());
  for (const file of [...fs.readdirSync(f.control).map(name => path.join(f.control,name)), path.join(f.volume, ADMIN_VOLUME_MARKER)]) {
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    assert.ok(!fs.readFileSync(file,'utf8').includes(f.email));
  }
});

test('only one reservation wins and completion resumes after the authorized store was committed', t => {
  const f = fixture(t);
  f.open().prepare('prepare', f.email);
  const first = f.open(), second = f.open();
  assert.equal(second.inspect(), 'open');
  const binding = first.reserve(f.email);
  assert.throws(() => second.reserve(f.email));
  // If commit is unknown, an empty/missing account file cannot generate a fresh first account.
  assert.throws(() => f.open().inspect());
  assert.throws(() => f.open().prepare('prepare', f.email));
  assert.throws(() => f.open().complete(binding, f.email));
  writeBoundAccount(f.authFile, 'other@example.invalid', binding);
  assert.throws(() => f.open().complete(binding, f.email));
  writeBoundAccount(f.authFile, f.email, binding);
  const reloaded = JSON.parse(fs.readFileSync(f.authFile,'utf8')).bootstrap;
  assert.throws(() => f.open().complete({...binding,volumeId:crypto.randomUUID()}, f.email));
  assert.throws(() => f.open().complete(reloaded, 'other@example.invalid'));
  const later = Date.now() + 3_600_001;
  t.mock.method(Date, 'now', () => later);
  assert.equal(f.open().inspect(reloaded), 'closed');
  f.open().complete(reloaded, f.email);
  f.open().complete(reloaded, f.email);
  fs.unlinkSync(f.authFile);
  assert.throws(() => f.open().inspect());
  assert.throws(() => f.open().prepare('prepare', f.email));
});

test('two processes racing to reserve the same grant receive exactly one authorization', async t => {
  const f = fixture(t);
  f.open().prepare('prepare', f.email);
  const module = new URL('../lib/adminBootstrap.ts', import.meta.url).href;
  const worker = `
    import { AdminBootstrap } from ${JSON.stringify(module)};
    try {
      AdminBootstrap.fromEnvironment(process.env, process.env.FIXTURE_AUTH_FILE).reserve(process.env.FIXTURE_EMAIL);
      console.log('reserved');
    } catch { console.log('closed'); }
  `;
  const call = () => promisify(execFile)(process.execPath, ['--import','tsx','--input-type=module','-e',worker], {
    env: {...f.env, FIXTURE_AUTH_FILE:f.authFile, FIXTURE_EMAIL:f.email},
  });
  const results = await Promise.all([call(),call()]);
  assert.deepEqual(results.map(({stdout}) => stdout.trim()).sort(), ['closed','reserved']);
  assert.throws(() => f.open().inspect());
});

test('a missing or swapped volume fails closed before and after closure; missing external evidence cannot be recreated', t => {
  for (const closed of [false, true]) {
    const f = fixture(t), other = fixture(t);
    f.open().prepare('prepare', f.email);
    other.open().prepare('prepare', other.email);
    if (closed) {
      const binding = f.open().reserve(f.email);
      writeBoundAccount(f.authFile, f.email, binding);
      f.open().complete(binding, f.email);
    }
    const marker = path.join(f.volume, ADMIN_VOLUME_MARKER);
    const original = fs.readFileSync(marker);
    fs.unlinkSync(marker);
    assert.throws(() => f.open().inspect());
    assert.throws(() => f.open().prepare('prepare', f.email));
    fs.copyFileSync(path.join(other.volume, ADMIN_VOLUME_MARKER), marker);
    assert.throws(() => f.open().inspect());
    fs.writeFileSync(marker, original);
    for (const name of fs.readdirSync(f.control)) fs.unlinkSync(path.join(f.control,name));
    assert.throws(() => f.open().inspect());
    assert.throws(() => f.open().prepare('prepare', f.email));
  }
});

test('an expired authorization cannot reserve or extend itself on restart', t => {
  const f = fixture(t);
  f.open().prepare('prepare', f.email);
  const later = Date.now() + 3_600_001;
  t.mock.method(Date, 'now', () => later);
  assert.throws(() => f.open().reserve(f.email));
  assert.throws(() => f.open().prepare('prepare', f.email));
});

test('an adoption accepts only the approved v1 snapshot; a prior snapshot cannot reopen consumed setup', t => {
  const f = fixture(t);
  const original = JSON.stringify({version:'1.0.0',admins:[{role:'ADMINISTRADOR',email:f.email}]});
  fs.writeFileSync(f.authFile, original, {mode:0o600});
  assert.throws(() => f.open().prepare('prepare', f.email));
  assert.throws(() => f.open().prepare('adopt', 'unrelated@example.invalid'));
  f.open().prepare('adopt', f.email);
  assert.equal(f.open().inspect(undefined, original), 'adopt');
  assert.throws(() => f.open().inspect());
  assert.throws(() => f.open().adopt(original + ' '));
  const binding = f.open().adopt(original);
  assert.deepEqual(f.open().adopt(original), binding);
  writeBoundAccount(f.authFile, f.email, binding);
  f.open().complete(binding, f.email);
  fs.writeFileSync(f.authFile, original);
  assert.throws(() => f.open().adopt(original));
  assert.throws(() => f.open().reserve(f.email));
});

test('control requires an explicit private directory separate from the volume and rejects indirect data path escapes', t => {
  const f = fixture(t);
  assert.throws(() => AdminBootstrap.fromEnvironment({}, f.authFile));
  assert.throws(() => AdminBootstrap.fromEnvironment({...f.env,BOLT_ADMIN_CONTROL_DIR:f.volume}, f.authFile));
  assert.throws(() => AdminBootstrap.fromEnvironment(f.env, path.join(f.control,'accounts.json')));
  fs.symlinkSync(f.control, path.join(f.volume,'redirect'));
  assert.throws(() => AdminBootstrap.fromEnvironment(f.env, path.join(f.volume,'redirect/new/accounts.json')));
  fs.chmodSync(f.control, 0o755);
  assert.throws(() => f.open());
});

test('a sealed receipt on a single volume supports login validation only and never accepts new setup or adoption', t => {
  const f = fixture(t);
  f.open().prepare('prepare',f.email);
  const binding = f.open().reserve(f.email);
  writeBoundAccount(f.authFile,f.email,binding);
  assert.throws(() => f.open().closedReceipt(binding, f.email));
  f.open().complete(binding, f.email);
  const receipt = f.open().closedReceipt(binding,f.email);
  assert.ok(/^[a-f0-9]{64}$/.test(receipt));
  const env = {...f.env, BOLT_ADMIN_CONTROL_DIR:undefined, BOLT_ADMIN_CLOSED_RECEIPT:receipt};
  fs.rmSync(f.control,{recursive:true});
  const sealed = AdminBootstrap.fromEnvironment(env, f.authFile);
  assert.equal(sealed.inspect(binding), 'closed');
  sealed.complete(binding, f.email);
  assert.throws(() => sealed.prepare('prepare',f.email));
  assert.throws(() => sealed.adopt('{}'));
  assert.throws(() => sealed.reserve(f.email));
  assert.throws(() => sealed.closedReceipt(binding,f.email));
  assert.throws(() => AdminBootstrap.fromEnvironment({...env,BOLT_ADMIN_CLOSED_RECEIPT:' '},f.authFile));
  assert.throws(() => AdminBootstrap.fromEnvironment({...env,BOLT_ADMIN_CLOSED_RECEIPT:'a'.repeat(64)},f.authFile).inspect(binding));
  const elsewhere = path.join(f.volume,'moved.json');
  fs.copyFileSync(f.authFile,elsewhere);
  assert.throws(() => AdminBootstrap.fromEnvironment(env,elsewhere).inspect(binding));
  const original = JSON.parse(fs.readFileSync(f.authFile, 'utf8'));
  original.admins[0].id += '-changed';
  fs.writeFileSync(f.authFile, JSON.stringify(original));
  assert.throws(() => sealed.inspect(binding));
  writeBoundAccount(f.authFile,f.email,binding);
  fs.unlinkSync(path.join(f.volume, ADMIN_VOLUME_MARKER));
  assert.throws(() => sealed.inspect(binding), /recupera/);
  assert.throws(() => sealed.inspect(), /recupera/);
});
