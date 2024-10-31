import { EkuboAPIRoute, RequestContext } from "../../shared/context";
import { IRequest, json, StatusError } from "itty-router";
import { getAllTokens, getTokenByIdentifier } from "../meta/tokens";
import Decimal from "decimal.js-light";
import { TokenIdentifierType } from "../../shared/validation/address";
import { createQueries } from "../../queries";
import {
  OpenAPIRouteSchema,
  Path,
  Query,
} from "@cloudflare/itty-router-openapi";
import { z } from "zod";
import { ETH_TOKEN_ADDRESS } from "../../shared/constants";

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
