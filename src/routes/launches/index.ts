import { createRoute, z } from "@hono/zod-openapi";
import { defineRoute } from "../../shared/context";
import {
  errorResponses,
  notFoundResponse,
  StatusError,
} from "../../shared/errors";
import { jsonResponse } from "../../shared/openapi";
import {
  AddressType,
  ChainIdType,
  DecimalStringType,
  HexStringType,
  NumericStringType,
} from "../../shared/validation/address";
import {
  createQueries,
  LaunchDetailRow,
  LaunchRow,
  LaunchStatsRow,
  LaunchSwapRow,
} from "../../queries";
import toHex from "../../shared/toHex";

// Cache lifetimes. Launch state moves with every swap, so the detail and swap
// pages are short-lived; the list and the stats aggregate tolerate a minute.
export const LAUNCH_LIST_CACHE_CONTROL = "public, max-age=60, must-revalidate";
export const LAUNCH_DETAIL_CACHE_CONTROL =
  "public, max-age=10, must-revalidate";
export const LAUNCH_STATS_CACHE_CONTROL = "public, max-age=60, must-revalidate";
export const LAUNCH_SWAPS_CACHE_CONTROL = "public, max-age=10, must-revalidate";

const SignedDecimalStringType = z.string().regex(/^-?\d+$/);
const UnixSecondsType = z.number().int().describe("Unix time in seconds");

const LaunchStatusType = z
  .enum(["upcoming", "live", "ended", "migrated"])
  .describe(
    "Derived from the chain's indexed head block time, not the wall clock: upcoming before start_time, live in [start_time, end_time) while not complete, ended at or after end_time while not complete, migrated once complete",
  );

const LaunchTokenType = z.object({
  address: HexStringType,
  name: z.string(),
  symbol: z.string(),
  decimals: z.number().int(),
  total_supply: DecimalStringType,
});

const QuoteTokenType = z.object({
  address: HexStringType,
  name: z
    .string()
    .nullable()
    .describe("Null when the token is not in the token list"),
  symbol: z.string().nullable(),
  decimals: z.number().int().nullable(),
});

const LaunchPoolKeyType = z.object({
  core_address: HexStringType,
  token0: HexStringType,
  token1: HexStringType,
  fee: HexStringType,
  tick_spacing: z.number().int().nullable(),
  extension: HexStringType,
});

const LaunchSummaryShape = {
  chain_id: DecimalStringType,
  pool_key_id: DecimalStringType,
  pool_id: HexStringType,
  pool_key: LaunchPoolKeyType,
  launch_token: LaunchTokenType,
  quote_token: QuoteTokenType,
  launch_token_is_token1: z.boolean(),
  start_time: UnixSecondsType,
  end_time: UnixSecondsType,
  target_tick: z
    .number()
    .int()
    .describe(
      "Tick in raw quote units per launch token, independent of token order",
    ),
  upper_tick: z.number().int(),
  tick_spacing: z.number().int(),
  initial_fee: DecimalStringType.describe("0.64 fixed-point fee fraction"),
  final_fee: DecimalStringType.describe("0.64 fixed-point fee fraction"),
  migration_tick_lower: z.number().int(),
  migration_tick_upper: z.number().int(),
  deployed: DecimalStringType,
  reserve0: DecimalStringType,
  reserve1: DecimalStringType,
  complete: z.boolean(),
  status: LaunchStatusType.nullable().describe(
    "Null only when the chain has no indexed head yet and the launch is not complete",
  ),
  status_as_of: UnixSecondsType.nullable().describe(
    "The indexed head block time the status was derived from",
  ),
  owner: HexStringType.describe(
    "Owner of record in LaunchCreated (LaunchRouter for routed launches)",
  ),
  creator: HexStringType.nullable().describe(
    "LaunchRouter.LaunchCreatedBy creator, the account that may claim creator fees; null when the launch was not created through LaunchRouter",
  ),
  created_block_number: DecimalStringType,
  created_transaction_hash: HexStringType,
  created_time: UnixSecondsType,
};

const LaunchSummaryType = z.object(LaunchSummaryShape);

const ListLaunchesResponseType = z.object({
  data: z.array(LaunchSummaryType),
  pagination: z.object({
    page: z.number().int().min(1),
    pageSize: z.number().int().min(1),
    totalPages: z.number().int().min(0),
    totalItems: z.number().int().min(0),
  }),
});

const LaunchDetailType = z.object({
  ...LaunchSummaryShape,
  pool_state: z
    .object({
      sqrt_ratio: DecimalStringType,
      tick: z.number().int(),
      liquidity: DecimalStringType,
    })
    .nullable()
    .describe("Core pool state of the launch pool"),
  latest_advance: z
    .object({
      block_number: DecimalStringType,
      transaction_hash: HexStringType,
      time: UnixSecondsType,
    })
    .nullable()
    .describe(
      "The LaunchAdvanced event the deployed/reserve/complete values come from; null before the first advance",
    ),
  terminal: z
    .object({
      pool_id: HexStringType,
      locked_liquidity: DecimalStringType,
    })
    .nullable()
    .describe("The pool the principal was locked in once migrated"),
  creator_fees_claimed: z.object({
    amount0: DecimalStringType,
    amount1: DecimalStringType,
  }),
});

const TokenQuoteAmountsType = z.object({
  launch_token: DecimalStringType,
  quote_token: DecimalStringType,
});

const LaunchStatsType = z.object({
  chain_id: DecimalStringType,
  pool_id: HexStringType,
  swaps: z.object({
    count: z.number().int(),
    buy_count: z.number().int(),
    sell_count: z.number().int(),
    distinct_transactions: z.number().int(),
    distinct_lockers: z
      .number()
      .int()
      .describe(
        "Distinct LaunchSwapped.locker addresses: the contract that forwarded the swap (usually a router), not the user",
      ),
    distinct_transaction_senders: z
      .null()
      .describe(
        "Not available: the indexer stores no transaction sender, and the API does not resolve transactions to their senders",
      ),
  }),
  volume: z.object({
    buy: z
      .object({
        quote_in: DecimalStringType,
        launch_token_out: DecimalStringType,
      })
      .describe("Swaps that took launch tokens out of the pool"),
    sell: z
      .object({
        launch_token_in: DecimalStringType,
        quote_out: DecimalStringType,
      })
      .describe("Swaps that put launch tokens into the pool"),
  }),
  creator_fees: z.object({
    accrued: TokenQuoteAmountsType.describe(
      "Sum of LaunchSwapped fees, saved for the launch's creator",
    ),
    claimed: TokenQuoteAmountsType,
    claim_count: z.number().int(),
  }),
  funding: z.object({
    received: TokenQuoteAmountsType.describe(
      "PrincipalReceived from lockers that forwarded LAUNCH_FUND",
    ),
    count: z.number().int(),
    migrated_principal: TokenQuoteAmountsType.describe(
      "PrincipalReceived from the launch extension at migration",
    ),
  }),
  attribution: z
    .object({
      counts: z.string(),
      lockers: z.string(),
      senders: z.string(),
    })
    .describe("Where each count comes from"),
});

const LaunchSwapType = z.object({
  event_id: SignedDecimalStringType,
  block_number: DecimalStringType,
  transaction_index: z.number().int(),
  event_index: z.number().int(),
  transaction_hash: HexStringType,
  time: UnixSecondsType,
  locker: HexStringType.describe(
    "The locker that forwarded the swap, usually a router contract",
  ),
  delta0: SignedDecimalStringType.describe(
    "Fee-inclusive pool-perspective delta of token0",
  ),
  delta1: SignedDecimalStringType.describe(
    "Fee-inclusive pool-perspective delta of token1",
  ),
  fee_amount: DecimalStringType,
  fee_is_token1: z.boolean(),
});

const ListLaunchSwapsResponseType = z.object({
  chain_id: DecimalStringType,
  pool_id: HexStringType,
  swaps: z.array(LaunchSwapType),
  next_cursor: SignedDecimalStringType.nullable(),
  has_more: z.boolean(),
});

const LaunchParams = z.object({
  chainId: ChainIdType,
  poolId: NumericStringType.describe("The launch pool's ID").openapi({
    example: "0x1234",
  }),
});

const EventCursorType = z.coerce
  .bigint()
  .min(-(1n << 63n))
  .max((1n << 63n) - 1n)
  .openapi({ type: "integer", format: "int64" });

const seconds = (value: bigint | Date) =>
  value instanceof Date ? Math.floor(value.getTime() / 1000) : Number(value);

const hex = (value: string, width?: number) => toHex(BigInt(value), width);

function formatQuoteToken(row: LaunchRow) {
  return {
    address: hex(row.quote_token, 20),
    name: row.quote_token_name,
    symbol: row.quote_token_symbol,
    decimals: row.quote_token_decimals,
  };
}

function formatLaunch(row: LaunchRow): z.infer<typeof LaunchSummaryType> {
  return {
    chain_id: row.chain_id.toString(),
    pool_key_id: row.pool_key_id.toString(),
    pool_id: hex(row.pool_id, 32),
    pool_key: {
      core_address: hex(row.core_address, 20),
      token0: hex(row.token0, 20),
      token1: hex(row.token1, 20),
      fee: hex(row.fee),
      tick_spacing: row.pool_tick_spacing,
      extension: hex(row.pool_extension, 20),
    },
    launch_token: {
      address: hex(row.token, 20),
      name: row.token_name,
      symbol: row.token_symbol,
      decimals: row.token_decimals,
      total_supply: row.total_supply,
    },
    quote_token: formatQuoteToken(row),
    launch_token_is_token1: row.token_is_token1,
    start_time: seconds(row.start_time),
    end_time: seconds(row.end_time),
    target_tick: row.target_tick,
    upper_tick: row.upper_tick,
    tick_spacing: row.tick_spacing,
    initial_fee: row.initial_fee,
    final_fee: row.final_fee,
    migration_tick_lower: row.migration_tick_lower,
    migration_tick_upper: row.migration_tick_upper,
    deployed: row.deployed,
    reserve0: row.reserve0,
    reserve1: row.reserve1,
    complete: row.complete,
    status: row.status,
    status_as_of: row.head_block_time ? seconds(row.head_block_time) : null,
    owner: hex(row.owner, 20),
    creator: row.creator === null ? null : hex(row.creator, 20),
    created_block_number: row.created_block_number.toString(),
    created_transaction_hash: hex(row.created_transaction_hash, 32),
    created_time: seconds(row.created_time),
  };
}

function formatPoolState(row: LaunchDetailRow) {
  if (row.state_sqrt_ratio === null || row.state_liquidity === null) {
    return null;
  }
  return {
    sqrt_ratio: row.state_sqrt_ratio,
    tick: Number(row.state_tick),
    liquidity: row.state_liquidity,
  };
}

function formatLatestAdvance(row: LaunchDetailRow) {
  if (row.advanced_block_number === null) return null;
  return {
    block_number: row.advanced_block_number.toString(),
    transaction_hash: hex(row.advanced_transaction_hash!, 32),
    time: seconds(row.advanced_time!),
  };
}

function formatTerminal(row: LaunchDetailRow) {
  if (row.terminal_pool_id === null) return null;
  return {
    pool_id: hex(row.terminal_pool_id, 32),
    locked_liquidity: row.locked_liquidity ?? "0",
  };
}

function formatLaunchDetail(
  row: LaunchDetailRow,
): z.infer<typeof LaunchDetailType> {
  return {
    ...formatLaunch(row),
    pool_state: formatPoolState(row),
    latest_advance: formatLatestAdvance(row),
    terminal: formatTerminal(row),
    creator_fees_claimed: {
      amount0: row.creator_fees_claimed0,
      amount1: row.creator_fees_claimed1,
    },
  };
}

const ATTRIBUTION = {
  counts:
    "Swap, buy, sell and transaction counts are LaunchSwapped events and their transaction hashes",
  lockers:
    "distinct_lockers counts LaunchSwapped.locker, the router contract that forwarded each swap",
  senders:
    "Transaction senders are not indexed and are not resolved by this API",
};

function formatStats(
  chainId: bigint,
  poolId: bigint,
  row: LaunchStatsRow,
): z.infer<typeof LaunchStatsType> {
  return {
    chain_id: chainId.toString(),
    pool_id: toHex(poolId, 32),
    swaps: {
      count: row.swap_count,
      buy_count: row.buy_count,
      sell_count: row.sell_count,
      distinct_transactions: row.distinct_transactions,
      distinct_lockers: row.distinct_lockers,
      distinct_transaction_senders: null,
    },
    volume: {
      buy: { quote_in: row.buy_quote_in, launch_token_out: row.buy_token_out },
      sell: {
        launch_token_in: row.sell_token_in,
        quote_out: row.sell_quote_out,
      },
    },
    creator_fees: {
      accrued: {
        launch_token: row.fees_accrued_token,
        quote_token: row.fees_accrued_quote,
      },
      claimed: {
        launch_token: row.fees_claimed_token,
        quote_token: row.fees_claimed_quote,
      },
      claim_count: row.fee_claim_count,
    },
    funding: {
      received: {
        launch_token: row.funding_token,
        quote_token: row.funding_quote,
      },
      count: row.funding_count,
      migrated_principal: {
        launch_token: row.migrated_principal_token,
        quote_token: row.migrated_principal_quote,
      },
    },
    attribution: ATTRIBUTION,
  };
}

type LaunchSwap = z.infer<typeof LaunchSwapType>;

function formatSwap(row: LaunchSwapRow): LaunchSwap {
  return {
    event_id: row.event_id!.toString(),
    block_number: row.block_number!.toString(),
    transaction_index: row.transaction_index!,
    event_index: row.event_index!,
    transaction_hash: hex(row.transaction_hash!, 32),
    time: seconds(row.block_time!),
    locker: hex(row.locker!, 20),
    delta0: row.delta0!,
    delta1: row.delta1!,
    fee_amount: row.fee_amount!,
    fee_is_token1: row.fee_is_token1!,
  };
}

export const ListLaunches = defineRoute(
  createRoute({
    method: "get",
    path: "/launches",
    tags: ["Launches"],
    summary: "List launches",
    description:
      "Lists ScheduledLaunch launches from the indexed launchpad tables, newest first",
    operationId: "get_ListLaunches",
    request: {
      query: z.object({
        chainId: ChainIdType.optional().describe("Restrict to one chain"),
        status: LaunchStatusType.optional(),
        creator: AddressType.optional().describe(
          "Only launches created through LaunchRouter by this address",
        ),
        pageSize: z.coerce
          .number()
          .int()
          .min(1)
          .max(200)
          .optional()
          .describe("Maximum number of launches per page")
          .default(50),
        page: z.coerce
          .number()
          .int()
          .min(1)
          .optional()
          .describe("Page number to fetch (1-indexed)")
          .default(1),
      }),
    },
    responses: {
      200: jsonResponse("A page of launches", ListLaunchesResponseType),
      ...errorResponses,
    },
  }),
  async (c) => {
    const {
      chainId = null,
      status = null,
      creator,
      page,
      pageSize,
    } = c.req.valid("query");
    const queries = await createQueries(c.env);
    const { rows, totalCount } = await queries.listLaunches({
      chainId,
      status,
      creator: creator === undefined ? null : BigInt(creator),
      page,
      pageSize,
    });

    const response = {
      data: rows.map(formatLaunch),
      pagination: {
        page,
        pageSize,
        totalPages: Math.ceil(totalCount / pageSize),
        totalItems: totalCount,
      },
    } satisfies z.infer<typeof ListLaunchesResponseType>;

    return c.json(response, 200, {
      "cache-control": LAUNCH_LIST_CACHE_CONTROL,
    });
  },
);

export const GetLaunch = defineRoute(
  createRoute({
    method: "get",
    path: "/launches/{chainId}/{poolId}",
    tags: ["Launches"],
    summary: "Get a launch",
    description:
      "Returns a launch's configuration, saved state, latest advance, migration and claimed creator fees, plus the Core pool state",
    operationId: "get_GetLaunch",
    request: { params: LaunchParams },
    responses: {
      200: jsonResponse("The launch", LaunchDetailType),
      ...notFoundResponse,
      ...errorResponses,
    },
  }),
  async (c) => {
    const { chainId, poolId } = c.req.valid("param");
    const queries = await createQueries(c.env);
    const row = await queries.getLaunch(chainId, BigInt(poolId));
    if (row === null) throw new StatusError(404, "Launch not found");

    return c.json(formatLaunchDetail(row), 200, {
      "cache-control": LAUNCH_DETAIL_CACHE_CONTROL,
    });
  },
);

export const GetLaunchStats = defineRoute(
  createRoute({
    method: "get",
    path: "/launches/{chainId}/{poolId}/stats",
    tags: ["Launches"],
    summary: "Get launch stats",
    description:
      "Swap volume by side, swap and locker counts, creator fees accrued and claimed, and funding received for one launch",
    operationId: "get_GetLaunchStats",
    request: { params: LaunchParams },
    responses: {
      200: jsonResponse("Launch statistics", LaunchStatsType),
      ...notFoundResponse,
      ...errorResponses,
    },
  }),
  async (c) => {
    const { chainId, poolId: poolIdParam } = c.req.valid("param");
    const poolId = BigInt(poolIdParam);
    const queries = await createQueries(c.env);
    const row = await queries.getLaunchStats(chainId, poolId);
    if (row === null) throw new StatusError(404, "Launch not found");

    return c.json(formatStats(chainId, poolId, row), 200, {
      "cache-control": LAUNCH_STATS_CACHE_CONTROL,
    });
  },
);

export const ListLaunchSwaps = defineRoute(
  createRoute({
    method: "get",
    path: "/launches/{chainId}/{poolId}/swaps",
    tags: ["Launches"],
    summary: "List launch swaps",
    description:
      "Returns a launch's LaunchSwapped events in ascending event order",
    operationId: "get_ListLaunchSwaps",
    request: {
      params: LaunchParams,
      query: z.object({
        cursor: EventCursorType.optional().describe(
          "Return swaps strictly after this event_id; use next_cursor to continue",
        ),
        limit: z.coerce
          .number()
          .int()
          .min(1)
          .max(1000)
          .optional()
          .describe("Maximum number of swaps to return")
          .default(100),
      }),
    },
    responses: {
      200: jsonResponse("A page of launch swaps", ListLaunchSwapsResponseType),
      ...notFoundResponse,
      ...errorResponses,
    },
  }),
  async (c) => {
    const { chainId, poolId: poolIdParam } = c.req.valid("param");
    const { cursor = null, limit } = c.req.valid("query");
    const poolId = BigInt(poolIdParam);
    const queries = await createQueries(c.env);
    const rows = await queries.listLaunchSwaps({
      chainId,
      poolId,
      cursor,
      limit: limit + 1,
    });
    if (rows.length === 0) throw new StatusError(404, "Launch not found");

    const swaps = rows.filter((row) => row.event_id !== null);
    const page = swaps.slice(0, limit).map(formatSwap);
    const response = {
      chain_id: chainId.toString(),
      pool_id: toHex(poolId, 32),
      swaps: page,
      next_cursor: page.at(-1)?.event_id ?? cursor?.toString() ?? null,
      has_more: swaps.length > limit,
    } satisfies z.infer<typeof ListLaunchSwapsResponseType>;

    return c.json(response, 200, {
      "cache-control": LAUNCH_SWAPS_CACHE_CONTROL,
    });
  },
);
