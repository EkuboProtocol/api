// An in-memory D1 over bun:sqlite, enough for the identity routes: prepare,
// bind, first, all, run and batch (run as one transaction, as D1 does).
import { Database } from "bun:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { D1Database } from "@cloudflare/workers-types";

type Value = string | number | null;

class Statement {
  constructor(
    private readonly db: Database,
    readonly sql: string,
    readonly params: Value[] = [],
  ) {}

  bind(...params: Value[]) {
    return new Statement(this.db, this.sql, params);
  }

  execute() {
    const statement = this.db.prepare(this.sql);
    const rows = statement.all(...this.params) as Record<string, unknown>[];
    const changes = (
      this.db.prepare("SELECT changes() AS n").get() as { n: number }
    ).n;
    return {
      results: rows,
      success: true,
      meta: { changes: /^\s*select/i.test(this.sql) ? 0 : changes },
    };
  }

  async first<T>() {
    return (this.execute().results[0] as T | undefined) ?? null;
  }

  async all<T>() {
    return this.execute() as unknown as { results: T[] };
  }

  async run() {
    return this.execute();
  }
}

export function fakeD1(migrationsDir: string): {
  d1: D1Database;
  sqlite: Database;
} {
  const sqlite = new Database(":memory:");
  for (const file of readdirSync(migrationsDir).sort()) {
    sqlite.exec(readFileSync(join(migrationsDir, file), "utf8"));
  }
  const d1 = {
    prepare: (sql: string) => new Statement(sqlite, sql),
    batch: async (statements: Statement[]) =>
      sqlite.transaction(() => statements.map((s) => s.execute()))(),
  };
  return { d1: d1 as unknown as D1Database, sqlite };
}
