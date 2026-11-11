/** One-time, explicit provisioning of the newly authorized private demo database. */
import { Pool } from 'pg';
import { connectCustomerDatabase } from '../../src/customer/database';
import { applyCustomerMigration } from '../../src/customer/migration';
const env=process.env;
if (env.BOLT_CUSTOMER_PROVISION_DEMO !== '1') {
  console.log('Customer database provisioning disabled; no database writes.');
} else {
  if (!process.argv.includes('--apply')) throw Error('Explicit --apply required');
  const admin=env.BOLT_CUSTOMER_BOOTSTRAP_DATABASE_URL, target=env.BOLT_CUSTOMER_DATABASE_URL;
  if (!admin || !target) throw Error('Configure private bootstrap and application connection references');
  const sourceURL=new URL(admin),appURL=new URL(target);
  if (sourceURL.hostname!==appURL.hostname || !appURL.hostname.endsWith('.railway.internal') || appURL.pathname!=='/bolt_customers_demo' || sourceURL.pathname!==appURL.pathname || appURL.username!=='bolt_customer_app')
    throw Error('Provisioning is restricted to the dedicated Railway private demo database');
  const password=decodeURIComponent(appURL.password);
  if (!/^[A-Za-z0-9_-]{40,}$/.test(password)) throw Error('Use a strong dedicated generated credential');
  // Railway private networking encrypts this channel. No public TCP proxy is used.
  const pool=new Pool({connectionString:admin,connectionTimeoutMillis:10000,max:1});
  const client=await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('select pg_advisory_xact_lock(164081174)');
    const roles=await client.query("select rolsuper,rolcreaterole,rolcreatedb,rolbypassrls from pg_roles where rolname='bolt_customer_app'");
    if (!roles.rowCount) await client.query(`CREATE ROLE bolt_customer_app LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS`);
    else if (Object.values(roles.rows[0]).some(Boolean)) throw Error('Existing application role has unexpected privileges');
    await client.query('REVOKE ALL ON DATABASE bolt_customers_demo FROM PUBLIC');
    await client.query('GRANT CONNECT ON DATABASE bolt_customers_demo TO bolt_customer_app');
    await client.query('REVOKE ALL ON SCHEMA public FROM PUBLIC');
    await client.query('GRANT USAGE, CREATE ON SCHEMA public TO bolt_customer_app');
    await client.query('COMMIT');
  } catch { await client.query('ROLLBACK'); throw Error('Private demo role provisioning failed; inspect configuration without logging credentials'); }
  finally {client.release();await pool.end();}
  const db=connectCustomerDatabase(target);
  try {console.log('Dedicated demo customer role ready; schema v1:',await applyCustomerMigration(db));}
  catch {throw Error('Customer schema provisioning failed; operational order storage was not modified');}
  finally {await db.destroy();}
}
