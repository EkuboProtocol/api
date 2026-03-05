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
import {
  OpenAPIRouteSchema,
  Path,
  Query,
} from "@cloudflare/itty-router-openapi";
import { z } from "zod";
import { ETH_TOKEN_ADDRESS_VALUE } from "../../shared/constants";
import toHex from "../../shared/toHex";
import { projectTwammPoolStateAtTime } from "./twammProjection";

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

const PoolPriceHistoryPointType = z.object({
  start: z.union([z.string(), z.date()]),
  open: z.number(),
  high: z.number(),
  low: z.number(),
  close: z.number(),
});

const PoolPriceLiveTailProjectionType = z.object({
  from: z.number().int(),
  to: z.number().int(),
  price: z.number(),
  sqrt_ratio: z.string(),
});

const GetPoolPriceHistoryResponseType = z.object({
  timestamp: z.number().int(),
  start: z.number().int(),
  end: z.number().int(),
  interval: z.number().int(),
  pool_key_id: z.string(),
  token0: z.string(),
  token1: z.string(),
  execution_markers: z.array(z.number().int()),
  live_tail_projection: PoolPriceLiveTailProjectionType.nullable(),
  data: z.array(PoolPriceHistoryPointType),
});

function sqrtRatioX128ToPrice(sqrtRatio: bigint | string): number {
  const ratio = Number(sqrtRatio) / 2 ** 128;
  return ratio * ratio;
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

  async handle({ params, query }: IRequest, { env }: RequestContext) {
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

export class GetPoolPriceHistory extends EkuboAPIRoute {
  static route = "/pools/:chainId/:coreAddress/:poolId/price/history";

  static schema: OpenAPIRouteSchema = {
    tags: ["Prices"],
    summary: "Get pool price history",
    description:
      "Returns swap-based pool OHLC history, TWAMM virtual execution markers, and a TWAMM live-tail projection",
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

  async handle({ params, query }: IRequest, { env }: RequestContext) {
    const chainId = BigInt(params.chainId);
    const coreAddress = BigInt(params.coreAddress);
    const poolId = BigInt(params.poolId);

    const queries = await createQueries(env);
    const pool = await queries.getPoolByCoreAndId({
      chainId,
      coreAddress,
      poolId,
    });

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

    const [candles, priceSeed, markerRows, twammState] = await Promise.all([
      queries.getPoolPriceHistoryCandles({
        poolKeyId: pool.pool_key_id,
        start,
        end,
        intervalSeconds,
      }),
      queries.getPoolPriceSeed(pool.pool_key_id, start),
      queries.getTwammVirtualExecutionMarkers({
        poolKeyId: pool.pool_key_id,
        start,
        end,
      }),
      queries.getPoolTwammState(pool.pool_key_id),
    ]);

    const data = candles.map((row) => ({
      start: row.start,
      open: sqrtRatioX128ToPrice(row.open_sqrt_ratio),
      high: sqrtRatioX128ToPrice(row.high_sqrt_ratio),
      low: sqrtRatioX128ToPrice(row.low_sqrt_ratio),
      close: sqrtRatioX128ToPrice(row.close_sqrt_ratio),
    }));

    if (
      priceSeed &&
      (data.length === 0 ||
        new Date(data[0].start).getTime() > start.getTime())
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

    let liveTailProjection: z.infer<
      typeof GetPoolPriceHistoryResponseType
    >["live_tail_projection"] = null;

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
            const projected = projectTwammPoolStateAtTime({
              chainId,
              token0: BigInt(pool.token0),
              token1: BigInt(pool.token1),
              fee: BigInt(pool.fee),
              sqrtRatio: BigInt(twammState.sqrt_ratio),
              liquidity: BigInt(twammState.liquidity),
              tick: twammState.tick,
              token0SaleRate: BigInt(twammState.token0_sale_rate),
              token1SaleRate: BigInt(twammState.token1_sale_rate),
              lastExecutionTime: lastExecutionTimeSeconds,
              sortedTicks: poolTicks.map((tick) => ({
                tick: Number(tick.tick),
                liquidityDelta: BigInt(tick.liquidity_delta),
              })),
              saleRateDeltas: twammSaleRateDeltas.map((delta) => ({
                time: Math.floor(delta.time.getTime() / 1_000),
                saleRateDelta0: BigInt(delta.net_sale_rate_delta0),
                saleRateDelta1: BigInt(delta.net_sale_rate_delta1),
              })),
              targetTime,
            });

            liveTailProjection = {
              from: lastExecutionTimeSeconds,
              to: targetTime,
              price: sqrtRatioX128ToPrice(projected.sqrtRatio),
              sqrt_ratio: projected.sqrtRatio.toString(),
            };
          } catch {
            liveTailProjection = null;
          }
        }
      }
    }

    const response = {
      timestamp: Date.now(),
      start: start.getTime(),
      end: end.getTime(),
      interval: intervalSeconds,
      pool_key_id: pool.pool_key_id.toString(),
      token0: toHex(pool.token0),
      token1: toHex(pool.token1),
      execution_markers: markerRows.map((row) => Number(row.time)),
      live_tail_projection: liveTailProjection,
      data,
    } satisfies z.infer<typeof GetPoolPriceHistoryResponseType>;

    return json(response, {
      headers: {
        "cache-control": `public, max-age=${Math.ceil(
          intervalSeconds / 4,
        )}, must-revalidate`,
      },
    });
  }
}
