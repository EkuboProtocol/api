import { ContractCase, QueryResult, stubQuery } from "../harness";
import { CORE, tokenRow, USDC, USDC_DECIMAL } from "../fixtures";

// Request window for the pool price history cases: ten hourly buckets.
const START = 1_790_600_000;
const END = START + 10 * 3_600;
const at = (seconds: number) => new Date(seconds * 1_000);

// sqrt(token1 per token0) * 2**128 for ETH/USDC around 2.7e-9 USDC units per
// wei, as postgres returns NUMERIC.
const SQRT_2_68 = "17615981356597974461518658387574784";
const SQRT_2_69 = "17648816392279131946403317996847104";
const SQRT_2_70 = "17681590452805816215298018342076416";
const SQRT_2_71 = "17714303876616965883137017885229056";
const SQRT_2_72 = "17746956999032258152338621602988032";

const TWAMM_EXTENSION = "0xd4279c050da1f5c5b2830558c7a08e57e12b54ec";
const POOL_ID =
  "0x614e2ba87050c938ccff35e3260b7ea9c6f5303365b8ee172ebd07e916015046";
const POOL_PATH = `/pools/1/${CORE}/${POOL_ID}/price/history`;
const POOL_QUERY = `?interval=3600&start=${START}&end=${END}`;

type PoolKeyRow = QueryResult<"getPoolKeyByCoreAndId">[number];

const ethUsdcPool = (overrides: Partial<PoolKeyRow> = {}): PoolKeyRow => ({
  pool_key_id: 42n,
  token0: "0",
  token1: USDC_DECIMAL,
  fee: "9223372036854775",
  tick_spacing: 1000,
  extension: "0",
  stableswap_center_tick: null,
  stableswap_amplification: null,
  pool_config: null,
  state_sqrt_ratio: SQRT_2_70,
  state_tick: -19_730_000,
  state_liquidity: "1572500836553",
  ...overrides,
});

type Candle = QueryResult<"getPoolPriceHistoryCandles">[number];

const candle = (
  startSeconds: number,
  [open, high, low, close]: string[],
  swapCount: bigint,
): Candle => ({
  start: at(startSeconds),
  open_sqrt_ratio: open,
  high_sqrt_ratio: high,
  low_sqrt_ratio: low,
  close_sqrt_ratio: close,
  volume0: "137964328940192000",
  volume1: "370862000",
  // Declared as string in queries.ts; COUNT(*) is int8, which the driver
  // returns as bigint.
  swap_count: swapCount as unknown as string,
});

// The first candle starts after the window opens, so the handler prepends a
// volume-less seed candle from getPoolPriceSeed.
const swapCandles = [
  candle(START + 3_600, [SQRT_2_69, SQRT_2_71, SQRT_2_68, SQRT_2_70], 3n),
  candle(START + 3 * 3_600, [SQRT_2_70, SQRT_2_72, SQRT_2_70, SQRT_2_71], 1n),
];

function stubSwapPricePath(): void {
  stubQuery("getPoolPriceHistoryCandles", swapCandles);
  stubQuery("getPoolPriceSeed", {
    block_time: at(START - 600),
    sqrt_ratio_after: SQRT_2_69,
  });
}

// A full-range TWAMM pool selling ETH for USDC and USDC for ETH, whose last
// virtual execution sits mid-window so the handler projects the tail.
function stubTwammPool(): void {
  const liquidity = "5196152422706632";
  stubQuery("getPoolKeyByCoreAndId", [
    ethUsdcPool({
      fee: "18446744073709552",
      tick_spacing: null,
      extension: BigInt(TWAMM_EXTENSION).toString(),
      state_liquidity: liquidity,
    }),
  ]);
  stubSwapPricePath();
  stubQuery("getPoolTwammState", {
    sqrt_ratio: SQRT_2_71,
    tick: -19_720_000,
    liquidity,
    fee: "18446744073709552",
    token0_sale_rate: "1193046471111111126024192",
    token1_sale_rate: "3221225472000000",
    last_execution_time: at(START + 4 * 3_600 + 120),
  });
  stubQuery("getTwammSaleRateDeltas", [
    {
      time: at(START + 7 * 3_600),
      net_sale_rate_delta0: "-596523235555555563012096",
      net_sale_rate_delta1: "0",
    },
  ]);
  stubQuery("getPoolTicksById", [
    { tick: -88_722_835, liquidity_delta: liquidity },
    { tick: 88_722_835, liquidity_delta: `-${liquidity}` },
  ]);
}

type TwammState = QueryResult<"getPoolTwammState">;

type PriceHistoryRow = QueryResult<"getPriceHistory">[number];

// Declared as {start: string; vwap/min/max: number} in queries.ts; date_bin
// over timestamptz returns a Date and the NUMERIC aggregates come back as
// strings.
const priceHistoryRow = (
  startSeconds: number,
  vwap: string,
  min: string | null,
  max: string | null,
): PriceHistoryRow =>
  ({
    start: at(startSeconds),
    vwap,
    min,
    max,
    k_volume: "1239640265493601327150444738",
  }) as unknown as PriceHistoryRow;

function stubPairPrices(): void {
  // Unregistered tokens fall back to their raw addresses.
  stubQuery("getErc20TokenByAddress", null);
  stubQuery("getVolumeWeightedPrice", { price: 2.7e-9, k_volume: 10n ** 30n });
}

export const pricesCases: ContractCase[] = [
  {
    operation: "/tokens/{chainId}/{tokenAddress}/price-history",
    request: `/tokens/1/${USDC}/price-history?interval=3600&duration=86400`,
    stub: () => {
      stubQuery("getErc20TokenByAddress", tokenRow());
      stubQuery("getTokenUsdPriceHistory", [
        { start: at(START), price: 1.00000000310102 },
        { start: at(START + 3_600), price: 0.99999999560024 },
      ]);
    },
  },
  {
    operation: "/price/{chainId}/{baseToken}/{quoteToken}/history",
    request: `/price/1/0x0/${USDC}/history?interval=3600`,
    stub: () => {
      stubPairPrices();
      stubQuery("getPriceHistory", [
        priceHistoryRow(START, "2.6394e-9", "2.6372e-9", "2.6425e-9"),
        priceHistoryRow(START + 3_600, "2.6448e-9", "2.6393e-9", "2.6502e-9"),
      ]);
    },
  },
  {
    operation: "/price/{chainId}/{baseToken}/{quoteToken}/history",
    name: "/price/{chainId}/{baseToken}/{quoteToken}/history inverted",
    request: `/price/1/${USDC}/0x0/history?interval=3600`,
    stub: () => {
      stubPairPrices();
      stubQuery("getPriceHistory", [
        priceHistoryRow(START, "2.6394e-9", "2.6372e-9", "2.6425e-9"),
      ]);
    },
  },
  {
    operation: "/price/{chainId}/{baseToken}/{quoteToken}/history",
    // A bucket whose swaps all fall under the dust threshold has NULL min and
    // max. Inverting them divides by Number(null) = 0, and JSON serialises
    // the resulting Infinity as null, which the schema's number rejects.
    name: "/price/{chainId}/{baseToken}/{quoteToken}/history inverted dust-only bucket",
    request: `/price/1/${USDC}/0x0/history?interval=3600`,
    stub: () => {
      stubPairPrices();
      stubQuery("getPriceHistory", [
        priceHistoryRow(START, "2.6394e-9", null, null),
      ]);
    },
  },
  {
    operation: "/price/{chainId}/{baseToken}/{quoteToken}/ohlc",
    request: `/price/1/${USDC}/0x0/ohlc?interval=3600`,
    stub: () => {
      stubPairPrices();
      stubQuery("getPairOhlcHistory", [
        {
          start: at(START),
          open: "2.6394e-9",
          high: "2.6502e-9",
          low: "2.6372e-9",
          close: "2.6448e-9",
          volume0: "137964328940192000",
          volume1: "370862000",
          // Declared as string in queries.ts; COUNT(*) is int8, which the
          // driver returns as bigint.
          swap_count: 4n as unknown as string,
        },
      ]);
    },
  },
  {
    operation: "/pools/{chainId}/{coreAddress}/{poolId}/price/history",
    request: POOL_PATH + POOL_QUERY,
    stub: () => {
      stubQuery("getPoolKeyByCoreAndId", [ethUsdcPool()]);
      stubSwapPricePath();
      // Declared without null in queries.ts (rows[0] ?? null infers the row
      // type), but a pool without TWAMM state returns null.
      stubQuery("getPoolTwammState", null as unknown as TwammState);
    },
  },
  {
    operation: "/pools/{chainId}/{coreAddress}/{poolId}/price/history",
    name: "/pools/{chainId}/{coreAddress}/{poolId}/price/history TWAMM projection",
    request: POOL_PATH + POOL_QUERY,
    stub: stubTwammPool,
  },
];
