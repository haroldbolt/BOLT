import assert from "node:assert/strict";
import { sql } from "kysely";
import { readFileSync } from "node:fs";
import { fixtureDatabase } from "./customer/fixture";
import { applyCustomerMigration } from "../customer/migration";
const db = fixtureDatabase();
try {
  await assert.rejects(
    applyCustomerMigration(db, () => {
      throw Error("fixture interruption");
    }),
  );
  assert.equal(
    (
      await sql<{
        name: string | null;
      }>`select to_regclass('customer_user') as name`.execute(db)
    ).rows[0].name,
    null,
  );
  console.log("PASS interrupted schema migration rolls back all tables");
  assert.equal(await applyCustomerMigration(db), "applied");
  await db
    .insertInto("customer_user")
    .values({
      id: "fixture-preserve",
      name: "Fixture",
      email: "fixture@example.invalid",
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
      legalReceipt: "{}",
      deletionPending: false,
    })
    .execute();
  assert.equal(await applyCustomerMigration(db), "already-applied");
  assert.ok(
    await db
      .selectFrom("customer_user")
      .select("id")
      .where("id", "=", "fixture-preserve")
      .executeTakeFirst(),
  );
  console.log(
    "PASS resumed migration is idempotent and retains subsequent account data",
  );
  await sql
    .raw(
      "CREATE ROLE bolt_public_fixture; GRANT USAGE ON SCHEMA public TO bolt_public_fixture; GRANT SELECT ON ALL TABLES IN SCHEMA public TO bolt_public_fixture; SET ROLE bolt_public_fixture",
    )
    .execute(db);
  assert.equal(
    (await db.selectFrom("customer_user").select("id").execute()).length,
    0,
  );
  await sql.raw("RESET ROLE").execute(db);
  console.log(
    "PASS PostgreSQL RLS denies public-role access even with table SELECT permission",
  );
  await db.updateTable("customer_schema").set({ version: 999 }).execute();
  await assert.rejects(applyCustomerMigration(db), /Unsupported/);
  console.log("PASS unsupported schema detected before modification");
} finally {
  await db.destroy();
}


// Exercise the actual restricted owner. A superuser bypasses even FORCE RLS.
const restricted = fixtureDatabase();
try {
  await sql.raw("CREATE ROLE bolt_scope_fixture NOSUPERUSER NOBYPASSRLS; GRANT CREATE ON SCHEMA public TO bolt_scope_fixture; SET ROLE bolt_scope_fixture").execute(restricted);
  for (const file of ["001-auth.sql", "001-data.sql"]) {
    await sql.raw(readFileSync(new URL("../../scripts/customer/" + file, import.meta.url), "utf8")).execute(restricted);
  }
  await restricted.insertInto("customer_user").values({id:"legacy", name:"Legacy", email:"legacy@example.invalid", emailVerified:true, createdAt:new Date(), updatedAt:new Date(), legalReceipt:"{}", deletionPending:false}).execute();
  await restricted.insertInto("customer_data").values({user_id:"legacy", revision:7}).execute();
  assert.equal(await applyCustomerMigration(restricted), "applied");
  assert.equal(await applyCustomerMigration(restricted), "already-applied");
  const { withCustomerScope, assertRestrictedCustomerRole } = await import("../customer/database");
  await assertRestrictedCustomerRole(restricted);
  assert.equal((await withCustomerScope(restricted, "legacy", tx => tx.selectFrom("customer_data").select("revision").executeTakeFirstOrThrow())).revision, 7);
  for (const id of ["one", "two"]) {
    await restricted.insertInto("customer_user").values({id, name:id, email:id+"@example.invalid", emailVerified:true, createdAt:new Date(), updatedAt:new Date(), legalReceipt:"{}", deletionPending:false}).execute();
    await withCustomerScope(restricted, id, tx => tx.insertInto("customer_data").values({user_id:id}).execute());
  }
  assert.equal((await restricted.selectFrom("customer_data").selectAll().execute()).length, 0);
  await withCustomerScope(restricted, "two", async tx => {
    assert.deepEqual(await tx.selectFrom("customer_data").select("user_id").execute(), [{user_id:"two"}]);
    assert.equal((await tx.updateTable("customer_data").set({revision:9}).where("user_id", "=", "one").returning("user_id").execute()).length, 0);
  });
  await assert.rejects(withCustomerScope(restricted, "one", tx => tx.insertInto("customer_imports").values({user_id:"two",import_id:"wrong-owner"}).execute()), /row.level security/i);
  assert.equal((await restricted.selectFrom("customer_data").selectAll().execute()).length, 0);
  // The fixture leases the same PostgreSQL connection to both subjects. A failed
  // transaction must clear its subject just like a committed one.
  const forced = await sql<{relname: string}>`select relname from pg_class
    where oid in ('customer_data'::regclass, 'customer_imports'::regclass, 'customer_order_links'::regclass)
      and relrowsecurity and relforcerowsecurity order by relname`.execute(restricted);
  assert.deepEqual(forced.rows.map(row => row.relname), ["customer_data", "customer_imports", "customer_order_links"]);
  for (const subject of ["one", "two"]) {
    await withCustomerScope(restricted, subject, tx => tx.insertInto("customer_order_links")
      .values({order_id: "review-" + subject, user_id: subject, evidence: "guest-capability"}).execute());
  }
  await assert.rejects(withCustomerScope(restricted, "one", async tx => {
    assert.deepEqual(await tx.selectFrom("customer_order_links").select("order_id").execute(), [{order_id:"review-one"}]);
    throw Error("Interrupción de revisión");
  }), /Interrupción de revisión/);
  assert.deepEqual(await restricted.selectFrom("customer_order_links").select("order_id").execute(), []);
  await withCustomerScope(restricted, "two", async tx => {
    assert.deepEqual(await tx.selectFrom("customer_order_links").select("order_id").execute(), [{order_id:"review-two"}]);
  });
  assert.deepEqual(await restricted.selectFrom("customer_order_links").select("order_id").execute(), []);
  console.log("PASS restricted owner enforces per-session RLS and clears pooled transaction context");
} finally {
  await restricted.destroy();
}
