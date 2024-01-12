import { EkuboAPIRoute, RequestContext } from "../../shared/context";
import { error, IRequest, json } from "itty-router";
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

const DEFAULT_PERIOD_SECONDS = 5 * 60;

export class GetPairPrice extends EkuboAPIRoute {
  static route = "/price/:baseToken/:quoteToken";

  static schema: OpenAPIRouteSchema = {
    tags: ["Prices"],
    summary: "Get pair price",
    description: "Get the price of the base token in terms of the quote token",
    parameters: {
      baseToken: Path(TokenIdentifierType, { example: "ETH" }),
      quoteToken: Path(TokenIdentifierType, { example: "USDC" }),
      period: Query(
        z.coerce.number().int().min(300).max(21_600).openapi({
          description: "The amount of time over which the VWAP is measured",
        }),
        {
          example: 60,
          default: DEFAULT_PERIOD_SECONDS,
        }
      ),
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
      return error(400, "Base token or quote token not known");
    }

    const baseToken = BigInt(bt.l2_token_address);
    const quoteToken = BigInt(qt.l2_token_address);
    const period = Number(query.period ?? DEFAULT_PERIOD_SECONDS) * 1_000;

    const timestamp = Date.now();
    const startTimestamp = new Date(timestamp - period);

    const ethTokenAddress = BigInt(env.ETH_TOKEN_ADDRESS);

    if (!ethTokenAddress) {
      return error(500, "Fee token not defined for chain");
    }

    const [direct, quoteToEth, baseToEth] = await queries.withinTransaction(
      () =>
        Promise.all([
          queries.getLastVolumeWeightedPrice({
            quoteToken,
            baseToken,
            since: startTimestamp,
          }),
          queries.getLastVolumeWeightedPrice({
            quoteToken,
            baseToken: ethTokenAddress,
            since: startTimestamp,
          }),
          queries.getLastVolumeWeightedPrice({
            quoteToken: ethTokenAddress,
            baseToken,
            since: startTimestamp,
          }),
        ])
    );

    let price: Decimal;
    if (direct) {
      if (!quoteToEth || !baseToEth) {
        price = direct.price;
      } else if (
        quoteToEth.k_volume * baseToEth.k_volume >
        direct.k_volume ** 2n
      ) {
        price = quoteToEth.price.mul(baseToEth.price);
      } else {
        price = direct.price;
      }
    } else {
      if (!quoteToEth || !baseToEth) {
        return error(404, "No volume for this pair");
      }

      price = quoteToEth.price.mul(baseToEth.price);
    }

    const scaled = price.mul(new Decimal(10).pow(bt.decimals - qt.decimals));

    return json(
      {
        timestamp,
        price: scaled.toSignificantDigits(10).toString(),
      },
      {
        headers: {
          "cache-control": `public, max-age=${Math.floor(
            period / 2
          )}, must-revalidate`,
        },
      }
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
      return error(400, "Base token or quote token not known");
    }

    const baseToken = BigInt(bt.l2_token_address);
    const quoteToken = BigInt(qt.l2_token_address);

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
    const ethTokenAddress = BigInt(env.ETH_TOKEN_ADDRESS);
    const price0 =
      (
        await queries.getLastVolumeWeightedPrice({
          baseToken: ethTokenAddress,
          quoteToken: token0,
          since: null,
        })
      )?.price ?? new Decimal(0);
    const price1 =
      (
        await queries.getLastVolumeWeightedPrice({
          baseToken: ethTokenAddress,
          quoteToken: token1,
          since: null,
        })
      )?.price ?? new Decimal(0);

    const thresholdEth = new Decimal(1e15);
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
  static route = "/price/:quoteToken";

  static schema: OpenAPIRouteSchema = {
    tags: ["Prices"],
    summary: "Get token prices",
    description:
      "Given a quote token, returns the price of all other tokens in terms of the qutoe token",
    parameters: {
      quoteToken: Path(AddressType, { description: "The quote token address" }),
    },
    responses: {
      "200": {
        description: "The prices of other tokens in terms of quote token",
        contentType: "application/json",
      },
    },
  };

  async handle({ params }: IRequest, { env }: RequestContext) {
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
