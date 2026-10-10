import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { inspect } from "node:util";
import postgres from "postgres";
import { Env } from "./env";
import { createQueries } from "./queries";
import { app } from "./router";
import { startFakePostgres, type FakePostgres } from "./testing/fakePostgres";

// A chain id that appears nowhere except as a bound query parameter, and a
// fragment of the getLatestBlock SQL text. Neither may reach an error log.
const PARAMETER = "987654321";
const SQL_FRAGMENT = "head_block_number IS NOT NULL";

const FAILURE = { code: "42P01", message: "relation does not exist" };

let server: FakePostgres | undefined;
afterEach(async () => {
  await server?.close();
  server = undefined;
});

const envFor = (url: string) => ({ PG_CONNECTION_STRING: url }) as Env;

// Everything a log sink could render from the error: util.inspect (console),
// Bun.inspect, JSON serialization and the stack.
function renderings(error: unknown): string[] {
  return [
    inspect(error, { depth: 5, showHidden: false }),
    Bun.inspect(error),
    JSON.stringify(error, (_, v: unknown) =>
      typeof v === "bigint" ? v.toString() : v,
    ),
    String((error as Error).stack),
  ];
}

async function latestBlockError(url: string) {
  const queries = await createQueries(envFor(url));
  return queries.getLatestBlock(BigInt(PARAMETER)).then(
    () => {
      throw new Error("expected the query to fail");
    },
    (error: unknown) => error,
  );
}

describe("createQueries", () => {
  test("runs queries", async () => {
    server = await startFakePostgres({
      rows: [{ number: "42", hash: "0xab", timestamp: "2026-10-09 00:00:00" }],
    });
    const queries = await createQueries(envFor(server.url));

    expect(await queries.getLatestBlock(1n)).toEqual({
      number: "42",
      hash: "0xab",
      timestamp: "2026-10-09 00:00:00",
    });
  });

  test("query errors keep the database diagnostics", async () => {
    server = await startFakePostgres({ error: FAILURE });
    const error = (await latestBlockError(server.url)) as Error &
      Record<string, unknown>;

    expect(error).toBeInstanceOf(postgres.PostgresError);
    expect(error.message).toBe(FAILURE.message);
    expect(error.code).toBe(FAILURE.code);
    expect(error.severity).toBe("ERROR");
    expect(error.routine).toBe("fake_routine");
    // The stack still points at the query's call site.
    expect(error.stack).toContain("getLatestBlock");
  });

  test("query errors do not expose the SQL or its parameters", async () => {
    server = await startFakePostgres({ error: FAILURE });
    const error = await latestBlockError(server.url);

    for (const key of ["query", "parameters", "args", "types"]) {
      expect(Object.keys(error as object)).not.toContain(key);
    }
    expect(inspect(error)).toContain(FAILURE.code);
    for (const rendered of renderings(error)) {
      expect(rendered).not.toContain(SQL_FRAGMENT);
      expect(rendered).not.toContain(PARAMETER);
    }
  });

  // Guards the test above: with postgres.js debug mode on, the same
  // renderings do carry the SQL and the parameter.
  test("debug mode would expose them", async () => {
    server = await startFakePostgres({ error: FAILURE });
    const sql = postgres(server.url, {
      max: 1,
      fetch_types: false,
      debug: true,
    });
    const error = await sql`SELECT ${SQL_FRAGMENT}, ${PARAMETER}::int8`.then(
      () => null,
      (e: unknown) => e,
    );
    await sql.end();

    expect(Object.keys(error as object)).toEqual(
      expect.arrayContaining(["query", "parameters"]),
    );
    const rendered = inspect(error);
    expect(rendered).toContain(SQL_FRAGMENT);
    expect(rendered).toContain(PARAMETER);
  });

  test("the app logs a failing query without SQL or parameters", async () => {
    server = await startFakePostgres({ error: FAILURE });
    const logged: unknown[][] = [];
    const consoleError = spyOn(console, "error").mockImplementation(
      (...args: unknown[]) => {
        logged.push(args);
      },
    );
    try {
      const response = await app.fetch(
        new Request(`http://localhost/blocks/${PARAMETER}/latest`),
        envFor(server.url),
      );

      expect(response.status).toBe(500);
      expect(await response.json<unknown>()).toEqual({
        status: 500,
        error: "Internal server error",
      });
    } finally {
      consoleError.mockRestore();
    }

    expect(logged).toHaveLength(1);
    const rendered = logged[0]!.flatMap(renderings).join("\n");
    expect(rendered).toContain(FAILURE.message);
    expect(rendered).toContain(FAILURE.code);
    expect(rendered).not.toContain(SQL_FRAGMENT);
    expect(rendered).not.toContain(PARAMETER);
  });
});
