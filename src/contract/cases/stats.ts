import { ContractCase, QueryResult, stubQuery, stubTokens } from "../harness";
import {
  CORE,
  CORE_DECIMAL,
  OWNER,
  pairTokens,
  USDC,
  USDC_DECIMAL,
  WETH,
  WETH_DECIMAL,
} from "../fixtures";

// DATE_TRUNC over timestamptz and blocks.block_time come back as Date, while
// queries.ts declares several of them as string.
const DAY = new Date("2026-09-28T00:00:00.000Z");
const BLOCK_TIME = new Date("2026-09-28T12:34:56.000Z");
const asDeclaredString = (date: Date) => date as unknown as string;

type PoolStatsRow = QueryResult<"getTopPools">[number];

const poolStatsRow = (overrides: Partial<PoolStatsRow> = {}): PoolStatsRow => ({
  pool_id: "73786976294838206464",
  fee: "55340232221128654",
  tick_spacing: 5982,
  core_address: CORE_DECIMAL,
  extension: "0",
  volume0_24h: "1000000",
  volume1_24h: "400000000000000000",
  fees0_24h: "3000",
  fees1_24h: "1200000000000000",
  ve33_fees0_24h: "0",
  ve33_fees1_24h: "0",
  tvl0_total: "5000000000",
  tvl1_total: "2000000000000000000000",
  tvl0_delta_24h: "-1000",
  tvl1_delta_24h: "1000",
  depth0: "100000",
  depth1: "40000000000000000",
  depth_percent: 0.0121,
  stableswap_center_tick: null,
  stableswap_amplification: null,
  boosted_fees_donate_rate0: "1000000",
  boosted_fees_donate_rate1: "0",
  boosted_fees_last_donated_time: BLOCK_TIME,
  boosted_fees_future_deltas: [
    {
      // EXTRACT(epoch ...)::text renders the NUMERIC with fractional digits.
      time: "1790000000.000000",
      donate_rate_delta0: "-1000000",
      donate_rate_delta1: "0",
    },
  ],
  ...overrides,
});

const unboostedPoolStatsRow = poolStatsRow({
  pool_id: "147573952589676412928",
  depth_percent: null,
  boosted_fees_donate_rate0: null,
  boosted_fees_donate_rate1: null,
  boosted_fees_last_donated_time: null,
  boosted_fees_future_deltas: null,
});

// Stableswap pools have tick_spacing NULL (pool_keys_tick_spacing_required);
// queries.ts declares tick_spacing as number and the stableswap columns as
// string, but they are INT4/INT2 and come back as numbers.
const stableswapPoolStatsRow = poolStatsRow({
  pool_id: "221360928884514619392",
  tick_spacing: null as unknown as number,
  stableswap_center_tick: 0 as unknown as string,
  stableswap_amplification: 10 as unknown as string,
  boosted_fees_donate_rate0: null,
  boosted_fees_donate_rate1: null,
  boosted_fees_last_donated_time: null,
  boosted_fees_future_deltas: null,
});

const boostedPoolRow = (pool: PoolStatsRow) => ({
  chain_id: 1n,
  token0: USDC_DECIMAL,
  token1: WETH_DECIMAL,
  ...pool,
});

type PairEventRow = QueryResult<"getPairEvents">[number];

const pairEventRow = (overrides: Partial<PairEventRow> = {}): PairEventRow => ({
  type: 0,
  fee: "55340232221128654",
  tick_spacing: 5982,
  extension: "0",
  core_address: CORE_DECIMAL,
  locker: BigInt(OWNER).toString(),
  timestamp: asDeclaredString(BLOCK_TIME),
  transaction_hash:
    "51922968585348276285304963292200960000000000000000000000000000000000000000",
  delta0: "1000000",
  delta1: "-400000000000000",
  ...overrides,
});

type TopPositionRow = QueryResult<"getTopPositionsByPair">[number];

// lower_bound/upper_bound and tick_spacing are INT4 and stableswap_amplification
// is INT2, all declared as string in queries.ts; the runtime values are numbers.
const topPositionRow = (
  overrides: Partial<TopPositionRow> = {},
): TopPositionRow => ({
  chain_id: 1n,
  nft_address: BigInt(
    "0x07b696af58c967c1b14c9dde0ace001720635a660a8e90c565ea459345318b30",
  ).toString(),
  core_address: CORE_DECIMAL,
  positions_address: BigInt(
    "0x02e0af29598b407c8716b17f6d2795eca1b471413fa03fb145a5e33722184067",
  ).toString(),
  owner: BigInt(OWNER).toString(),
  token_id: "12345",
  token0: USDC_DECIMAL,
  token1: WETH_DECIMAL,
  fee: "55340232221128654",
  tick_spacing: 5982 as unknown as string,
  extension: "0",
  lower_bound: -27631000 as unknown as string,
  upper_bound: -12345000 as unknown as string,
  liquidity: "123456789012345",
  minted_timestamp: BLOCK_TIME,
  pool_state_sqrt_ratio: "1461446703485210103287273052203988822378723970342",
  pool_state_tick: -19650000,
  pool_state_liquidity: "987654321098765",
  stableswap_center_tick: null,
  stableswap_amplification: null,
  ...overrides,
});

const topPositionRows: TopPositionRow[] = [
  topPositionRow(),
  topPositionRow({
    token_id: "12346",
    tick_spacing: null,
    lower_bound: -88722000 as unknown as string,
    upper_bound: 88722000 as unknown as string,
    pool_state_sqrt_ratio: null,
    pool_state_tick: null,
    pool_state_liquidity: null,
    stableswap_center_tick: 0,
    stableswap_amplification: 10 as unknown as string,
  }),
];

export const statsCases: ContractCase[] = [
  {
    operation: "/overview/pairs",
    request: "/overview/pairs?chainId=1",
    stub: () =>
      stubQuery("getTopPairs", [
        {
          chain_id: 1n,
          token0: USDC_DECIMAL,
          // Declared as number in queries.ts; postgres returns NUMERIC as a
          // string.
          token1: WETH_DECIMAL as unknown as number,
          volume0_24h: "1000000",
          volume1_24h: "400000000000000000",
          fees0_24h: "500",
          fees1_24h: "200000000000000",
          ve33_fees0_24h: "0",
          ve33_fees1_24h: "0",
          tvl0_total: "5000000000",
          tvl1_total: "2000000000000000000000",
          tvl0_delta_24h: "-1000",
          tvl1_delta_24h: "1000",
          depth0: "100000",
          depth1: "40000000000000000",
          min_depth_percent: 0.02,
        },
      ]),
  },
  {
    operation: "/overview/boosted-fees-pools",
    request: "/overview/boosted-fees-pools?chainId=1",
    stub: () =>
      stubQuery("getBoostedFeesPools", [
        boostedPoolRow(poolStatsRow()),
        boostedPoolRow(
          poolStatsRow({
            pool_id: "147573952589676412928",
            depth_percent: null,
            boosted_fees_future_deltas: null,
          }),
        ),
      ]),
  },
  {
    operation: "/overview/boosted-fees-pools",
    name: "/overview/boosted-fees-pools stableswap pool (tick_spacing null)",
    request: "/overview/boosted-fees-pools?chainId=1",
    stub: () =>
      stubQuery("getBoostedFeesPools", [
        boostedPoolRow({
          ...stableswapPoolStatsRow,
          boosted_fees_donate_rate0: "1000000",
          boosted_fees_donate_rate1: "0",
          boosted_fees_last_donated_time: BLOCK_TIME,
        }),
      ]),
  },
  {
    operation: "/overview/revenue",
    request: "/overview/revenue?chainId=1",
    stub: () => {
      stubQuery("getRevenueByTokenByDate", [
        // Declared as {token, volume, chain_id}; the query actually selects
        // date and revenue.
        {
          chain_id: 1n,
          token: USDC_DECIMAL,
          date: DAY,
          revenue: "1500",
        } as unknown as QueryResult<"getRevenueByTokenByDate">[number],
      ]);
      stubQuery("getRevenueByToken", [
        { chain_id: 1n, token: WETH_DECIMAL, revenue: "60000000000000" },
      ]);
    },
  },
  {
    operation: "/overview/tvl",
    request: "/overview/tvl?chainId=1",
    stub: () => {
      stubQuery("getTvlByToken", [
        { chain_id: 1n, token: USDC_DECIMAL, balance: "5000000000" },
      ]);
      stubQuery("getTvlDeltaByTokenByDate", [
        {
          chain_id: 1n,
          token: WETH_DECIMAL,
          date: asDeclaredString(DAY),
          delta: "-1000000000000000",
        },
      ]);
      stubQuery("listPricedErc20Tokens", [
        {
          chain_id: 1n,
          token_address: USDC_DECIMAL,
          token_decimals: 6,
          usd_price: "1.0001",
        },
        {
          chain_id: 1n,
          token_address: WETH_DECIMAL,
          token_decimals: 18,
          usd_price: "2500.5",
        },
      ]);
    },
  },
  {
    operation: "/overview/volume",
    request: "/overview/volume",
    stub: () => {
      stubQuery("getTotalVolume", [
        {
          chain_id: 1n,
          token: USDC_DECIMAL,
          volume: "1000000",
          fees: "3000",
          ve33_fees: "0",
        },
      ]);
      stubQuery("getVolumeByTokenByDate", [
        {
          chain_id: 1n,
          token: WETH_DECIMAL,
          date: asDeclaredString(DAY),
          volume: "400000000000000000",
          fees: "1200000000000000",
          ve33_fees: "0",
        },
      ]);
      stubQuery("listPricedErc20Tokens", [
        {
          chain_id: 1n,
          token_address: USDC_DECIMAL,
          token_decimals: 6,
          usd_price: "1.0001",
        },
        {
          chain_id: 1n,
          token_address: WETH_DECIMAL,
          token_decimals: 18,
          usd_price: "2500.5",
        },
      ]);
    },
  },
  {
    operation: "/pair/{chainId}/{tokenA}/{tokenB}/tvl",
    name: "/pair/{chainId}/{tokenA}/{tokenB}/tvl (tvlByToken chain_id)",
    request: `/pair/1/${WETH}/${USDC}/tvl?coreAddress=${CORE}&poolId=1`,
    stub: () => {
      stubTokens(pairTokens);
      stubQuery("getTvlByToken", [
        { chain_id: 1n, token: USDC_DECIMAL, balance: "5000000000" },
        {
          chain_id: 1n,
          token: WETH_DECIMAL,
          balance: "2000000000000000000000",
        },
      ]);
      stubQuery("getTvlDeltaByTokenByDate", [
        {
          chain_id: 1n,
          token: USDC_DECIMAL,
          date: asDeclaredString(DAY),
          delta: "1000",
        },
      ]);
    },
  },
  {
    operation: "/pair/{chainId}/{tokenA}/{tokenB}/volume",
    name: "/pair/{chainId}/{tokenA}/{tokenB}/volume (volumeByTokenByDate chain_id)",
    request: `/pair/1/${USDC}/${WETH}/volume`,
    stub: () => {
      stubTokens(pairTokens);
      stubQuery("getTotalVolume", [
        {
          chain_id: 1n,
          token: USDC_DECIMAL,
          volume: "1000000",
          fees: "3000",
          ve33_fees: "0",
        },
      ]);
      stubQuery("getVolumeByTokenByDate", [
        {
          chain_id: 1n,
          token: WETH_DECIMAL,
          date: asDeclaredString(DAY),
          volume: "400000000000000000",
          fees: "1200000000000000",
          ve33_fees: "0",
        },
      ]);
    },
  },
  {
    operation: "/pair/{chainId}/{tokenA}/{tokenB}/pools",
    request: `/pair/1/${USDC}/${WETH}/pools?minTvlUsd=0`,
    stub: () => {
      stubTokens(pairTokens);
      stubQuery("getTopPools", [poolStatsRow(), unboostedPoolStatsRow]);
    },
  },
  {
    operation: "/pair/{chainId}/{tokenA}/{tokenB}/pools",
    name: "/pair/{chainId}/{tokenA}/{tokenB}/pools stableswap pool (tick_spacing null)",
    request: `/pair/1/${USDC}/${WETH}/pools`,
    stub: () => {
      stubTokens(pairTokens);
      stubQuery("getTopPools", [stableswapPoolStatsRow]);
    },
  },
  {
    operation: "/tokens/{chainId}/{tokenA}/{tokenB}/liquidity",
    name: "/tokens/{chainId}/{tokenA}/{tokenB}/liquidity (tick is a number)",
    request: `/tokens/1/${USDC}/${WETH}/liquidity`,
    stub: () => {
      stubTokens(pairTokens);
      // per_pool_per_tick_liquidity.tick is INT4, declared as string.
      stubQuery("getPairLiquidityGraph", [
        {
          tick: -20000000 as unknown as string,
          net_liquidity_delta_diff: "123456789",
        },
        {
          tick: -19000000 as unknown as string,
          net_liquidity_delta_diff: "-123456789",
        },
      ]);
    },
  },
  {
    operation: "/pair/{chainId}/{tokenA}/{tokenB}/positions",
    request: `/pair/1/${USDC}/${WETH}/positions?coreAddress=${CORE}&limit=2`,
    stub: () => {
      stubTokens(pairTokens);
      stubQuery("getTopPositionsByPair", topPositionRows);
    },
  },
  {
    operation: "/pools/{chainId}/{coreAddress}/{poolId}/positions",
    request: `/pools/1/${CORE}/73786976294838206464/positions?limit=5`,
    stub: () => stubQuery("getTopPositionsByPool", topPositionRows),
  },
  {
    operation: "/tokens/{chainId}/{tokenA}/{tokenB}/events",
    request: `/tokens/1/${USDC}/${WETH}/events?poolId=1`,
    stub: () => {
      stubTokens(pairTokens);
      stubQuery("getPairEvents", [
        pairEventRow(),
        pairEventRow({
          type: 1,
          delta0: "-5000000",
          delta1: "-2000000000000000",
        }),
      ]);
    },
  },
  {
    operation: "/tokens/{chainId}/{tokenA}/{tokenB}/events",
    name: "/tokens/{chainId}/{tokenA}/{tokenB}/events stableswap pool (tick_spacing null)",
    request: `/tokens/1/${USDC}/${WETH}/events`,
    stub: () => {
      stubTokens(pairTokens);
      // pool_keys.tick_spacing is NULL for stableswap pools; declared number.
      stubQuery("getPairEvents", [
        pairEventRow({ tick_spacing: null as unknown as number }),
      ]);
    },
  },
];
