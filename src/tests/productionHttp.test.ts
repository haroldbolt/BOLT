import assert from 'node:assert/strict';
import test from 'node:test';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { request, type IncomingHttpHeaders } from 'node:http';
import express from 'express';
import { mountProductionHttp } from '../lib/productionHttp';

type Reply = { status: number; headers: IncomingHttpHeaders; data: Record<string, unknown> };
type Get = (path: string, headers?: Record<string,string>, method?: string) => Promise<Reply>;
const canonical = 'https://bolt.example.test';
const secure = { Host: 'bolt.example.test', 'X-Forwarded-Proto': 'https' };
const setup = { NODE_ENV: 'production', BOLT_PUBLIC_ORIGIN: canonical, BOLT_TRUSTED_PROXY_CIDRS: '127.0.0.1/32' };
async function exercise(env: NodeJS.ProcessEnv, run: (call: Get) => Promise<void>, simulation=false) {
  const app = express();
  mountProductionHttp(app, env, simulation);
  app.use((req,res) => res.json({ ip:req.ip, host:req.hostname, secure:req.secure, rawIp:req.get('x-forwarded-for') }));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = (server.address() as AddressInfo).port;
  const call: Get = (path, headers={}, method='GET') => new Promise((resolve,reject) => {
    const req = request({hostname:'127.0.0.1', port, path, headers, method}, res => {
      let body = '';
      res.setEncoding('utf8').on('data', part => body += part).on('end', () =>
        resolve({status:res.statusCode!,headers:res.headers,data:body ? JSON.parse(body) : {}}));
    });
    req.on('error',reject).end();
  });
  try { await run(call); }
  finally { await new Promise<void>((resolve,reject) => server.close(error => error ? reject(error) : resolve())); }
}

test('TLS uses the trusted peer, exact scheme and the canonical Host', async () => {
  await exercise(setup,async call => {
    const result=await call('/api/v1/stores', {...secure, 'X-Forwarded-Host':'foreign.invalid', 'X-Forwarded-For':'192.0.2.8, 198.51.100.4'});
    assert.equal(result.status,200);
    assert.deepEqual(result.data,{ip:'198.51.100.4',host:'bolt.example.test',secure:true,rawIp:'198.51.100.4'});
    assert.match(String(result.headers['strict-transport-security']), /max-age=/);
    assert.equal(result.headers['x-content-type-options'],'nosniff');
    assert.equal(result.headers['referrer-policy'],'strict-origin');
    assert.equal((await call('/api/v1/stores', { ...secure, Host:'foreign.invalid' })).status,421);
    for (const value of ['http','https,http']) {
      const rejected=await call('/api/v1/stores',{ ...secure, 'X-Forwarded-Proto':value });
      assert.equal(rejected.status,403);
      assert.equal(rejected.headers['strict-transport-security'],undefined);
    }
  });
  await exercise({...setup, BOLT_TRUSTED_PROXY_CIDRS:'192.0.2.0/24'}, async call => {
    assert.equal((await call('/api/v1/stores',secure)).status,403);
    assert.equal((await call('/api/v1/health')).status,200);
    assert.notEqual((await call('/api/v1/health',{},'POST')).status,200);
  });
});

test('only explicit origins use CORS on v1; Apple callback retains provider authentication',async () => {
  const allowed = 'https://cliente.example.test';
  await exercise({...setup,BOLT_PWA_ORIGINS:allowed,BOLT_APPLE_SERVICE_ID:'fixture',BOLT_APPLE_CLIENT_SECRET:'fixture'},async call => {
    const cors=await call('/api/v1/orders',{...secure, Origin:allowed,'Access-Control-Request-Method':'POST'},'OPTIONS');
    assert.equal(cors.status,204);
    assert.equal(cors.headers['access-control-allow-origin'],allowed);
    assert.equal(cors.headers['access-control-allow-credentials'],undefined);
    assert.match(String(cors.headers['access-control-allow-headers']), /Idempotency-Key/);
    assert.equal((await call('/api/v1/stores',{...secure,Origin:canonical})).status,200);
    for (const origin of ['null','https://cliente.example.test.attacker.test']) {
      const blocked=await call('/api/v1/stores',{...secure,Origin:origin});
      assert.equal(blocked.status,403);
      assert.equal(blocked.headers['access-control-allow-origin'],undefined);
    }
    assert.equal((await call('/api/customer/me',{...secure,Origin:allowed})).status,403);
    const apple={...secure, Origin:'https://appleid.apple.com'};
    assert.equal((await call('/api/customer-auth/callback/apple',apple,'POST')).status,200);
    assert.equal((await call('/api/customer-auth/callback/apple',apple)).status,403);
    assert.equal((await call('/api/customer/profile',apple,'POST')).status,403);
  });
});

test('without configured origin only a local request or health probe is served',async () => {
  await exercise({NODE_ENV:'production'}, async call => {
    assert.equal((await call('/api/v1/stores')).status,200);
    assert.equal((await call('/api/v1/stores',secure)).status,503);
    assert.equal((await call('/api/v1/stores',{'X-Forwarded-For':'192.0.2.42'})).status,503);
  });
  for (const config of [
    {...setup, BOLT_PUBLIC_ORIGIN:'http://insecure.invalid'},
    {...setup, BOLT_PWA_ORIGINS:'https://*.example.test'},
    {...setup, BOLT_TRUSTED_PROXY_CIDRS:'0.0.0.0/0'},
    {...setup, BOLT_TRUSTED_PROXY_CIDRS:'true'},
  ]) assert.throws(() => mountProductionHttp(express(),config,false));
});

test('isolated demo delegates forwarded origins to the existing private gateway guard',async () => {
  await exercise({NODE_ENV:'production',BOLT_CUSTOMER_ORIGIN:canonical},async call => {
    const demo=await call('/api/customer/me',{ Origin:canonical });
    assert.equal(demo.status,200);
    assert.equal(demo.headers['access-control-allow-origin'],undefined);
  },true);
});
