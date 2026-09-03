import { EkuboAPIRoute, RequestContext } from "../../shared/context";
import { IRequest, json, StatusError } from "itty-router";
import { getTokenByUserSpecifiedIdentifier } from "../meta/tokens";
import {
  AddressType,
  ChainIdType,
  NumericStringType,
  TokenIdentifierType,
} from "../../shared/validation/address";
import { createQueries } from "../../queries";
import { OpenAPIRouteSchema, Path, Query } from "../../shared/openapi";
import { z } from "zod";
import { ETH_TOKEN_ADDRESS_VALUE } from "../../shared/constants";
import toHex from "../../shared/toHex";
import { projectTwammPoolStateAtTime } from "./twammProjection";
import { ErrorResponseType } from "../../shared/errors";
import { getTokenByAddress } from "../meta/tokens";

const PriceHistoryPointType = z.object({
  start: z.union([z.string(), z.date()]),
  vwap: z.number(),
  max: z.number(),
  min: z.number(),
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

export class GetTokenUsdPriceHistory extends EkuboAPIRoute {
  static route = "/tokens/:chainId/:tokenAddress/price-history";

  static schema: OpenAPIRouteSchema = {
    tags: ["Prices"],
    summary: "Get token USD price history",
    description:
      "Returns bounded USD price history for a token, sampled from the latest price in each interval",
    parameters: {
      chainId: Path(ChainIdType, { required: true }),
      tokenAddress: Path(AddressType, { required: true }),
      interval: Query(z.coerce.number().int().min(60).max(86_400), {
        required: false,
        default: DEFAULT_TOKEN_PRICE_HISTORY_INTERVAL_SECONDS,
        description: "Bucket size in seconds",
      }),
      duration: Query(z.coerce.number().int().min(3_600).max(86_400), {
        required: false,
        default: DEFAULT_TOKEN_PRICE_HISTORY_DURATION_SECONDS,
        description: "History duration in seconds, up to 24 hours",
      }),
    },
    responses: {
      "200": {
        description: "The token's USD price history",
        schema: GetTokenUsdPriceHistoryResponseType,
      },
      "404": {
        description: "Token not found",
        schema: ErrorResponseType,
      },
    },
  };

  async handleRequest({ params, query }: IRequest, { env }: RequestContext) {
    const chainId = BigInt(params.chainId);
    const tokenAddress = BigInt(params.tokenAddress);
    const intervalSeconds = Number(
      query.interval ?? DEFAULT_TOKEN_PRICE_HISTORY_INTERVAL_SECONDS,
    );
    const durationSeconds = Number(
      query.duration ?? DEFAULT_TOKEN_PRICE_HISTORY_DURATION_SECONDS,
    );

    if (durationSeconds / intervalSeconds > MAX_TOKEN_PRICE_HISTORY_POINTS) {
      throw new StatusError(
        400,
        `Interval must produce at most ${MAX_TOKEN_PRICE_HISTORY_POINTS} data points`,
      );
    }

    const end = new Date();
    const start = new Date(end.getTime() - durationSeconds * 1_000);
    const queries = await createQueries(env);
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

    return json(response, {
      headers: {
        "cache-control": `public, max-age=${Math.ceil(intervalSeconds / 4)}, must-revalidate`,
      },
    });
  }
}

export class GetPairPriceHistory extends EkuboAPIRoute {
  static route = "/price/:chainId/:baseToken/:quoteToken/history";

  static schema: OpenAPIRouteSchema = {
    tags: ["Prices"],
    summary: "Get price history",
    description: "Get the VWAP-based price history for the given pair",
    parameters: {
      baseToken: Path(TokenIdentifierType, { example: "0x0" }),
      quoteToken: Path(TokenIdentifierType, {
        example: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
      }),
      chainId: Path(NumericStringType, { example: "1" }),
      interval: Query(z.coerce.number().int().min(60), { required: false }),
    },
    responses: {
      "200": {
        description: "The price history of the pair",
        schema: GetPairPriceHistoryResponseType,
      },
    },
  };

  async handleRequest({ params, query }: IRequest, { env }: RequestContext) {
    const chainId = BigInt(params.chainId);
    const queries = await createQueries(env);

    const [baseToken, quoteToken] = await Promise.all([
      getTokenByUserSpecifiedIdentifier(queries, chainId, params.baseToken),
      getTokenByUserSpecifiedIdentifier(queries, chainId, params.quoteToken),
    ]);

    if (!baseToken || !quoteToken) {
      throw new StatusError(400, "Base token or quote token invalid");
    }

    if (baseToken.address === quoteToken.address) {
      throw new StatusError(400, "Base token cannot be equal to quote token");
    }

    const baseTokenAddress = BigInt(baseToken.address);
    const quoteTokenAddress = BigInt(quoteToken.address);

    const baseBeforeQuote = baseTokenAddress < quoteTokenAddress;

    const token0Address = baseBeforeQuote
      ? baseTokenAddress
      : quoteTokenAddress;
    const token1Address = baseBeforeQuote
      ? quoteTokenAddress
      : baseTokenAddress;

    let intervalSeconds: number;
    let start: Date;
    let end: Date;

    try {
      intervalSeconds =
        typeof query.interval === "string" ? parseInt(query.interval) : 1800;
      end =
        typeof query.end === "string"
          ? new Date(parseInt(query.end) * 1_000)
          : new Date(Date.now());
      start =
        typeof query.start === "string"
          ? new Date(parseInt(query.start) * 1_000)
          : new Date(end.getTime() - intervalSeconds * 60 * 1_000); // default 60 data points
    } catch (e) {
      throw new StatusError(
        400,
        "Invalid `interval`, `end` or `start` parameters",
      );
    }

    const durationMilliseconds = end.getTime() - start.getTime();
    if (durationMilliseconds > 30 * 86_400 * 1_000) {
      throw new StatusError(
        400,
        "Start time cannot be more than 30 days before end time",
      );
    }

    if (intervalSeconds <= 0) {
      throw new StatusError(400, "Interval must be positive");
    }

    const numIntervals = durationMilliseconds / intervalSeconds / 1_000;

    if (numIntervals > 120) {
      throw new StatusError(400, "Interval too small for the range");
    }

    // convert 1e15 eth to the threshold for token0 by multiplying 1e15 eth by the price in per eth
    const price0 =
      (
        await queries.getVolumeWeightedPrice({
          baseToken: ETH_TOKEN_ADDRESS_VALUE,
          quoteToken: token0Address,
          chainId,
        })
      )?.price ?? 0;
    const price1 =
      (
        await queries.getVolumeWeightedPrice({
          baseToken: ETH_TOKEN_ADDRESS_VALUE,
          quoteToken: token1Address,
          chainId,
        })
      )?.price ?? 0;

    const thresholdEth = 1e16;
    const threshold0 = BigInt(Math.max(0, Math.round(thresholdEth * price0)));
    const threshold1 = BigInt(Math.max(0, Math.round(thresholdEth * price1)));

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

    return json(response, {
      headers: {
        "cache-control": `public, max-age=${Math.ceil(
          intervalSeconds / 4,
        )}, must-revalidate`,
      },
    });
  }
}

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
const DEFAULT_OHLC_CANDLE_COUNT = 60;
const MAX_OHLC_CANDLES = 120;
const MAX_OHLC_DURATION_SECONDS = 30 * 86_400;

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

export class GetPairOhlcHistory extends EkuboAPIRoute {
  static route = "/price/:chainId/:baseToken/:quoteToken/ohlc";

  static schema: OpenAPIRouteSchema = {
    tags: ["Prices"],
    summary: "Get pair OHLC price history",
    description:
      "Returns open, high, low, close and volume candles for a pair, aggregated across every pool of that pair. " +
      "Prices are the prices swaps actually executed at, so the four values carry their traditional meaning, and " +
      "dust swaps are excluded so a negligible trade cannot set a candle's open or close. Buckets in which nothing " +
      "traded are omitted rather than carried forward, so every candle returned describes real trading. Prices are " +
      "expressed in the quote token's smallest unit per the base token's smallest unit, so a client holding the two " +
      "token decimals must scale them for display.",
    parameters: {
      chainId: Path(NumericStringType, { example: "1" }),
      baseToken: Path(TokenIdentifierType, { example: "0x0" }),
      quoteToken: Path(TokenIdentifierType, {
        example: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
      }),
      interval: Query(z.coerce.number().int().min(60), {
        required: false,
        default: DEFAULT_OHLC_INTERVAL_SECONDS,
        description: "Bucket size in seconds",
      }),
      start: Query(z.coerce.number().int().min(0), {
        required: false,
        description: "Unix timestamp (seconds) of the first bucket",
      }),
      end: Query(z.coerce.number().int().min(0), {
        required: false,
        description: "Unix timestamp (seconds) of the last bucket",
      }),
    },
    responses: {
      "200": {
        description: "The OHLC price history of the pair",
        schema: GetPairOhlcHistoryResponseType,
      },
      "400": {
        description: "Invalid tokens or range",
        schema: ErrorResponseType,
      },
    },
  };

  async handleRequest({ params, query }: IRequest, { env }: RequestContext) {
    const chainId = BigInt(params.chainId);
    const queries = await createQueries(env);

    const [baseToken, quoteToken] = await Promise.all([
      getTokenByUserSpecifiedIdentifier(queries, chainId, params.baseToken),
      getTokenByUserSpecifiedIdentifier(queries, chainId, params.quoteToken),
    ]);

    if (!baseToken || !quoteToken) {
      throw new StatusError(400, "Base token or quote token invalid");
    }

    if (baseToken.address === quoteToken.address) {
      throw new StatusError(400, "Base token cannot be equal to quote token");
    }

    const baseTokenAddress = BigInt(baseToken.address);
    const quoteTokenAddress = BigInt(quoteToken.address);

    const baseBeforeQuote = baseTokenAddress < quoteTokenAddress;

    const token0Address = baseBeforeQuote
      ? baseTokenAddress
      : quoteTokenAddress;
    const token1Address = baseBeforeQuote
      ? quoteTokenAddress
      : baseTokenAddress;

    const intervalSeconds =
      typeof query.interval === "string"
        ? Number.parseInt(query.interval, 10)
        : DEFAULT_OHLC_INTERVAL_SECONDS;

    if (!Number.isInteger(intervalSeconds) || intervalSeconds <= 0) {
      throw new StatusError(400, "Interval must be a positive integer");
    }

    const end =
      typeof query.end === "string"
        ? new Date(Number.parseInt(query.end, 10) * 1_000)
        : new Date(Date.now());
    const start =
      typeof query.start === "string"
        ? new Date(Number.parseInt(query.start, 10) * 1_000)
        : new Date(
            end.getTime() - intervalSeconds * DEFAULT_OHLC_CANDLE_COUNT * 1_000,
          );

    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      throw new StatusError(400, "Invalid `start` or `end` parameters");
    }

    if (start.getTime() >= end.getTime()) {
      throw new StatusError(400, "Start time must be before end time");
    }

    const durationMilliseconds = end.getTime() - start.getTime();

    if (durationMilliseconds > MAX_OHLC_DURATION_SECONDS * 1_000) {
      throw new StatusError(
        400,
        "Start time cannot be more than 30 days before end time",
      );
    }

    if (durationMilliseconds / intervalSeconds / 1_000 > MAX_OHLC_CANDLES) {
      throw new StatusError(400, "Interval too small for the range");
    }

    // Dust swaps are excluded by requiring both sides to move at least the
    // value of 0.01 ETH, converted into each token by its price in ETH.
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

    const thresholdEth = 1e16;
    const threshold0 = BigInt(
      Math.max(0, Math.round(thresholdEth * (price0?.price ?? 0))),
    );
    const threshold1 = BigInt(
      Math.max(0, Math.round(thresholdEth * (price1?.price ?? 0))),
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
      base_token: toHex(baseToken.address),
      quote_token: toHex(quoteToken.address),
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

    return json(response, {
      headers: {
        "cache-control": `public, max-age=${Math.ceil(
          intervalSeconds / 4,
        )}, must-revalidate`,
      },
    });
  }
}

export class GetPoolPriceHistory extends EkuboAPIRoute {
  static route = "/pools/:chainId/:coreAddress/:poolId/price/history";

  static schema: OpenAPIRouteSchema = {
    tags: ["Prices"],
    summary: "Get pool price history",
    description:
      "Returns pool OHLC history with swap candles and TWAMM-projected tail fill when needed",
    parameters: {
      chainId: Path(ChainIdType, { required: true }),
      coreAddress: Path(AddressType, { required: true, example: "0xabcd" }),
      poolId: Path(NumericStringType, { required: true, example: "1" }),
      interval: Query(z.coerce.number().int().min(1), {
        required: false,
        description: "Bucket size in seconds",
      }),
      start: Query(z.coerce.number().int().min(0), {
        required: false,
        description: "Unix timestamp (seconds)",
      }),
      end: Query(z.coerce.number().int().min(0), {
        required: false,
        description: "Unix timestamp (seconds)",
      }),
    },
    responses: {
      "200": {
        description: "Pool-level price history and TWAMM metadata for charting",
        schema: GetPoolPriceHistoryResponseType,
      },
    },
  };

  async handleRequest({ params, query }: IRequest, { env }: RequestContext) {
    const chainId = BigInt(params.chainId);
    const coreAddress = BigInt(params.coreAddress);
    const poolId = BigInt(params.poolId);

    const queries = await createQueries(env);
    const poolRows = await queries.getPoolKeyByCoreAndId(
      chainId,
      coreAddress,
      poolId,
    );
    const pool = poolRows[0] ?? null;

    if (!pool) {
      throw new StatusError(404, "Pool not found");
    }

    let intervalSeconds = 300;
    let end = new Date(Date.now());
    let start = new Date(end.getTime() - intervalSeconds * 60 * 1_000);

    try {
      intervalSeconds =
        typeof query.interval === "string"
          ? Number.parseInt(query.interval, 10)
          : 300;
      end =
        typeof query.end === "string"
          ? new Date(Number.parseInt(query.end, 10) * 1_000)
          : new Date(Date.now());
      start =
        typeof query.start === "string"
          ? new Date(Number.parseInt(query.start, 10) * 1_000)
          : new Date(end.getTime() - intervalSeconds * 60 * 1_000);
    } catch (e) {
      throw new StatusError(
        400,
        "Invalid `interval`, `end` or `start` parameters",
      );
    }

    if (
      !Number.isFinite(intervalSeconds) ||
      !Number.isInteger(intervalSeconds) ||
      intervalSeconds <= 0
    ) {
      throw new StatusError(400, "Interval must be a positive integer");
    }

    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      throw new StatusError(400, "Invalid `start` or `end` parameters");
    }

    if (start.getTime() >= end.getTime()) {
      throw new StatusError(400, "Start time must be before end time");
    }

    const durationMilliseconds = end.getTime() - start.getTime();
    if (durationMilliseconds > 30 * 86_400 * 1_000) {
      throw new StatusError(
        400,
        "Start time cannot be more than 30 days before end time",
      );
    }

    const numIntervals = durationMilliseconds / intervalSeconds / 1_000;
    if (numIntervals > 120) {
      throw new StatusError(400, "Interval too small for the range");
    }

    const intervalMilliseconds = intervalSeconds * 1_000;

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

    const data: z.infer<typeof PoolPriceHistoryPointType>[] = candles.map(
      (row) => ({
        start: row.start,
        open: sqrtRatioX128ToPrice(row.open_sqrt_ratio),
        high: sqrtRatioX128ToPrice(row.high_sqrt_ratio),
        low: sqrtRatioX128ToPrice(row.low_sqrt_ratio),
        close: sqrtRatioX128ToPrice(row.close_sqrt_ratio),
        volume0: row.volume0,
        volume1: row.volume1,
        swap_count: Number(row.swap_count),
      }),
    );

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
      const lastExecutionTimeSeconds = Math.floor(
        twammState.last_execution_time.getTime() / 1_000,
      );
      const targetTime = Math.floor(end.getTime() / 1_000);

      if (targetTime > lastExecutionTimeSeconds) {
        const [twammSaleRateDeltas, poolTicks] = await Promise.all([
          queries.getTwammSaleRateDeltas({
            poolKeyId: pool.pool_key_id,
            after: twammState.last_execution_time,
            until: end,
          }),
          queries.getPoolTicksById(pool.pool_key_id),
        ]);

        if (poolTicks.length > 0) {
          try {
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

            const tailStartMs =
              data.length > 0
                ? new Date(data[data.length - 1].start).getTime() +
                  intervalMilliseconds
                : start.getTime();

            const lastExecutionTimeMs = lastExecutionTimeSeconds * 1_000;
            const saleRateDeltaTimes = saleRateDeltas.map(
              (delta) => delta.time,
            );
            let deltaTimeIndex = 0;

            const projectSegment = (
              segmentStartSeconds: number,
              segmentEndSeconds: number,
            ) => {
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

              if (
                checkpointTimes[checkpointTimes.length - 1] !==
                segmentEndSeconds
              ) {
                checkpointTimes.push(segmentEndSeconds);
              }

              let open = 0;
              let close = 0;
              let high = Number.NEGATIVE_INFINITY;
              let low = Number.POSITIVE_INFINITY;

              for (let i = 0; i < checkpointTimes.length; i++) {
                const checkpointState = advanceProjectionTo(checkpointTimes[i]);
                const checkpointPrice = sqrtRatioX128ToPrice(
                  checkpointState.sqrtRatio,
                );

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

            if (data.length > 0) {
              const lastCandle = data[data.length - 1];
              const lastCandleStartMs = new Date(lastCandle.start).getTime();
              const lastCandleEndMs = Math.min(
                lastCandleStartMs + intervalMilliseconds,
                end.getTime(),
              );
              const segmentStartMs = Math.max(
                lastCandleStartMs,
                lastExecutionTimeMs,
              );

              const projectedLastSegment = projectSegment(
                Math.floor(segmentStartMs / 1_000),
                Math.floor(lastCandleEndMs / 1_000),
              );

              if (projectedLastSegment) {
                lastCandle.high = Math.max(
                  lastCandle.high,
                  projectedLastSegment.high,
                );
                lastCandle.low = Math.min(
                  lastCandle.low,
                  projectedLastSegment.low,
                );
                lastCandle.close = projectedLastSegment.close;
                // The volume is left as the indexed swaps measured it. The
                // projection moves the price from TWAMM sale rates, and those
                // virtual fills are not swaps rows to count.
              }
            }

            let firstProjectedBucketStartMs = tailStartMs;

            if (firstProjectedBucketStartMs < lastExecutionTimeMs) {
              const skippedIntervals = Math.ceil(
                (lastExecutionTimeMs - firstProjectedBucketStartMs) /
                  intervalMilliseconds,
              );
              firstProjectedBucketStartMs +=
                skippedIntervals * intervalMilliseconds;
            }

            if (firstProjectedBucketStartMs < end.getTime()) {
              const projectedCandles: z.infer<
                typeof PoolPriceHistoryPointType
              >[] = [];

              for (
                let bucketStartMs = firstProjectedBucketStartMs;
                bucketStartMs < end.getTime();
                bucketStartMs += intervalMilliseconds
              ) {
                const bucketEndMs = Math.min(
                  bucketStartMs + intervalMilliseconds,
                  end.getTime(),
                );
                const bucketStartSeconds = Math.floor(bucketStartMs / 1_000);
                const bucketEndSeconds = Math.floor(bucketEndMs / 1_000);

                if (bucketEndSeconds <= bucketStartSeconds) {
                  continue;
                }

                const projectedSegment = projectSegment(
                  bucketStartSeconds,
                  bucketEndSeconds,
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

              data.push(...projectedCandles);
            }
          } catch {
            // Ignore TWAMM projection issues and return swap-based candles only.
          }
        }
      }
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

    return json(response, {
      headers: {
        "cache-control": `public, max-age=30, must-revalidate`,
      },
    });
  }
}
