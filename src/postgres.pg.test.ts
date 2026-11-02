import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import postgres, { type Sql } from "postgres";
import { app } from "./router";

const URL = process.env.TEST_PG_CONNECTION_STRING;

async function rejection(promise: PromiseLike<unknown>) {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("expected rejection");
}

describe.skipIf(!URL)("postgres dependency compatibility", () => {
  let sql: Sql<{ bigint: bigint }>;

  beforeAll(async () => {
    sql = postgres(URL, {
      max: 1,
      fetch_types: false,
      debug: false,
      types: { bigint: postgres.BigInt },
      connection: { application_name: "ekubo-api-dependency-test" },
    });
    await sql`CREATE TEMP TABLE dependency_rollback (id int PRIMARY KEY)`;
    await sql`CREATE SCHEMA dependency_compatibility`;
    await sql`CREATE TABLE dependency_compatibility.indexer_cursor (
      chain_id int8, head_block_number int8, head_block_hash text,
      head_block_time timestamptz
    )`;
    await sql`INSERT INTO dependency_compatibility.indexer_cursor VALUES
      (1, 24000000, '0xab', '2026-10-25T14:00:00Z')`;
  });

  afterAll(async () => {
    await sql`DROP SCHEMA dependency_compatibility CASCADE`;
    await sql?.end();
  });

  test("returns the existing block response from a real database", async () => {
    const response = await app.fetch(
      new Request("http://localhost/blocks/1/latest"),
      {
        PG_CONNECTION_STRING: `${URL}?search_path=dependency_compatibility`,
      },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      number: 24000000,
      timestamp: "2026-10-25T14:00:00.000Z",
    });
  });

  test("preserves bigint, numeric, JSON, boolean and explicit timestamp types", async () => {
    const instant = new Date("2026-10-25T14:00:00Z");
    const rows = await sql`
      SELECT ${9007199254740993n}::int8 AS integer,
             ${"12345678901234567890.123456"}::numeric AS amount,
             ${instant}::timestamptz AS instant,
             ${true}::boolean AS enabled,
             ${sql.json({ amount: "123", nested: [1, null] })}::jsonb AS payload
    `;
    expect([...rows]).toEqual([
      {
        integer: 9007199254740993n,
        amount: "12345678901234567890.123456",
        instant,
        enabled: true,
        payload: { amount: "123", nested: [1, null] },
      },
    ]);
  });

  test("commits successful transactions", async () => {
    await sql.begin(async (tx) => {
      await tx`INSERT INTO dependency_rollback VALUES (1)`;
    });
    expect([...(await sql`SELECT id FROM dependency_rollback`)]).toEqual([
      { id: 1 },
    ]);
  });

  test("rolls back database errors and reuses the connection", async () => {
    const error = await rejection(
      sql.begin(async (tx) => {
        await tx`INSERT INTO dependency_rollback VALUES (2)`;
        await tx`INSERT INTO dependency_rollback VALUES (2)`;
      }),
    );
    expect(error).toMatchObject({ code: "23505" });
    expect([
      ...(await sql`SELECT id FROM dependency_rollback WHERE id = 2`),
    ]).toEqual([]);
    expect((await sql`SELECT 1 AS healthy`)[0]?.healthy).toBe(1);
  });

  test("rolls back callback failures", async () => {
    const error = await rejection(
      sql.begin(async (tx) => {
        await tx`INSERT INTO dependency_rollback VALUES (3)`;
        throw new Error("callback failure");
      }),
    );
    expect(error).toMatchObject({ message: "callback failure" });
    expect([
      ...(await sql`SELECT id FROM dependency_rollback WHERE id = 3`),
    ]).toEqual([]);
  });

  test("honors API read-only startup settings", async () => {
    const readonly = postgres(URL, {
      max: 1,
      fetch_types: false,
      connection: {
        application_name: "ekubo-api",
        default_transaction_read_only: true,
        statement_timeout: 5_000,
      },
    });
    try {
      expect((await readonly`SHOW default_transaction_read_only`)[0]).toEqual({
        default_transaction_read_only: "on",
      });
      expect((await readonly`SHOW statement_timeout`)[0]).toEqual({
        statement_timeout: "5s",
      });
      const error = await rejection(
        readonly`CREATE TABLE must_not_be_created (id int)`,
      );
      expect(error).toMatchObject({ code: "25006" });
      expect((await readonly`SELECT 1 AS healthy`)[0]?.healthy).toBe(1);
    } finally {
      await readonly.end();
    }
  });
});
