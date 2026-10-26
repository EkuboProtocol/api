import type postgres from "postgres";
import type { Sql } from "postgres";
import { z } from "@hono/zod-openapi";
import { StatusError } from "../../shared/errors";
import {
  alignedRange,
  feeSchedule,
  launchStatus,
  launchSupply,
  marketData,
  seconds,
  supportedInstances,
  supportedQuotes,
  unpackString,
  utf8OrNull,
  type LaunchInstance,
  type LaunchQuote,
} from "./policy";
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
type Head = z.infer<typeof BlockRef>;
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
  name_word: Numeric;
  symbol_word: Numeric;
  logo_url_bytes: Uint8Array;
  quote_name: string | null;
  quote_symbol: string | null;
  quote_decimals: number | null;
  token_is_token1: boolean;
  ask_tick: number;
  upper_tick: number;
  tick_spacing: bigint;
  aligned_ask_tick: number;
  aligned_upper_tick: number;
  tick_lower: number;
  tick_upper: number;
  trading_start: Numeric;
  decay_rate_x32: Numeric;
  initial_fee: Numeric;
  final_fee: Numeric;
  salt: Numeric;
  position_id: Numeric;
  liquidity: Numeric;
  requested_supply: Numeric;
  installed_supply: Numeric;
  sink_supply: Numeric;
  balance0: Numeric;
  balance1: Numeric;
  sqrt_ratio: Numeric;
  tick: number;
  accrued0: Numeric;
  accrued1: Numeric;
  claimed0: Numeric;
  claimed1: Numeric;
  swap_count: bigint;
  claim_count: bigint;
  last_event_id: bigint;
  market_cap_usd: string | null;
  volume: Numeric;
  volume_usd: string | null;
}
const decimal = (n: Numeric) => n.toString();
const hex = (n: Numeric, width: number) =>
  `0x${BigInt(n)
    .toString(16)
    .padStart(width * 2, "0")}`;
const epoch = (date: Date) => Math.floor(date.getTime() / 1000);
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
    block_time: epoch(row.block_time),
    transaction_index: row.transaction_index,
    event_index: row.event_index,
    transaction_hash: hex(row.transaction_hash, 32),
  };
}
// The installed range must be the one the contract derives from the
// requested ticks; anything else is malformed indexed data.
function range(row: LaunchRow) {
  const derived = alignedRange(row.ask_tick, row.upper_tick);
  const [lower, upper] = row.token_is_token1
    ? [-derived.aligned_upper_tick, -derived.aligned_ask_tick]
    : [derived.aligned_ask_tick, derived.aligned_upper_tick];
  if (
    derived.tick_spacing !== Number(row.tick_spacing) ||
    derived.aligned_ask_tick !== row.aligned_ask_tick ||
    derived.aligned_upper_tick !== row.aligned_upper_tick ||
    lower !== row.tick_lower ||
    upper !== row.tick_upper
  )
    throw new Error("Invalid indexed launch range");
  return { ...derived, pool_tick_lower: lower, pool_tick_upper: upper };
}
function summary(row: LaunchRow, asOf: Head, time: bigint) {
  const start = BigInt(row.trading_start);
  const [tokenReserve, quoteReserve] = row.token_is_token1
    ? [row.balance1, row.balance0]
    : [row.balance0, row.balance1];
  const supply = launchSupply({
    requested: BigInt(row.requested_supply),
    installed: BigInt(row.installed_supply),
    sink: BigInt(row.sink_supply),
  });
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
      name: unpackString(BigInt(row.name_word)),
      symbol: unpackString(BigInt(row.symbol_word)),
      decimals: 18 as const,
    },
    quote_token: quoteToken(row),
    launch_token_is_token1: row.token_is_token1,
    controller: hex(row.controller, 20),
    creator: hex(row.initial_owner, 20),
    owner: hex(row.current_owner, 20),
    logo_url: utf8OrNull(row.logo_url_bytes),
    parameters: {
      name: hex(row.name_word, 32),
      symbol: hex(row.symbol_word, 32),
      supply: supply.requested,
      quote_token: hex(row.quote_token, 20),
      ask_tick: row.ask_tick.toString(),
      upper_tick: row.upper_tick.toString(),
      trading_start: decimal(row.trading_start),
      decay_rate_x32: decimal(row.decay_rate_x32),
      initial_fee: decimal(row.initial_fee),
      final_fee: decimal(row.final_fee),
      salt: hex(row.salt, 32),
    },
    range: range(row),
    supply,
    trading_start: seconds(start),
    status: launchStatus(start, time),
    fee_schedule: feeSchedule({
      start,
      initial: BigInt(row.initial_fee),
      final: BigInt(row.final_fee),
      rate: BigInt(row.decay_rate_x32),
      time,
    }),
    market: marketData({
      sqrtRatio: BigInt(row.sqrt_ratio),
      tick: row.tick,
      launchIsToken1: row.token_is_token1,
      totalSupply: BigInt(row.requested_supply),
      installed: BigInt(row.installed_supply),
      tokenReserve: BigInt(tokenReserve),
      quoteReserve: BigInt(quoteReserve),
      marketCapUsd: row.market_cap_usd,
      tradeCount: row.swap_count,
      volume: BigInt(row.volume),
      volumeUsd: row.volume_usd,
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
function detail(row: LaunchRow, asOf: Head, time: bigint) {
  const launch = summary(row, asOf, time);
  const [tokenBalance, quoteBalance] = row.token_is_token1
    ? [row.balance1, row.balance0]
    : [row.balance0, row.balance1];
  const [tokenSide, quoteSide] = row.token_is_token1
    ? [ledger(row.accrued1, row.claimed1), ledger(row.accrued0, row.claimed0)]
    : [ledger(row.accrued0, row.claimed0), ledger(row.accrued1, row.claimed1)];
  return parseIndexed(LaunchDetail, {
    ...launch,
    principal: {
      position_id: hex(row.position_id, 32),
      liquidity: decimal(row.liquidity),
      locked: true,
      withdrawable: false,
      pool_reserves: {
        launch_token: decimal(tokenBalance),
        quote_token: decimal(quoteBalance),
      },
    },
    fee_ledger: {
      holder: launch.owner,
      launch_token: tokenSide,
      quote_token: quoteSide,
      swap_count: Number(row.swap_count),
      claim_count: Number(row.claim_count),
      owner_change_count: Number(row.owner_change_count),
      last_event_id: decimal(row.last_event_id),
    },
  });
}

export type LaunchStatusFilter = "all" | "trading" | "upcoming";
export type LaunchOrder =
  | "market_cap"
  | "volume"
  | "sold_share"
  | "trade_count"
  | "created";

export interface LaunchReadOptions {
  chainId: bigint;
  cursor?: bigint;
  limit: number;
}

export interface LaunchListOptions {
  chainId?: bigint;
  status: LaunchStatusFilter;
  owner?: bigint;
  creator?: bigint;
  orderBy: LaunchOrder;
  offset: number;
  limit: number;
}

interface ReaderOptions {
  localHarness: boolean;
  instances: readonly LaunchInstance[];
  quotes: readonly LaunchQuote[];
  maxIndexAgeSeconds: number;
  /** Seconds since the epoch at which status and fee rate are evaluated. */
  now?: () => bigint;
  /** The reviewed manifests the requested lists must match (tests only). */
  pins?: {
    instances: readonly LaunchInstance[];
    quotes: readonly LaunchQuote[];
  };
}

const HOSTED: ReaderOptions = {
  localHarness: false,
  instances: [],
  quotes: [],
  maxIndexAgeSeconds: 60,
};
const wallClock = () => BigInt(Math.floor(Date.now() / 1000));

/** All constituent reads share a read-only repeatable-read snapshot. */
export class LaunchQueries {
  private readonly enabled: readonly LaunchInstance[];
  private readonly quotes: readonly LaunchQuote[];
  private readonly maxAge: number;
  private readonly now: () => bigint;
  constructor(
    private readonly sql: DB,
    options: ReaderOptions = HOSTED,
  ) {
    this.enabled = supportedInstances(
      options.instances,
      options.localHarness,
      options.pins?.instances,
    );
    this.quotes = supportedQuotes(
      options.quotes,
      options.localHarness,
      options.pins?.quotes,
    );
    this.maxAge = options.maxIndexAgeSeconds;
    this.now = options.now ?? wallClock;
    if (!Number.isFinite(this.maxAge) || this.maxAge <= 0) {
      throw new Error("Invalid local index freshness bound");
    }
  }

  /** The enabled chains a request covers; none is a disabled launch read. */
  private chains(chainId?: bigint): string[] {
    const chains = [...new Set(this.enabled.map((p) => p.chainId))]
      .filter((c) => chainId === undefined || c === chainId.toString())
      .sort((a, b) => (BigInt(a) < BigInt(b) ? -1 : 1));
    if (chains.length === 0)
      throw new StatusError(404, "Launch support is disabled");
    return chains;
  }

  private async head(db: DB, chainId: string): Promise<Head> {
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
    if (!head || Date.now() - head.last_updated.getTime() > this.maxAge * 1000)
      throw new StatusError(
        503,
        `Launch index for chain ${chainId} is stale or has no coherent head`,
      );
    return parseIndexed(BlockRef, {
      block_number: decimal(head.block_number),
      block_hash: hex(head.block_hash, 32),
      block_time: epoch(head.block_time),
    });
  }

  private async snapshot<T>(
    chains: string[],
    read: (tx: DB, heads: Map<string, Head>, time: bigint) => Promise<T>,
  ): Promise<T> {
    const time = this.now();
    return this.sql.begin(
      "isolation level repeatable read read only",
      async (tx) => {
        const db = tx as unknown as DB;
        const heads = new Map<string, Head>();
        for (const chain of chains)
          heads.set(chain, await this.head(db, chain));
        return read(db, heads, time);
      },
    ) as Promise<T>;
  }

  /**
   * Supported launches of the given chains. Screening happens in SQL before
   * any order, offset or limit, so an unsupported launch never takes a slot.
   */
  private rows(tx: DB, chains: string[], filter: postgres.Fragment) {
    const pins = this.enabled.filter((p) => chains.includes(p.chainId));
    // Only launches created through the instance's periphery have an owner.
    const instance = pins
      .map(
        (p) => tx`
      (c.chain_id = ${p.chainId}::int8
       AND c.emitter = ${BigInt(p.address).toString()}::numeric
       AND c.controller = ${BigInt(p.periphery).toString()}::numeric
       AND pk.core_address = ${BigInt(p.core).toString()}::numeric)
    `,
      )
      .reduce((a, b) => tx`${a} OR ${b}`);
    // The launch's own quote: native ETH, or a reviewed ERC-20 of the chain.
    const erc20 = this.quotes
      .filter((q) => chains.includes(q.chainId))
      .map(
        (q) =>
          tx`(c.chain_id = ${q.chainId}::int8 AND c.quote_token = ${BigInt(q.address).toString()}::numeric)`,
      )
      .reduce((a, b) => tx`${a} OR ${b}`, tx`FALSE`);
    const chainList = chains
      .map((chain) => tx`${chain}::int8`)
      .reduce((a, b) => tx`${a}, ${b}`);
    const quote = tx`
      ((c.quote_kind = 'native' AND c.quote_token = 0)
       OR (c.quote_kind = 'erc20' AND c.quote_token <> 0 AND (${erc20})))
    `;
    // price_x128 = raw quote per raw launch token * 2^128 (Core's sqrt ratio
    // is Q128 token1 per token0); market cap = price * totalSupply. volume is
    // |quote delta| summed over every LaunchSwapped, fee-inclusive. The USD
    // values use the indexed quote price; the *_quote columns (whole quote
    // units) and sold_share_e18 exist only to order by.
    return tx<LaunchRow[]>`
      SELECT l.*, m.market_cap::text AS market_cap,
             CASE WHEN l.quote_price IS NULL THEN NULL
                  ELSE ROUND(m.market_cap / POWER(10::numeric, l.quote_decimals_effective)
                             * l.quote_price::numeric, 6)::text END AS market_cap_usd,
             CASE WHEN l.quote_price IS NULL THEN NULL
                  ELSE ROUND(l.volume / POWER(10::numeric, l.quote_decimals_effective)
                             * l.quote_price::numeric, 6)::text END AS volume_usd,
             m.market_cap / POWER(10::numeric, l.quote_decimals_effective) AS market_cap_quote,
             l.volume / POWER(10::numeric, l.quote_decimals_effective) AS volume_quote,
             DIV((l.installed_supply - LEAST(l.token_reserve, l.installed_supply))
                 * 1000000000000000000, NULLIF(l.installed_supply, 0)) AS sold_share_e18
      FROM (
        SELECT c.*, b.block_hash, b.block_time, pk.core_address, pk.token0, pk.token1,
               qt.token_name AS quote_name, qt.token_symbol AS quote_symbol,
               qt.token_decimals AS quote_decimals,
               CASE WHEN c.quote_kind = 'native' THEN 18 ELSE qt.token_decimals END AS quote_decimals_effective,
               qp.value AS quote_price,
               s.accrued0, s.accrued1, s.claimed0, s.claimed1, s.swap_count, s.claim_count,
               s.last_event_id, s.initial_owner, s.current_owner, s.owner_change_count,
               pt.balance0, pt.balance1, ps.tick, ps.sqrt_ratio, v.volume,
               CASE WHEN c.token_is_token1 THEN pt.balance1 ELSE pt.balance0 END AS token_reserve,
               CASE WHEN c.token_is_token1
                    THEN DIV(POWER(2::numeric, 384), ps.sqrt_ratio * ps.sqrt_ratio)
                    ELSE DIV(ps.sqrt_ratio * ps.sqrt_ratio, 340282366920938463463374607431768211456) END AS price_x128
        FROM zero_seed_launch_created c
        JOIN zero_seed_launch_pool_keys registration USING (pool_key_id)
        JOIN pool_keys pk USING (pool_key_id)
        JOIN blocks b ON b.chain_id = c.chain_id AND b.block_number = c.block_number
        JOIN zero_seed_launch_states s USING (pool_key_id)
        JOIN pool_states ps USING (pool_key_id)
        JOIN pool_tvl pt USING (pool_key_id)
        LEFT JOIN erc20_tokens qt ON qt.chain_id = c.chain_id AND qt.token_address = c.quote_token
                                  AND c.quote_kind = 'erc20'
        LEFT JOIN erc20_tokens_latest_price qp ON qp.chain_id = c.chain_id AND qp.token_address = c.quote_token
        CROSS JOIN LATERAL (
          SELECT COALESCE(SUM(ABS(CASE WHEN c.token_is_token1 THEN w.delta0 ELSE w.delta1 END)), 0) AS volume
          FROM zero_seed_launch_swapped w WHERE w.pool_key_id = c.pool_key_id
        ) v
        WHERE c.chain_id IN (${chainList}) AND pk.chain_id = c.chain_id
          AND pk.pool_extension = c.emitter AND pk.fee = 0
          AND pk.token0 = LEAST(c.token, c.quote_token)
          AND pk.token1 = GREATEST(c.token, c.quote_token)
          AND pk.tick_spacing = c.tick_spacing
          AND s.current_owner IS NOT NULL AND s.initial_owner IS NOT NULL
          AND (${instance}) AND ${quote} AND ${filter}
      ) l
      CROSS JOIN LATERAL (
        SELECT DIV(l.price_x128 * l.requested_supply, 340282366920938463463374607431768211456) AS market_cap
      ) m
    `;
  }

  async list(input: LaunchListOptions) {
    const chains = this.chains(input.chainId);
    return this.snapshot(chains, async (tx, heads, time) => {
      const creator = input.creator?.toString() ?? null;
      const owner = input.owner?.toString() ?? null;
      const filter = tx`
        (${creator}::numeric IS NULL OR s.initial_owner = ${creator}::numeric)
        AND (${owner}::numeric IS NULL OR s.current_owner = ${owner}::numeric)
      `;
      const now = time.toString();
      const status = {
        all: tx`TRUE`,
        trading: tx`l.trading_start <= ${now}::numeric`,
        upcoming: tx`l.trading_start > ${now}::numeric`,
      }[input.status];
      const [counts] = await tx<
        { all: number; trading: number; upcoming: number }[]
      >`
        SELECT COUNT(*)::int AS all,
               (COUNT(*) FILTER (WHERE l.trading_start <= ${now}::numeric))::int AS trading,
               (COUNT(*) FILTER (WHERE l.trading_start > ${now}::numeric))::int AS upcoming
        FROM (${this.rows(tx, chains, filter)}) l
      `;
      const groups = await tx<QuoteGroup[]>`
        SELECT l.chain_id, l.quote_token, COUNT(*)::int AS launch_count,
               SUM(l.swap_count)::text AS trade_count, SUM(l.volume)::text AS volume,
               SUM(l.market_cap::numeric)::text AS market_cap,
               SUM(l.volume_usd::numeric)::text AS volume_usd,
               SUM(l.market_cap_usd::numeric)::text AS market_cap_usd
        FROM (${this.rows(tx, chains, filter)}) l
        WHERE ${status}
        GROUP BY l.chain_id, l.quote_token ORDER BY l.chain_id, l.quote_token
      `;
      // The whole filtered set is ordered before the page is cut; the
      // creation order breaks ties.
      const rows = await tx<LaunchRow[]>`
        SELECT * FROM (${this.rows(tx, chains, filter)}) l
        WHERE ${status}
        ORDER BY ${orderBy(tx, input.orderBy)}, block_time DESC, chain_id, event_id DESC
        OFFSET ${input.offset} LIMIT ${input.limit + 1}
      `;
      const page = rows.slice(0, input.limit);
      return parseIndexed(LaunchList, {
        schema_version: SCHEMA_VERSION,
        data: page.map((r) =>
          summary(r, heads.get(r.chain_id.toString())!, time),
        ),
        total: counts[input.status],
        totals: counts,
        aggregates: aggregates(groups),
        next_offset:
          rows.length > input.limit ? input.offset + input.limit : null,
        evaluated_at: seconds(time),
        heads: chains.map((chain) => ({
          chain_id: chain,
          ...heads.get(chain)!,
        })),
      });
    });
  }

  private async launch(tx: DB, chainId: bigint, poolId: bigint) {
    const [row] = await this.rows(
      tx,
      [chainId.toString()],
      tx`c.pool_id = ${poolId.toString()}::numeric`,
    );
    if (!row) throw new StatusError(404, "Launch not found");
    return row;
  }

  async detail(chainId: bigint, poolId: bigint) {
    return this.snapshot(this.chains(chainId), async (tx, heads, time) =>
      detail(
        await this.launch(tx, chainId, poolId),
        heads.get(chainId.toString())!,
        time,
      ),
    );
  }

  private page<T extends z.ZodType>(
    schema: T,
    input: LaunchReadOptions & { poolId: bigint },
    asOf: Head,
    data: { event: { event_id: string } }[],
    more: boolean,
    extra: object = {},
  ) {
    return parseIndexed(schema, {
      schema_version: SCHEMA_VERSION,
      chain_id: input.chainId.toString(),
      pool_id: hex(input.poolId, 32),
      as_of: asOf,
      data,
      next_cursor: more ? data.at(-1)!.event.event_id : null,
      ...extra,
    });
  }

  async swaps(input: LaunchReadOptions & { poolId: bigint }) {
    const chains = this.chains(input.chainId);
    return this.snapshot(chains, async (tx, heads) => {
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
      return this.page(
        SwapPage,
        input,
        heads.get(chains[0])!,
        data,
        rows.length > input.limit,
      );
    });
  }

  async claims(input: LaunchReadOptions & { poolId: bigint }) {
    const chains = this.chains(input.chainId);
    return this.snapshot(chains, async (tx, heads) => {
      const launch = await this.launch(tx, input.chainId, input.poolId);
      // One row per claim, keyed on the extension event; the periphery
      // payout of the same transaction only names owner and recipient. A
      // periphery launch always has its payout; one without is malformed.
      const rows = await tx<
        (EventRow & {
          payout_event_id: bigint | null;
          owner: Numeric | null;
          recipient: Numeric | null;
          amount0: Numeric;
          amount1: Numeric;
        })[]
      >`
        SELECT cl.event_id, cl.block_number, cl.transaction_index, cl.event_index,
               cl.transaction_hash, cl.payout_event_id, cl.owner, cl.recipient,
               cl.amount0, cl.amount1, b.block_hash, b.block_time
        FROM zero_seed_launch_claims cl
        JOIN blocks b ON b.chain_id = cl.chain_id AND b.block_number = cl.block_number
        WHERE cl.pool_key_id = ${launch.pool_key_id}
          AND (${input.cursor ?? null}::int8 IS NULL OR cl.event_id > ${input.cursor ?? null})
        ORDER BY cl.event_id LIMIT ${input.limit + 1}
      `;
      const data = rows.slice(0, input.limit).map((row) => {
        if (
          row.payout_event_id === null ||
          row.owner === null ||
          row.recipient === null
        )
          throw new Error("Invalid indexed claim without its payout");
        return {
          event: event(row),
          payout_event_id: decimal(row.payout_event_id),
          owner: hex(row.owner, 20),
          recipient: hex(row.recipient, 20),
          launch_token_amount: decimal(
            launch.token_is_token1 ? row.amount1 : row.amount0,
          ),
          quote_token_amount: decimal(
            launch.token_is_token1 ? row.amount0 : row.amount1,
          ),
        };
      });
      const [tokenClaimed, quoteClaimed] = launch.token_is_token1
        ? [launch.claimed1, launch.claimed0]
        : [launch.claimed0, launch.claimed1];
      return this.page(
        ClaimPage,
        input,
        heads.get(chains[0])!,
        data,
        rows.length > input.limit,
        {
          totals: {
            launch_token: decimal(tokenClaimed),
            quote_token: decimal(quoteClaimed),
          },
        },
      );
    });
  }

  async owners(input: LaunchReadOptions & { poolId: bigint }) {
    const chains = this.chains(input.chainId);
    return this.snapshot(chains, async (tx, heads) => {
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
      return this.page(
        OwnerPage,
        input,
        heads.get(chains[0])!,
        data,
        rows.length > input.limit,
      );
    });
  }
}

// Launches without a USD value rank after those with one, by whole quote
// units, so launches on different quotes still compare.
function orderBy(tx: DB, key: LaunchOrder) {
  return {
    market_cap: tx`(market_cap_usd IS NULL), market_cap_usd::numeric DESC, market_cap_quote DESC NULLS LAST`,
    volume: tx`(volume_usd IS NULL), volume_usd::numeric DESC, volume_quote DESC NULLS LAST`,
    sold_share: tx`sold_share_e18 DESC NULLS LAST`,
    trade_count: tx`swap_count DESC`,
    created: tx`block_time DESC`,
  }[key];
}

interface QuoteGroup {
  chain_id: bigint;
  quote_token: Numeric;
  launch_count: number;
  trade_count: string;
  volume: string;
  market_cap: string;
  volume_usd: string | null;
  market_cap_usd: string | null;
}

const sumUsd = (values: (string | null)[]) => {
  const priced = values.filter((v): v is string => v !== null);
  if (priced.length === 0) return null;
  const micros = priced.reduce(
    (sum, v) => sum + BigInt(v.replace(".", "")),
    0n,
  );
  return `${micros / 1_000_000n}.${(micros % 1_000_000n).toString().padStart(6, "0")}`;
};

// Per-quote sums and USD sums over priced quotes only: raw amounts of
// different quote tokens are never added together.
function aggregates(groups: QuoteGroup[]) {
  const byQuote = groups.map((g) => ({
    chain_id: decimal(g.chain_id),
    quote_token: hex(g.quote_token, 20),
    launch_count: g.launch_count,
    trade_count: Number(g.trade_count),
    volume: g.volume,
    market_cap: g.market_cap,
    usd_priced: g.volume_usd !== null,
    volume_usd: g.volume_usd,
    market_cap_usd: g.market_cap_usd,
  }));
  const count = (rows: typeof byQuote) =>
    rows.reduce((n, g) => n + g.launch_count, 0);
  const priced = byQuote.filter((g) => g.usd_priced);
  return {
    launch_count: count(byQuote),
    trade_count: byQuote.reduce((n, g) => n + g.trade_count, 0),
    by_quote: byQuote,
    usd: {
      volume: sumUsd(priced.map((g) => g.volume_usd)),
      market_cap: sumUsd(priced.map((g) => g.market_cap_usd)),
      priced_launch_count: count(priced),
      excluded_launch_count: count(byQuote) - count(priced),
    },
  };
}

function swapDirection(token: bigint, quote: bigint) {
  if (token === 0n && quote === 0n) return "zero_fill";
  if (token <= 0n && quote >= 0n) return "buy";
  if (token >= 0n && quote <= 0n) return "sell";
  throw new Error("Invalid indexed swap direction");
}
