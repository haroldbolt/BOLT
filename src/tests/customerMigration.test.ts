import assert from "node:assert/strict";
import { sql } from "kysely";
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
