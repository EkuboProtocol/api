import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import postgres from "postgres";
import { createQueries, type Queries } from "../../queries";

const URL = process.env.TEST_PG_CONNECTION_STRING;

const SCHEMA = "net_flow_test";
const CHAIN = 1n;
const OTHER_CHAIN = 10n;
const TOKEN = 0x1234n;
const LOW = 0x10n;
const HIGH = 0x9999n;

const TABLES = `
DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE;
CREATE SCHEMA ${SCHEMA};
CREATE TABLE ${SCHEMA}.pool_keys (
  pool_key_id int8 PRIMARY KEY, chain_id int8 NOT NULL,
  token0 numeric NOT NULL, token1 numeric NOT NULL);
CREATE TABLE ${SCHEMA}.swaps (
  event_id serial8 PRIMARY KEY,
  pool_key_id int8 NOT NULL REFERENCES ${SCHEMA}.pool_keys (pool_key_id),
  block_time timestamptz NOT NULL,
  delta0 numeric NOT NULL, delta1 numeric NOT NULL);
`;

describe.skipIf(!URL)("getTokenNetFlow", () => {
  let admin: ReturnType<typeof postgres>;
  let queries: Queries;

  beforeAll(async () => {
    admin = postgres(URL, { max: 1, onnotice: () => {} });
    await admin.unsafe(TABLES);
    await admin.unsafe(`
      INSERT INTO ${SCHEMA}.pool_keys VALUES
        (1, ${CHAIN}, ${TOKEN}, ${HIGH}),
        (2, ${CHAIN}, ${LOW}, ${TOKEN}),
        (3, ${CHAIN}, ${LOW}, ${HIGH}),
        (4, ${OTHER_CHAIN}, ${TOKEN}, ${HIGH});
      INSERT INTO ${SCHEMA}.swaps (pool_key_id, block_time, delta0, delta1) VALUES
        -- token is token0: the trader pays 100 in, then takes 30 out
        (1, '2026-10-25T14:05:00Z', 100, -5),
        (1, '2026-10-25T14:29:59Z', -30, 2),
        -- token is token1: the trader takes 75 out in the same bucket
        (2, '2026-10-25T14:10:00Z', 9, -75),
        -- next bucket, and a swap that moved none of the token
        (2, '2026-10-25T14:30:00Z', 4, 0),
        -- pools without the token, or on another chain, are ignored
        (3, '2026-10-25T14:10:00Z', 1000, -1000),
        (4, '2026-10-25T14:10:00Z', 1000, -1000),
        -- outside the window
        (1, '2026-10-25T13:59:59Z', 1000, -1000);
    `);
    queries = await createQueries({
      PG_CONNECTION_STRING: `${URL}${URL?.includes("?") ? "&" : "?"}search_path=${SCHEMA}`,
    });
  });

  afterAll(async () => {
    await admin?.unsafe(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    await admin?.end();
  });

  test("splits each pool's token delta into bought and sold per bucket", async () => {
    const rows = await queries.getTokenNetFlow({
      chainId: CHAIN,
      tokenAddress: TOKEN,
      start: new Date("2026-10-25T14:00:00Z"),
      end: new Date("2026-10-25T15:00:00Z"),
      intervalSeconds: 1_800,
    });

    expect([...rows]).toEqual([
      {
        start: new Date("2026-10-25T14:00:00Z"),
        bought: "105",
        sold: "100",
        swap_count: 3,
      },
      {
        start: new Date("2026-10-25T14:30:00Z"),
        bought: "0",
        sold: "0",
        swap_count: 1,
      },
    ]);
  });

  test("aligns buckets to the price history origin", async () => {
    const rows = await queries.getTokenNetFlow({
      chainId: CHAIN,
      tokenAddress: TOKEN,
      start: new Date("2026-10-25T14:00:00Z"),
      end: new Date("2026-10-25T15:00:00Z"),
      intervalSeconds: 43_200,
    });

    expect([...rows]).toEqual([
      {
        start: new Date("2026-10-25T12:00:00Z"),
        bought: "105",
        sold: "100",
        swap_count: 4,
      },
    ]);
  });

  test("returns no buckets for a token without pools", async () => {
    const rows = await queries.getTokenNetFlow({
      chainId: CHAIN,
      tokenAddress: 0xdeadn,
      start: new Date("2026-10-25T14:00:00Z"),
      end: new Date("2026-10-25T15:00:00Z"),
      intervalSeconds: 1_800,
    });

    expect([...rows]).toEqual([]);
  });
});
