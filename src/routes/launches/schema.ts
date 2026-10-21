import { z } from "@hono/zod-openapi";

// v4: requested/installed/sink supply, per-launch quote.
export const SCHEMA_VERSION = "zero-seed-launch-api/v4" as const;
export const SchemaVersion = z.literal(SCHEMA_VERSION);
const U = z.string().regex(/^(0|[1-9][0-9]*)$/);
const I = z.string().regex(/^(0|-?[1-9][0-9]*)$/);
const Address = z.string().regex(/^0x[0-9a-f]{40}$/);
const Bytes32 = z.string().regex(/^0x[0-9a-f]{64}$/);
const Seconds = z.number().int().nonnegative();
export const BlockRef = z.strictObject({
  block_number: U,
  block_hash: Bytes32,
  block_time: Seconds,
});
export const EventRef = BlockRef.extend({
  event_id: I,
  transaction_index: z.number().int().nonnegative(),
  event_index: z.number().int().nonnegative(),
  transaction_hash: Bytes32,
});
const Token = z.strictObject({
  address: Address,
  name: z.string().nullable(),
  symbol: z.string().nullable(),
  decimals: z.number().int().min(0).max(255).nullable(),
});
// Native ETH is address 0, always token0, 18 decimals and has no token
// contract, so no ERC-20 metadata is read for it (name and symbol are null).
const QuoteToken = Token.extend({ kind: z.enum(["native", "erc20"]) });
const PoolKey = z.strictObject({
  core_address: Address,
  token0: Address,
  token1: Address,
  config: Bytes32,
  fee: z.literal("0"),
  tick_spacing: z.number().int().positive(),
  extension: Address,
});
export const FeeSchedule = z.strictObject({
  trading_start: Seconds,
  fee_duration: z.number().int().positive(),
  fee_end: Seconds,
  initial_fee: U,
  final_fee: U,
  // 2^(-t/600) from a fixed Q128 table, rescaled to reach final_fee at fee_end.
  decay: z.strictObject({
    kind: z.literal("fixed_base_q128"),
    half_life_seconds: z.literal(600),
  }),
  phase: z.enum(["before_trading_start", "fee_decay", "final_fee"]),
  fee_rate: U,
  evaluated_at: Seconds,
});
// Raw launch-token units. requested is LaunchParameters.supply and the
// token's totalSupply; installed is what Core took into the position at
// creation (all circulating inventory); sink = requested - installed was
// minted to address 0 and can never move. It is not a burn.
const Supply = z.strictObject({
  requested: U,
  installed: U,
  sink: U,
  sink_holder: z.literal("0x0000000000000000000000000000000000000000"),
});
export const LaunchSummary = z.strictObject({
  schema_version: SchemaVersion,
  chain_id: U,
  pool_id: Bytes32,
  pool_key: PoolKey,
  token: Token,
  // The launch's own quote, LaunchParameters.quoteToken.
  quote_token: QuoteToken,
  supply: Supply,
  launch_token_is_token1: z.boolean(),
  // The locker that forwarded the creation: the instance's periphery.
  controller: Address,
  // Owner at creation (LaunchOwnerChanged from the zero address); never changes.
  creator: Address,
  // Current owner: holds the unclaimed and future creator fees; transferable.
  owner: Address,
  ask_tick: z.number().int(),
  upper_tick: z.number().int(),
  fee_schedule: FeeSchedule,
  created: EventRef,
  as_of: BlockRef,
});
const SideAmounts = z.strictObject({ launch_token: U, quote_token: U });
const LedgerSide = z.strictObject({ accrued: U, claimed: U, unclaimed: U });
export const LaunchDetail = LaunchSummary.extend({
  principal: z.strictObject({
    position_id: Bytes32,
    tick_lower: z.number().int(),
    tick_upper: z.number().int(),
    liquidity: U,
    locked: z.literal(true),
    withdrawable: z.literal(false),
    pool_reserves: SideAmounts,
    reserves_basis: z.literal("core_pool_balance"),
  }),
  fee_ledger: z.strictObject({
    holder: Address,
    transferable: z.literal(true),
    launch_token: LedgerSide,
    quote_token: LedgerSide,
    swap_count: z.number().int().nonnegative(),
    claim_count: z.number().int().nonnegative(),
    owner_change_count: z.number().int().positive(),
    last_event_id: I,
  }),
  inventory: z.strictObject({
    trading_open: z.boolean(),
    no_bid: z.boolean(),
    price_tick: z.number().int(),
  }),
});
export const LaunchList = z.strictObject({
  schema_version: SchemaVersion,
  data: z.array(LaunchSummary),
  next_cursor: z.string().nullable(),
  as_of: BlockRef,
});
export const Swap = z.strictObject({
  event: EventRef,
  forwarding_locker: Address,
  direction: z.enum(["buy", "sell", "zero_fill"]),
  launch_token_delta: I,
  quote_token_delta: I,
  fee_rate: U,
  fee_amount: U,
  fee_asset: z.enum(["launch_token", "quote_token"]),
});
// One claim: the periphery payout event, linked to the extension ledger
// event of the same transaction. The amounts are counted once.
export const Claim = z.strictObject({
  event: EventRef,
  ledger_event_id: I,
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
export const ClaimPage = PageIdentity.extend({ data: z.array(Claim) });
export const OwnerPage = PageIdentity.extend({ data: z.array(OwnerChange) });
