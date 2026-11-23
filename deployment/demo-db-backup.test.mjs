import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { backupDemoDatabase, verifyArchive, withTemporaryPostgres } from './demo-db-backup.mjs';

const source = fileURLToPath(new URL('../', import.meta.url));
const postgresBin = process.env.BOLT_TEST_PG_BIN || undefined;
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'bolt-backup-test-'));
try {
  await withTemporaryPostgres(async (local, run) => {
    run('psql', ['-Xq', '-v', 'ON_ERROR_STOP=1', '-c', 'CREATE ROLE bolt_customer_app LOGIN NOSUPERUSER NOBYPASSRLS']);
    run('createdb', ['--owner=bolt_customer_app', 'bolt_customers_demo']);
    const owner = { ...local, PGUSER: 'bolt_customer_app', PGDATABASE: 'bolt_customers_demo' };
    for (const name of ['001-auth.sql', '001-data.sql']) {
      run('psql', ['-Xq', '-v', 'ON_ERROR_STOP=1', '-f', path.join(source, 'scripts/customer', name)], owner);
    }
    run('psql', ['-Xq', '-v', 'ON_ERROR_STOP=1', '-c',
      "INSERT INTO customer_audit (id,subject_hash,event,evidence) VALUES ('round-trip-fixture','synthetic','fixture','{}')"], owner);
    const connectionString = 'postgresql://bolt_customer_app@' + encodeURIComponent(local.PGHOST) + '/bolt_customers_demo';
    const directory = path.join(scratch, 'backups');
    const backup = await backupDemoDatabase({ connectionString, directory, postgresBin });
    assert.equal(fs.statSync(directory).mode & 0o777, 0o700);
    assert.equal(fs.statSync(backup.file).mode & 0o777, 0o600);
    assert.equal(createHash('sha256').update(fs.readFileSync(backup.file)).digest('hex'), backup.sha256);
    assert.deepEqual(fs.readdirSync(directory), [path.basename(backup.file)]);

    run('createdb', ['--owner=bolt_customer_app', 'verification']);
    const restore = { ...local, PGDATABASE: 'verification' };
    run('pg_restore', ['--exit-on-error', '--single-transaction', '--dbname=verification', backup.file], restore);
    const check = sql => run('psql', ['-XAt', '-v', 'ON_ERROR_STOP=1', '-c', sql], restore, { capture: true });
    assert.equal(check("SELECT count(*) FROM customer_audit WHERE id='round-trip-fixture'"), '1');
    assert.equal(check("SELECT pg_get_userbyid(relowner) || ':' || relrowsecurity::text FROM pg_class WHERE oid='customer_data'::regclass"), 'bolt_customer_app:true');
    const broken = path.join(scratch, 'incomplete.dump');
    const bytes = fs.readFileSync(backup.file);
    fs.writeFileSync(broken, bytes.subarray(0, Math.floor(bytes.length / 2)), { mode: 0o600 });
    await assert.rejects(verifyArchive(broken, postgresBin));
    console.log('PASS PostgreSQL: restauración de datos, esquema y RLS, permisos, SHA-256 y rechazo de copia truncada.');
  }, postgresBin);
} finally {
  fs.rmSync(scratch, { recursive: true, force: true });
}
