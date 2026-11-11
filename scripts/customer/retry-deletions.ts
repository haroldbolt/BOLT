import { readCustomerConfig } from "../../src/customer/config";
import {
  connectCustomerDatabase,
  assertCustomerSchema,
} from "../../src/customer/database";
import { createCustomerAuth } from "../../src/customer/auth";
import { resumeVerifiedDeletion } from "../../src/customer/deletion";
if (!process.argv.includes("--apply"))
  throw Error(
    "Use --apply to retry verified pending deletions; no new requests are authorized.",
  );
const config = readCustomerConfig();
if (!config) throw Error("Customer configuration missing");
const db = connectCustomerDatabase(config.databaseURL!);
await assertCustomerSchema(db);
try {
  const instance = createCustomerAuth(config, db, async () => {
    throw Error("This worker does not send email");
  });
  const jobs = await db
    .selectFrom("customer_deletions")
    .select("user_id")
    .where("status", "=", "PENDING_PROVIDER")
    .execute();
  let completed = 0,
    pending = 0;
  for (const job of jobs) {
    try {
      await resumeVerifiedDeletion(instance, db, job.user_id);
      completed++;
    } catch {
      pending++;
    }
  }
  console.log(JSON.stringify({ completed, pending })); // No identity, provider token or deletion link in logs.
} finally {
  await db.destroy();
}
