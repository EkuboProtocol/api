import type postgres from "postgres";
import type { Sql } from "postgres";
import { z } from "@hono/zod-openapi";
import { StatusError } from "../../shared/errors";
import { feeSchedule, supportedInstances, type LaunchInstance } from "./policy";
import {
  BlockRef,
  ClaimPage,
  LaunchDetail,
  LaunchList,
  OwnerPage,
  SCHEMA_VERSION,
  SwapPage,
} from "./schema";

type DB = Sql<{ bigint: bigint }>;
type Numeric = string | bigint;
interface EventRow {
  event_id: bigint;
  block_number: bigint;
  block_hash: Numeric;
  block_time: Date;
  transaction_index: number;
  event_index: number;
  transaction_hash: Numeric;
}
interface LaunchRow extends EventRow {
  chain_id: bigint;
  pool_id: Numeric;
  pool_key_id: bigint;
  core_address: Numeric;
  emitter: Numeric;
  token0: Numeric;
  token1: Numeric;
  token: Numeric;
  quote_token: Numeric;
  quote_kind: "native" | "erc20";
  controller: Numeric;
  initial_owner: Numeric;
  current_owner: Numeric;
  owner_change_count: bigint;
  name: string;
  symbol: string;
  decimals: number;
  quote_name: string | null;
  quote_symbol: string | null;
  quote_decimals: number | null;
  token_is_token1: boolean;
  ask_tick: number;
  upper_tick: number;
  tick_spacing: bigint;
  trading_start: bigint;
  fee_duration: bigint;
  initial_fee: Numeric;
  final_fee: Numeric;
  position_id: Numeric;
  tick_lower: number;
  tick_upper: number;
  liquidity: Numeric;
  supply: Numeric;
  balance0: Numeric;
  balance1: Numeric;
  tick: number;
  accrued0: Numeric;
  accrued1: Numeric;
  claimed0: Numeric;
  claimed1: Numeric;
  swap_count: bigint;
  claim_count: bigint;
  last_event_id: bigint;
}
const decimal = (n: Numeric) => n.toString();
const hex = (n: Numeric, width: number) =>
  `0x${BigInt(n)
    .toString(16)
    .padStart(width * 2, "0")}`;
const seconds = (date: Date) => Math.floor(date.getTime() / 1000);
function parseIndexed<T extends z.ZodType>(
  schema: T,
  value: unknown,
): z.output<T> {
  const result = schema.safeParse(value);
  if (!result.success) throw new Error("Invalid indexed launch data");
  return result.data;
}
function event(row: EventRow) {
  return {
    event_id: decimal(row.event_id),
    block_number: decimal(row.block_number),
    block_hash: hex(row.block_hash, 32),
    block_time: seconds(row.block_time),
    transaction_index: row.transaction_index,
    event_index: row.event_index,
    transaction_hash: hex(row.transaction_hash, 32),
  };
}
function summary(row: LaunchRow, asOf: z.infer<typeof BlockRef>) {
  return {
    schema_version: SCHEMA_VERSION,
    chain_id: decimal(row.chain_id),
    pool_id: hex(row.pool_id, 32),
    pool_key: {
      core_address: hex(row.core_address, 20),
      token0: hex(row.token0, 20),
      token1: hex(row.token1, 20),
      config: hex(
        (BigInt(row.emitter) << 96n) | (1n << 31n) | row.tick_spacing,
        32,
      ),
      fee: "0" as const,
      tick_spacing: Number(row.tick_spacing),
      extension: hex(row.emitter, 20),
    },
    token: {
      address: hex(row.token, 20),
      name: row.name,
      symbol: row.symbol,
      decimals: row.decimals,
    },
    quote_token: quoteToken(row),
    launch_token_is_token1: row.token_is_token1,
    controller: hex(row.controller, 20),
    creator: hex(row.initial_owner, 20),
    owner: hex(row.current_owner, 20),
    ask_tick: row.ask_tick,
    upper_tick: row.upper_tick,
    fee_schedule: feeSchedule({
      start: row.trading_start,
      duration: row.fee_duration,
      initial: BigInt(row.initial_fee),
      final: BigInt(row.final_fee),
      indexedTime: BigInt(asOf.block_time),
    }),
    created: event(row),
    as_of: asOf,
  };
}
// Native ETH has no token contract: 18 decimals, no ERC-20 metadata.
function quoteToken(row: LaunchRow) {
  if (row.quote_kind === "native")
    return {
      address: hex(row.quote_token, 20),
      name: null,
      symbol: null,
      decimals: 18,
      kind: "native" as const,
    };
  return {
    address: hex(row.quote_token, 20),
    name: row.quote_name,
    symbol: row.quote_symbol,
    decimals: row.quote_decimals,
    kind: "erc20" as const,
  };
}
function ledger(accrued: Numeric, claimed: Numeric) {
  return {
    accrued: decimal(accrued),
    claimed: decimal(claimed),
    unclaimed: (BigInt(accrued) - BigInt(claimed)).toString(),
  };
}
function detail(row: LaunchRow, asOf: z.infer<typeof BlockRef>) {
  const launch = summary(row, asOf);
  const [tokenBalance, quoteBalance] = row.token_is_token1
    ? [row.balance1, row.balance0]
    : [row.balance0, row.balance1];
  return parseIndexed(LaunchDetail, {
    ...launch,
    principal: {
      position_id: hex(row.position_id, 32),
      tick_lower: row.tick_lower,
      tick_upper: row.tick_upper,
      liquidity: decimal(row.liquidity),
      installed_supply: decimal(row.supply),
      locked: true,
      withdrawable: false,
      pool_reserves: {
        launch_token: decimal(tokenBalance),
        quote_token: decimal(quoteBalance),
      },
      reserves_basis: "core_pool_balance",
    },
    fee_ledger: {
      holder: launch.owner,
      transferable: true,
      launch_token: row.token_is_token1
        ? ledger(row.accrued1, row.claimed1)
        : ledger(row.accrued0, row.claimed0),
      quote_token: row.token_is_token1
        ? ledger(row.accrued0, row.claimed0)
        : ledger(row.accrued1, row.claimed1),
      swap_count: Number(row.swap_count),
      claim_count: Number(row.claim_count),
      owner_change_count: Number(row.owner_change_count),
      last_event_id: decimal(row.last_event_id),
    },
    inventory: {
      trading_open: asOf.block_time >= Number(row.trading_start),
      no_bid: BigInt(quoteBalance) === 0n,
      price_tick: row.token_is_token1 ? -row.tick : row.tick,
    },
  });
}

export interface LaunchReadOptions {
  chainId: bigint;
  cursor?: bigint;
  limit: number;
}

/** All constituent reads share a read-only repeatable-read snapshot. */
export class LaunchQueries {
  private readonly enabled: readonly LaunchInstance[];
  constructor(
    private readonly sql: DB,
    options: {
      localHarness: boolean;
      instances: readonly LaunchInstance[];
      maxIndexAgeSeconds: number;
    } = { localHarness: false, instances: [], maxIndexAgeSeconds: 60 },
  ) {
    this.enabled = supportedInstances(options.instances, options.localHarness);
    this.maxAge = options.maxIndexAgeSeconds;
    if (!Number.isFinite(this.maxAge) || this.maxAge <= 0) {
      throw new Error("Invalid local index freshness bound");
    }
  }
  private readonly maxAge: number;

  private async snapshot<T>(
    chainId: bigint,
    read: (tx: DB, asOf: z.infer<typeof BlockRef>) => Promise<T>,
  ): Promise<T> {
    if (!this.enabled.some((p) => p.chainId === chainId.toString())) {
      throw new StatusError(404, "Launch support is disabled");
    }
    return this.sql.begin(
      "isolation level repeatable read read only",
      async (tx) => {
        const db = tx as unknown as DB;
        const [head] = await db<
          {
            block_number: bigint;
            block_hash: Numeric;
            block_time: Date;
            last_updated: Date;
          }[]
        >`
        SELECT b.block_number, b.block_hash, b.block_time, ic.last_updated
        FROM indexer_cursor ic JOIN blocks b
          ON b.chain_id = ic.chain_id AND b.block_number = ic.head_block_number
             AND b.block_hash = ic.head_block_hash
        WHERE ic.chain_id = ${chainId}
      `;
        if (
          !head ||
          Date.now() - head.last_updated.getTime() > this.maxAge * 1000
        ) {
          throw new StatusError(
            503,
            "Launch index is stale or has no coherent head",
          );
        }
        const asOf = parseIndexed(BlockRef, {
          block_number: decimal(head.block_number),
          block_hash: hex(head.block_hash, 32),
          block_time: seconds(head.block_time),
        });
        return read(db, asOf);
      },
    ) as Promise<T>;
  }

  private rows(tx: DB, chainId: bigint, filter: postgres.Fragment) {
    // Screening occurs in SQL BEFORE cursor/limit; no arbitrary quote can
    // occupy a page or be served by detail/history.
    const pins = this.enabled.filter((p) => p.chainId === chainId.toString());
    // Only launches created through the instance's periphery have an owner.
    const checks = pins.map(
      (p) => tx`
      (c.emitter = ${BigInt(p.address).toString()}::numeric
       AND c.controller = ${BigInt(p.periphery).toString()}::numeric
       AND c.quote_token = ${BigInt(p.quote).toString()}::numeric
       AND c.quote_kind = ${p.quoteKind}
       AND pk.core_address = ${BigInt(p.core).toString()}::numeric)
    `,
    );
    const supported = checks.reduce((a, b) => tx`${a} OR ${b}`);
    return tx<LaunchRow[]>`
      SELECT c.*, b.block_hash, b.block_time, pk.core_address, pk.token0, pk.token1,
             qt.token_name AS quote_name, qt.token_symbol AS quote_symbol,
             qt.token_decimals AS quote_decimals, s.accrued0, s.accrued1,
             s.claimed0, s.claimed1, s.swap_count, s.claim_count, s.last_event_id,
             s.initial_owner, s.current_owner, s.owner_change_count,
             pt.balance0, pt.balance1, ps.tick
      FROM zero_seed_launch_created c
      JOIN zero_seed_launch_pool_keys registration USING (pool_key_id)
      JOIN pool_keys pk USING (pool_key_id)
      JOIN blocks b ON b.chain_id = c.chain_id AND b.block_number = c.block_number
      JOIN zero_seed_launch_states s USING (pool_key_id)
      JOIN pool_states ps USING (pool_key_id)
      JOIN pool_tvl pt USING (pool_key_id)
      LEFT JOIN erc20_tokens qt ON qt.chain_id = c.chain_id AND qt.token_address = c.quote_token
                                AND c.quote_kind = 'erc20'
      WHERE c.chain_id = ${chainId} AND pk.chain_id = c.chain_id
        AND pk.pool_extension = c.emitter AND pk.fee = 0
        AND pk.token0 = LEAST(c.token, c.quote_token)
        AND pk.token1 = GREATEST(c.token, c.quote_token)
        AND pk.tick_spacing = c.tick_spacing
        AND s.current_owner IS NOT NULL AND s.initial_owner IS NOT NULL
        AND (${supported}) AND ${filter}
    `;
  }

  async list(input: LaunchReadOptions & { creator?: bigint; owner?: bigint }) {
    return this.snapshot(input.chainId, async (tx, asOf) => {
      const creator = input.creator?.toString() ?? null;
      const owner = input.owner?.toString() ?? null;
      const filter = tx`
        (${input.cursor ?? null}::int8 IS NULL OR c.event_id < ${input.cursor ?? null})
        AND (${creator}::numeric IS NULL OR s.initial_owner = ${creator})
        AND (${owner}::numeric IS NULL OR s.current_owner = ${owner})
      `;
      const rows = await tx<LaunchRow[]>`
        SELECT * FROM (${this.rows(tx, input.chainId, filter)}) l
        ORDER BY event_id DESC LIMIT ${input.limit + 1}
      `;
      const page = rows.slice(0, input.limit);
      return parseIndexed(LaunchList, {
        schema_version: SCHEMA_VERSION,
        as_of: asOf,
        data: page.map((r) => summary(r, asOf)),
        next_cursor:
          rows.length > input.limit ? page.at(-1)!.event_id.toString() : null,
      });
    });
  }

  private async launch(tx: DB, chainId: bigint, poolId: bigint) {
    const [row] = await this.rows(
      tx,
      chainId,
      tx`c.pool_id = ${poolId.toString()}::numeric`,
    );
    if (!row) throw new StatusError(404, "Launch not found");
    return row;
  }

  async detail(chainId: bigint, poolId: bigint) {
    return this.snapshot(chainId, async (tx, asOf) =>
      detail(await this.launch(tx, chainId, poolId), asOf),
    );
  }

  async swaps(input: LaunchReadOptions & { poolId: bigint }) {
    return this.snapshot(input.chainId, async (tx, asOf) => {
      const launch = await this.launch(tx, input.chainId, input.poolId);
      const rows = await tx<
        (EventRow & {
          locker: Numeric;
          delta0: Numeric;
          delta1: Numeric;
          fee_rate: Numeric;
          fee_amount: Numeric;
          fee_is_token1: boolean;
        })[]
      >`
        SELECT s.*, b.block_hash, b.block_time FROM zero_seed_launch_swapped s
        JOIN blocks b ON b.chain_id = s.chain_id AND b.block_number = s.block_number
        WHERE s.pool_key_id = ${launch.pool_key_id}
          AND (${input.cursor ?? null}::int8 IS NULL OR s.event_id > ${input.cursor ?? null})
        ORDER BY s.event_id LIMIT ${input.limit + 1}
      `;
      const data = rows.slice(0, input.limit).map((row) => {
        const [token, quote] = launch.token_is_token1
          ? [row.delta1, row.delta0]
          : [row.delta0, row.delta1];
        return {
          event: event(row),
          forwarding_locker: hex(row.locker, 20),
          direction: swapDirection(BigInt(token), BigInt(quote)),
          launch_token_delta: decimal(token),
          quote_token_delta: decimal(quote),
          fee_rate: decimal(row.fee_rate),
          fee_amount: decimal(row.fee_amount),
          fee_asset:
            row.fee_is_token1 === launch.token_is_token1
              ? "launch_token"
              : "quote_token",
        };
      });
      return parseIndexed(SwapPage, {
        schema_version: SCHEMA_VERSION,
        chain_id: input.chainId.toString(),
        pool_id: hex(input.poolId, 32),
        as_of: asOf,
        data,
        next_cursor:
          rows.length > input.limit ? data.at(-1)!.event.event_id : null,
      });
    });
  }

  async claims(input: LaunchReadOptions & { poolId: bigint }) {
    return this.snapshot(input.chainId, async (tx, asOf) => {
      const launch = await this.launch(tx, input.chainId, input.poolId);
      // The periphery payout, joined to the extension claim it pays out; the
      // ledger moved once, by the latter.
      const rows = await tx<
        (EventRow & {
          claimed_event_id: bigint;
          owner: Numeric;
          recipient: Numeric;
          amount0: Numeric;
          amount1: Numeric;
        })[]
      >`
        SELECT p.*, b.block_hash, b.block_time FROM zero_seed_launch_fees_paid p
        JOIN zero_seed_launch_fees_claimed cl
          ON cl.chain_id = p.chain_id AND cl.event_id = p.claimed_event_id
             AND cl.pool_key_id = p.pool_key_id
             AND (cl.amount0, cl.amount1) = (p.amount0, p.amount1)
        JOIN blocks b ON b.chain_id = p.chain_id AND b.block_number = p.block_number
        WHERE p.pool_key_id = ${launch.pool_key_id}
          AND (${input.cursor ?? null}::int8 IS NULL OR p.event_id > ${input.cursor ?? null})
        ORDER BY p.event_id LIMIT ${input.limit + 1}
      `;
      const data = rows.slice(0, input.limit).map((row) => ({
        event: event(row),
        ledger_event_id: decimal(row.claimed_event_id),
        owner: hex(row.owner, 20),
        recipient: hex(row.recipient, 20),
        launch_token_amount: decimal(
          launch.token_is_token1 ? row.amount1 : row.amount0,
        ),
        quote_token_amount: decimal(
          launch.token_is_token1 ? row.amount0 : row.amount1,
        ),
      }));
      return parseIndexed(ClaimPage, {
        schema_version: SCHEMA_VERSION,
        chain_id: input.chainId.toString(),
        pool_id: hex(input.poolId, 32),
        as_of: asOf,
        data,
        next_cursor:
          rows.length > input.limit ? data.at(-1)!.event.event_id : null,
      });
    });
  }

  async owners(input: LaunchReadOptions & { poolId: bigint }) {
    return this.snapshot(input.chainId, async (tx, asOf) => {
      const launch = await this.launch(tx, input.chainId, input.poolId);
      const rows = await tx<
        (EventRow & { previous_owner: Numeric; new_owner: Numeric })[]
      >`
        SELECT o.*, b.block_hash, b.block_time FROM zero_seed_launch_owner_changed o
        JOIN blocks b ON b.chain_id = o.chain_id AND b.block_number = o.block_number
        WHERE o.pool_key_id = ${launch.pool_key_id}
          AND (${input.cursor ?? null}::int8 IS NULL OR o.event_id > ${input.cursor ?? null})
        ORDER BY o.event_id LIMIT ${input.limit + 1}
      `;
      const data = rows.slice(0, input.limit).map((row) => ({
        event: event(row),
        previous_owner:
          BigInt(row.previous_owner) === 0n
            ? null
            : hex(row.previous_owner, 20),
        new_owner: hex(row.new_owner, 20),
      }));
      return parseIndexed(OwnerPage, {
        schema_version: SCHEMA_VERSION,
        chain_id: input.chainId.toString(),
        pool_id: hex(input.poolId, 32),
        as_of: asOf,
        data,
        next_cursor:
          rows.length > input.limit ? data.at(-1)!.event.event_id : null,
      });
    });
  }
}

function swapDirection(token: bigint, quote: bigint) {
  if (token === 0n && quote === 0n) return "zero_fill";
  if (token <= 0n && quote >= 0n) return "buy";
  if (token >= 0n && quote <= 0n) return "sell";
  throw new Error("Invalid indexed swap direction");
}
