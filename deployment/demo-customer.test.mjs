import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import {once} from 'node:events';
import {createDemoGateway} from './demo-gateway.mjs';
import {demoCustomerEnvironment} from './customer-environment.mjs';
const origin='https://demo.example',password=crypto.randomBytes(32).toString('hex'),sessionKey=crypto.randomBytes(48).toString('hex');
const env={BOLT_DEMO_CUSTOMER_ACCOUNTS:'1',BOLT_CUSTOMER_ORIGIN:origin,BOLT_CUSTOMER_SECRET:sessionKey,BOLT_CUSTOMER_DATABASE_URL:'postgres://fixture.invalid',BOLT_DEMO_PASSWORD:password,SHOPIFY_TOKEN:'must-not-pass',BOLT_UNRELATED_SECRET:'must-not-pass'};
assert.equal(demoCustomerEnvironment({...env,BOLT_DEMO_CUSTOMER_ACCOUNTS:'0'},origin).enabled,false);
assert.throws(()=>demoCustomerEnvironment(env,'https://different.example'));
const child=demoCustomerEnvironment(env,origin);assert.equal(child.env.BOLT_DEMO_PASSWORD,undefined);assert.equal(child.env.SHOPIFY_TOKEN,undefined);assert.equal(child.env.BOLT_UNRELATED_SECRET,undefined);
const listen=async s=>{s.listen(0,'127.0.0.1');await once(s,'listening');return s.address().port};
let forwarded,backendCalls=0;
const backend=http.createServer((req,res)=>{backendCalls++;forwarded=req.headers;res.setHeader('Set-Cookie',[
 '__Secure-bolt_customer.session_token=fixture; Path=/; Secure; HttpOnly; SameSite=Lax',
 '__Secure-bolt_customer.state=fixture-state; Path=/; Secure; HttpOnly; SameSite=None',
 '__Host-bolt_demo=must-not-pass; Path=/; Secure; HttpOnly',
 '__Secure-bolt_customer.session_token=invalid; Domain=evil.invalid; Path=/; Secure; HttpOnly',
 'other_session=must-not-pass; Path=/; Secure; HttpOnly']);res.end('{}')});
const upstreamPort=await listen(backend),gateway=createDemoGateway({origin,password,sessionKey,upstreamPort,customerAuth:{enabled:true,google:true,apple:true}}),port=await listen(gateway);
const call=(path,method='GET',headers={},body='')=>new Promise((resolve,reject)=>{const req=http.request({hostname:'127.0.0.1',port,path,method,headers:{Host:'demo.example',...headers}},res=>{let text='';res.on('data',b=>text+=b);res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,text}))});req.on('error',reject);req.end(body)});
try{
 assert.equal((await call('/api/customer/me')).status,401);
 const tokenPath='/cuenta?token=PRIVATE-FIXTURE';const page=await call(tokenPath);assert.equal(page.status,200);
 assert.ok(!page.text.includes('PRIVATE-FIXTURE'));
 const continuation=page.headers['set-cookie'][0].split(';')[0];assert.ok(!continuation.includes('PRIVATE-FIXTURE'));
 const login=await call('/__demo/login','POST',{Origin:origin,Cookie:continuation},new URLSearchParams({password}).toString());
 assert.equal(login.headers.location,tokenPath);assert.match(login.headers['set-cookie'][0],/SameSite=Lax/);
 const gate=login.headers['set-cookie'][0].split(';')[0];
 const cookies=gate+'; __Secure-bolt_customer.session_token=fixture; admin_cookie=private; other_cookie=private';
 const me=await call('/api/customer/me','GET',{Cookie:cookies,Origin:origin,'X-Forwarded-Host':'evil.invalid'});
 assert.equal(me.status,200);assert.equal(forwarded.cookie,'__Secure-bolt_customer.session_token=fixture');assert.equal(forwarded.origin,origin);assert.equal(forwarded['x-forwarded-host'],undefined);assert.equal(me.headers['set-cookie'].length,2);
 await call('/api/v1/orders','POST',{Cookie:cookies,Origin:origin},'{}');assert.equal(forwarded.cookie,'__Secure-bolt_customer.session_token=fixture');
 const admin=await call('/api/v1/admin/dispatch','GET',{Cookie:cookies});assert.equal(forwarded.cookie,undefined);assert.equal(admin.headers['set-cookie'],undefined);
 const before=backendCalls;
 assert.equal((await call('/api/customer/profile','POST',{Cookie:cookies,Origin:'https://appleid.apple.com'},'{}')).status,403);
 assert.equal((await call('/api/customer-auth/callback/apple/extra','POST',{Origin:'https://appleid.apple.com'},'state=x')).status,403);
 assert.equal((await call('/api/customer-auth/callback/apple','POST',{Origin:'https://evil.invalid'},'state=x')).status,403);
 assert.equal(backendCalls,before);
 assert.equal((await call('/api/customer-auth/callback/apple','POST',{Origin:'https://appleid.apple.com',Cookie:'__Secure-bolt_customer.state=fixture-state'},'state=x')).status,200);
 assert.equal(forwarded.origin,'https://appleid.apple.com');assert.equal(forwarded.cookie,'__Secure-bolt_customer.state=fixture-state');
 assert.equal((await call('/api/customer-auth/callback/google?state=fixture','GET',{})).status,200);
 const tampered=await call('/__demo/login','POST',{Origin:origin,Cookie:continuation+'tamper'},new URLSearchParams({password}).toString());assert.equal(tampered.headers.location,'/__demo');
 assert.equal((await call('//evil.invalid/cuenta')).headers['set-cookie'],undefined);
 console.log('PASS customer gateway: narrow cookie forwarding, origin/CSRF, exact callbacks, encrypted email continuation, tampering, no open redirects, env isolation. OAuth state is separately verified by integration suite.');
}finally{gateway.closeAllConnections();backend.closeAllConnections();gateway.close();backend.close();}
