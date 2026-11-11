/** Isolated provider contract: no real email or credentials. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { sql } from 'kysely';
import { fixtureDatabase } from './customer/fixture';
import { customerMailer } from '../customer/mail';
import { readCustomerConfig, customerEmailConfigured } from '../customer/config';
const config = readCustomerConfig({ NODE_ENV:'production', BOLT_CUSTOMER_ORIGIN:'https://demo.example', BOLT_CUSTOMER_DATABASE_URL:'postgres://fixture.invalid/isolated', BOLT_CUSTOMER_SECRET:'ISOLATED'.repeat(8), BOLT_RESEND_API_KEY:'ISOLATED-API-KEY', BOLT_CUSTOMER_MAIL_FROM:'BOLT <test@example.invalid>' })!;
assert.equal(customerEmailConfigured(config),true);
assert.equal(config.legalApproved,false);
assert.equal(config.smtp,undefined);
assert.equal(customerEmailConfigured(null),false);
const db=fixtureDatabase();
for(const file of ['001-auth.sql','001-data.sql'])await sql.raw(fs.readFileSync(`scripts/customer/${file}`,'utf8')).execute(db);
const realFetch=globalThis.fetch; const calls:any[]=[]; let fails=true;
globalThis.fetch=async(input,init)=>{
 assert.equal(input,'https://api.resend.com/emails');assert.equal(init?.redirect,'error');assert.ok(init?.signal);
 const headers=new Headers(init?.headers);assert.equal(headers.get('Authorization'),'Bearer ISOLATED-API-KEY');
 calls.push({key:headers.get('Idempotency-Key'),body:JSON.parse(String(init?.body))});
 return fails?new Response('DO NOT LOG provider response with private details',{status:503}):Response.json({id:'fixture-mail-id'});
};
try{
 const mailer=customerMailer(config,db);
 await assert.rejects(mailer.enqueue({to:'test@example.invalid',subject:'fixture',url:'https://evil.invalid/secret'}));
 await mailer.enqueue({to:'test@example.invalid',subject:'Verify fixture',url:'https://demo.example/api/customer-auth/verify-email?token=PRIVATE-FIXTURE'});
 let row=await db.selectFrom('customer_mail').selectAll().executeTakeFirstOrThrow();
 assert.ok(!row.encrypted_payload.includes('PRIVATE-FIXTURE'));assert.ok(!row.encrypted_payload.includes('test@example.invalid'));
 await mailer.drain();row=await db.selectFrom('customer_mail').selectAll().executeTakeFirstOrThrow();assert.equal(row.attempts,1);
 await db.updateTable('customer_mail').set({next_attempt:new Date(0)}).execute();fails=false;
 // A new worker after a restart uses the same persisted idempotency key.
 await customerMailer(config,db).drain();assert.equal(calls.length,2);assert.equal(calls[0].key,calls[1].key);assert.deepEqual(calls[0].body,calls[1].body);
 assert.equal((await db.selectFrom('customer_mail').selectAll().execute()).length,0);
 await mailer.enqueue({to:'test@example.invalid',subject:'Expired',url:'https://demo.example/cuenta'});
 await db.updateTable('customer_mail').set({created_at:new Date(Date.now()-86400001)}).execute();await mailer.drain();assert.equal(calls.length,2);
 console.log('PASS HTTPS mail: configuration, encrypted queue, fixed endpoint, retry/restart idempotency, expiration and no invented legal approval.');
}finally{globalThis.fetch=realFetch;await db.destroy();}
