import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { sql } from 'kysely';
import type { CustomerDB } from '../../src/customer/database';

const role = 'bolt_customer_app';
const scoped = ['customer_data', 'customer_imports', 'customer_order_links'];
const tables = [...scoped, 'customer_account', 'customer_audit', 'customer_deletions', 'customer_mail',
  'customer_rate_limit', 'customer_schema', 'customer_session', 'customer_user', 'customer_verification'].sort();
export type Action = 'status' | 'upgrade' | 'rollback';
type Artifact = {file: string; sha256: string};
type Evidence = {before: Schema; after: Schema; inventory: string; artifact: Artifact};
type Policy = {name: string; roles: string[]; command: string; qualifier: string; check: string; permissive: string};
type Relation = {name: string; owner: string; enabled: boolean; forced: boolean; policies: Policy[]};
type Schema = {version: number; migrated: string; relations: Relation[]};
type Services = {
  databaseName: string;
  backup: () => Promise<Artifact>;
  verifyBackup: (artifact: Artifact) => Promise<void>;
};
type Row = {id: string; state: 'upgraded' | 'rolled-back'; evidence: Evidence; checksum: string};

function check(condition: unknown, code: string): asserts condition {
  if (!condition) throw new Error(code);
}
function canonical(value: any): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
  return JSON.stringify(value);
}
const hash = (value: unknown) => createHash('sha256').update(canonical(value)).digest('hex');
const relation = (name: string) => sql.id('public', name);

async function readSchema(tx: CustomerDB): Promise<Schema> {
  const meta = (await sql<{version: number; migrated: string}>`select version, migrated_at::text as migrated from public.customer_schema where id=1`.execute(tx)).rows[0];
  check(meta && [1,2].includes(meta.version), 'DEMO_DB_UNSUPPORTED_SCHEMA');
  const relations = (await sql<Relation>`
    select c.relname as name, pg_get_userbyid(c.relowner) as owner, c.relrowsecurity as enabled, c.relforcerowsecurity as forced,
      coalesce((select jsonb_agg(jsonb_build_object('name',p.policyname,'roles',p.roles,'command',p.cmd,
        'qualifier',p.qual,'check',p.with_check,'permissive',p.permissive) order by p.policyname)
        from pg_catalog.pg_policies p where p.schemaname='public' and p.tablename=c.relname), '[]'::jsonb) as policies
    from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind='r' and c.relname in (${sql.join(tables)})
    order by c.relname collate "C"`.execute(tx)).rows;
  check(relations.length === tables.length && relations.every(t => t.owner === role && t.enabled), 'DEMO_DB_UNEXPECTED_TABLES');
  for (const t of relations) {
    const migrated = meta.version === 2 && scoped.includes(t.name);
    check(t.forced === migrated, 'DEMO_DB_UNEXPECTED_RLS');
    if (scoped.includes(t.name)) {
      const p = t.policies[0];
      check(migrated ? t.policies.length === 1 && p.name === 'bolt_authenticated_owner' &&
        p.roles.length === 1 && p.roles[0] === role && p.command === 'ALL' && p.permissive === 'PERMISSIVE' &&
        !!p.qualifier && p.qualifier === p.check : t.policies.length === 0, 'DEMO_DB_UNEXPECTED_POLICY');
    }
  }
  return {...meta, relations};
}

// Only a count and an aggregate SHA256 of salted row digests leave PostgreSQL. Each forced table is
// read under the same verified user context as the application, without suspending its policies.
async function inventory(tx: CustomerDB, version: number, salt: string) {
  const users = (await sql<{id: string}>`select id from public.customer_user order by id collate "C"`.execute(tx)).rows;
  const summaries: unknown[] = [];
  async function digestRows(table: string, user?: string) {
    const predicate = user === undefined ? sql`` : sql`where t.user_id = ${user}`;
    const {rows} = await sql<{n: number; digest: string}>`
      select count(*)::integer as n, encode(sha256(convert_to(coalesce(string_agg(h,'' order by h collate "C"),''),'UTF8')),'hex') as digest
      from (select encode(sha256(convert_to(${salt} || to_jsonb(t)::text,'UTF8')),'hex') as h from ${relation(table)} t ${predicate}) rows`.execute(tx);
    return rows[0];
  }
  for (const table of tables.filter(t => t !== 'customer_schema' && !scoped.includes(t))) summaries.push([table, await digestRows(table)]);
  const totals: Record<string, number> = Object.fromEntries(scoped.map(t => [t, 0]));
  for (const {id} of users) {
    await sql`select set_config('bolt.customer_id', ${id}, true)`.execute(tx);
    for (const table of scoped) {
      const summary = await digestRows(table, id);
      summaries.push([table, summary]);
      totals[table] += summary.n;
    }
  }
  await sql`select set_config('bolt.customer_id', '', true)`.execute(tx);
  if (version === 1) for (const t of scoped) {
    const count = (await sql<{n:number}>`select count(*)::integer as n from ${relation(t)}`.execute(tx)).rows[0].n;
    check(count === totals[t], 'DEMO_DB_UNSCOPED_ROWS');
  }
  return hash(summaries);
}

function validArtifact(file: Artifact) {
  return file && typeof file.file === 'string' && !!file.file && /^[a-f0-9]{64}$/.test(file.sha256);
}
async function receipt(tx: CustomerDB) {
  const exists = (await sql<{name:string|null}>`select to_regclass('public.bolt_demo_account_release')::text as name`.execute(tx)).rows[0].name;
  if (!exists) return undefined;
  const row = (await sql<Row>`select id::text, state, evidence, checksum from public.bolt_demo_account_release order by id desc limit 1`.execute(tx)).rows[0];
  check(row && ['upgraded','rolled-back'].includes(row.state) && hash(row.evidence) === row.checksum && validArtifact(row.evidence.artifact), 'DEMO_DB_BACKUP_RECEIPT_INVALID');
  return row;
}

export async function demoDBTransition(db: CustomerDB, action: Action, services: Services) {
  return db.transaction().execute(async tx => {
    await sql`set local lock_timeout='12s'`.execute(tx);
    await sql`set local time zone 'UTC'`.execute(tx);
    await sql`set local search_path=pg_catalog, public`.execute(tx);
    const identity = (await sql<{name:string; account:string; restricted:boolean}>`
      select current_database() as name, current_user::text as account,
        not (rolsuper or rolbypassrls or rolcreaterole or rolcreatedb or rolreplication) as restricted
      from pg_catalog.pg_roles where rolname=current_user`.execute(tx)).rows[0];
    check(identity?.name === services.databaseName && identity.account === role && identity.restricted, 'DEMO_DB_WRONG_IDENTITY');
    await sql`select pg_advisory_xact_lock(164081173)`.execute(tx);
    if (action !== 'status') await sql`lock table ${sql.join(tables.map(relation))} in share row exclusive mode`.execute(tx);
    const before = await readSchema(tx);
    const saved = await receipt(tx);
    if (action === 'status') return {version: before.version, receipt: saved?.state ?? 'none'};
    if (before.version === 2) {
      check(saved?.state === 'upgraded' && hash(saved.evidence.after) === hash(before), 'DEMO_DB_V2_NOT_OWNED');
      await services.verifyBackup(saved.evidence.artifact);
      if (action === 'upgrade') return {version: 2, receipt: 'already-upgraded'};
      const digest = await inventory(tx, 2, saved.evidence.artifact.sha256);
      for (const t of scoped) {
        await sql`drop policy bolt_authenticated_owner on ${relation(t)}`.execute(tx);
        await sql`alter table ${relation(t)} no force row level security`.execute(tx);
      }
      await sql`update public.customer_schema set version=1, migrated_at=${saved.evidence.before.migrated}::timestamptz where id=1 and version=2`.execute(tx);
      check(hash(await readSchema(tx)) === hash(saved.evidence.before), 'DEMO_DB_ROLLBACK_SHAPE_MISMATCH');
      check(await inventory(tx, 1, saved.evidence.artifact.sha256) === digest, 'DEMO_DB_ROLLBACK_DATA_MISMATCH');
      await sql`update public.bolt_demo_account_release set state='rolled-back', reverted_at=now(), rollback_inventory=${digest} where id=${saved.id}`.execute(tx);
      return {version: 1, receipt: 'rolled-back'};
    }
    if (saved) {
      check(saved.state === 'rolled-back' && hash(saved.evidence.before) === hash(before), 'DEMO_DB_V1_DRIFT');
      if (action === 'rollback') {
        await services.verifyBackup(saved.evidence.artifact);
        return {version: 1, receipt: 'already-rolled-back'};
      }
    }
    check(action === 'upgrade', 'DEMO_DB_NO_UPGRADE_TO_REVERSE');
    const artifact = await services.backup();
    check(validArtifact(artifact), 'DEMO_DB_INVALID_BACKUP');
    await services.verifyBackup(artifact);
    const digest = await inventory(tx, 1, artifact.sha256);
    await sql.raw(readFileSync(new URL('./002-user-scope.sql', import.meta.url), 'utf8')).execute(tx);
    const after = await readSchema(tx);
    check(after.version === 2 && await inventory(tx, 2, artifact.sha256) === digest, 'DEMO_DB_UPGRADE_DATA_MISMATCH');
    const evidence = {before, after, artifact, inventory: digest};
    if (!saved) {
      await sql`create table public.bolt_demo_account_release (
        id bigint generated always as identity primary key, state text not null check (state in ('upgraded','rolled-back')),
        evidence jsonb not null, checksum text not null, applied_at timestamptz not null default now(), reverted_at timestamptz,
        rollback_inventory text)`.execute(tx);
      await sql`revoke all on public.bolt_demo_account_release from public`.execute(tx);
    }
    await sql`insert into public.bolt_demo_account_release (state,evidence,checksum) values ('upgraded',${JSON.stringify(evidence)}::jsonb,${hash(evidence)})`.execute(tx);
    return {version: 2, receipt: 'upgraded'};
  });
}

export function railwayDemoDatabaseTarget(env: NodeJS.ProcessEnv) {
  check(env.BOLT_DEMO_CUSTOMER_ACCOUNTS === '1', 'DEMO_DB_NOT_ENABLED');
  const url = new URL(env.BOLT_CUSTOMER_DATABASE_URL || '');
  check(['postgresql:', 'postgres:'].includes(url.protocol) && url.hostname.endsWith('.railway.internal') &&
    url.pathname === '/bolt_customers_demo' && url.username === role && !!url.password &&
    [...url.searchParams.keys()].every(key => key === 'sslmode'), 'DEMO_DB_WRONG_TARGET');
  return url.toString();
}
