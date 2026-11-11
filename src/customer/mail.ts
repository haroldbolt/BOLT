import crypto from "node:crypto";
import nodemailer from "nodemailer";
import { symmetricEncrypt, symmetricDecrypt } from "better-auth/crypto";
import type { CustomerConfig } from "./config";
import type { CustomerDB } from "./database";
import type { CustomerMail } from "./auth";
export function customerMailer(config: CustomerConfig, db: CustomerDB) {
  const transport = config.smtp
    ? nodemailer.createTransport({
        host: config.smtp.host,
        port: config.smtp.port,
        secure: config.smtp.secure,
        requireTLS: !config.smtp.secure,
        auth: { user: config.smtp.user, pass: config.smtp.pass },
        logger: false,
        debug: false,
      })
    : null;
  return {
    enqueue: async (mail: CustomerMail) => {
      if (!transport) throw Error("Transactional email is not configured");
      const url = new URL(mail.url);
      if (url.origin !== config.origin)
        throw Error("Invalid transactional URL");
      await db
        .insertInto("customer_mail")
        .values({
          id: crypto.randomUUID(),
          recipient_hash: crypto
            .createHmac("sha256", config.secret)
            .update(mail.to.toLowerCase())
            .digest("hex"),
          encrypted_payload: await symmetricEncrypt({
            key: config.secret,
            data: JSON.stringify(mail),
          }),
        })
        .execute();
    },
    drain: async () => {
      if (!transport) return;
      // Locks coordinate workers. An interrupted SMTP send may resend the same one-use link;
      // it never creates another account, order or authorization.
      await db.transaction().execute(async (tx) => {
        const rows = await tx
          .selectFrom("customer_mail")
          .selectAll()
          .where("next_attempt", "<=", new Date())
          .where("attempts", "<", 8)
          .forUpdate()
          .skipLocked()
          .limit(10)
          .execute();
        for (const row of rows) {
          if (Date.now() - new Date(row.created_at).getTime() > 86400000) {
            await tx
              .deleteFrom("customer_mail")
              .where("id", "=", row.id)
              .execute();
            continue;
          }
          try {
            const mail = JSON.parse(
              await symmetricDecrypt({
                key: config.secret,
                data: row.encrypted_payload,
              }),
            );
            await transport.sendMail({
              from: config.smtp!.from,
              to: mail.to,
              subject: mail.subject,
              text: `${mail.subject}\n\n${mail.url}\n\nSi no solicitaste esta acción, ignora este mensaje. No compartas este enlace.`,
            });
            await tx
              .deleteFrom("customer_mail")
              .where("id", "=", row.id)
              .execute();
          } catch {
            await tx
              .updateTable("customer_mail")
              .set({
                attempts: row.attempts + 1,
                next_attempt: new Date(
                  Date.now() + Math.min(3600000, 30000 * 2 ** row.attempts),
                ),
              })
              .where("id", "=", row.id)
              .execute();
          }
        }
        await tx
          .deleteFrom("customer_mail")
          .where("created_at", "<", new Date(Date.now() - 86400000))
          .execute();
      });
    },
  };
}
