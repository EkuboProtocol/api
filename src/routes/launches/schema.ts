import { z } from "@hono/zod-openapi";

// v7: the final zero-seed launch (evm-contracts 853b608) only. One fee model,
// so the schedule has no discriminator; launches carry their logo, every
// LaunchParameters field, the derived spacing and aligned bounds, a status
// and market data with volume, and the list spans chains with status/owner
// filters, market-cap, volume, sold-share, trade-count and creation order,
// totals and market aggregates.
export const SCHEMA_VERSION = "zero-seed-launch-api/v7" as const;
export const SchemaVersion = z.literal(SCHEMA_VERSION);
const UINT64_MAX = (1n << 64n) - 1n;
const U = z.string().regex(/^(0|[1-9][0-9]*)$/);
const I = z.string().regex(/^(0|-?[1-9][0-9]*)$/);
const Uint64 = U.max(20).refine(
  (value) => /^(0|[1-9][0-9]*)$/.test(value) && BigInt(value) <= UINT64_MAX,
);
// A Q0.64 fee rate: every uint64. The fee fraction is value / 2^64, so the
// maximum 2^64 - 1 is just under 100%, never exactly 100%.
const Q64 = Uint64.openapi({
  description:
    "Q0.64 fee rate as a canonical decimal uint64 (0 to 18446744073709551615): the fee fraction is value / 2^64",
});
const Address = z.string().regex(/^0x[0-9a-f]{40}$/);
const Bytes32 = z.string().regex(/^0x[0-9a-f]{64}$/);
const Seconds = z.number().int().nonnegative();
const Tick = z.number().int();
export const BlockRef = z.strictObject({
  block_number: U,
  block_hash: Bytes32,
  block_time: Seconds,
});
export const ChainHead = BlockRef.extend({ chain_id: U });
export const EventRef = BlockRef.extend({
  event_id: I,
  transaction_index: z.number().int().nonnegative(),
  event_index: z.number().int().nonnegative(),
  transaction_hash: Bytes32,
});
// name and symbol are decoded from the canonical LibString.packOne words in
// parameters (length byte, then content); null when the content is not
// valid UTF-8. Untrusted creator input: escape before display.
const LaunchToken = z.strictObject({
  address: Address,
  name: z.string().nullable(),
  symbol: z.string().nullable(),
  decimals: z.literal(18),
});
// Native ETH is address 0, always token0, 18 decimals, and has no token
// contract, so it has no ERC-20 metadata. ERC-20 metadata is null when the
// token is not in the indexed token list.
const QuoteToken = z.strictObject({
  address: Address,
  name: z.string().nullable(),
  symbol: z.string().nullable(),
  decimals: z.number().int().min(0).max(255).nullable(),
  kind: z.enum(["native", "erc20"]),
});
const PoolKey = z.strictObject({
  core_address: Address,
  token0: Address,
  token1: Address,
  config: Bytes32,
  fee: z.literal("0"),
  tick_spacing: z.number().int().positive(),
  extension: Address,
});
// LaunchParameters exactly as emitted in LaunchCreated: numbers as exact
// decimal strings, words as 32-byte hex. ask_tick and upper_tick are the
// requested economic ticks; salt is the owner-namespaced salt the extension
// received.
const Parameters = z.strictObject({
  name: Bytes32,
  symbol: Bytes32,
  supply: U,
  quote_token: Address,
  ask_tick: I,
  upper_tick: I,
  trading_start: Uint64,
  decay_rate_x32: Uint64,
  initial_fee: Q64,
  final_fee: Q64,
  salt: Bytes32,
});
// spacing = ceil((upper - ask) / 256); the installed economic bounds are
// ceil(ask / s) * s and floor(upper / s) * s; pool ticks are those bounds,
// negated and swapped when the launch token is token1.
const Range = z.strictObject({
  tick_spacing: z.number().int().positive(),
  aligned_ask_tick: Tick,
  aligned_upper_tick: Tick,
  pool_tick_lower: Tick,
  pool_tick_upper: Tick,
});
// final_fee is the long-run floor the fee approaches; there is no end time.
// fee = final + floor((initial - final) * toFixed(tickToSqrtRatio(-m)) /
// 2^128), m = floor(rate * elapsed / 2^32), initial before and at the start.
export const FeeSchedule = z.strictObject({
  trading_start: Seconds,
  initial_fee: Q64,
  final_fee: Q64,
  decay_rate_x32: Uint64.openapi({
    description:
      "decayRateX32: unsigned Q32.32 ticks per second as a canonical decimal uint64; 0 keeps initial_fee",
  }),
  half_life_seconds: z
    .string()
    .regex(/^(0|[1-9][0-9]*)\.[0-9]{6}$/)
    .nullable()
    .openapi({
      description:
        "Half-life of the excess over the floor, seconds with 6 decimals (floored); null for rate 0. Display only",
    }),
  saturation_elapsed_seconds: U.nullable().openapi({
    description:
      "floor(381061679028371455 / decay_rate_x32): after this many seconds the fee is exactly final_fee; null for rate 0",
  }),
  phase: z.enum(["before_trading_start", "decaying", "at_floor", "constant"]),
  fee_rate: Q64,
  evaluated_at: Seconds,
});
// Raw launch-token units. requested is LaunchParameters.supply and the
// token's totalSupply; installed went into the position; sink = requested -
// installed was minted to address 0. The sink is not a burn.
const Supply = z.strictObject({
  requested: U,
  installed: U,
  sink: U,
  sink_holder: z.literal("0x0000000000000000000000000000000000000000"),
});
// USD with exactly 6 decimals, from the indexed quote price.
const Usd = z.string().regex(/^(0|[1-9][0-9]*)\.[0-9]{6}$/);
// Computed from the indexed Core pool state, balances and LaunchSwapped
// events. Raw units; price is raw quote per raw launch token, times 2^128
// and floored.
const Market = z.strictObject({
  price_tick: Tick,
  price_x128: U,
  market_cap: U.openapi({
    description:
      "floor(price * totalSupply) in raw quote units; totalSupply includes the sink",
  }),
  market_cap_usd: Usd.nullable().openapi({
    description:
      "market_cap / 10^quote decimals * the indexed quote USD price, rounded to 6 decimals; null when the quote has no indexed price or no known decimals",
  }),
  raised: U.openapi({
    description: "Quote held by the launch pool (buyers' net input)",
  }),
  sold: U.openapi({
    description: "installed - launch tokens left in the pool",
  }),
  sold_share: z
    .string()
    .regex(/^[01]\.[0-9]{18}$/)
    .openapi({ description: "sold / installed, 18 decimals, floored" }),
  trade_count: z.number().int().nonnegative().openapi({
    description: "LaunchSwapped events of the launch, zero fills included",
  }),
  volume: U.openapi({
    description:
      "Sum of |quote delta| over every LaunchSwapped of the launch, buys and sells, fee-inclusive, in raw quote base units",
  }),
  volume_usd: Usd.nullable().openapi({
    description:
      "volume / 10^quote decimals * the indexed quote USD price, rounded to 6 decimals; null exactly when market_cap_usd is",
  }),
});
export const LaunchSummary = z.strictObject({
  schema_version: SchemaVersion,
  chain_id: U,
  pool_id: Bytes32,
  pool_key: PoolKey,
  token: LaunchToken,
  quote_token: QuoteToken,
  launch_token_is_token1: z.boolean(),
  // The locker that forwarded the creation: the instance's periphery.
  controller: Address,
  // Owner at creation (LaunchOwnerChanged from the zero address).
  creator: Address,
  // Current owner: holds the unclaimed and future creator fees.
  owner: Address,
  logo_url: z.string().nullable().openapi({
    description:
      "LaunchCreated.logoUrl exactly as emitted; null when empty or not valid UTF-8. Untrusted: never fetched or rewritten here",
  }),
  parameters: Parameters,
  range: Range,
  supply: Supply,
  trading_start: Seconds,
  status: z.enum(["upcoming", "trading"]).openapi({
    description: "upcoming while evaluated_at < trading_start, else trading",
  }),
  fee_schedule: FeeSchedule,
  market: Market,
  created: EventRef,
  as_of: BlockRef,
});
const SideAmounts = z.strictObject({ launch_token: U, quote_token: U });
const LedgerSide = z.strictObject({ accrued: U, claimed: U, unclaimed: U });
export const LaunchDetail = LaunchSummary.extend({
  principal: z.strictObject({
    position_id: Bytes32,
    liquidity: U,
    locked: z.literal(true),
    withdrawable: z.literal(false),
    pool_reserves: SideAmounts,
  }),
  fee_ledger: z.strictObject({
    holder: Address,
    launch_token: LedgerSide,
    quote_token: LedgerSide,
    swap_count: z.number().int().nonnegative(),
    claim_count: z.number().int().nonnegative(),
    owner_change_count: z.number().int().positive(),
    last_event_id: I,
  }),
});
const Totals = z.strictObject({
  all: z.number().int().nonnegative(),
  trading: z.number().int().nonnegative(),
  upcoming: z.number().int().nonnegative(),
});
const Count = z.number().int().nonnegative();
// One row per (chain, quote token): amounts of different quote tokens are
// never added together.
const QuoteAggregate = z.strictObject({
  chain_id: U,
  quote_token: Address,
  launch_count: Count,
  trade_count: Count,
  volume: U.openapi({ description: "Sum of market.volume, raw quote units" }),
  market_cap: U.openapi({
    description: "Sum of market.market_cap, raw quote units",
  }),
  usd_priced: z.boolean().openapi({
    description: "The quote has an indexed USD price and known decimals",
  }),
  volume_usd: Usd.nullable(),
  market_cap_usd: Usd.nullable(),
});
export const Aggregates = z
  .strictObject({
    launch_count: Count,
    trade_count: Count,
    by_quote: z.array(QuoteAggregate),
    usd: z.strictObject({
      volume: Usd.nullable().openapi({
        description:
          "Sum of market.volume_usd over priced launches; null when none is priced",
      }),
      market_cap: Usd.nullable().openapi({
        description:
          "Sum of market.market_cap_usd over priced launches; null when none is priced",
      }),
      priced_launch_count: Count,
      excluded_launch_count: Count.openapi({
        description:
          "Launches left out of the USD sums because their quote has no indexed price",
      }),
    }),
  })
  .openapi({
    description:
      "Over every launch matching all filters (the set total counts), not one page. by_quote is ordered by chain_id, then quote_token",
  });
export const LaunchList = z.strictObject({
  schema_version: SchemaVersion,
  data: z.array(LaunchSummary),
  // launches matching every filter, and by status matching the others
  total: z.number().int().nonnegative(),
  totals: Totals,
  aggregates: Aggregates,
  next_offset: z.number().int().positive().nullable(),
  evaluated_at: Seconds,
  heads: z.array(ChainHead),
});
export const Swap = z.strictObject({
  event: EventRef,
  forwarding_locker: Address,
  direction: z.enum(["buy", "sell", "zero_fill"]),
  launch_token_delta: I,
  quote_token_delta: I,
  fee_rate: Q64,
  fee_amount: U,
  fee_asset: z.enum(["launch_token", "quote_token"]),
});
// One claim, keyed on the extension's CreatorFeesClaimed; the periphery's
// LaunchFeesClaimed of the same transaction supplies owner and recipient.
export const Claim = z.strictObject({
  event: EventRef,
  payout_event_id: I,
  owner: Address,
  recipient: Address,
  launch_token_amount: U,
  quote_token_amount: U,
});
export const OwnerChange = z.strictObject({
  event: EventRef,
  // null for the creation
  previous_owner: Address.nullable(),
  new_owner: Address,
});
const PageIdentity = z.strictObject({
  schema_version: SchemaVersion,
  chain_id: U,
  pool_id: Bytes32,
  next_cursor: z.string().nullable(),
  as_of: BlockRef,
});
export const SwapPage = PageIdentity.extend({ data: z.array(Swap) });
export const ClaimPage = PageIdentity.extend({
  data: z.array(Claim),
  totals: SideAmounts,
});
export const OwnerPage = PageIdentity.extend({ data: z.array(OwnerChange) });
