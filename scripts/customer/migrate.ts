import { applyCustomerMigration } from "../../src/customer/migration";
import { readCustomerConfig } from "../../src/customer/config";
import { assertRestrictedCustomerRole, connectCustomerDatabase } from "../../src/customer/database";
if (!process.argv.includes("--apply"))
  throw Error(
    "Explicit --apply required. Back up the selected customer database first. No order files are migrated.",
  );
const config = readCustomerConfig();
if (!config)
  throw Error(
    "Configure BOLT_CUSTOMER_DATABASE_URL, ORIGIN and SECRET securely.",
  );
const db = connectCustomerDatabase(config.databaseURL!);
try {
  await assertRestrictedCustomerRole(db);
  console.log(
    "Customer schema v2:",
    await applyCustomerMigration(db),
    "; operational files unchanged.",
  );
} finally {
  await db.destroy();
}
