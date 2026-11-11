// Development-only: generate the pinned auth schema using an isolated PostgreSQL engine.
import fs from "node:fs";
import { getMigrations } from "better-auth/db/migration";
import {
  fixtureConfig,
  fixtureDatabase,
} from "../../src/tests/customer/fixture";
import { createCustomerAuth } from "../../src/customer/auth";
import { customerSchemaSQL } from "../../src/customer/database";
const db = fixtureDatabase();
const { auth } = createCustomerAuth(
  fixtureConfig("http://127.0.0.1:3999"),
  db,
  async () => {},
);
const migrations = await getMigrations(auth.options);
fs.writeFileSync(
  "scripts/customer/001-auth.sql",
  await migrations.compileMigrations(),
);
fs.writeFileSync("scripts/customer/001-data.sql", customerSchemaSQL);
await db.destroy();
console.log("Generated schema in isolation; no operational database used.");
