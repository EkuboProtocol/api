import { ContractCase, stubQuery } from "../harness";
import { LOCAL_INSTANCES } from "../../routes/launches/policy";

const pin = LOCAL_INSTANCES[0]!;
const zero = `0x${"0".repeat(64)}`;
const as_of = { block_number: "1", block_hash: zero, block_time: 1000 };
const summary = {
  schema_version: "zero-seed-launch-api/v1" as const,
  chain_id: "31337",
  pool_id: zero,
  pool_key: {
    core_address: pin.core,
    token0: `0x${"1".repeat(40)}`,
    token1: pin.quote,
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
    address: pin.quote,
    name: "Wrapped Ether",
    symbol: "WETH",
    decimals: 18,
  },
  launch_token_is_token1: false,
  creator: `0x${"2".repeat(40)}`,
  ask_tick: 0,
  upper_tick: 100,
  fee_schedule: {
    trading_start: 1000,
    fee_duration: 3600,
    fee_end: 4600,
    initial_fee: "10",
    final_fee: "3",
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
const ledger = { accrued: "0", claimed: "0", unclaimed: "0" };
const identity = {
  schema_version: "zero-seed-launch-api/v1" as const,
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
        schema_version: "zero-seed-launch-api/v1",
        data: [summary],
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
          installed_supply: "1000",
          locked: true,
          withdrawable: false,
          pool_reserves: { launch_token: "1000", quote_token: "0" },
          reserves_basis: "core_pool_balance",
        },
        fee_ledger: {
          holder: summary.creator,
          transferable: false,
          launch_token: ledger,
          quote_token: ledger,
          swap_count: 0,
          claim_count: 0,
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
];
