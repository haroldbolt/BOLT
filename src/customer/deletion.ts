import type { CustomerAuth } from "./auth";
import type { CustomerDB } from "./database";
/** Only resumable after the library verified the user's one-use deletion email. */
export async function resumeVerifiedDeletion(
  instance: CustomerAuth,
  db: CustomerDB,
  userId: string,
) {
  const job = await db
    .selectFrom("customer_deletions")
    .selectAll()
    .where("user_id", "=", userId)
    .executeTakeFirst();
  if (!job) throw Error("No verified deletion request exists");
  if (job.status === "COMPLETED") return { status: "COMPLETED" };
  const user = await db
    .selectFrom("customer_user")
    .select(["id", "deletionPending"])
    .where("id", "=", userId)
    .executeTakeFirst();
  if (user) {
    if (!user.deletionPending)
      throw Error("Deletion evidence inconsistent; requires review");
    await instance.beforeDelete({ id: userId });
    // Provider revocation is external, idempotent and precedes local deletion. Local cascades
    // commit in one PostgreSQL transaction; a crash afterwards is reconciled below on retry.
    await db.transaction().execute(async (tx) => {
      await tx
        .deleteFrom("customer_user")
        .where("id", "=", userId)
        .where("deletionPending", "=", true)
        .execute();
    });
  }
  await instance.afterDelete({ id: userId });
  return { status: "COMPLETED" };
}
