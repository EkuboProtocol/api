import { ContractCase, stubQuery } from "../harness";
import { LOCAL_INSTANCES } from "../../routes/launches/policy";

const NATIVE = "0x0000000000000000000000000000000000000000" as const;
const VERSION = "zero-seed-launch-api/v6" as const;

const pin = LOCAL_INSTANCES[0];
const owner = `0x${"2".repeat(40)}`;
const zero = `0x${"0".repeat(64)}`;
const as_of = { block_number: "1", block_hash: zero, block_time: 1000 };
const summary = {
  schema_version: VERSION,
  chain_id: "31337",
  pool_id: zero,
  pool_key: {
    core_address: pin.core,
    token0: NATIVE,
    token1: `0x${"1".repeat(40)}`,
    config: zero,
    fee: "0" as const,
    tick_spacing: 17990,
    extension: pin.address,
  },
  token: {
    address: `0x${"1".repeat(40)}`,
    name: "Zero Seed",
    symbol: "ZERO",
    decimals: 18 as const,
  },
  quote_token: {
    address: NATIVE,
    name: null,
    symbol: null,
    decimals: 18,
    kind: "native" as const,
  },
  launch_token_is_token1: true,
  controller: pin.periphery,
  creator: owner,
  owner,
  logo_url: null,
  parameters: {
    name: "0x095a65726f205365656400000000000000000000000000000000000000000000",
    symbol:
      "0x045a45524f000000000000000000000000000000000000000000000000000000",
    supply: "1000000000000000000000000000",
    quote_token: NATIVE,
    ask_tick: "-13815500",
    upper_tick: "-9210300",
    trading_start: "1000",
    decay_rate_x32: "68913100933",
    initial_fee: "9223372036854775808",
    final_fee: "55340232221128654",
    salt: zero,
  },
  range: {
    tick_spacing: 17990,
    aligned_ask_tick: -13798330,
    aligned_upper_tick: -9210880,
    pool_tick_lower: 9210880,
    pool_tick_upper: 13798330,
  },
  supply: {
    requested: "1000000000000000000000000000",
    installed: "999999999999999999999999508",
    sink: "492",
    sink_holder: NATIVE,
  },
  trading_start: 1000,
  status: "trading" as const,
  fee_schedule: {
    trading_start: 1000,
    initial_fee: "9223372036854775808",
    final_fee: "55340232221128654",
    decay_rate_x32: "68913100933",
    half_life_seconds: "86400.000001",
    saturation_elapsed_seconds: "5529597",
    phase: "decaying" as const,
    fee_rate: "9223372036854775808",
    evaluated_at: 1000,
  },
  market: {
    price_tick: -13798330,
    price_x128: "340282366920938463463374607431768",
    market_cap: "1000000000000000000000",
    market_cap_usd: null,
    raised: "0",
    sold: "0",
    sold_share: "0.000000000000000000",
    trade_count: 0,
  },
  created: {
    ...as_of,
    event_id: "-1",
    transaction_index: 0,
    event_index: 0,
    transaction_hash: zero,
  },
  as_of,
};
const ledger = { accrued: "0", claimed: "0", unclaimed: "0" };
const identity = {
  schema_version: VERSION,
  chain_id: "31337",
  pool_id: zero,
  as_of,
  next_cursor: null,
};
const path = `/launches/31337/${zero}`;
export const launchesCases: ContractCase[] = [
  {
    operation: "/launches",
    request: "/launches?status=trading",
    stub: () =>
      stubQuery("readZeroSeedList", {
        schema_version: VERSION,
        data: [
          summary,
          {
            ...summary,
            logo_url: "https://example.invalid/logo.svg",
            status: "upcoming",
          },
        ],
        total: 2,
        totals: { all: 2, trading: 1, upcoming: 1 },
        next_offset: null,
        evaluated_at: 1000,
        heads: [{ chain_id: "31337", ...as_of }],
      }),
  },
  {
    operation: "/launches/{chainId}/{poolId}",
    request: path,
    stub: () =>
      stubQuery("readZeroSeedDetail", {
        ...summary,
        principal: {
          position_id: zero,
          liquidity: "100",
          locked: true,
          withdrawable: false,
          pool_reserves: { launch_token: "1000", quote_token: "0" },
        },
        fee_ledger: {
          holder: owner,
          launch_token: ledger,
          quote_token: ledger,
          swap_count: 0,
          claim_count: 0,
          owner_change_count: 1,
          last_event_id: "-1",
        },
      }),
  },
  {
    operation: "/launches/{chainId}/{poolId}/swaps",
    request: `${path}/swaps`,
    stub: () => stubQuery("readZeroSeedSwaps", { ...identity, data: [] }),
  },
  {
    operation: "/launches/{chainId}/{poolId}/claims",
    request: `${path}/claims`,
    stub: () =>
      stubQuery("readZeroSeedClaims", {
        ...identity,
        data: [
          {
            event: summary.created,
            payout_event_id: "1",
            owner,
            recipient: owner,
            launch_token_amount: "0",
            quote_token_amount: "5",
          },
        ],
        totals: { launch_token: "0", quote_token: "5" },
      }),
  },
  {
    operation: "/launches/{chainId}/{poolId}/owners",
    request: `${path}/owners`,
    stub: () =>
      stubQuery("readZeroSeedOwners", {
        ...identity,
        data: [
          {
            event: summary.created,
            previous_owner: null,
            new_owner: owner,
          },
        ],
      }),
  },
];
