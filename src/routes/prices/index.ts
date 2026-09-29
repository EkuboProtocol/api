import { createRoute, z } from "@hono/zod-openapi";
import { defineRoute } from "../../shared/context";
import { parseOutTokenAddress } from "../../shared/parseOutTokens";
import {
  AddressType,
  ChainIdType,
  NumericStringType,
  TokenIdentifierType,
} from "../../shared/validation/address";
import { createQueries, Queries } from "../../queries";
import { jsonResponse } from "../../shared/openapi";
import { ETH_TOKEN_ADDRESS_VALUE } from "../../shared/constants";
import toHex from "../../shared/toHex";
import { projectTwammPoolStateAtTime } from "./twammProjection";
import {
  errorResponses,
  notFoundResponse,
  StatusError,
} from "../../shared/errors";
import { getTokenByAddress } from "../meta/tokens";

const PriceHistoryPointType = z.object({
  start: z.union([z.string(), z.date()]),
  vwap: z.number(),
  // A bucket whose swaps are all dust has no min or max. Inverting the pair
  // divides by zero for those, and JSON serializes the Infinity as null.
  max: z.number().nullable(),
  min: z.number().nullable(),
  k_volume: z.string(),
});

const GetPairPriceHistoryResponseType = z.object({
  timestamp: z.number().int(),
  start: z.number().int(),
  end: z.number().int(),
  interval: z.number().int(),
  data: z.array(PriceHistoryPointType),
});

export const PoolPriceHistoryPointType = z.object({
  start: z.union([z.string(), z.date()]),
  open: z.number(),
  high: z.number(),
  low: z.number(),
  close: z.number(),
  // Sums of the swap amounts in each token's smallest unit, labelled by the
  // pool's sort order. They are optional because not every candle is built
  // from swaps: a candle carrying the price forward over a quiet stretch, and
  // one projected from TWAMM sale rates, describe no indexed trades and so
  // report no volume rather than a misleading zero.
  volume0: z.string().optional(),
  volume1: z.string().optional(),
  swap_count: z.number().int().optional(),
});

const GetPoolPriceHistoryResponseType = z.object({
  timestamp: z.number().int(),
  start: z.number().int(),
  end: z.number().int(),
  interval: z.number().int(),
  token0: z.string(),
  token1: z.string(),
  data: z.array(PoolPriceHistoryPointType),
});

const TokenUsdPriceHistoryPointType = z.object({
  start: z.union([z.string(), z.date()]),
  price: z.number().positive(),
});

const GetTokenUsdPriceHistoryResponseType = z.object({
  timestamp: z.number().int(),
  start: z.number().int(),
  end: z.number().int(),
  interval: z.number().int(),
  data: z.array(TokenUsdPriceHistoryPointType),
});

const DEFAULT_TOKEN_PRICE_HISTORY_INTERVAL_SECONDS = 15 * 60;
const DEFAULT_TOKEN_PRICE_HISTORY_DURATION_SECONDS = 24 * 60 * 60;
const MAX_TOKEN_PRICE_HISTORY_POINTS = 120;

function sqrtRatioX128ToPrice(sqrtRatio: bigint | string): number {
  const ratio = Number(sqrtRatio) / 2 ** 128;
  return ratio * ratio;
}

// Pair and pool histories default to this many buckets ending now.
const DEFAULT_HISTORY_POINT_COUNT = 60;
const MAX_HISTORY_POINTS = 120;
const MAX_HISTORY_DURATION_SECONDS = 30 * 86_400;

const DEFAULT_PAIR_PRICE_HISTORY_INTERVAL_SECONDS = 1_800;
const DEFAULT_POOL_PRICE_HISTORY_INTERVAL_SECONDS = 300;

const DEFAULT_END_DESCRIPTION = "; defaults to now";
const DEFAULT_START_DESCRIPTION = `; defaults to ${DEFAULT_HISTORY_POINT_COUNT} intervals before end`;

// `end` defaults to now and `start` to DEFAULT_HISTORY_POINT_COUNT intervals
// before `end`.
function parseHistoryRange(
  intervalSeconds: number,
  startSeconds: number | undefined,
  endSeconds: number | undefined,
): { start: Date; end: Date } {
  const end =
    endSeconds === undefined
      ? new Date(Date.now())
      : new Date(endSeconds * 1_000);
  const start =
    startSeconds === undefined
      ? new Date(
          end.getTime() - intervalSeconds * DEFAULT_HISTORY_POINT_COUNT * 1_000,
        )
      : new Date(startSeconds * 1_000);
  return { start, end };
}

function assertOrderedRange(start: Date, end: Date): void {
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new StatusError(400, "Invalid `start` or `end` parameters");
  }

  if (start.getTime() >= end.getTime()) {
    throw new StatusError(400, "Start time must be before end time");
  }
}

function assertRangeWithinLimits(
  start: Date,
  end: Date,
  intervalSeconds: number,
): void {
  const durationMilliseconds = end.getTime() - start.getTime();

  if (durationMilliseconds > MAX_HISTORY_DURATION_SECONDS * 1_000) {
    throw new StatusError(
      400,
      "Start time cannot be more than 30 days before end time",
    );
  }

  if (durationMilliseconds / intervalSeconds / 1_000 > MAX_HISTORY_POINTS) {
    throw new StatusError(400, "Interval too small for the range");
  }
}

async function resolvePair(
  queries: Queries,
  chainId: bigint,
  baseToken: string,
  quoteToken: string,
) {
  const [baseTokenAddress, quoteTokenAddress] = await Promise.all([
    parseOutTokenAddress(queries, chainId, baseToken),
    parseOutTokenAddress(queries, chainId, quoteToken),
  ]);

  if (baseTokenAddress === quoteTokenAddress) {
    throw new StatusError(400, "Base token cannot be equal to quote token");
  }

  const baseBeforeQuote = baseTokenAddress < quoteTokenAddress;

  return {
    baseTokenAddress,
    quoteTokenAddress,
    baseBeforeQuote,
    token0Address: baseBeforeQuote ? baseTokenAddress : quoteTokenAddress,
    token1Address: baseBeforeQuote ? quoteTokenAddress : baseTokenAddress,
  };
}

function dustThreshold(priceInEth: number | undefined): bigint {
  const thresholdEth = 1e16;
  return BigInt(Math.max(0, Math.round(thresholdEth * (priceInEth ?? 0))));
}

// Dust swaps are excluded by requiring both sides to move at least the
// value of 0.01 ETH, converted into each token by its price in ETH.
async function getDustThresholds(
  queries: Queries,
  chainId: bigint,
  token0Address: bigint,
  token1Address: bigint,
): Promise<{ threshold0: bigint; threshold1: bigint }> {
  const [price0, price1] = await Promise.all([
    queries.getVolumeWeightedPrice({
      baseToken: ETH_TOKEN_ADDRESS_VALUE,
      quoteToken: token0Address,
      chainId,
    }),
    queries.getVolumeWeightedPrice({
      baseToken: ETH_TOKEN_ADDRESS_VALUE,
      quoteToken: token1Address,
      chainId,
    }),
  ]);

  return {
    threshold0: dustThreshold(price0?.price),
    threshold1: dustThreshold(price1?.price),
  };
}

export const GetTokenUsdPriceHistory = defineRoute(
  createRoute({
    method: "get",
    path: "/tokens/{chainId}/{tokenAddress}/price-history",
    tags: ["Prices"],
    summary: "Get token USD price history",
    description:
      "Returns bounded USD price history for a token, sampled from the latest price in each interval",
    operationId: "get_GetTokenUsdPriceHistory",
    request: {
      params: z.object({
        chainId: ChainIdType,
        tokenAddress: AddressType,
      }),
      query: z.object({
        interval: z.coerce
          .number()
          .int()
          .min(60)
          .max(86_400)
          .optional()
          .describe("Bucket size in seconds")
          .default(DEFAULT_TOKEN_PRICE_HISTORY_INTERVAL_SECONDS),
        duration: z.coerce
          .number()
          .int()
          .min(3_600)
          .max(86_400)
          .optional()
          .describe("History duration in seconds, up to 24 hours")
          .default(DEFAULT_TOKEN_PRICE_HISTORY_DURATION_SECONDS),
      }),
    },
    responses: {
      200: jsonResponse(
        "The token's USD price history",
        GetTokenUsdPriceHistoryResponseType,
      ),
      ...notFoundResponse,
      ...errorResponses,
    },
  }),
  async (c) => {
    const { chainId, tokenAddress: tokenAddressParam } = c.req.valid("param");
    const { interval: intervalSeconds, duration: durationSeconds } =
      c.req.valid("query");
    const tokenAddress = BigInt(tokenAddressParam);

    if (durationSeconds / intervalSeconds > MAX_TOKEN_PRICE_HISTORY_POINTS) {
      throw new StatusError(
        400,
        `Interval must produce at most ${MAX_TOKEN_PRICE_HISTORY_POINTS} data points`,
      );
    }

    const end = new Date();
    const start = new Date(end.getTime() - durationSeconds * 1_000);
    const queries = await createQueries(c.env);
    const [token, queryData] = await Promise.all([
      getTokenByAddress(queries, chainId, tokenAddress),
      queries.getTokenUsdPriceHistory({
        chainId,
        tokenAddress,
        start,
        end,
        intervalSeconds,
      }),
    ]);

    if (!token) {
      throw new StatusError(404, "Token not found");
    }

    const response = {
      timestamp: Date.now(),
      start: start.getTime(),
      end: end.getTime(),
      interval: intervalSeconds,
      data: queryData,
    } satisfies z.infer<typeof GetTokenUsdPriceHistoryResponseType>;

    return c.json(response, 200, {
      "cache-control": `public, max-age=${Math.ceil(intervalSeconds / 4)}, must-revalidate`,
    });
  },
);

export const GetPairPriceHistory = defineRoute(
  createRoute({
    method: "get",
    path: "/price/{chainId}/{baseToken}/{quoteToken}/history",
    tags: ["Prices"],
    summary: "Get price history",
    description: "Get the VWAP-based price history for the given pair",
    operationId: "get_GetPairPriceHistory",
    request: {
      params: z.object({
        baseToken: TokenIdentifierType.openapi({ example: "0x0" }),
        quoteToken: TokenIdentifierType.openapi({
          example: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
        }),
        chainId: NumericStringType.openapi({ example: "1" }),
      }),
      query: z.object({
        interval: z.coerce
          .number()
          .int()
          .min(60)
          .optional()
          .default(DEFAULT_PAIR_PRICE_HISTORY_INTERVAL_SECONDS),
        start: z.coerce
          .number()
          .int()
          .min(0)
          .optional()
          .describe(
            `Unix timestamp (seconds) of the start of the range${DEFAULT_START_DESCRIPTION}`,
          ),
        end: z.coerce
          .number()
          .int()
          .min(0)
          .optional()
          .describe(
            `Unix timestamp (seconds) of the end of the range${DEFAULT_END_DESCRIPTION}`,
          ),
      }),
    },
    responses: {
      200: jsonResponse(
        "The price history of the pair",
        GetPairPriceHistoryResponseType,
      ),
      ...errorResponses,
    },
  }),
  async (c) => {
    const params = c.req.valid("param");
    const query = c.req.valid("query");
    const chainId = BigInt(params.chainId);
    const intervalSeconds = query.interval;
    const queries = await createQueries(c.env);

    const { baseBeforeQuote, token0Address, token1Address } = await resolvePair(
      queries,
      chainId,
      params.baseToken,
      params.quoteToken,
    );

    const { start, end } = parseHistoryRange(
      intervalSeconds,
      query.start,
      query.end,
    );
    assertRangeWithinLimits(start, end, intervalSeconds);

    const { threshold0, threshold1 } = await getDustThresholds(
      queries,
      chainId,
      token0Address,
      token1Address,
    );

    const queryData = await queries.getPriceHistory({
      token0: token0Address,
      token1: token1Address,
      start,
      end,
      intervalSeconds,
      delta0Threshold: threshold0,
      delta1Threshold: threshold1,
      chainId,
    });

    const formattedData = queryData.map((d) => ({
      ...d,
      vwap: Number(d.vwap),
      max: Number(d.max),
      min: Number(d.min),
    }));

    const response = {
      timestamp: Date.now(),
      start: start.getTime(),
      end: end.getTime(),
      interval: intervalSeconds,
      data: baseBeforeQuote
        ? formattedData
        : formattedData.map((d) => ({
            ...d,
            vwap: 1 / d.vwap,
            max: 1 / d.min,
            min: 1 / d.max,
            k_volume: d.k_volume,
          })),
    } satisfies z.infer<typeof GetPairPriceHistoryResponseType>;

    return c.json(response, 200, {
      "cache-control": `public, max-age=${Math.ceil(
        intervalSeconds / 4,
      )}, must-revalidate`,
    });
  },
);

const PairOhlcCandleType = z.object({
  start: z.union([z.string(), z.date()]),
  open: z.number(),
  high: z.number(),
  low: z.number(),
  close: z.number(),
  volume_base: z.string(),
  volume_quote: z.string(),
  swap_count: z.number().int(),
});

const GetPairOhlcHistoryResponseType = z.object({
  timestamp: z.number().int(),
  start: z.number().int(),
  end: z.number().int(),
  interval: z.number().int(),
  base_token: z.string(),
  quote_token: z.string(),
  data: z.array(PairOhlcCandleType),
});

const DEFAULT_OHLC_INTERVAL_SECONDS = 3_600;

/**
 * A candle as the database produces it: priced in token1 per token0, with
 * volumes still labelled by sort order rather than by the caller's base and
 * quote.
 */
export type CanonicalOhlcCandle = {
  start: string | Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume0: string;
  volume1: string;
  swap_count: number;
};

function invertPrice(price: number): number {
  return price === 0 ? 0 : 1 / price;
}

/**
 * Re-expresses a canonical candle in the orientation the caller asked for.
 *
 * Inverting a price swaps the extremes as well as the ends, because the
 * highest price of token1 per token0 is the moment token0 was cheapest in
 * terms of token1. Open and close keep their ends: they are anchored to a
 * point in time, not to a magnitude.
 */
export function orientOhlcCandle(
  candle: CanonicalOhlcCandle,
  baseBeforeQuote: boolean,
): z.infer<typeof PairOhlcCandleType> {
  if (baseBeforeQuote) {
    return {
      start: candle.start,
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
      volume_base: candle.volume0,
      volume_quote: candle.volume1,
      swap_count: candle.swap_count,
    };
  }

  return {
    start: candle.start,
    open: invertPrice(candle.open),
    high: invertPrice(candle.low),
    low: invertPrice(candle.high),
    close: invertPrice(candle.close),
    volume_base: candle.volume1,
    volume_quote: candle.volume0,
    swap_count: candle.swap_count,
  };
}

export const GetPairOhlcHistory = defineRoute(
  createRoute({
    method: "get",
    path: "/price/{chainId}/{baseToken}/{quoteToken}/ohlc",
    tags: ["Prices"],
    summary: "Get pair OHLC price history",
    description:
      "Returns open, high, low, close and volume candles for a pair, aggregated across every pool of that pair. " +
      "Prices are the prices swaps actually executed at, so the four values carry their traditional meaning, and " +
      "dust swaps are excluded so a negligible trade cannot set a candle's open or close. Buckets in which nothing " +
      "traded are omitted rather than carried forward, so every candle returned describes real trading. Prices are " +
      "expressed in the quote token's smallest unit per the base token's smallest unit, so a client holding the two " +
      "token decimals must scale them for display.",
    operationId: "get_GetPairOhlcHistory",
    request: {
      params: z.object({
        chainId: NumericStringType.openapi({ example: "1" }),
        baseToken: TokenIdentifierType.openapi({ example: "0x0" }),
        quoteToken: TokenIdentifierType.openapi({
          example: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
        }),
      }),
      query: z.object({
        interval: z.coerce
          .number()
          .int()
          .min(60)
          .optional()
          .describe("Bucket size in seconds")
          .default(DEFAULT_OHLC_INTERVAL_SECONDS),
        start: z.coerce
          .number()
          .int()
          .min(0)
          .optional()
          .describe(
            `Unix timestamp (seconds) of the first bucket${DEFAULT_START_DESCRIPTION}`,
          ),
        end: z.coerce
          .number()
          .int()
          .min(0)
          .optional()
          .describe(
            `Unix timestamp (seconds) of the last bucket${DEFAULT_END_DESCRIPTION}`,
          ),
      }),
    },
    responses: {
      200: jsonResponse(
        "The OHLC price history of the pair",
        GetPairOhlcHistoryResponseType,
      ),
      ...errorResponses,
    },
  }),
  async (c) => {
    const params = c.req.valid("param");
    const query = c.req.valid("query");
    const chainId = BigInt(params.chainId);
    const intervalSeconds = query.interval;
    const queries = await createQueries(c.env);

    const {
      baseTokenAddress,
      quoteTokenAddress,
      baseBeforeQuote,
      token0Address,
      token1Address,
    } = await resolvePair(
      queries,
      chainId,
      params.baseToken,
      params.quoteToken,
    );

    const { start, end } = parseHistoryRange(
      intervalSeconds,
      query.start,
      query.end,
    );
    assertOrderedRange(start, end);
    assertRangeWithinLimits(start, end, intervalSeconds);

    const { threshold0, threshold1 } = await getDustThresholds(
      queries,
      chainId,
      token0Address,
      token1Address,
    );

    const rows = await queries.getPairOhlcHistory({
      token0: token0Address,
      token1: token1Address,
      start,
      end,
      intervalSeconds,
      delta0Threshold: threshold0,
      delta1Threshold: threshold1,
      chainId,
    });

    const response = {
      timestamp: Date.now(),
      start: start.getTime(),
      end: end.getTime(),
      interval: intervalSeconds,
      base_token: toHex(baseTokenAddress),
      quote_token: toHex(quoteTokenAddress),
      data: rows.map((row) =>
        orientOhlcCandle(
          {
            start: row.start,
            open: Number(row.open),
            high: Number(row.high),
            low: Number(row.low),
            close: Number(row.close),
            volume0: row.volume0,
            volume1: row.volume1,
            swap_count: Number(row.swap_count),
          },
          baseBeforeQuote,
        ),
      ),
    } satisfies z.infer<typeof GetPairOhlcHistoryResponseType>;

    return c.json(response, 200, {
      "cache-control": `public, max-age=${Math.ceil(
        intervalSeconds / 4,
      )}, must-revalidate`,
    });
  },
);

type PoolPriceHistoryPoint = z.infer<typeof PoolPriceHistoryPointType>;
type PoolKeyRow = Awaited<ReturnType<Queries["getPoolKeyByCoreAndId"]>>[number];
type PoolTwammStateRow = NonNullable<
  Awaited<ReturnType<Queries["getPoolTwammState"]>>
>;
type TwammSaleRateDeltaRow = Awaited<
  ReturnType<Queries["getTwammSaleRateDeltas"]>
>[number];
type PoolTickRow = Awaited<ReturnType<Queries["getPoolTicksById"]>>[number];

interface ProjectedSegment {
  open: number;
  high: number;
  low: number;
  close: number;
}

type SegmentProjector = (
  segmentStartSeconds: number,
  segmentEndSeconds: number,
) => ProjectedSegment | null;

// Projects the TWAMM pool's price forward from its last virtual execution.
// Segments must be requested in chronological order, because the projection
// only ever moves forward.
function createTwammSegmentProjector({
  chainId,
  pool,
  twammState,
  lastExecutionTimeSeconds,
  twammSaleRateDeltas,
  poolTicks,
}: {
  chainId: bigint;
  pool: PoolKeyRow;
  twammState: PoolTwammStateRow;
  lastExecutionTimeSeconds: number;
  twammSaleRateDeltas: TwammSaleRateDeltaRow[];
  poolTicks: PoolTickRow[];
}): SegmentProjector {
  const token0 = BigInt(pool.token0);
  const token1 = BigInt(pool.token1);
  const fee = BigInt(pool.fee);
  const sortedTicks = poolTicks.map((tick) => ({
    tick: Number(tick.tick),
    liquidityDelta: BigInt(tick.liquidity_delta),
  }));
  const saleRateDeltas = twammSaleRateDeltas.map((delta) => ({
    time: Math.floor(delta.time.getTime() / 1_000),
    saleRateDelta0: BigInt(delta.net_sale_rate_delta0),
    saleRateDelta1: BigInt(delta.net_sale_rate_delta1),
  }));

  let projectedState: {
    sqrtRatio: bigint;
    liquidity: bigint;
    activeTickIndex: number | undefined;
    token0SaleRate: bigint;
    token1SaleRate: bigint;
    lastExecutionTime: number;
  } = {
    sqrtRatio: BigInt(twammState.sqrt_ratio),
    liquidity: BigInt(twammState.liquidity),
    activeTickIndex: undefined,
    token0SaleRate: BigInt(twammState.token0_sale_rate),
    token1SaleRate: BigInt(twammState.token1_sale_rate),
    lastExecutionTime: lastExecutionTimeSeconds,
  };

  const advanceProjectionTo = (nextTime: number) => {
    if (nextTime < projectedState.lastExecutionTime) {
      throw new Error("Projection cannot go backward in time");
    }

    if (nextTime === projectedState.lastExecutionTime) {
      return projectedState;
    }

    const nextState = projectTwammPoolStateAtTime({
      chainId,
      token0,
      token1,
      fee,
      sqrtRatio: projectedState.sqrtRatio,
      liquidity: projectedState.liquidity,
      tick: twammState.tick,
      activeTickIndex: projectedState.activeTickIndex,
      token0SaleRate: projectedState.token0SaleRate,
      token1SaleRate: projectedState.token1SaleRate,
      lastExecutionTime: projectedState.lastExecutionTime,
      sortedTicks,
      saleRateDeltas,
      targetTime: nextTime,
    });

    projectedState = {
      ...nextState,
      activeTickIndex: nextState.activeTickIndex,
    };

    return projectedState;
  };

  const saleRateDeltaTimes = saleRateDeltas.map((delta) => delta.time);
  let deltaTimeIndex = 0;

  return (segmentStartSeconds, segmentEndSeconds) => {
    if (segmentEndSeconds <= segmentStartSeconds) {
      return null;
    }

    while (
      deltaTimeIndex < saleRateDeltaTimes.length &&
      saleRateDeltaTimes[deltaTimeIndex] <= segmentStartSeconds
    ) {
      deltaTimeIndex++;
    }

    const checkpointTimes = [segmentStartSeconds];
    let nextDeltaIndex = deltaTimeIndex;

    while (
      nextDeltaIndex < saleRateDeltaTimes.length &&
      saleRateDeltaTimes[nextDeltaIndex] <= segmentEndSeconds
    ) {
      checkpointTimes.push(saleRateDeltaTimes[nextDeltaIndex]);
      nextDeltaIndex++;
    }

    deltaTimeIndex = nextDeltaIndex;

    if (checkpointTimes[checkpointTimes.length - 1] !== segmentEndSeconds) {
      checkpointTimes.push(segmentEndSeconds);
    }

    let open = 0;
    let close = 0;
    let high = Number.NEGATIVE_INFINITY;
    let low = Number.POSITIVE_INFINITY;

    for (let i = 0; i < checkpointTimes.length; i++) {
      const checkpointState = advanceProjectionTo(checkpointTimes[i]);
      const checkpointPrice = sqrtRatioX128ToPrice(checkpointState.sqrtRatio);

      if (i === 0) {
        open = checkpointPrice;
      }

      close = checkpointPrice;
      high = Math.max(high, checkpointPrice);
      low = Math.min(low, checkpointPrice);
    }

    return {
      open,
      high,
      low,
      close,
    };
  };
}

interface TwammTailWindow {
  start: Date;
  end: Date;
  intervalMilliseconds: number;
  lastExecutionTimeMs: number;
}

// Folds the projected price over the rest of the last swap candle into it.
function extendLastCandle(
  lastCandle: PoolPriceHistoryPoint,
  projectSegment: SegmentProjector,
  { end, intervalMilliseconds, lastExecutionTimeMs }: TwammTailWindow,
): void {
  const lastCandleStartMs = new Date(lastCandle.start).getTime();
  const lastCandleEndMs = Math.min(
    lastCandleStartMs + intervalMilliseconds,
    end.getTime(),
  );
  const segmentStartMs = Math.max(lastCandleStartMs, lastExecutionTimeMs);

  const projectedLastSegment = projectSegment(
    Math.floor(segmentStartMs / 1_000),
    Math.floor(lastCandleEndMs / 1_000),
  );

  if (projectedLastSegment) {
    lastCandle.high = Math.max(lastCandle.high, projectedLastSegment.high);
    lastCandle.low = Math.min(lastCandle.low, projectedLastSegment.low);
    lastCandle.close = projectedLastSegment.close;
    // The volume is left as the indexed swaps measured it. The
    // projection moves the price from TWAMM sale rates, and those
    // virtual fills are not swaps rows to count.
  }
}

// Projected buckets start on the candle grid, but no earlier than the last
// virtual execution.
function firstProjectedBucketStart(
  tailStartMs: number,
  { intervalMilliseconds, lastExecutionTimeMs }: TwammTailWindow,
): number {
  if (tailStartMs >= lastExecutionTimeMs) {
    return tailStartMs;
  }

  const skippedIntervals = Math.ceil(
    (lastExecutionTimeMs - tailStartMs) / intervalMilliseconds,
  );
  return tailStartMs + skippedIntervals * intervalMilliseconds;
}

function projectTailCandles(
  firstBucketStartMs: number,
  projectSegment: SegmentProjector,
  { end, intervalMilliseconds }: TwammTailWindow,
): PoolPriceHistoryPoint[] {
  const projectedCandles: PoolPriceHistoryPoint[] = [];

  for (
    let bucketStartMs = firstBucketStartMs;
    bucketStartMs < end.getTime();
    bucketStartMs += intervalMilliseconds
  ) {
    const bucketEndMs = Math.min(
      bucketStartMs + intervalMilliseconds,
      end.getTime(),
    );
    const projectedSegment = projectSegment(
      Math.floor(bucketStartMs / 1_000),
      Math.floor(bucketEndMs / 1_000),
    );

    if (!projectedSegment) {
      continue;
    }

    projectedCandles.push({
      start: new Date(bucketStartMs),
      open: projectedSegment.open,
      high: projectedSegment.high,
      low: projectedSegment.low,
      close: projectedSegment.close,
    });
  }

  return projectedCandles;
}

// Extends the swap candles with the price the TWAMM pool's virtual orders
// have moved it to since its last execution. Any projection failure leaves
// the swap-based candles as they are, although the last candle may already
// have been extended by then.
async function appendTwammProjection(
  queries: Queries,
  data: PoolPriceHistoryPoint[],
  {
    chainId,
    pool,
    twammState,
    start,
    end,
    intervalSeconds,
  }: {
    chainId: bigint;
    pool: PoolKeyRow;
    twammState: PoolTwammStateRow;
    start: Date;
    end: Date;
    intervalSeconds: number;
  },
): Promise<void> {
  const lastExecutionTimeSeconds = Math.floor(
    twammState.last_execution_time.getTime() / 1_000,
  );
  const targetTime = Math.floor(end.getTime() / 1_000);

  if (targetTime <= lastExecutionTimeSeconds) {
    return;
  }

  const [twammSaleRateDeltas, poolTicks] = await Promise.all([
    queries.getTwammSaleRateDeltas({
      poolKeyId: pool.pool_key_id,
      after: twammState.last_execution_time,
      until: end,
    }),
    queries.getPoolTicksById(pool.pool_key_id),
  ]);

  if (poolTicks.length === 0) {
    return;
  }

  const window: TwammTailWindow = {
    start,
    end,
    intervalMilliseconds: intervalSeconds * 1_000,
    lastExecutionTimeMs: lastExecutionTimeSeconds * 1_000,
  };

  try {
    const projectSegment = createTwammSegmentProjector({
      chainId,
      pool,
      twammState,
      lastExecutionTimeSeconds,
      twammSaleRateDeltas,
      poolTicks,
    });

    const lastCandle = data.at(-1);
    const tailStartMs =
      lastCandle === undefined
        ? start.getTime()
        : new Date(lastCandle.start).getTime() + window.intervalMilliseconds;

    if (lastCandle !== undefined) {
      extendLastCandle(lastCandle, projectSegment, window);
    }

    data.push(
      ...projectTailCandles(
        firstProjectedBucketStart(tailStartMs, window),
        projectSegment,
        window,
      ),
    );
  } catch {
    // Ignore TWAMM projection issues and return swap-based candles only.
  }
}

export const GetPoolPriceHistory = defineRoute(
  createRoute({
    method: "get",
    path: "/pools/{chainId}/{coreAddress}/{poolId}/price/history",
    tags: ["Prices"],
    summary: "Get pool price history",
    description:
      "Returns pool OHLC history with swap candles and TWAMM-projected tail fill when needed",
    operationId: "get_GetPoolPriceHistory",
    request: {
      params: z.object({
        chainId: ChainIdType,
        coreAddress: AddressType.openapi({ example: "0xabcd" }),
        poolId: NumericStringType.openapi({ example: "1" }),
      }),
      query: z.object({
        interval: z.coerce
          .number()
          .int()
          .min(1)
          .optional()
          .describe("Bucket size in seconds")
          .default(DEFAULT_POOL_PRICE_HISTORY_INTERVAL_SECONDS),
        start: z.coerce
          .number()
          .int()
          .min(0)
          .optional()
          .describe(`Unix timestamp (seconds)${DEFAULT_START_DESCRIPTION}`),
        end: z.coerce
          .number()
          .int()
          .min(0)
          .optional()
          .describe(`Unix timestamp (seconds)${DEFAULT_END_DESCRIPTION}`),
      }),
    },
    responses: {
      200: jsonResponse(
        "Pool-level price history and TWAMM metadata for charting",
        GetPoolPriceHistoryResponseType,
      ),
      ...notFoundResponse,
      ...errorResponses,
    },
  }),
  async (c) => {
    const { chainId, coreAddress, poolId } = c.req.valid("param");
    const query = c.req.valid("query");
    const intervalSeconds = query.interval;

    const queries = await createQueries(c.env);
    const poolRows = await queries.getPoolKeyByCoreAndId(
      chainId,
      BigInt(coreAddress),
      BigInt(poolId),
    );
    const pool = poolRows[0] ?? null;

    if (!pool) {
      throw new StatusError(404, "Pool not found");
    }

    const { start, end } = parseHistoryRange(
      intervalSeconds,
      query.start,
      query.end,
    );
    assertOrderedRange(start, end);
    assertRangeWithinLimits(start, end, intervalSeconds);

    const [candles, priceSeed, twammState] = await Promise.all([
      queries.getPoolPriceHistoryCandles({
        poolKeyId: pool.pool_key_id,
        start,
        end,
        intervalSeconds,
      }),
      queries.getPoolPriceSeed(pool.pool_key_id, start),
      queries.getPoolTwammState(pool.pool_key_id),
    ]);

    const data: PoolPriceHistoryPoint[] = candles.map((row) => ({
      start: row.start,
      open: sqrtRatioX128ToPrice(row.open_sqrt_ratio),
      high: sqrtRatioX128ToPrice(row.high_sqrt_ratio),
      low: sqrtRatioX128ToPrice(row.low_sqrt_ratio),
      close: sqrtRatioX128ToPrice(row.close_sqrt_ratio),
      volume0: row.volume0,
      volume1: row.volume1,
      swap_count: Number(row.swap_count),
    }));

    if (
      priceSeed &&
      (data.length === 0 || new Date(data[0].start).getTime() > start.getTime())
    ) {
      const seedPrice = sqrtRatioX128ToPrice(priceSeed.sqrt_ratio_after);
      data.unshift({
        start: start,
        open: seedPrice,
        high: seedPrice,
        low: seedPrice,
        close: seedPrice,
      });
    }

    if (twammState !== null) {
      await appendTwammProjection(queries, data, {
        chainId,
        pool,
        twammState,
        start,
        end,
        intervalSeconds,
      });
    }

    const response = {
      timestamp: Date.now(),
      start: start.getTime(),
      end: end.getTime(),
      interval: intervalSeconds,
      token0: toHex(pool.token0),
      token1: toHex(pool.token1),
      data,
    } satisfies z.infer<typeof GetPoolPriceHistoryResponseType>;

    return c.json(response, 200, {
      "cache-control": `public, max-age=30, must-revalidate`,
    });
  },
);
