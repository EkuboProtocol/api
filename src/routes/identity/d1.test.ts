// The identity store against a real local D1 (workerd, through wrangler's
// getPlatformProxy), for what the bun:sqlite fake does not reproduce: D1's
// limit of 100 bound parameters per statement, and its batch semantics.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { D1Database } from "@cloudflare/workers-types";
import { getPlatformProxy } from "wrangler";
import { app } from "../../router";
import type { Env } from "../../env";
import { lookupLinks, removeLinksOfXUser } from "./store";

const MIGRATIONS = join(import.meta.dir, "../../../migrations/identity");

let db: D1Database;
let dispose: () => Promise<void>;

function statementsOf(sql: string): string[] {
  return sql
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("--"))
    .join("\n")
    .split(";")
    .map((statement) => statement.trim())
    .filter(Boolean);
}

beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), "identity-d1-"));
  const config = join(dir, "wrangler.json");
  writeFileSync(
    config,
    JSON.stringify({
      name: "identity-d1-test",
      compatibility_date: "2024-09-23",
      d1_databases: [
        {
          binding: "IDENTITY_DB",
          database_name: "identity-test",
          database_id: "00000000-0000-0000-0000-000000000000",
        },
      ],
    }),
  );
  const proxy = await getPlatformProxy<{ IDENTITY_DB: D1Database }>({
    configPath: config,
    persist: { path: join(dir, "state") },
  });
  db = proxy.env.IDENTITY_DB;
  dispose = proxy.dispose;
  for (const file of readdirSync(MIGRATIONS).sort()) {
    const sql = readFileSync(join(MIGRATIONS, file), "utf8");
    await db.batch(statementsOf(sql).map((s) => db.prepare(s)));
  }
}, 60_000);

afterAll(async () => {
  await dispose?.();
});

const addressOf = (i: number) => `0x${i.toString(16).padStart(40, "0")}`;

async function insertLink(address: string, xUserId: string, scope = "*") {
  await db
    .prepare(
      `INSERT INTO links (namespace, address, chain_scope, x_user_id, x_handle, signature_kind, verified_chain_id, linked_at)
       VALUES ('evm', ?, ?, ?, 'alice', 'ecdsa', '1', 1)`,
    )
    .bind(address, scope, xUserId)
    .run();
}

describe("identity store on D1", () => {
  test("D1 refuses more than 100 bound parameters", async () => {
    const placeholders = Array.from({ length: 101 }, () => "?").join(", ");
    const values = Array.from({ length: 101 }, (_, i) => addressOf(i));
    const error = await db
      .prepare(`SELECT 1 FROM links WHERE address IN (${placeholders})`)
      .bind(...values)
      .all()
      .then(
        () => null,
        (e: unknown) => String(e),
      );
    expect(error).toContain("too many SQL variables");
  });

  test("a lookup of 100 addresses succeeds", async () => {
    const addresses = Array.from({ length: 100 }, (_, i) => addressOf(i + 1));
    for (const address of addresses.slice(0, 3)) {
      await insertLink(address, "1234567890");
    }
    const found = await lookupLinks(db, "evm", "1", addresses);
    expect([...found.keys()].toSorted()).toEqual(addresses.slice(0, 3));

    const env: Env = { IDENTITY_DB: db };
    const query = addresses.map((a) => `address=${a}`).join("&");
    const response = await app.fetch(
      new Request(`https://api.test/v1/identity/addresses?chainId=1&${query}`),
      env,
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      identities: Record<string, unknown>;
    };
    expect(Object.keys(body.identities)).toHaveLength(100);
  });

  test("an X-side unlink removes that account's links and archives them", async () => {
    await insertLink(addressOf(500), "777");
    await insertLink(addressOf(501), "777", "8453");
    await insertLink(addressOf(502), "888");
    const removed = await removeLinksOfXUser(db, "777", 2, "x_unlinked");
    expect(removed.map((r) => r.address).toSorted()).toEqual([
      addressOf(500),
      addressOf(501),
    ]);
    const { results } = await db
      .prepare(
        "SELECT address, end_reason FROM link_history WHERE x_user_id = '777' ORDER BY address",
      )
      .all();
    expect(results).toEqual([
      { address: addressOf(500), end_reason: "x_unlinked" },
      { address: addressOf(501), end_reason: "x_unlinked" },
    ]);
    const left = await lookupLinks(db, "evm", "1", [addressOf(502)]);
    expect(left.get(addressOf(502))?.x_user_id).toBe("888");
  });
});
