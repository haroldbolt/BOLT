import fs from "node:fs";
import { sql } from "kysely";
import type { CustomerDB } from "./database";
/** One PostgreSQL transaction; no operational JSON or automatic boot migration. */
export async function applyCustomerMigration(
  db: CustomerDB,
  afterAuthSchema?: () => void,
) {
  return db.transaction().execute(async (tx) => {
    await sql`select pg_advisory_xact_lock(164081173)`.execute(tx);
    const exists = await sql<{
      name: string | null;
    }>`select to_regclass('customer_schema') as name`.execute(tx);
    if (exists.rows[0].name) {
      const row = await tx
        .selectFrom("customer_schema")
        .select("version")
        .where("id", "=", 1)
        .executeTakeFirst();
      if (row?.version === 1) return "already-applied";
      throw Error("Unsupported customer schema; stop and review migration.");
    }
    await sql
      .raw(
        fs.readFileSync(
          new URL("../../scripts/customer/001-auth.sql", import.meta.url),
          "utf8",
        ),
      )
      .execute(tx);
    afterAuthSchema?.();
    await sql
      .raw(
        fs.readFileSync(
          new URL("../../scripts/customer/001-data.sql", import.meta.url),
          "utf8",
        ),
      )
      .execute(tx);
    return "applied";
  });
}
