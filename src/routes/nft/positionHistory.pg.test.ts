import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import postgres from "postgres";
import { app } from "../../router";
import {
  decodeHistoryCursor,
  encodeHistoryCursor,
} from "./positionHistoryCursor";
import { z } from "zod";

const url = process.env.TEST_PG_CONNECTION_STRING;
const schema = "position_history_test";
const path = "http://localhost/positions/1/10/42/history";
const responseSchema = z.object({
  events: z.array(
    z.object({ type: z.string(), transaction_hash: z.string() }).passthrough(),
  ),
  page_info: z.object({
    has_more: z.boolean(),
    next_cursor: z.string().nullable(),
    snapshot: z.object({
      block_number: z.string(),
      block_hash: z.string(),
      fork_counter: z.string(),
    }),
  }),
});

function eventId(block: number, index = 0) {
  return -(1n << 63n) + (BigInt(block) << 32n) + BigInt(index) + 1n;
}

const options = {
  max: 1,
  onnotice: () => {},
  types: { bigint: postgres.BigInt },
};

describe.skipIf(!url)("position history against PostgreSQL", () => {
  const sql = postgres(url ?? "postgresql://localhost/unused", options);
  const env = { PG_CONNECTION_STRING: `${url}?search_path=${schema}` };
  beforeAll(async () => {
    await sql`CREATE SCHEMA position_history_test`;
    await sql`SET search_path TO position_history_test`;
    await sql.unsafe(`
      CREATE TABLE indexer_cursor(chain_id bigint PRIMARY KEY, head_block_number bigint, head_block_hash numeric, fork_counter bigint);
      CREATE TABLE blocks(chain_id bigint, block_number bigint, block_hash numeric, block_time timestamptz, num_events integer, PRIMARY KEY(chain_id,block_number));
      CREATE TABLE nonfungible_token_transfers(chain_id bigint, block_number bigint, event_id bigint, transaction_hash numeric, from_address numeric, to_address numeric, token_id numeric, emitter numeric, PRIMARY KEY(chain_id,event_id));
      CREATE TABLE nft_locker_mappings(chain_id bigint, nft_address numeric, locker numeric, token_id_transform jsonb);
      CREATE TABLE position_updates(chain_id bigint, block_number bigint, event_id bigint, transaction_hash numeric, salt numeric, liquidity_delta numeric, delta0 numeric, delta1 numeric, PRIMARY KEY(chain_id,event_id));
      CREATE TABLE position_fees_collected(chain_id bigint, block_number bigint, event_id bigint, transaction_hash numeric, salt numeric, delta0 numeric, delta1 numeric, PRIMARY KEY(chain_id,event_id));
      CREATE TABLE ve33_rewards_claimed(chain_id bigint, block_number bigint, event_id bigint, transaction_hash numeric, salt numeric, owner numeric, amount numeric, PRIMARY KEY(chain_id,event_id));
      CREATE FUNCTION nft_token_salt(transform jsonb, token_id numeric) RETURNS numeric LANGUAGE sql IMMUTABLE AS $$
        SELECT CASE WHEN transform ? 'bit_mod' THEN MOD(token_id, POW(2::numeric, (transform ->> 'bit_mod')::int)) ELSE token_id END
      $$;
      INSERT INTO indexer_cursor VALUES (1,10,101,0);
      INSERT INTO blocks VALUES (1,8,81,'2026-11-17T00:00Z',1), (1,9,91,'2026-11-17T00:00Z',1);
      INSERT INTO nft_locker_mappings VALUES (1,11,10,'{"bit_mod":5}');
    `);
    await sql`INSERT INTO nonfungible_token_transfers VALUES (1,8,${eventId(8)},1,0,99,42,11), (1,9,${eventId(9)},2,99,98,42,11)`;
    await sql`INSERT INTO position_updates SELECT 1,9,${eventId(9)}::bigint + i, 100 + i, 10, 99999999999999999, -i, i FROM generate_series(0,196) i`;
    await sql`INSERT INTO position_fees_collected VALUES (1,9,${eventId(9)},3,42,50,100)`;
    await sql`INSERT INTO ve33_rewards_claimed VALUES (1,9,${eventId(9)},4,10,10,99999999999999999), (1,9,${eventId(9, 1)},5,10,99,17)`;
  });
  afterAll(async () => {
    await sql`DROP SCHEMA position_history_test CASCADE`;
    await sql.end();
  });

  async function fetchPage(query: URLSearchParams) {
    const response = await app.request(
      `${path}/page?${query.toString()}`,
      undefined,
      env,
    );
    expect(response.status).toBe(200);
    return responseSchema.parse(await response.json());
  }

  test("concatenates a fixed snapshot for 1/25/100 across ties and an atomic later-block insert", async () => {
    const legacyResponse = await app.request(path, undefined, env);
    expect(legacyResponse.status).toBe(200);
    const legacy = responseSchema
      .pick({ events: true })
      .parse(await legacyResponse.json());
    const expected = legacy.events.toSorted((a, b) =>
      Number(BigInt(b.transaction_hash) - BigInt(a.transaction_hash)),
    );
    expect(expected).toHaveLength(200);
    const defaultPage = await fetchPage(new URLSearchParams());
    expect(defaultPage.events).toHaveLength(25);

    for (const limit of [25, 100]) {
      await sql`UPDATE indexer_cursor SET head_block_number=10, head_block_hash=101`;
      await sql`DELETE FROM position_updates WHERE block_number=11`;
      await sql`DELETE FROM blocks WHERE block_number=11`;
      const query = new URLSearchParams({ limit: String(limit) });
      let page = await fetchPage(query);
      const snapshot = page.page_info.snapshot;
      await sql.begin(async (tx) => {
        await tx`INSERT INTO blocks VALUES (1,11,111,'2026-11-17T00:00Z',1)`;
        await tx`INSERT INTO position_updates VALUES (1,11,${eventId(11)},999,10,10,11,12)`;
        await tx`UPDATE indexer_cursor SET head_block_number=11, head_block_hash=111`;
      });
      const actual = [...page.events];
      for (let count = 1; count < 200 / limit; count++) {
        expect(page.page_info.has_more).toBe(true);
        query.set("cursor", String(page.page_info.next_cursor));
        page = await fetchPage(query);
        expect(page.page_info.snapshot).toEqual(snapshot);
        actual.push(...page.events);
      }
      expect(page.page_info.next_cursor).toBeNull();
      expect(page.page_info.has_more).toBe(false);
      expect(
        actual.toSorted((a, b) =>
          Number(BigInt(b.transaction_hash) - BigInt(a.transaction_hash)),
        ),
      ).toEqual(expected);
      expect(actual.slice(-4).map(({ type }) => type)).toEqual([
        "claim_rewards",
        "collect_fees",
        "update",
        "transfer",
      ]);
    }
    expect(
      (await fetchPage(new URLSearchParams())).events[0]?.transaction_hash,
    ).toBe("0x3e7");
  }, 30000);

  test("invalidates when an empty block below the current head gains events without a fork-counter bump", async () => {
    await sql`UPDATE indexer_cursor SET head_block_number=10, head_block_hash=101`;
    const query = new URLSearchParams({ limit: "1" });
    const first = await fetchPage(query);
    query.set("cursor", first.page_info.next_cursor ?? "");
    await sql.begin(async (tx) => {
      await tx`INSERT INTO blocks VALUES (1,10,102,'2026-11-17T00:00Z',1)`;
      await tx`INSERT INTO position_updates VALUES (1,10,${eventId(10)},998,10,10,11,12)`;
      await tx`UPDATE indexer_cursor SET head_block_number=11, head_block_hash=111`;
    });
    expect(
      (await app.request(`${path}/page?${query.toString()}`, undefined, env))
        .status,
    ).toBe(400);
    await sql`DELETE FROM position_updates WHERE block_number=10`;
    await sql`DELETE FROM blocks WHERE block_number=10`;
  });

  test("handles empty continuation, missing positions and snapshot invalidation", async () => {
    const query = new URLSearchParams({ limit: "1" });
    const first = await fetchPage(query);
    const token = first.page_info.next_cursor ?? "";
    const cursor = decodeHistoryCursor(token, {
      chain_id: "1",
      locker: "10",
      id: "42",
      limit: 1,
    });
    query.set(
      "cursor",
      encodeHistoryCursor({ ...cursor, event_id: eventId(8).toString() }),
    );
    expect((await fetchPage(query)).events).toEqual([]);
    query.set("cursor", token);
    expect(
      (await app.request(path.replace("/42/", "/43/"), undefined, env)).status,
    ).toBe(404);

    await sql`UPDATE indexer_cursor SET head_block_hash=112`;
    expect(
      (await app.request(`${path}/page?${query.toString()}`, undefined, env))
        .status,
    ).toBe(400);
    await sql`UPDATE indexer_cursor SET head_block_number=10, head_block_hash=101`;
    expect(
      (await app.request(`${path}/page?${query.toString()}`, undefined, env))
        .status,
    ).toBe(400);
    await sql`UPDATE indexer_cursor SET head_block_number=11, head_block_hash=111, fork_counter=1`;
    const reorg = await app.request(
      `${path}/page?${query.toString()}`,
      undefined,
      env,
    );
    expect(reorg.status).toBe(400);
    expect(await reorg.json()).toEqual({
      status: 400,
      error: "History snapshot changed; restart pagination",
    });
  });
});
