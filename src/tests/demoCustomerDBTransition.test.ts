import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { sql } from 'kysely';
import { demoDBTransition, railwayDemoDatabaseTarget } from '../../scripts/customer/demo-db-transition';
import { fixtureDatabase } from './customer/fixture';
import { withCustomerScope } from '../customer/database';

const url = 'postgresql://bolt_customer_app:fake@postgres.railway.internal/bolt_customers_demo';
const cfg = {BOLT_DEMO_CUSTOMER_ACCOUNTS: '1', BOLT_CUSTOMER_DATABASE_URL: url};
assert.equal(railwayDemoDatabaseTarget(cfg), url);
for (const target of [url.replace('.railway.internal','.example.com'),url.replace('bolt_customers_demo','production'),
  url.replace('bolt_customer_app','postgres'), url + '?options=unsafe']) assert.throws(() => railwayDemoDatabaseTarget({...cfg, BOLT_CUSTOMER_DATABASE_URL: target}));
const db = fixtureDatabase();
let backups = 0, badBackup = false;
const services = {databaseName:'postgres', backup: async () => { backups++; return {file:'isolated.dump', sha256:'f'.repeat(64)}; },
  verifyBackup: async () => { if (badBackup) throw Error('fixture damaged'); }};
async function user(id: string) {
  await db.insertInto('customer_user').values({id, name:id, email:id+'@fixture.invalid', emailVerified:true, createdAt:new Date(), updatedAt:new Date(), legalReceipt:'{}', deletionPending:false}).execute();
}
try {
  await assert.rejects(demoDBTransition(db,'status',services), /WRONG_IDENTITY/);
  await sql.raw('CREATE ROLE bolt_customer_app; GRANT CREATE ON SCHEMA public TO bolt_customer_app; SET ROLE bolt_customer_app').execute(db);
  await assert.rejects(demoDBTransition(db,'status',{...services,databaseName:'wrong'}), /WRONG_IDENTITY/);
  for (const file of ['001-auth','001-data']) await sql.raw(readFileSync(new URL('../../scripts/customer/'+file+'.sql',import.meta.url),'utf8')).execute(db);
  await user('existing');
  await db.insertInto('customer_data').values({user_id:'existing',revision:2}).execute();
  assert.deepEqual(await demoDBTransition(db,'status',services), {version:1,receipt:'none'});
  badBackup = true;
  await assert.rejects(demoDBTransition(db,'upgrade',services), /damaged/);
  assert.deepEqual(await demoDBTransition(db,'status',services), {version:1,receipt:'none'});
  badBackup = false;
  assert.deepEqual(await demoDBTransition(db,'upgrade',services), {version:2,receipt:'upgraded'});
  assert.deepEqual(await demoDBTransition(db,'upgrade',services), {version:2,receipt:'already-upgraded'});
  assert.equal(backups, 2);
  assert.deepEqual(await db.selectFrom('customer_data').select('user_id').execute(), []);
  await user('new');
  await withCustomerScope(db,'new',async tx => {
    await tx.insertInto('customer_data').values({user_id:'new', revision:3}).execute();
    await tx.insertInto('customer_order_links').values({order_id:'fictitious-order', user_id:'new', evidence:'guest-capability'}).execute();
  });
  await withCustomerScope(db,'existing',tx => tx.updateTable('customer_data').set({revision:4}).where('user_id','=','existing').execute());
  await sql.raw('CREATE POLICY fixture_drift ON customer_data FOR SELECT USING(false)').execute(db);
  await assert.rejects(demoDBTransition(db,'rollback',services), /UNEXPECTED_POLICY/);
  await sql.raw('DROP POLICY fixture_drift ON customer_data').execute(db);
  badBackup = true;
  await assert.rejects(demoDBTransition(db,'rollback',services), /damaged/);
  assert.deepEqual(await demoDBTransition(db,'status',services), {version:2,receipt:'upgraded'});
  badBackup = false;
  assert.deepEqual(await demoDBTransition(db,'rollback',services), {version:1,receipt:'rolled-back'});
  assert.deepEqual(await demoDBTransition(db,'rollback',services), {version:1,receipt:'already-rolled-back'});
  assert.deepEqual(await db.selectFrom('customer_data').select(['user_id','revision']).orderBy('user_id').execute(),
    [{user_id:'existing',revision:4},{user_id:'new',revision:3}]);
  assert.equal((await db.selectFrom('customer_order_links').selectAll().execute())[0].order_id, 'fictitious-order');
  assert.deepEqual(await demoDBTransition(db,'upgrade',services), {version:2,receipt:'upgraded'});
  assert.equal(backups, 3);
  console.log('PASS esquema demo v1 → v2 → v1 → v2, respaldo verificado antes del cambio, reintentos, rechazo de deriva y conservación de altas, actualizaciones y vinculaciones posteriores.');
} finally { await db.destroy(); }
