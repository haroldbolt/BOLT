/** Local-only full-stack review. Real auth library/PostgreSQL engine; captured email, no external providers. */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import { sql } from "kysely";
import {
  fixtureDatabase,
  fixtureConfig,
} from "../../src/tests/customer/fixture";
const destination = path.resolve(
  process.argv[2] || "../bolt-dispatch-simulation-customer-review",
);
if (
  !path.basename(destination).startsWith("bolt-dispatch-simulation-") ||
  destination.startsWith(process.cwd() + path.sep)
)
  throw Error("Use a separate simulation directory");
if (!fs.existsSync(destination))
  execFileSync(
    process.execPath,
    ["--import", "tsx", "src/tests/createIntegrationReview.ts", destination],
    { stdio: "pipe" },
  );
const marker = JSON.parse(
  fs.readFileSync(
    path.join(destination, ".bolt-private/dispatch-simulation.json"),
    "utf8",
  ),
);
if (marker.version !== 1) throw Error("Isolated simulation marker required");
const db = fixtureDatabase(
  path.join(destination, ".bolt-private/customer-postgres"),
);
const exists = await sql<{
  name: string | null;
}>`select to_regclass('customer_schema') as name`.execute(db);
if (!exists.rows[0].name)
  for (const file of ["001-auth.sql", "001-data.sql"])
    await sql
      .raw(fs.readFileSync(`scripts/customer/${file}`, "utf8"))
      .execute(db);
const port = Number(process.env.BOLT_CUSTOMER_REVIEW_PORT || 3091),
  origin = `http://127.0.0.1:${port}`;
process.chdir(destination);
Object.assign(process.env, {
  PORT: String(port),
  NODE_ENV: "development",
  BOLT_DISPATCH_SIMULATION: "1",
  BOLT_DATA_DIR: path.join(destination, ".bolt-private/orders"),
});
const mails: any[] = [];
const { startServer } = await import(
  pathToFileURL(path.join(destination, "server.ts")).href
);
await startServer({
  db,
  config: fixtureConfig(origin),
  sendMail: async (mail: any) => {
    mails.push(mail);
    fs.writeFileSync(
      path.join(destination, ".bolt-private/customer-mail.json"),
      JSON.stringify(mails),
      { mode: 0o600 },
    );
  },
});
console.log(
  `ISOLATED CUSTOMER REVIEW ${origin}/cuenta — email captured locally; Google/Apple unavailable`,
);
