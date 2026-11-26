import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { test, type TestContext } from 'node:test';
import { AdminAuthService } from '../lib/adminAuthService';
import { ADMIN_VOLUME_MARKER } from '../lib/adminBootstrap';
import { preparePilot } from '../../deployment/start-pilot';

const source = path.resolve(import.meta.dirname, '../..');

function fixture(t: TestContext, pilot = false) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bolt-offline-seal-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  let release = source;
  if (pilot) {
    // The CLI prepares the disk, without executing a server bundle or requiring a previous build.
    release = path.join(root, 'release');
    fs.mkdirSync(path.join(release, 'scripts'), { recursive: true });
    fs.mkdirSync(path.join(release, 'dist'));
    fs.copyFileSync(path.join(source,'scripts/admin-seal.ts'), path.join(release,'scripts/admin-seal.ts'));
    for (const asset of ['package.json','storage-contract.json']) fs.copyFileSync(path.join(source,asset),path.join(release,asset));
    for (const dir of ['src','node_modules','deployment']) fs.symlinkSync(path.join(source,dir),path.join(release,dir),'dir');
    fs.writeFileSync(path.join(release,'dist/index.html'), '<!doctype html>');
    fs.writeFileSync(path.join(release,'server.js'), '');
  }
  const volume = path.join(root, 'volume'), control = path.join(root, 'maintenance'), output = path.join(root,'export');
  for (const dir of [volume,control,output]) fs.mkdirSync(dir, { mode: 0o700 });
  const email = randomUUID() + '@example.invalid', password = randomBytes(32).toString('base64url');
  const env: NodeJS.ProcessEnv = {
    PATH: process.env.PATH, BOLT_ADMIN_VOLUME_DIR: volume, BOLT_ADMIN_CONTROL_DIR: control,
    BOLT_ADMIN_INSTALLATION_ID: randomUUID(), BOLT_ADMIN_BOOTSTRAP_EMAIL: email,
    ...(pilot && { BOLT_PILOT_VOLUME: volume, BOLT_PILOT_STORE_IDS: 'HUB_ALAMOS,HUB_KENNEDY,HUB_SUBA' }),
  };
  const file = path.join(pilot ? path.join(volume, 'bolt-operacion') : volume, 'src/data/persisted-admin-auth.json');
  const receipt = path.join(output,'closed');
  const run = (action: string, destination = receipt, overrides: NodeJS.ProcessEnv = {}, input?: string) => {
    const cmd = spawnSync(process.execPath, ['--import','tsx','scripts/admin-seal.ts',action,file,destination], {
      cwd: release, env: { ...env, ...overrides }, encoding: 'utf8', input: input ?? '',
    });
    assert.ok(!cmd.error);
    assert.ok(![email, password].some(s => (cmd.stdout + cmd.stderr).includes(s)));
    assert.ok(!/[a-f0-9]{64}/i.test(cmd.stdout + cmd.stderr));
    return cmd.status;
  };
  return { release, volume, control, output, file, receipt, env, email, password, run };
}

test('crea por stdin sin token web, exporta sin sobrescribir y verifica cierre con el recibo tras reinicio', t => {
  const f = fixture(t);
  assert.equal(f.run('create', undefined, {}, f.password + '\n'), 0);
  assert.equal(fs.statSync(f.receipt).mode & 0o777, 0o600);
  const receipt = fs.readFileSync(f.receipt, 'utf8').trim();
  assert.ok(/^[a-f0-9]{64}$/.test(receipt));
  const closedEnv = { ...f.env, BOLT_ADMIN_CONTROL_DIR: undefined, BOLT_ADMIN_CLOSED_RECEIPT: receipt };
  const restarted = new AdminAuthService(f.file,{ mode: 'managed', env: closedEnv });
  assert.equal(restarted.setupState(), 'closed');
  assert.equal(restarted.login(f.email,f.password).success, true);
  assert.equal(restarted.setupMasterAdmin({ email:f.email,password:f.password,name:'Prueba' }).success,false);

  const data = fs.readFileSync(f.file);
  const second = path.join(f.output,'again');
  assert.equal(f.run('export'), 1);
  assert.equal(f.run('create',second,{},f.password), 1);
  assert.equal(f.run('adopt',second), 1);
  assert.equal(f.run('export',second,{BOLT_ADMIN_BOOTSTRAP_EMAIL:randomUUID()+'@example.invalid'}), 1);
  assert.equal(f.run('export',second), 0);
  assert.ok(fs.readFileSync(second).equals(fs.readFileSync(f.receipt)));
  assert.ok(fs.readFileSync(f.file).equals(data));
});

test('adopta la cuenta v1 real conservando credenciales, responsabilidades y sedes', t => {
  const f=fixture(t);
  const legacy = new AdminAuthService(f.file,{mode:'isolated'});
  assert.equal(legacy.setupMasterAdmin({email:f.email,name:'Prueba',password:f.password}).success,true);
  legacy.createStoreOperator(randomUUID()+'@example.invalid','Operador',randomBytes(32).toString('hex'),'HUB_ALAMOS');
  const old = JSON.parse(fs.readFileSync(f.file,'utf8'));
  assert.equal(f.run('adopt'),0);
  const current = JSON.parse(fs.readFileSync(f.file,'utf8'));
  assert.equal(current.version,'2.0.0');
  assert.ok(JSON.stringify(current.admins)===JSON.stringify(old.admins));
});

test('rechaza operaciones concurrentes, destinos inseguros, archivos ajenos y entrada corta antes de crear cuentas', t => {
  const f=fixture(t);
  const occupied = path.join(f.output,'occupied');
  fs.writeFileSync(occupied,'conservar',{mode:0o600});
  assert.equal(f.run('create',occupied,{},f.password),1);
  assert.equal(fs.readFileSync(occupied,'utf8'),'conservar');
  assert.equal(f.run('create',path.join(f.volume,'out'),{},f.password),1);
  assert.equal(f.run('create',path.join(f.control,'out'),{},f.password),1);
  fs.chmodSync(f.output,0o755);
  assert.equal(f.run('create',undefined,{},f.password),1);
  fs.chmodSync(f.output,0o700);
  assert.equal(f.run('create',undefined,{},'corta'),1);
  fs.mkdirSync(path.join(f.volume,'.bolt-pilot-writer'));
  assert.equal(f.run('create',undefined,{},f.password),1);
  fs.rmdirSync(path.join(f.volume,'.bolt-pilot-writer'));
  assert.ok(!fs.existsSync(path.join(f.volume,ADMIN_VOLUME_MARKER)));
  assert.ok(!fs.existsSync(f.file));
  assert.ok(!fs.existsSync(f.receipt));
});

test('la ceremonia de tres sedes prepara el runtime completo bajo el lock del lanzador', t => {
  const f=fixture(t,true);
  assert.equal(f.run('create',undefined,{},f.password),0);
  const closedEnv = { ...f.env, BOLT_ADMIN_CLOSED_RECEIPT: fs.readFileSync(f.receipt,'utf8').trim(), BOLT_ADMIN_CONTROL_DIR: undefined };
  const runtime = preparePilot(f.release,closedEnv);
  try {
    assert.equal(runtime.runtime,path.join(fs.realpathSync(f.volume),'bolt-operacion'));
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(runtime.data,'persisted-fulfillment.json'),'utf8')).orders,[]);
    assert.equal(f.run('export',path.join(f.output,'locked')),1);
  } finally { runtime.release(); }
  assert.equal(f.run('export',path.join(f.output,'after-restart')),0);
});
