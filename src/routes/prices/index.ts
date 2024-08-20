import { EkuboAPIRoute, RequestContext } from "../../shared/context";
import { IRequest, json, StatusError } from "itty-router";
import {
  getAllTokens,
  getTokenByAddress,
  getTokenByIdentifier,
} from "../meta/tokens";
import Decimal from "decimal.js-light";
import {
  AddressType,
  TokenIdentifierType,
} from "../../shared/validation/address";
import { createQueries } from "../../queries";
import {
  OpenAPIRouteSchema,
  Path,
  Query,
} from "@cloudflare/itty-router-openapi";
import { z } from "zod";
import { ETH_TOKEN_ADDRESS, STRK_TOKEN_ADDRESS } from "../../shared/constants";

const DEFAULT_PERIOD_SECONDS = 3600;

export class GetPairPrice extends EkuboAPIRoute {
  static route = "/price/:baseToken/:quoteToken";

  static schema: OpenAPIRouteSchema = {
    tags: ["Prices"],
    summary: "Get pair price",
    description: "Get the price of the base token in terms of the quote token",
    parameters: {
      baseToken: Path(TokenIdentifierType, { example: "ETH" }),
      quoteToken: Path(TokenIdentifierType, { example: "USDC" }),
      atTime: Query(
        z.coerce.date().openapi({
          description: "The time from which the VWAP should be measured",
        }),
        { example: "2024-01-01T00:00:00", required: false },
      ),
      period: Query(z.coerce.number().int().min(3600).max(86_400), {
        description: "The amount of time over which the VWAP is measured",
        example: 3600,
        default: DEFAULT_PERIOD_SECONDS,
        required: false,
      }),
    },
    responses: {
      "200": {
        description: "The price of base token in terms of quote token",
        contentType: "application/json",
      },
    },
  };

  async handle({ params, query }: IRequest, { env }: RequestContext) {
    const queries = await createQueries(env);
    const allTokens = await getAllTokens(env, queries);

    const bt = getTokenByIdentifier(allTokens, params.baseToken);
    const qt = getTokenByIdentifier(allTokens, params.quoteToken);

    if (!bt || !qt) {
      throw new StatusError(400, "Base token or quote token not known");
    }

    const baseToken = BigInt(bt.l2_token_address);
    const quoteToken = BigInt(qt.l2_token_address);
    const periodSeconds = Number(query.period ?? DEFAULT_PERIOD_SECONDS);

    const endTime =
      query.atTime && typeof query.atTime === "string"
        ? new Date(query.atTime)
        : undefined;

    const numHours = Math.ceil(periodSeconds / 3600);

    const [direct, quoteToEth, baseToEth, quoteToStrk, baseToStrk] =
      await Promise.all([
        queries.getVolumeWeightedPrice({
          quoteToken,
          baseToken,
          endTime,
          numHours,
        }),
        queries.getVolumeWeightedPrice({
          quoteToken,
          baseToken: ETH_TOKEN_ADDRESS,
          endTime,
          numHours,
        }),
        queries.getVolumeWeightedPrice({
          quoteToken: ETH_TOKEN_ADDRESS,
          baseToken,
          endTime,
          numHours,
        }),
        queries.getVolumeWeightedPrice({
          quoteToken,
          baseToken: STRK_TOKEN_ADDRESS,
          endTime,
          numHours,
        }),
        queries.getVolumeWeightedPrice({
          quoteToken: STRK_TOKEN_ADDRESS,
          baseToken,
          endTime,
          numHours,
        }),
      ]);

    console.log(
      "test",
      direct?.price.toString(),
      quoteToEth?.price.toString(),
      baseToEth?.price.toString(),
      quoteToStrk?.price.toString(),
      baseToStrk?.price.toString(),
    );

    let price: Decimal;
    if (
      quoteToEth &&
      baseToEth &&
      (!direct ||
        quoteToEth.k_volume * baseToEth.k_volume > direct.k_volume ** 2n)
    ) {
      price = quoteToEth.price.mul(baseToEth.price);
    } else if (
      quoteToStrk &&
      baseToStrk &&
      (!direct ||
        quoteToStrk.k_volume * baseToStrk.k_volume > direct.k_volume ** 2n)
    ) {
      price = quoteToStrk.price.mul(baseToStrk.price);
    } else if (direct) {
      price = direct.price;
    } else {
      throw new StatusError(404, "No volume for this pair");
    }

    const scaled = price.mul(new Decimal(10).pow(bt.decimals - qt.decimals));

    return json(
      {
        timestamp: Date.now(),
        price: scaled.toSignificantDigits(10).toString(),
      },
      {
        headers: {
          "cache-control": `public, max-age=${Math.floor(
            periodSeconds,
          )}, must-revalidate`,
        },
      },
    );
  }
}

export class GetPairVolatility extends EkuboAPIRoute {
  static route = "/volatility/:tokenA/:tokenB";

  static schema: OpenAPIRouteSchema = {
    tags: ["Prices"],
    summary: "Get pair volatility",
    description:
      "Get the historical volatility (i.e. realized) of a token pair",
    parameters: {
      tokenA: Path(TokenIdentifierType, { example: "ETH" }),
      tokenB: Path(TokenIdentifierType, { example: "USDC" }),
      fromDate: Query(
        z.coerce.date().openapi({
          description: "The time from which the volatility should be measured",
        }),
        { example: "2024-01-01T00:00:00", required: true },
      ),
      numDays: Query(z.coerce.number().int().min(7).max(90), {
        description: "The number of days over which the volatility is measured",
        required: true,
      }),
    },
    responses: {
      "200": {
        description: "The volatility of the token pair",
        contentType: "application/json",
        schema: z.object({
          volatility: z.object({
            ticks: z.number().int(),
          }),
        }),
      },
    },
  };

  async handle({ params, query }: IRequest, { env }: RequestContext) {
    const queries = await createQueries(env);
    const allTokens = await getAllTokens(env, queries);

    const tokenA = getTokenByIdentifier(allTokens, params.tokenA);
    const tokenB = getTokenByIdentifier(allTokens, params.tokenB);

    if (!tokenA || !tokenB) {
      throw new StatusError(400, "Base token or quote token not known");
    }

    if (typeof query.fromDate !== "string") {
      throw new StatusError(400, "Invalid `fromDate`");
    }

    const fromDate = new Date(query.fromDate);
    if (fromDate.getTime() > Date.now()) {
      throw new StatusError(400, "`fromDate` cannot be in future");
    }

    if (typeof query.numDays !== "string") {
      throw new StatusError(400, "Invalid `numDays`");
    }

    const [token0, token1] =
      BigInt(tokenA.l2_token_address) < BigInt(tokenB.l2_token_address)
        ? [BigInt(tokenA.l2_token_address), BigInt(tokenB.l2_token_address)]
        : [BigInt(tokenB.l2_token_address), BigInt(tokenA.l2_token_address)];

    const volatilityData = await queries.getVolatilityData({
      fromDate,
      pairs: [
        {
          token0,
          token1,
        },
      ],
      numDays: parseInt(query.numDays),
    });

    if (!volatilityData.length) {
      throw new StatusError(404, "No volatility data for the pair");
    }

    return json(
      {
        volatility: {
          ticks: volatilityData[0].volatility_in_ticks,
        },
      },
      {
        headers: {
          "cache-control": `public,max-age=86400,immutable`,
        },
      },
    );
  }
}

export class GetPairPriceHistory extends EkuboAPIRoute {
  static route = "/price/:baseToken/:quoteToken/history";

  static schema: OpenAPIRouteSchema = {
    tags: ["Prices"],
    summary: "Get price history",
    description: "Get the VWAP-based price history for the given pair",
    parameters: {
      baseToken: Path(TokenIdentifierType, { example: "ETH" }),
      quoteToken: Path(TokenIdentifierType, { example: "USDC" }),
      interval: Query(z.coerce.number().int().min(60), { required: false }),
    },
    responses: {
      "200": {
        description: "The price history of the pair",
        contentType: "application/json",
      },
    },
  };

  async handle({ params, query }: IRequest, { env }: RequestContext) {
    const queries = await createQueries(env);
    const allTokens = await getAllTokens(env, queries);

    const bt = getTokenByIdentifier(allTokens, params.baseToken);
    const qt = getTokenByIdentifier(allTokens, params.quoteToken);

    if (!bt || !qt) {
      throw new StatusError(400, "Base token or quote token not known");
    }

    const baseToken = BigInt(bt.l2_token_address);
    const quoteToken = BigInt(qt.l2_token_address);

    if (!bt || !qt) {
      throw new StatusError(400, "Base token or quote token not known");
    }

    if (baseToken === quoteToken) {
      throw new StatusError(400, "Base token cannot be equal to quote token");
    }

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

    const [token0, token1] =
      baseToken < quoteToken
        ? [baseToken, quoteToken]
        : [quoteToken, baseToken];

    // convert 1e15 eth to the threshold for token0 by multiplying 1e15 eth by the price in per eth
    const price0 =
      (
        await queries.getVolumeWeightedPrice({
          baseToken: ETH_TOKEN_ADDRESS,
          quoteToken: token0,
        })
      )?.price ?? new Decimal(0);
    const price1 =
      (
        await queries.getVolumeWeightedPrice({
          baseToken: ETH_TOKEN_ADDRESS,
          quoteToken: token1,
        })
      )?.price ?? new Decimal(0);

    const thresholdEth = new Decimal(1e16);
    const threshold0 = BigInt(thresholdEth.mul(price0).toFixed(0));
    const threshold1 = BigInt(thresholdEth.mul(price1).toFixed(0));

    const data = await queries.getPriceHistory({
      token0,
      token1,
      start,
      end,
      intervalSeconds,
      decimalsDifference:
        baseToken < quoteToken
          ? bt.decimals - qt.decimals
          : qt.decimals - bt.decimals,
      delta0Threshold: threshold0,
      delta1Threshold: threshold1,
    });

    return json(
      {
        timestamp: Date.now(),
        start: start.getTime(),
        end: end.getTime(),
        interval: intervalSeconds,
        data:
          baseToken < quoteToken
            ? data
            : data.map((d) => ({
                ...d,
                vwap: 1 / d.vwap,
                max: 1 / d.min,
                min: 1 / d.max,
                k_volume: d.k_volume,
              })),
      },
      {
        headers: {
          "cache-control": `public, max-age=${Math.ceil(
            intervalSeconds / 4,
          )}, must-revalidate`,
        },
      },
    );
  }
}

export class GetTokenPrices extends EkuboAPIRoute {
  static route = "/price/:quoteToken";

  static schema: OpenAPIRouteSchema = {
    tags: ["Prices"],
    summary: "Get token prices",
    description:
      "Given a quote token, returns the price of all other tokens in terms of the qutoe token",
    parameters: {
      quoteToken: Path(TokenIdentifierType, {
        description: "The quote token identifier",
      }),
      period: Query(z.coerce.number().int().min(3600).max(86400), {
        description: "The period in seconds over which to measure the VWAP",
        required: false,
      }),
      minSwapCount: Query(z.coerce.number().int().min(1), {
        description:
          "The minimum number of swaps over the period for the VWAP to be returned",
        required: false,
      }),
    },
    responses: {
      "200": {
        description: "The prices of other tokens in terms of quote token",
        contentType: "application/json",
      },
    },
  };

  async handle({ params, query }: IRequest, { env }: RequestContext) {
    const queries = await createQueries(env);
    const allTokens = await getAllTokens(env, queries);
    const qt = getTokenByIdentifier(allTokens, params.quoteToken);

    if (!qt) {
      throw new StatusError(400, "Invalid quote token");
    }

    const timestamp = Date.now();
    const startTime = new Date(
      timestamp - Number(query.period ?? 21_600) * 1000,
    );

    const prices = await queries.getAllVolumeWeightedPrices({
      quoteToken: BigInt(qt.l2_token_address),
      start: startTime,
      minSwapCount: Number(query.minSwapCount ?? 4),
    });

    const scaledPrices = prices
      .map(({ price, k_volume, token }) => {
        const base = getTokenByAddress(allTokens, token);
        if (!base) return null;

        const scaled = price.mul(
          new Decimal(10).pow(base.decimals - qt.decimals),
        );

        return {
          token,
          price: scaled.toSignificantDigits(6).toString(),
          k_volume: k_volume.toString(),
        };
      })
      .filter((p) => !!p);

    return json(
      {
        timestamp,
        prices: scaledPrices,
      },
      {
        headers: {
          "cache-control": "public, max-age=600, must-revalidate",
        },
      },
    );
  }
}
