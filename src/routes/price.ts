import { EkuboAPIRoute } from "./_shared/context";
import { error, IRequest, json } from "itty-router";
import { Env } from "../env";
import { FEE_TOKEN_ADDRESS, getAllTokens, getTokenByAddress } from "../tokens";
import Decimal from "decimal.js-light";
import { ADDRESS_REGEX, AddressType } from "./_shared/validation/address";
import { createQueries } from "../queries";
import { OpenAPIRouteSchema } from "@cloudflare/itty-router-openapi";
import { z } from "zod";

export class GetPairPrice extends EkuboAPIRoute {
  async handle({ params }: IRequest, env: Env) {
    if (
      typeof params.baseToken !== "string" ||
      !ADDRESS_REGEX.test(params.baseToken) ||
      typeof params.quoteToken !== "string" ||
      !ADDRESS_REGEX.test(params.quoteToken)
    ) {
      return error(
        400,
        "`baseToken` and `quoteToken` path parameters must be token addresses in hex format"
      );
    }

    const baseToken = BigInt(params.baseToken);
    const quoteToken = BigInt(params.quoteToken);

    const queries = await createQueries(env);
    const allTokens = await getAllTokens(env, queries);

    const bt = getTokenByAddress(allTokens, baseToken);
    const qt = getTokenByAddress(allTokens, quoteToken);

    if (!bt || !qt) {
      return error(400, "Base token or quote token not known");
    }

    const timestamp = Date.now();
    const oneDayAgo = new Date(timestamp - 86_400_000);

    const ft = FEE_TOKEN_ADDRESS[env.STARKNET_CHAIN_ID];

    if (!ft) {
      return error(500, "Fee token not defined for chain");
    }

    const [direct, quoteFt, baseFt] = await queries.withinTransaction(() =>
      Promise.all([
        queries.getLastVolumeWeightedPrice({
          quoteToken,
          baseToken,
          since: oneDayAgo,
        }),
        queries.getLastVolumeWeightedPrice({
          quoteToken,
          baseToken: ft,
          since: oneDayAgo,
        }),
        queries.getLastVolumeWeightedPrice({
          quoteToken: ft,
          baseToken,
          since: oneDayAgo,
        }),
      ])
    );

    let price: Decimal;
    if (direct) {
      if (!quoteFt || !baseFt) {
        price = direct.price;
      } else {
        if (quoteFt.k_volume * baseFt.k_volume > direct.k_volume ** 2n) {
          price = quoteFt.price.mul(baseFt.price);
        } else {
          price = direct.price;
        }
      }
    } else {
      if (!quoteFt || !baseFt) {
        return error(404, "No volume for this pair");
      }

      price = quoteFt.price.mul(baseFt.price);
    }

    const scaled = price.mul(new Decimal(10).pow(bt.decimals - qt.decimals));

    return json(
      {
        timestamp,
        price: scaled.toSignificantDigits(10).toString(),
      },
      {
        headers: {
          "cache-control": "public, max-age=180, must-revalidate",
        },
      }
    );
  }
}

export class GetPairPriceHistory extends EkuboAPIRoute {
  static route = "/price/:baseToken/:quoteToken/history";

  static schema: OpenAPIRouteSchema = {
    tags: ["Prices"],
    summary: "Get the price history for the given pair",
    parameters: {
      baseToken: {
        type: AddressType,
        location: "path",
      },
      quoteToken: {
        type: AddressType,
        location: "path",
      },
      interval: {
        type: z.coerce.number().int(),
        location: "query",
      },
    },
    responses: {
      "200": {
        description: "The price history of the pair",
        contentType: "application/json",
      },
    },
  };
  async handle({ params, query }: IRequest, env: Env) {
    if (
      typeof params.baseToken !== "string" ||
      !ADDRESS_REGEX.test(params.baseToken) ||
      typeof params.quoteToken !== "string" ||
      !ADDRESS_REGEX.test(params.quoteToken)
    ) {
      return error(
        400,
        "`baseToken` and `quoteToken` path parameters must be token addresses in hex format"
      );
    }

    const baseToken = BigInt(params.baseToken);
    const quoteToken = BigInt(params.quoteToken);

    const queries = await createQueries(env);

    const tokens = await getAllTokens(env, queries);
    const bt = getTokenByAddress(tokens, baseToken);
    const qt = getTokenByAddress(tokens, quoteToken);

    if (!bt || !qt) {
      return error(400, "Base token or quote token not known");
    }

    if (baseToken === quoteToken) {
      return error(400, "Base token cannot be equal to quote token");
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
      return error(400, "Invalid `interval`, `end` or `start` parameters");
    }

    const durationMilliseconds = end.getTime() - start.getTime();
    if (durationMilliseconds > 30 * 86_400 * 1_000) {
      return error(
        400,
        "Start time cannot be more than 30 days before end time"
      );
    }

    if (intervalSeconds <= 0) {
      return error(400, "Interval must be positive");
    }

    const numIntervals = durationMilliseconds / intervalSeconds / 1_000;

    if (numIntervals > 120) {
      return error(400, "Interval too small for the range");
    }

    const [token0, token1] =
      baseToken < quoteToken
        ? [baseToken, quoteToken]
        : [quoteToken, baseToken];

    // convert 1e15 eth to the threshold for token0 by multiplying 1e15 eth by the price in per eth
    const fta = FEE_TOKEN_ADDRESS[env.STARKNET_CHAIN_ID];
    const price0 =
      token0 === fta
        ? new Decimal(1)
        : (
            await queries.getLastVolumeWeightedPrice({
              baseToken: fta,
              quoteToken: token0,
              since: null,
            })
          )?.price ?? new Decimal(0);
    const price1 =
      token1 === fta
        ? new Decimal(1)
        : (
            await queries.getLastVolumeWeightedPrice({
              baseToken: fta,
              quoteToken: token1,
              since: null,
            })
          )?.price ?? new Decimal(0);

    const thresholdFeeToken = new Decimal(1e15);
    const threshold0 = BigInt(thresholdFeeToken.mul(price0).toFixed(0));
    const threshold1 = BigInt(thresholdFeeToken.mul(price1).toFixed(0));

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
              })),
      },
      {
        headers: {
          "cache-control": `public, max-age=${Math.ceil(
            intervalSeconds / 4
          )}, must-revalidate`,
        },
      }
    );
  }
}

export class GetTokenPrices extends EkuboAPIRoute {
  async handle({ params }: IRequest, env: Env) {
    if (
      typeof params.quoteToken !== "string" ||
      !ADDRESS_REGEX.test(params.quoteToken)
    ) {
      return error(
        400,
        "`quoteToken` path parameters must be a token address in hex format"
      );
    }

    const quoteToken = BigInt(params.quoteToken);

    const queries = await createQueries(env);
    const allTokens = await getAllTokens(env, queries);
    const qt = getTokenByAddress(allTokens, quoteToken);

    if (!qt) {
      return error(400, "Quote token not known");
    }

    const timestamp = Date.now();
    const sixHoursAgo = new Date(timestamp - 3_600_000 * 6);

    const prices = await queries.getAllVolumeWeightedPrices({
      quoteToken,
      start: sixHoursAgo,
    });

    const scaledPrices = prices
      .map(({ price, k_volume, token }) => {
        const base = getTokenByAddress(allTokens, token);
        if (!base) return null;

        const scaled = price.mul(
          new Decimal(10).pow(base.decimals - qt.decimals)
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
      }
    );
  }
}
