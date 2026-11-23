import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import { withTemporaryPostgres, backupDemoDatabase } from './demo-db-backup.mjs';
import { demoDBTransition } from '../scripts/customer/demo-db-transition.ts';
import { withCustomerScope } from '../src/customer/database.ts';

const directory = await mkdtemp(path.join(tmpdir(), 'bolt-roundtrip-'));
const role = 'bolt_customer_app';
const databaseName = 'bolt_customers_demo';
const fictitiousUser = id => ({ id, name: 'Prueba', email: id + '@fixture.invalid',
  emailVerified: true, legalReceipt: '{}', deletionPending: false });

try {
  await withTemporaryPostgres(async (local, run) => {
    run('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-c', 'CREATE ROLE bolt_customer_app LOGIN']);
    run('createdb', ['--owner', role, databaseName]);
    const localOwner = { ...local, PGDATABASE: databaseName, PGUSER: role };
    for (const file of ['001-auth.sql', '001-data.sql']) {
      const script = fileURLToPath(new URL('../scripts/customer/' + file, import.meta.url));
      run('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-f', script], localOwner);
    }
    const db = new Kysely({dialect: new PostgresDialect({
      pool: new Pool({host: local.PGHOST, port: Number(local.PGPORT), database: databaseName, user: role}),
    })});
    const connectionString = 'postgresql://' + role + '@' + encodeURIComponent(local.PGHOST) + '/' + databaseName;
    const services = {
      databaseName,
      backup: () => backupDemoDatabase({ connectionString, directory }),
      verifyBackup: async ({file, sha256}) => {
        assert.equal(path.dirname(file), directory);
        assert.equal(createHash('sha256').update(await readFile(file)).digest('hex'), sha256);
      },
    };
    try {
      await db.insertInto('customer_user').values(fictitiousUser('before')).execute();
      await db.insertInto('customer_data').values({user_id: 'before', revision: 1}).execute();
      assert.deepEqual(await demoDBTransition(db, 'upgrade', services), {version: 2, receipt: 'upgraded'});
      assert.deepEqual(await demoDBTransition(db, 'upgrade', services), {version: 2, receipt: 'already-upgraded'});
      assert.equal((await readdir(directory)).length, 1);
      await db.insertInto('customer_user').values(fictitiousUser('after')).execute();
      await withCustomerScope(db, 'before', tx => tx.updateTable('customer_data').set({revision: 2}).execute());
      await withCustomerScope(db, 'after', async tx => {
        await tx.insertInto('customer_data').values({user_id: 'after', revision: 3}).execute();
        await tx.insertInto('customer_order_links').values({user_id: 'after', order_id: 'fixture-link', evidence: 'guest-capability'}).execute();
        assert.deepEqual(await tx.selectFrom('customer_data').select('user_id').execute(), [{user_id: 'after'}]);
      });
      assert.deepEqual(await demoDBTransition(db, 'rollback', services), {version: 1, receipt: 'rolled-back'});
      assert.deepEqual(await demoDBTransition(db, 'rollback', services), {version: 1, receipt: 'already-rolled-back'});
      const changes = await db.selectFrom('customer_data').select(['user_id','revision']).orderBy('user_id').execute();
      assert.deepEqual(changes, [{user_id: 'after', revision: 3}, {user_id: 'before', revision: 2}]);
      assert.deepEqual(await db.selectFrom('customer_order_links').select('order_id').execute(), [{order_id:'fixture-link'}]);
      console.log('PASS PostgreSQL 18 nativo · copia restaurada · RLS · reintentos · reversión con datos posteriores.');
    } finally {
      await db.destroy();
    }
  });
} finally {
  await rm(directory, {recursive: true, force: true});
}
