import { test } from 'node:test';
import assert from 'node:assert/strict';
import { providerQuota, providerRouteLimit } from '../lib/providerQuota';
import type { Request, Response } from 'express';

test('El cupo total y por identidad es conjunto, acotado y se renueva al minuto', () => {
  let now = Date.UTC(2026, 10, 20, 15);
  const quota = providerQuota('WOMPI', {
    BOLT_WOMPI_PER_IDENTITY_PER_MINUTE:'1', BOLT_WOMPI_TOTAL_PER_MINUTE:'2', BOLT_WOMPI_MAX_CONCURRENT:'1',
  }, () => now);
  const a = quota.take(['ip:a','staff:a']);
  assert.ok('release' in a);
  assert.deepEqual(quota.take(['ip:b']), { retryAfter:1 });
  a.release(); a.release();
  assert.deepEqual(quota.take(['ip:b','staff:a']), { retryAfter:60 });
  const b = quota.take(['ip:b','staff:b']); assert.ok('release' in b); b.release();
  assert.deepEqual(quota.take(['ip:c','staff:c']), { retryAfter:60 });
  now += 60000;
  const next = quota.take(['ip:a','staff:a']); assert.ok('release' in next); next.release();
});

test('Medianoche colombiana renueva el presupuesto; el llamador recibe la espera restante', () => {
  let now = Date.UTC(2026, 10, 20, 4, 59, 50);
  const quota = providerQuota('GEOCODE',{BOLT_GEOCODE_DAILY_LIMIT:'1'},()=>now);
  const a = quota.take(['ip:a']); assert.ok('release' in a); a.release();
  assert.deepEqual(quota.take(['ip:a']), {retryAfter:10});
  now += 10000;
  const b = quota.take(['ip:b']); assert.ok('release' in b); b.release();
});

test('Solicitud rechazada no ejecuta la operación de pago; principal verificado comparte cupo entre IP', async () => {
  const limit=providerRouteLimit('WOMPI',{BOLT_WOMPI_PER_IDENTITY_PER_MINUTE:'1'});
  const res = { locals:{rateLimitPrincipal:'server-verified'}, code:200, headers:{} as Record<string,string>,
    status(code:number){this.code=code;return this}, set(headers:Record<string,string>){this.headers=headers;return this}, json(){return this} };
  let upstream=0;
  const call = (ip:string) => limit({ip} as Request,res as unknown as Response,async()=>{ ++upstream; });
  await call('192.0.2.1'); await call('192.0.2.2');
  assert.equal(upstream,1); assert.equal(res.code,429); assert.ok(Number(res.headers['Retry-After'])>0);
});
