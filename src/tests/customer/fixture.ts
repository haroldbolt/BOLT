import { PGlite } from "@electric-sql/pglite";
import {
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
  type Dialect,
  type Driver,
  type DatabaseConnection,
  type CompiledQuery,
  type QueryResult,
} from "kysely";
import type { CustomerConfig } from "../../customer/config";
export function fixtureConfig(origin: string): CustomerConfig {
  return {
    origin,
    secret: "ISOLATED-TEST-ONLY-" + "z".repeat(40),
    legalApproved: true,
    smtp: {
      host: "fixture.invalid",
      port: 465,
      secure: true,
      user: "fixture",
      pass: "fixture-only",
      from: "test@example.invalid",
    },
  };
}
export function fixtureDatabase(directory?: string) {
  const pg = new PGlite(directory);
  let tail = Promise.resolve(),
    unlock: () => void = () => {};
  const connection: DatabaseConnection = {
    async executeQuery<R>(q: CompiledQuery): Promise<QueryResult<R>> {
      const result =
        !q.parameters.length && q.sql.includes(";")
          ? (await pg.exec(q.sql)).at(-1)!
          : await pg.query<R>(q.sql, [...q.parameters]);
      return {
        rows: result.rows as R[],
        numAffectedRows: BigInt(result.affectedRows || 0),
      };
    },
    async *streamQuery() {
      throw Error("Streaming not used by tests");
    },
  };
  const driver: Driver = {
    async init() {
      await pg.waitReady;
    },
    async acquireConnection() {
      const old = tail;
      tail = new Promise<void>((resolve) => {
        unlock = resolve;
      });
      const release = unlock;
      await old;
      (connection as any).release = release;
      return connection;
    },
    async releaseConnection(c) {
      (c as any).release();
    },
    async beginTransaction(c) {
      await pg.exec("BEGIN");
    },
    async commitTransaction(c) {
      await pg.exec("COMMIT");
    },
    async rollbackTransaction(c) {
      await pg.exec("ROLLBACK");
    },
    async destroy() {
      await pg.close();
    },
  };
  const dialect: Dialect = {
    createDriver: () => driver,
    createAdapter: () => new PostgresAdapter(),
    createIntrospector: (db) => new PostgresIntrospector(db),
    createQueryCompiler: () => new PostgresQueryCompiler(),
  };
  return new Kysely<any>({ dialect });
}
