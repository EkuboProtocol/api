import { ContractCase, stubQuery } from "../harness";
import { LOCAL_INSTANCES } from "../../routes/launches/policy";

const NATIVE = "0x0000000000000000000000000000000000000000" as const;

const pin = LOCAL_INSTANCES[0];
const owner = `0x${"2".repeat(40)}`;
const zero = `0x${"0".repeat(64)}`;
const as_of = { block_number: "1", block_hash: zero, block_time: 1000 };
const summary = {
  schema_version: "zero-seed-launch-api/v5" as const,
  chain_id: "31337",
  pool_id: zero,
  pool_key: {
    core_address: pin.core,
    token0: NATIVE,
    token1: `0x${"1".repeat(40)}`,
    config: zero,
    fee: "0" as const,
    tick_spacing: 100,
    extension: pin.address,
  },
  token: {
    address: `0x${"1".repeat(40)}`,
    name: "Local",
    symbol: "LOCAL",
    decimals: 18,
  },
  quote_token: {
    address: NATIVE,
    name: null,
    symbol: null,
    decimals: 18,
    kind: "native" as const,
  },
  supply: {
    requested: "1000000000000000000000000000",
    installed: "999999999999999999999999422",
    sink: "578",
    sink_holder: NATIVE,
  },
  launch_token_is_token1: true,
  controller: pin.periphery,
  creator: owner,
  owner,
  ask_tick: 0,
  upper_tick: 100,
  fee_schedule: {
    model: "fixed_base_duration_v1" as const,
    trading_start: 1000,
    fee_duration: 3600,
    fee_end: 4600,
    initial_fee: "10",
    final_fee: "3",
    decay: {
      kind: "fixed_base_q128" as const,
      half_life_seconds: 600 as const,
    },
    phase: "fee_decay" as const,
    fee_rate: "10",
    evaluated_at: 1000,
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
// The same launch shape on the tick-rate instance: a floor, never an end.
const tickRatePin = LOCAL_INSTANCES[1];
const tickRateSummary = {
  ...summary,
  pool_key: { ...summary.pool_key, extension: tickRatePin.address },
  controller: tickRatePin.periphery,
  fee_schedule: {
    model: "tick_rate_v2" as const,
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
};
const ledger = { accrued: "0", claimed: "0", unclaimed: "0" };
const identity = {
  schema_version: "zero-seed-launch-api/v5" as const,
  chain_id: "31337",
  pool_id: zero,
  as_of,
  next_cursor: null,
};
const path = `/launches/31337/${zero}`;
export const launchesCases: ContractCase[] = [
  {
    operation: "/launches",
    request: "/launches?chainId=31337",
    stub: () =>
      stubQuery("readZeroSeedList", {
        schema_version: "zero-seed-launch-api/v5",
        data: [tickRateSummary, summary],
        as_of,
        next_cursor: null,
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
          tick_lower: 0,
          tick_upper: 100,
          liquidity: "100",
          locked: true,
          withdrawable: false,
          pool_reserves: { launch_token: "1000", quote_token: "0" },
          reserves_basis: "core_pool_balance",
        },
        fee_ledger: {
          holder: owner,
          transferable: true,
          launch_token: ledger,
          quote_token: ledger,
          swap_count: 0,
          claim_count: 0,
          owner_change_count: 1,
          last_event_id: "-1",
        },
        inventory: { trading_open: true, no_bid: true, price_tick: 0 },
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
    stub: () => stubQuery("readZeroSeedClaims", { ...identity, data: [] }),
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
