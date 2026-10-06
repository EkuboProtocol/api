// Runs the launch queries against a real indexer schema seeded with a fixture
// launch. It needs a throwaway Postgres with every indexer migration applied
// (00134_scheduled_launch_pool_states or later), so it is skipped unless
// LAUNCH_QUERIES_PG points at one:
//
//   cd indexer && PG_CONNECTION_STRING=$URL bun scripts/migrate.ts
//   LAUNCH_QUERIES_PG=$URL bun test src/launchQueries.db.test.ts
//
// Every test runs inside a transaction that is rolled back.
import { describe, expect, test } from "bun:test";
import postgres, { type Sql } from "postgres";
import { Queries } from "./queries";

const URL = process.env.LAUNCH_QUERIES_PG;

const CHAIN = 8453n;
const SL = BigInt("0x5184f618B2d6cE625d9fDB9770E151a9B84EdB81");
const LLL = BigInt("0x4B4e88581110396a09E3Bc313199b96Ab1D8ADEA");
const ROUTER = BigInt("0x9dae609a75Ac80BB84448a14823199faC514aeDb");
const TWAMM = BigInt("0x00000000000000000000000000000000000077aa");
const CORE = BigInt("0x00000000000014aa86c5d3c41765bb24e11bd701");
const WETH = BigInt("0x4200000000000000000000000000000000000006");
const TOKEN = BigInt("0x7a1c0ffee0000000000000000000000000000001");
const CREATOR = BigInt("0x00000000000000000000000000000000000000cc");
const YUL_ROUTER = BigInt("0x7B2aA7Ecc0B5936b7C52E6259A19C3BA557d0748");
const OTHER_ROUTER = BigInt("0x00000000000000000000000000000000000055aa");
const POOL_ID = 0x6f1bn;
const TERMINAL_POOL_ID = 0x7e2cn;
const OTHER_POOL_ID = 0x8f3dn;
const T0 = 1791331200;
const DAY = 86400;
const E24 = 10n ** 24n;
const E18 = 10n ** 18n;

class Rollback extends Error {}

async function withFixture(run: (q: Queries, tx: Sql) => Promise<void>) {
  const sql = postgres(URL!, {
    max: 1,
    types: { bigint: postgres.BigInt },
    onnotice: () => {},
  });
  try {
    await sql.begin(async (tx) => {
      await seed(tx as unknown as Sql);
      await run(
        new Queries(tx as unknown as Sql<{ bigint: bigint }>),
        tx as unknown as Sql,
      );
      throw new Rollback();
    });
  } catch (error) {
    if (!(error instanceof Rollback)) throw error;
  } finally {
    await sql.end();
  }
}

const n = (value: bigint) => value.toString();

async function block(tx: Sql, number: number, time: number) {
  await tx`
    INSERT INTO blocks (chain_id, block_number, block_hash, block_time, num_events, fork_counter)
    VALUES (${n(CHAIN)}, ${number}, ${number * 7919}, to_timestamp(${time}), 1, 0)
  `;
}

async function setHead(tx: Sql, time: number) {
  await tx`
    INSERT INTO indexer_cursor (chain_id, order_key, last_updated, head_block_number, head_block_hash, head_block_time)
    VALUES (${n(CHAIN)}, 200, now(), 200, 1, to_timestamp(${time}))
    ON CONFLICT (chain_id) DO UPDATE SET head_block_time = EXCLUDED.head_block_time
  `;
}

const ev = (blockNumber: number, eventIndex = 0, txIndex = 0) => ({
  chain_id: n(CHAIN),
  block_number: blockNumber,
  transaction_index: txIndex,
  event_index: eventIndex,
  transaction_hash: n(BigInt(blockNumber * 1000 + txIndex)),
});

async function poolKey(tx: Sql, poolId: bigint, extension: bigint) {
  const [{ pool_key_id }] = await tx<{ pool_key_id: bigint }[]>`
    INSERT INTO pool_keys (chain_id, core_address, pool_id, token0, token1, fee, fee_denominator, tick_spacing, pool_extension)
    VALUES (${n(CHAIN)}, ${n(CORE)}, ${n(poolId)}, ${n(WETH)}, ${n(TOKEN)}, 0, ${n(1n << 64n)}, 1000, ${n(extension)})
    RETURNING pool_key_id
  `;
  return pool_key_id;
}

async function created(
  tx: Sql,
  poolKeyId: bigint,
  poolId: bigint,
  blockNumber: number,
  start: number,
) {
  await tx`
    INSERT INTO scheduled_launch_created ${tx({
      ...ev(blockNumber),
      emitter: n(SL),
      pool_key_id: n(poolKeyId),
      pool_id: n(poolId),
      token: n(TOKEN),
      owner: n(ROUTER),
      quote_token: n(WETH),
      name: "Launch Token",
      symbol: "LAUNCH",
      decimals: 18,
      total_supply: n(1000n * E24),
      start_time: start,
      end_time: start + DAY,
      target_tick: -230000,
      upper_tick: -160000,
      tick_spacing: 1000,
      initial_fee: n(1n << 60n),
      final_fee: n(1n << 56n),
      migration_tick_lower: -887000,
      migration_tick_upper: 887000,
    })}
  `;
}

async function swap(
  tx: Sql,
  poolKeyId: bigint,
  blockNumber: number,
  locker: bigint,
  delta0: bigint,
  delta1: bigint,
  fee: bigint,
  feeIsToken1: boolean,
) {
  await tx`
    INSERT INTO scheduled_launch_swapped ${tx({
      ...ev(blockNumber, 2),
      emitter: n(SL),
      pool_key_id: n(poolKeyId),
      pool_id: n(POOL_ID),
      locker: n(locker),
      delta0: n(delta0),
      delta1: n(delta1),
      fee_amount: n(fee),
      fee_is_token1: feeIsToken1,
    })}
  `;
}

async function advanced(
  tx: Sql,
  poolKeyId: bigint,
  blockNumber: number,
  complete: boolean,
) {
  await tx`
    INSERT INTO scheduled_launch_advanced ${tx({
      ...ev(blockNumber, 0),
      emitter: n(SL),
      pool_key_id: n(poolKeyId),
      pool_id: n(POOL_ID),
      deployed: n(250n * E24),
      reserve0: n(2n * E18),
      reserve1: n(750n * E24),
      complete,
    })}
  `;
}

let launchKey = 0n;

// One routed launch on Base starting at T0 with two buys, one sell, a creator
// fee claim, a LAUNCH_FUND top-up and a migration; plus a second, later launch
// created directly on the extension.
async function seed(tx: Sql) {
  for (const [number, offset] of [
    [100, -3600],
    [101, 60],
    [102, 120],
    [103, 180],
    [104, 240],
    [105, 300],
    [110, 7200],
  ]) {
    await block(tx, number, T0 + offset);
  }
  await setHead(tx, T0 - 10);
  await tx`
    INSERT INTO erc20_tokens (chain_id, token_address, token_symbol, token_name, token_decimals, visibility_priority, sort_order)
    VALUES (${n(CHAIN)}, ${n(WETH)}, 'WETH', 'Wrapped Ether', 18, 0, 0)
    ON CONFLICT DO NOTHING
  `;

  launchKey = await poolKey(tx, POOL_ID, SL);
  const terminalKey = await poolKey(tx, TERMINAL_POOL_ID, TWAMM);
  const otherKey = await poolKey(tx, OTHER_POOL_ID, SL);
  await tx`
    INSERT INTO pool_states (pool_key_id, sqrt_ratio, tick, liquidity, last_event_id)
    VALUES (${n(launchKey)}, ${n(1n << 128n)}, 0, 5000, 1)
  `;

  await created(tx, launchKey, POOL_ID, 100, T0);
  await tx`
    INSERT INTO launch_created_by ${tx({
      ...ev(100, 1),
      emitter: n(ROUTER),
      pool_key_id: n(launchKey),
      launch_id: n(POOL_ID),
      creator: n(CREATOR),
    })}
  `;
  await created(tx, otherKey, OTHER_POOL_ID, 110, T0 + 2 * DAY);

  // token1 is the launch token: a buy moves quote (token0) in and launch
  // tokens out
  await advanced(tx, launchKey, 101, false);
  await swap(tx, launchKey, 101, YUL_ROUTER, E18, -20n * E24, 100n, true);
  await swap(tx, launchKey, 102, YUL_ROUTER, E18, -20n * E24, 100n, true);
  await swap(
    tx,
    launchKey,
    103,
    OTHER_ROUTER,
    -4n * 10n ** 16n,
    E24,
    200n,
    false,
  );

  await tx`
    INSERT INTO scheduled_launch_creator_fees_claimed ${tx({
      ...ev(104),
      emitter: n(SL),
      pool_key_id: n(launchKey),
      pool_id: n(POOL_ID),
      recipient: n(CREATOR),
      amount0: "150",
      amount1: "0",
    })}
  `;
  await tx`
    INSERT INTO launch_principal_received ${tx({
      ...ev(104, 1),
      emitter: n(LLL),
      pool_key_id: n(launchKey),
      launch_id: n(POOL_ID),
      from_address: n(ROUTER),
      amount0: "5",
      amount1: "0",
    })}
  `;
  await tx`
    INSERT INTO launch_principal_received ${tx({
      ...ev(105, 1),
      emitter: n(LLL),
      pool_key_id: n(launchKey),
      launch_id: n(POOL_ID),
      from_address: n(SL),
      amount0: n(2n * E18),
      amount1: n(700n * E24),
    })}
  `;
  await tx`
    INSERT INTO launch_liquidity_locked ${tx({
      ...ev(105, 2),
      emitter: n(LLL),
      pool_key_id: n(launchKey),
      launch_id: n(POOL_ID),
      terminal_pool_key_id: n(terminalKey),
      terminal_pool_id: n(TERMINAL_POOL_ID),
      liquidity: "777",
    })}
  `;
}

async function statuses(q: Queries) {
  const { rows } = await q.listLaunches({
    chainId: CHAIN,
    status: null,
    creator: null,
    page: 1,
    pageSize: 10,
  });
  return Object.fromEntries(rows.map((r) => [r.pool_id, r.status]));
}

describe.skipIf(!URL)("launch queries against the indexer schema", () => {
  test("status follows the indexed head block time", async () => {
    await withFixture(async (q, tx) => {
      expect(await statuses(q)).toEqual({
        [n(POOL_ID)]: "upcoming",
        [n(OTHER_POOL_ID)]: "upcoming",
      });
      await setHead(tx, T0);
      expect((await statuses(q))[n(POOL_ID)]).toBe("live");
      await setHead(tx, T0 + DAY - 1);
      expect((await statuses(q))[n(POOL_ID)]).toBe("live");
      await setHead(tx, T0 + DAY);
      expect((await statuses(q))[n(POOL_ID)]).toBe("ended");
      await advanced(tx, launchKey, 105, true);
      expect((await statuses(q))[n(POOL_ID)]).toBe("migrated");
      // a migrated launch stays migrated whatever the head says
      await setHead(tx, T0 - 10);
      expect((await statuses(q))[n(POOL_ID)]).toBe("migrated");
    });
  });

  test("list filters and pagination", async () => {
    await withFixture(async (q, tx) => {
      await setHead(tx, T0 + 100);
      const all = await q.listLaunches({
        chainId: CHAIN,
        status: null,
        creator: null,
        page: 1,
        pageSize: 1,
      });
      expect(all.totalCount).toBe(2);
      // newest first
      expect(all.rows.map((r) => r.pool_id)).toEqual([n(OTHER_POOL_ID)]);

      const live = await q.listLaunches({
        chainId: null,
        status: "live",
        creator: null,
        page: 1,
        pageSize: 10,
      });
      expect(live.totalCount).toBe(1);
      const [row] = live.rows;
      expect(row.pool_id).toBe(n(POOL_ID));
      expect(row.creator).toBe(n(CREATOR));
      expect(row.owner).toBe(n(ROUTER));
      expect(row.token_symbol).toBe("LAUNCH");
      expect(row.quote_token_symbol).toBe("WETH");
      expect(row.token_is_token1).toBe(true);
      expect(row.start_time).toBe(BigInt(T0));
      expect(row.deployed).toBe(n(250n * E24));
      expect(row.created_block_number).toBe(100n);
      expect(row.created_time.getTime()).toBe((T0 - 3600) * 1000);

      const byCreator = await q.listLaunches({
        chainId: CHAIN,
        status: null,
        creator: CREATOR,
        page: 1,
        pageSize: 10,
      });
      expect(byCreator.rows.map((r) => r.pool_id)).toEqual([n(POOL_ID)]);

      const otherChain = await q.listLaunches({
        chainId: 1n,
        status: null,
        creator: null,
        page: 1,
        pageSize: 10,
      });
      expect(otherChain).toEqual({ rows: expect.any(Array), totalCount: 0 });
    });
  });

  test("detail", async () => {
    await withFixture(async (q) => {
      const row = await q.getLaunch(CHAIN, POOL_ID);
      expect(row).not.toBeNull();
      expect(row!.state_sqrt_ratio).toBe(n(1n << 128n));
      expect(row!.state_liquidity).toBe("5000");
      expect(row!.advanced_block_number).toBe(101n);
      expect(row!.terminal_pool_id).toBe(n(TERMINAL_POOL_ID));
      expect(row!.locked_liquidity).toBe("777");
      expect(row!.creator_fees_claimed0).toBe("150");
      expect(row!.creator_fees_claimed1).toBe("0");

      const other = await q.getLaunch(CHAIN, OTHER_POOL_ID);
      expect(other!.creator).toBeNull();
      expect(other!.advanced_block_number).toBeNull();
      expect(other!.terminal_pool_id).toBeNull();
      expect(other!.state_sqrt_ratio).toBeNull();

      expect(await q.getLaunch(CHAIN, TERMINAL_POOL_ID)).toBeNull();
      expect(await q.getLaunch(1n, POOL_ID)).toBeNull();
    });
  });

  test("stats", async () => {
    await withFixture(async (q) => {
      expect(await q.getLaunchStats(CHAIN, POOL_ID)).toEqual({
        swap_count: 3,
        buy_count: 2,
        sell_count: 1,
        buy_quote_in: n(2n * E18),
        buy_token_out: n(40n * E24),
        sell_token_in: n(E24),
        sell_quote_out: n(4n * 10n ** 16n),
        distinct_lockers: 2,
        distinct_transactions: 3,
        fees_accrued_token: "200",
        fees_accrued_quote: "200",
        fees_claimed_token: "0",
        fees_claimed_quote: "150",
        fee_claim_count: 1,
        funding_token: "0",
        funding_quote: "5",
        funding_count: 1,
        migrated_principal_token: n(700n * E24),
        migrated_principal_quote: n(2n * E18),
      });
      const empty = await q.getLaunchStats(CHAIN, OTHER_POOL_ID);
      expect(empty!.swap_count).toBe(0);
      expect(empty!.buy_quote_in).toBe("0");
      expect(empty!.fee_claim_count).toBe(0);
      expect(await q.getLaunchStats(CHAIN, TERMINAL_POOL_ID)).toBeNull();
    });
  });

  test("swaps page by event id", async () => {
    await withFixture(async (q) => {
      const first = await q.listLaunchSwaps({
        chainId: CHAIN,
        poolId: POOL_ID,
        cursor: null,
        limit: 2,
      });
      expect(first.map((r) => r.block_number)).toEqual([101n, 102n]);
      expect(first[0].delta1).toBe(n(-20n * E24));
      expect(first[0].block_time!.getTime()).toBe((T0 + 60) * 1000);

      const rest = await q.listLaunchSwaps({
        chainId: CHAIN,
        poolId: POOL_ID,
        cursor: first[1].event_id,
        limit: 2,
      });
      expect(rest.map((r) => r.locker)).toEqual([n(OTHER_ROUTER)]);

      const none = await q.listLaunchSwaps({
        chainId: CHAIN,
        poolId: OTHER_POOL_ID,
        cursor: null,
        limit: 2,
      });
      expect(none).toHaveLength(1);
      expect(none[0].event_id).toBeNull();

      expect(
        await q.listLaunchSwaps({
          chainId: CHAIN,
          poolId: TERMINAL_POOL_ID,
          cursor: null,
          limit: 2,
        }),
      ).toHaveLength(0);
    });
  });
});
