import type { LaunchDetailRow, LaunchRow } from "../../queries";
import { ContractCase, stubQuery } from "../harness";
import { OWNER } from "../fixtures";

// Base, with the predicted (not deployed) launchpad addresses from EKU-822.
const SCHEDULED_LAUNCH = BigInt(
  "0x5184f618B2d6cE625d9fDB9770E151a9B84EdB81",
).toString();
const LAUNCH_ROUTER = BigInt(
  "0x9dae609a75Ac80BB84448a14823199faC514aeDb",
).toString();
const WETH_BASE = BigInt("0x4200000000000000000000000000000000000006");
const LAUNCH_TOKEN = BigInt("0x7a1c0ffee0000000000000000000000000000001");
const CORE = BigInt("0x00000000000014aa86c5d3c41765bb24e11bd701").toString();
const POOL_ID =
  "0x6f1b0c3e9a4d5f2b8c7e6d5a4b3c2d1e0f9a8b7c6d5e4f3a2b1c0d9e8f7a6b5c";
const TX_HASH = BigInt(
  "0x8c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d",
).toString();

const launchRow = (overrides: Partial<LaunchRow> = {}): LaunchRow => ({
  chain_id: 8453n,
  pool_key_id: 42n,
  core_address: CORE,
  pool_id: BigInt(POOL_ID).toString(),
  token0: WETH_BASE.toString(),
  token1: LAUNCH_TOKEN.toString(),
  fee: "0",
  pool_tick_spacing: 1000,
  pool_extension: SCHEDULED_LAUNCH,
  token: LAUNCH_TOKEN.toString(),
  token_name: "Launch Token",
  token_symbol: "LAUNCH",
  token_decimals: 18,
  total_supply: "1000000000000000000000000000",
  quote_token: WETH_BASE.toString(),
  quote_token_name: "Wrapped Ether",
  quote_token_symbol: "WETH",
  quote_token_decimals: 18,
  token_is_token1: true,
  start_time: 1791331200n,
  end_time: 1791417600n,
  target_tick: -230000,
  upper_tick: -160000,
  tick_spacing: 1000,
  initial_fee: "184467440737095516",
  final_fee: "18446744073709551",
  migration_tick_lower: -887000,
  migration_tick_upper: 887000,
  deployed: "250000000000000000000000000",
  reserve0: "12000000000000000000",
  reserve1: "750000000000000000000000000",
  complete: false,
  owner: LAUNCH_ROUTER,
  creator: BigInt(OWNER).toString(),
  launch_extension: SCHEDULED_LAUNCH,
  created_block_number: 36000000n,
  created_transaction_hash: TX_HASH,
  created_time: new Date("2026-10-06T00:00:00Z"),
  created_event_id: -9223217452617613312n,
  last_advanced_event_id: -9223217010235916288n,
  head_block_time: new Date("2026-10-07T12:00:00Z"),
  status: "live",
  ...overrides,
});

const detailRow = (
  overrides: Partial<LaunchDetailRow> = {},
): LaunchDetailRow => ({
  ...launchRow(),
  state_sqrt_ratio: "340282366920938463463374607431768211456",
  state_tick: 200000,
  state_liquidity: "1000000000000000000",
  advanced_block_number: 36000100n,
  advanced_transaction_hash: TX_HASH,
  advanced_time: new Date("2026-10-07T11:59:00Z"),
  terminal_pool_id: null,
  locked_liquidity: null,
  creator_fees_claimed0: "0",
  creator_fees_claimed1: "0",
  ...overrides,
});

const launchPath = `/launches/8453/${POOL_ID}`;

export const launchesCases: ContractCase[] = [
  {
    operation: "/launches",
    request: `/launches?chainId=8453&status=live&creator=${OWNER}&page=1&pageSize=2`,
    stub: () =>
      stubQuery("listLaunches", {
        rows: [
          launchRow(),
          // created directly on the extension, chain head not indexed yet
          launchRow({
            pool_key_id: 43n,
            creator: null,
            quote_token_name: null,
            quote_token_symbol: null,
            quote_token_decimals: null,
            head_block_time: null,
            status: null,
            last_advanced_event_id: null,
          }),
        ],
        totalCount: 3,
      }),
  },
  {
    operation: "/launches/{chainId}/{poolId}",
    request: launchPath,
    stub: () => stubQuery("getLaunch", detailRow()),
  },
  {
    name: `${launchPath} (migrated)`,
    operation: "/launches/{chainId}/{poolId}",
    request: launchPath,
    stub: () =>
      stubQuery(
        "getLaunch",
        detailRow({
          complete: true,
          status: "migrated",
          terminal_pool_id: BigInt(POOL_ID).toString(),
          locked_liquidity: "123456789",
          creator_fees_claimed0: "5",
          creator_fees_claimed1: "6",
        }),
      ),
  },
  {
    name: `${launchPath} (before the first advance)`,
    operation: "/launches/{chainId}/{poolId}",
    request: launchPath,
    stub: () =>
      stubQuery(
        "getLaunch",
        detailRow({
          status: "upcoming",
          advanced_block_number: null,
          advanced_transaction_hash: null,
          advanced_time: null,
          last_advanced_event_id: null,
        }),
      ),
  },
  {
    operation: "/launches/{chainId}/{poolId}/stats",
    request: `${launchPath}/stats`,
    stub: () =>
      stubQuery("getLaunchStats", {
        swap_count: 3,
        buy_count: 2,
        sell_count: 1,
        buy_quote_in: "2000000000000000000",
        buy_token_out: "40000000000000000000000000",
        sell_token_in: "1000000000000000000000000",
        sell_quote_out: "40000000000000000",
        distinct_lockers: 1,
        distinct_transactions: 3,
        fees_accrued_token: "100",
        fees_accrued_quote: "200",
        fees_claimed_token: "0",
        fees_claimed_quote: "150",
        fee_claim_count: 1,
        funding_token: "0",
        funding_quote: "0",
        funding_count: 0,
        migrated_principal_token: "0",
        migrated_principal_quote: "0",
      }),
  },
  {
    operation: "/launches/{chainId}/{poolId}/swaps",
    request: `${launchPath}/swaps?limit=1&cursor=-9223217452617613312`,
    stub: () =>
      stubQuery("listLaunchSwaps", [
        {
          event_id: -9223217010235916287n,
          block_number: 36000100n,
          transaction_index: 4,
          event_index: 7,
          transaction_hash: TX_HASH,
          block_time: new Date("2026-10-07T11:59:00Z"),
          locker: BigInt(
            "0x7B2aA7Ecc0B5936b7C52E6259A19C3BA557d0748",
          ).toString(),
          delta0: "1000000000000000000",
          delta1: "-20000000000000000000000000",
          fee_amount: "100",
          fee_is_token1: true,
        },
        {
          event_id: -9223217010235916280n,
          block_number: 36000101n,
          transaction_index: 0,
          event_index: 2,
          transaction_hash: TX_HASH,
          block_time: new Date("2026-10-07T11:59:02Z"),
          locker: BigInt(
            "0x7B2aA7Ecc0B5936b7C52E6259A19C3BA557d0748",
          ).toString(),
          delta0: "-40000000000000000",
          delta1: "1000000000000000000000000",
          fee_amount: "200",
          fee_is_token1: false,
        },
      ]),
  },
  {
    name: `${launchPath}/swaps (launch with no swaps)`,
    operation: "/launches/{chainId}/{poolId}/swaps",
    request: `${launchPath}/swaps`,
    stub: () =>
      stubQuery("listLaunchSwaps", [
        {
          event_id: null,
          block_number: null,
          transaction_index: null,
          event_index: null,
          transaction_hash: null,
          block_time: null,
          locker: null,
          delta0: null,
          delta1: null,
          fee_amount: null,
          fee_is_token1: null,
        },
      ]),
  },
];
