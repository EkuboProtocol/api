import { ContractCase, QueryResult, stubQuery } from "../harness";
import { CORE_DECIMAL, OWNER, USDC_DECIMAL, WETH_DECIMAL } from "../fixtures";

type PoolRow = QueryResult<"getVe33Pools">["rows"][number];
type TokenRow = QueryResult<"getVe33TokensByAddress">["rows"][number];

const VE33 = "0x5555555555555555555555555555555555555555";
const VE33_DECIMAL = BigInt(VE33).toString();
const VE_TOKEN = "0x6666666666666666666666666666666666666666";
const VE_TOKEN_DECIMAL = BigInt(VE_TOKEN).toString();

// Declared as string | null in queries.ts; pool_keys.stableswap_center_tick is
// INT4 and stableswap_amplification INT2, which postgres returns as numbers.
const stableswapInt = (value: number) => value as unknown as string;

const poolRow = (overrides: Partial<PoolRow> = {}): PoolRow => ({
  chain_id: 1n,
  pool_key_id: "101",
  pool_id: "123456789012345678901234567890",
  token0: USDC_DECIMAL,
  token1: WETH_DECIMAL,
  fee: "1844674407370955",
  tick_spacing: 1000,
  core_address: CORE_DECIMAL,
  extension: VE33_DECIMAL,
  stableswap_center_tick: null,
  stableswap_amplification: null,
  pool_state_sqrt_ratio: "340282366920938463463374607431768211456",
  pool_state_tick: -196000,
  pool_state_liquidity: "1000000000000",
  pool_total_vote_weight: "700000000000000000000",
  swap_fee: "1844674407370955",
  volume0_24h: "1000000",
  volume1_24h: "400000000000000000",
  fees0_24h: "500",
  fees1_24h: "200000000000000",
  ve33_fees0_24h: "100",
  ve33_fees1_24h: "40000000000000",
  ve33_fees0_7d: "700",
  ve33_fees1_7d: "280000000000000",
  ve33_fees0_all: "5000",
  ve33_fees1_all: "2000000000000000",
  ve33_fees_since: new Date("2026-01-01T00:00:00.000Z"),
  tvl0_total: "5000000000",
  tvl1_total: "2000000000000000000000",
  tvl0_delta_24h: "-1000",
  tvl1_delta_24h: "1000",
  depth0: "100000",
  depth1: "40000000000000000",
  depth_percent: 0.02,
  last_event_id: "4611686018427387904",
  total_count: 2,
  total_vote_weight: "1000000000000000000000",
  ...overrides,
});

const tokenRow = (overrides: Partial<TokenRow> = {}): TokenRow => ({
  chain_id: 1n,
  owner: BigInt(OWNER).toString(),
  ve_token_address: VE_TOKEN_DECIMAL,
  ve33_address: VE33_DECIMAL,
  token_id: "7",
  stake_id: "3",
  amount: "1000000000000000000000",
  end_time: new Date("2028-01-01T00:00:00.000Z"),
  voted_pool_id: "123456789012345678901234567890",
  voted_pool_token0: USDC_DECIMAL,
  voted_pool_token1: WETH_DECIMAL,
  voted_pool_fee: "1844674407370955",
  voted_pool_tick_spacing: 1000,
  voted_pool_extension: VE33_DECIMAL,
  voted_pool_stableswap_center_tick: null,
  voted_pool_stableswap_amplification: null,
  pool_key_id: "101",
  applied_vote_weight: "500000000000000000000",
  voted_swap_fee: "1844674407370955",
  pool_total_vote_weight: "700000000000000000000",
  minted_at: new Date("2026-01-01T00:00:00.000Z"),
  mint_transaction_hash:
    "51922968585348276285304963292200960102946523104364574096359779766325829713509",
  last_stake_changed_event_id: "4611686018427387904",
  last_transfer_event_id: "4611686018427387000",
  total_count: 3,
  ...overrides,
});

export const ve33Cases: ContractCase[] = [
  {
    operation: "/ve33/{ve33Address}/pools",
    request: `/ve33/${VE33}/pools?chainId=1&pageSize=10&page=1`,
    stub: () =>
      stubQuery("getVe33Pools", {
        rows: [
          poolRow(),
          poolRow({
            pool_key_id: "102",
            tick_spacing: null,
            stableswap_center_tick: stableswapInt(-100),
            stableswap_amplification: stableswapInt(10),
            pool_state_sqrt_ratio: null,
            pool_state_tick: null,
            pool_state_liquidity: null,
            pool_total_vote_weight: "300000000000000000000",
            ve33_fees_since: null,
            depth_percent: null,
          }),
        ],
        totalCount: 2,
        totalVoteWeight: "1000000000000000000000",
      }),
  },
  {
    operation: "/ve33/{ve33Address}/voters",
    request: `/ve33/${VE33}/voters?chainId=1`,
    stub: () =>
      stubQuery("getVe33Voters", {
        rows: [
          {
            voter: BigInt(OWNER).toString(),
            vote_weight: "700000000000000000000",
            total_count: 1,
            total_vote_weight: "700000000000000000000",
          },
        ],
        totalCount: 1,
        totalVoteWeight: "700000000000000000000",
      }),
  },
  {
    operation: "/ve33/{veTokenAddress}/{address}",
    request: `/ve33/${VE_TOKEN}/${OWNER}?chainId=1&pageSize=50&page=1`,
    stub: () =>
      stubQuery("getVe33TokensByAddress", {
        rows: [
          tokenRow(),
          tokenRow({
            token_id: "8",
            stake_id: "4",
            voted_pool_tick_spacing: null,
            voted_pool_stableswap_center_tick: stableswapInt(0),
            voted_pool_stableswap_amplification: stableswapInt(10),
            minted_at: null,
            mint_transaction_hash: null,
          }),
          tokenRow({
            token_id: "9",
            stake_id: "5",
            voted_pool_id: null,
            voted_pool_token0: null,
            voted_pool_token1: null,
            voted_pool_fee: null,
            voted_pool_extension: null,
            voted_pool_stableswap_center_tick: null,
            voted_pool_stableswap_amplification: null,
            pool_key_id: null,
            applied_vote_weight: null,
            voted_swap_fee: null,
            pool_total_vote_weight: null,
            minted_at: null,
            mint_transaction_hash: null,
          }),
        ],
        totalCount: 3,
      }),
  },
];
