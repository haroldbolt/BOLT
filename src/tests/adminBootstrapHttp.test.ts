import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';
import { pathToFileURL } from 'node:url';
import { AdminAuthService } from '../lib/adminAuthService';
import { AdminBootstrap } from '../lib/adminBootstrap';
import { FulfillmentStorage } from '../lib/fulfillmentStorage';
import { newDispatchState } from '../types/dispatch';
import { adminBootstrapFixture } from './adminBootstrapFixture.mjs';

const source = process.cwd();
const secret = () => randomBytes(32).toString('hex');

function isolatedVolume() {
  const volume = fs.mkdtempSync(path.join(os.tmpdir(), 'bolt-admin-http-volume-'));
  const data = path.join(volume,'src/data');
  fs.mkdirSync(path.join(data,'catalogo-local'), {recursive:true});
  for (const file of ['bodegas.json','productos.json']) fs.writeFileSync(path.join(data,'catalogo-local',file), '[]');
  fs.symlinkSync(path.join(source,'src/data/geography'), path.join(data,'geography'), 'dir');
  const fulfillment = new FulfillmentStorage(path.join(volume,'fulfillment'));
  fulfillment.commit({orders:[], drivers:[], audit:[], telemetry:{}, dispatch:newDispatchState()});
  return {volume, fulfillment, authFile:path.join(data, 'persisted-admin-auth.json')};
}

async function exerciseServer(
  runtime: ReturnType<typeof isolatedVolume>, env: NodeJS.ProcessEnv,
  act: (request: (route:string, values?:object, setupToken?:string) => Promise<Response>) => Promise<void>,
) {
  const entry = pathToFileURL(path.join(source,'server.ts')).href;
  const launch = `
    import { once } from 'node:events';
    import { startServer } from ${JSON.stringify(entry)};
    const server = await startServer();
    if (!server.listening) await once(server,'listening');
    process.on('message', () => {
      server.close(() => process.exit(0));
      server.closeAllConnections();
    });
    process.send(server.address().port);
  `;
  const child = spawn(process.execPath, [
    '--import', path.join(source,'node_modules/tsx/dist/loader.mjs'), '--input-type=module','-e',launch,
  ], {
    cwd:runtime.volume,
    env: {PATH:process.env.PATH, TMPDIR:os.tmpdir(), NODE_ENV:'production', PORT:'0', BOLT_BIND_LOOPBACK_ONLY:'1',
      BOLT_DATA_DIR:path.join(runtime.volume,'fulfillment'), ...env},
    stdio:['ignore','ignore','ignore','ipc'],
  });
  const closed = once(child, 'exit');
  try {
    const port = await startupPort(child);
    const origin = 'http://127.0.0.1:' + port + '/api/v1/auth/';
    await act((route, values, setupToken) => fetch(origin + route, {
      method:values ? 'POST' : 'GET', headers: {
        'Content-Type':'application/json', ...(setupToken && {'X-Bolt-Admin-Setup-Token':setupToken}),
      }, body:values ? JSON.stringify(values) : undefined,
    }));
  } finally {
    if (child.connected) child.send('stop');
    const kill = setTimeout(() => child.kill('SIGKILL'), 3000);
    try { await closed; } finally { clearTimeout(kill); }
  }
  assert.equal(runtime.fulfillment.read().orders.length, 0);
}

function startupPort(child: ChildProcess): Promise<number> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { cleanup(); reject(Error('El servidor local no estuvo listo a tiempo.')); }, 20000);
    function cleanup() {
      clearTimeout(timer); child.off('exit', ended); child.off('message', message); child.off('error', ended);
    }
    function ended() { cleanup(); reject(Error('Falló el arranque del servidor de pruebas aislado.')); }
    function message(value: unknown) {
      cleanup();
      if (typeof value === 'number' && value > 0) resolve(value);
      else reject(Error('El servidor de pruebas no entregó un puerto local.'));
    }
    child.once('exit',ended); child.once('error',ended); child.once('message',message);
  });
}

function cleanup(t: TestContext, folder: string) {
  t.after(() => fs.rmSync(folder, {recursive:true, force:true}));
}

async function rejected(response: Response, status: number) {
  assert.equal(response.status, status);
  const data = await response.json();
  assert.ok(typeof data.error === 'string');
  assert.ok(Object.keys(data).every(key => key === 'code' || key === 'error'));
}

test('HTTP requires both authorizations, issues one first account and keeps setup closed after restart and storage loss', async t => {
  const first = isolatedVolume();
  cleanup(t,first.volume);
  const user = {email:randomUUID()+'@example.invalid', name:'Coordinación de prueba', password:secret()};
  const old = {email:randomUUID()+'@example.invalid', name:'Cuenta anterior de prueba', password:secret()};
  const fixture = adminBootstrapFixture(first.volume,user.email);
  t.after(fixture.dispose);
  const env = {...fixture.env, BOLT_ADMIN_EMAIL:old.email, BOLT_ADMIN_PASSWORD:old.password};
  const originalToken = env.BOLT_ADMIN_SETUP_TOKEN;

  await exerciseServer(first,env,async request => {
    const state = await (await request('status')).json();
    assert.equal(state.setupState,'open');
    await rejected(await request('setup-admin',user),403);
    await rejected(await request('setup-admin',user,secret()),403);
    await rejected(await request('setup-admin',old,originalToken),403);
    assert.equal(fs.existsSync(first.authFile),false);
    const responses = await Promise.all([request('setup-admin',user,originalToken), request('setup-admin',user,originalToken)]);
    assert.deepEqual(responses.map(r => r.status).sort(),[201,409]);
    const result = await responses.find(r => r.status===201)!.json();
    assert.ok(typeof result.token === 'string' && result.user.role === 'ADMINISTRADOR');
    await rejected(responses.find(r => r.status===409)!,409);
    assert.equal((await (await request('status')).json()).setupState,'closed');
  });
  const saved = JSON.parse(fs.readFileSync(first.authFile,'utf8'));
  assert.equal(saved.admins.length,1);
  assert.equal(saved.version,'2.0.0');

  const nextToken = secret();
  await exerciseServer(first,{...env,BOLT_ADMIN_SETUP_TOKEN:nextToken},async request => {
    assert.equal((await (await request('status')).json()).isSetupRequired,false);
    await rejected(await request('setup-admin',user,originalToken),403);
    await rejected(await request('setup-admin',user,nextToken),409);
    await rejected(await request('login',old),401);
    assert.equal((await request('login',user)).status,200);
  });
  const withoutToken: NodeJS.ProcessEnv = {...env};
  delete withoutToken.BOLT_ADMIN_SETUP_TOKEN;
  await exerciseServer(first,withoutToken,async request => {
    assert.equal((await (await request('status')).json()).setupState,'closed');
    await rejected(await request('setup-admin',user,originalToken),403);
    assert.equal((await request('login',user)).status,200);
  });

  const sealedReceipt = AdminBootstrap.fromEnvironment(env,first.authFile).closedReceipt(saved.bootstrap,user.email);
  const pinned: NodeJS.ProcessEnv = {...env,BOLT_ADMIN_CLOSED_RECEIPT:sealedReceipt};
  delete pinned.BOLT_ADMIN_CONTROL_DIR;
  await exerciseServer(first,pinned,async request => {
    assert.equal((await (await request('status')).json()).setupState,'closed');
    await rejected(await request('setup-admin',old,originalToken),409);
    assert.equal((await request('login',user)).status,200);
  });

  const replacement = isolatedVolume();
  cleanup(t,replacement.volume);
  await exerciseServer(replacement,{...env,BOLT_ADMIN_VOLUME_DIR:replacement.volume},async request => {
    const state = await (await request('status')).json();
    assert.equal(state.setupState,'recovery-required');
    assert.equal(state.isSetupRequired,false);
    await rejected(await request('setup-admin',user,originalToken),503);
    await rejected(await request('login',old),503);
    assert.equal(fs.existsSync(replacement.authFile),false);
  });
  await exerciseServer(replacement,{...pinned,BOLT_ADMIN_VOLUME_DIR:replacement.volume},async request => {
    assert.equal((await (await request('status')).json()).setupState,'recovery-required');
    await rejected(await request('setup-admin',user,originalToken),503);
    assert.equal(fs.existsSync(replacement.authFile),false);
  });
  await exerciseServer(first,{...env,BOLT_ADMIN_CONTROL_DIR:path.join(first.volume,'unavailable')},async request => {
    assert.equal((await (await request('status')).json()).setupState,'recovery-required');
    await rejected(await request('setup-admin',user,originalToken),503);
    await rejected(await request('login',user),503);
    assert.equal(JSON.parse(fs.readFileSync(first.authFile,'utf8')).admins.length,1);
  });
});

test('HTTP leaves v1 untouched until offline adoption and keeps the account and its verifier', async t => {
  const runtime = isolatedVolume(), control = fs.mkdtempSync(path.join(os.tmpdir(),'bolt-admin-http-control-'));
  cleanup(t,runtime.volume); cleanup(t,control);
  const user = {email:randomUUID()+'@example.invalid',name:'Coordinación histórica de prueba',password:secret()};
  const legacy = new AdminAuthService(runtime.authFile,{mode:'isolated'});
  assert.equal(legacy.setupMasterAdmin(user).success,true);
  const original = fs.readFileSync(runtime.authFile,'utf8');
  const env = {BOLT_ADMIN_CONTROL_DIR:control,BOLT_ADMIN_VOLUME_DIR:runtime.volume,
    BOLT_ADMIN_SETUP_TOKEN:secret(), BOLT_ADMIN_INSTALLATION_ID:randomUUID()};
  await exerciseServer(runtime,env,async request => {
    assert.equal((await (await request('status')).json()).setupState,'recovery-required');
    await rejected(await request('login',user),503);
    assert.ok(fs.readFileSync(runtime.authFile,'utf8')===original);
  });
  AdminBootstrap.fromEnvironment(env,runtime.authFile).prepare('adopt',user.email);
  await exerciseServer(runtime,env,async request => {
    assert.equal((await (await request('status')).json()).setupState,'closed');
    assert.equal((await request('login',user)).status,200);
    await rejected(await request('setup-admin',user,env.BOLT_ADMIN_SETUP_TOKEN),409);
  });
  const converted = JSON.parse(fs.readFileSync(runtime.authFile,'utf8')), previous = JSON.parse(original).admins[0];
  assert.equal(converted.version,'2.0.0');
  assert.equal(converted.admins.length,1);
  for (const key of ['id','email','createdAt','passwordHash','salt','role']) assert.ok(converted.admins[0][key]===previous[key]);
});
