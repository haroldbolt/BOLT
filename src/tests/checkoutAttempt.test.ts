import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';
import type { Express, Request, Response } from 'express';
import { checkoutVerifier, mountCheckoutAttempt, sameCheckoutAttempt } from '../lib/checkoutAttempt';
import type { Order } from '../types';

function fixture(headers: Record<string,string> = {}, split = '', local = false) {
  const req = {hostname:local ? '127.0.0.1' : 'bolt.example.invalid',secure:!local,get:(name:string)=>headers[name.toLowerCase()]} as Request;
  let issued: {name:string; value:string; options:Record<string,unknown>} | undefined;
  let body: {proof:string} | undefined;
  const res = {
    locals: { authorizedPwaOrigin:split || undefined },
    cookie(name:string,value:string,options:Record<string,unknown>) { issued={name,value,options}; },
    status() { return this; }, end() {}, json(value:{proof:string}) { body=value; },
  } as unknown as Response;
  return {req,res,issued:()=>issued,body:()=>body};
}

test('una sesión de compra de primera parte se prepara con cookie privada y conserva su valor al reintentar', () => {
  let prepare!: (req:Request,res:Response)=>void;
  mountCheckoutAttempt({post:(_path:string,route:typeof prepare)=>{prepare=route;}} as Express);
  const created=fixture(); prepare(created.req,created.res);
  const cookie=created.issued()!;
  assert.equal(cookie.name,'__Host-bolt_checkout_attempt');
  assert.deepEqual(cookie.options,{httpOnly:true,secure:true,sameSite:'strict',path:'/',maxAge:86400000});
  assert.equal(created.body(),undefined);
  const retry=fixture({cookie:cookie.name+'='+cookie.value});prepare(retry.req,retry.res);
  assert.equal(retry.issued(),undefined);
  const verifier=checkoutVerifier(retry.req,retry.res,'purchase-1');
  const order={createdAt:new Date().toISOString(),checkoutAttemptVerifier:verifier} as Order;
  assert.equal(sameCheckoutAttempt(order,verifier),true);
  assert.equal(sameCheckoutAttempt(order,checkoutVerifier(retry.req,retry.res,'purchase-2')),false);
  assert.equal(sameCheckoutAttempt({} as Order,verifier),false);
  assert.equal(sameCheckoutAttempt({...order, createdAt:new Date(Date.now()-86400001).toISOString()}, verifier),false);
});

test('la PWA de origen separado conserva su permiso solo para ese origen, navegador e intento', () => {
  const proof=randomBytes(32).toString('base64url'),headers={'x-bolt-checkout-proof':proof};
  const split=fixture(headers,'https://cliente.example.invalid');
  const order={createdAt:new Date().toISOString(),checkoutAttemptVerifier:checkoutVerifier(split.req,split.res,'purchase-1')} as Order;
  assert.equal(sameCheckoutAttempt(order,checkoutVerifier(split.req,split.res,'purchase-1')),true);
  for (const different of [fixture(headers),fixture(headers,'https://otra.example.invalid'),fixture({},'https://cliente.example.invalid')]) {
    assert.equal(sameCheckoutAttempt(order,checkoutVerifier(different.req,different.res,'purchase-1')),false);
  }
});

test('confirmaciones concurrentes del mismo carrito reutilizan el intento y una compra posterior obtiene otro', async t => {
  const { prepareCheckout, finishCheckout } = await import('../lib/checkoutAttemptClient');
  const saved = new Map<string, PropertyDescriptor | undefined>();
  for (const k of ['localStorage','sessionStorage','fetch']) saved.set(k,Object.getOwnPropertyDescriptor(globalThis,k));
  t.after(()=>{
    for (const [k,descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis,k,descriptor);
      else Reflect.deleteProperty(globalThis,k);
    }
  });
  for (const k of ['localStorage','sessionStorage']) {
    const values=new Map<string,string>();
    Object.defineProperty(globalThis,k,{configurable:true,value:{
      getItem:(key:string)=>values.get(key) ?? null,
      setItem:(key:string,value:string)=>values.set(key,value),
      removeItem:(key:string)=>values.delete(key),
    }});
  }
  Object.defineProperty(globalThis,'fetch',{configurable:true,value:async (path:string,options:RequestInit)=>{
    assert.equal(path,'/api/v1/checkout/attempt');
    assert.equal(options.method,'POST');
    return new Response(null,{status:204});
  }});
  const [first,retry]=await Promise.all([prepareCheckout('fixture-cart'),prepareCheckout('fixture-cart')]);
  assert.equal(first['Idempotency-Key'],retry['Idempotency-Key']);
  assert.deepEqual(Object.keys(first),['Idempotency-Key']);
  finishCheckout(first['Idempotency-Key']);
  const next=await prepareCheckout('fixture-cart');
  assert.notEqual(first['Idempotency-Key'],next['Idempotency-Key']);
  finishCheckout(next['Idempotency-Key']);
});

test('un conflicto conserva el intento hasta que el cliente decide preparar otra compra', async t => {
  const { api } = await import('../lib/api');
  const { CheckoutAttemptNeedsReview, finishCheckout } = await import('../lib/checkoutAttemptClient');
  const saved=Object.getOwnPropertyDescriptor(globalThis,'fetch')!;
  t.after(()=>Object.defineProperty(globalThis,'fetch',saved));
  const submitted:string[]=[];
  Object.defineProperty(globalThis,'fetch',{configurable:true,value:async (path:string,options:RequestInit)=>{
    if (path==='/api/v1/checkout/attempt') return new Response(null,{status:204});
    assert.equal(path,'/api/v1/orders');
    const key=new Headers(options.headers).get('Idempotency-Key')!;
    submitted.push(key);
    return Response.json({code:'CHECKOUT_REVIEW_REQUIRED',error:'Revisa la confirmación.'},{status:409});
  }});
  const payload={items:[{productId:'fixture',quantity:1}]};
  await assert.rejects(api.createOrder(payload),CheckoutAttemptNeedsReview);
  await assert.rejects(api.createOrder(payload),CheckoutAttemptNeedsReview);
  assert.equal(submitted[0],submitted[1]);
  finishCheckout(submitted[0]);
  assert.equal(submitted.length,2,'Preparar otra compra nunca crea un pedido.');
  await assert.rejects(api.createOrder(payload),CheckoutAttemptNeedsReview);
  assert.notEqual(submitted[2],submitted[1]);
  finishCheckout(submitted[2]);
});
