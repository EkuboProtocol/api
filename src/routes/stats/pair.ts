import { EkuboAPIRoute, RequestContext } from "../../shared/context";
import { error, IRequest, json } from "itty-router";
import { AddressType } from "../../shared/validation/address";
import { createQueries } from "../../queries";
import { OpenAPIRouteSchema, Path } from "@cloudflare/itty-router-openapi";

export class GetPairInfo extends EkuboAPIRoute {
  static route = "/pair/:tokenA/:tokenB";

  static schema: OpenAPIRouteSchema = {
    tags: ["Stats"],
    summary: "Get pair stats",
    description: "Returns high level stats for a given trading pair",
    parameters: {
      tokenA: Path(AddressType),
      tokenB: Path(AddressType),
    },
    responses: {
      "200": {
        description: "Information about the token pair",
        contentType: "application/json",
      },
    },
  };

  async handle({ params }: IRequest, { env }: RequestContext) {
    const [token0, token1] =
      BigInt(params.tokenA) < BigInt(params.tokenB)
        ? [BigInt(params.tokenA), BigInt(params.tokenB)]
        : [BigInt(params.tokenB), BigInt(params.tokenA)];

    const queries = await createQueries(env);
    const pair = { token0, token1 };

    const timestamp = Date.now();
    const thirtyDaysAgo = new Date(timestamp - 1000 * 60 * 60 * 24 * 30);

    const [
      { rows: tvlByToken },
      { rows: volumeByToken },
      { rows: revenueByToken },
      { rows: tvlDeltaByTokenByDate },
      { rows: volumeByTokenByDate },
      { rows: revenueByTokenByDate },
      { rows: topPools },
    ] = await queries.withinTransaction(() =>
      Promise.all([
        queries.getTvlByToken(pair),
        queries.getTotalVolumeByToken({ pair }),
        queries.getRevenueByToken({ pair }),
        queries.getTvlDeltaByTokenByDate(thirtyDaysAgo, pair),
        queries.getVolumeByTokenByDate(thirtyDaysAgo, pair),
        queries.getRevenueByTokenByDate(thirtyDaysAgo, pair),
        queries.getTopPools(pair),
      ])
    );

    return json(
      {
        timestamp,
        tvlByToken,
        volumeByToken,
        revenueByToken,
        tvlDeltaByTokenByDate,
        volumeByTokenByDate,
        revenueByTokenByDate,
        topPools,
      },
      {
        headers: {
          "cache-control":
            "public, max-age=600, stale-while-revalidate=180, stale-if-error=180",
        },
      }
    );
  }
}

export class GetPairLiquidity extends EkuboAPIRoute {
  static route = "/tokens/:tokenA/:tokenB/liquidity";
  static schema: OpenAPIRouteSchema = {
    tags: ["Stats"],
    summary: "Get pair liquidity",
    parameters: {
      tokenA: Path(AddressType),
      tokenB: Path(AddressType),
    },
    description:
      "Returns the liquidity chart for the given token pair, aggregated across all pools",
    responses: {
      "200": {
        description: "For each tick for pools of the pair, the liquidity delta",
        contentType: "application/json",
      },
    },
  };

  async handle(
    { params: { tokenA: tokenAStr, tokenB: tokenBStr } }: IRequest,
    { env }: RequestContext
  ) {
    let tokenA: bigint, tokenB: bigint;
    try {
      tokenA = BigInt(tokenAStr);
      tokenB = BigInt(tokenBStr);
    } catch (e) {
      return error(400, "Invalid tokens");
    }

    const queries = await createQueries(env);

    const [token0, token1] =
      tokenA < tokenB ? [tokenA, tokenB] : [tokenB, tokenA];

    if (token0 === 0n) {
      return error(400, "Invalid tokens");
    }

    const { rows } = await queries.withinTransaction(() =>
      queries.getPairLiquidityGraph({
        token0,
        token1,
      })
    );

    return json(
      {
        data: rows,
      },
      {
        headers: {
          "cache-control": "public, max-age=600, must-revalidate",
        },
      }
    );
  }
}

export class ListPairEvents extends EkuboAPIRoute {
  static route = "/tokens/:tokenA/:tokenB/events";
  static schema: OpenAPIRouteSchema = {
    tags: ["Stats"],
    summary: "Get pair events",
    description: "Returns a list of recent events for the given trading pair",
    parameters: {
      tokenA: Path(AddressType),
      tokenB: Path(AddressType),
    },
    responses: {
      "200": {
        description: "A list of events for the given pair",
        contentType: "application/json",
      },
    },
  };

  async handle(
    { params: { tokenA: tokenAStr, tokenB: tokenBStr } }: IRequest,
    { env }: RequestContext
  ) {
    let tokenA: bigint, tokenB: bigint;
    try {
      tokenA = BigInt(tokenAStr);
      tokenB = BigInt(tokenBStr);
    } catch (e) {
      return error(400, "Invalid tokens");
    }

    const [token0, token1] =
      tokenA < tokenB ? [tokenA, tokenB] : [tokenB, tokenA];

    if (token0 === 0n) {
      return error(400, "Invalid tokens");
    }

    const queries = await createQueries(env);

    const { rows } = await queries.getPairEvents({
      token0,
      token1,
      limit: 300,
    });

    return json(
      {
        data: rows,
      },
      {
        headers: {
          "cache-control": "public, max-age=180, must-revalidate",
        },
      }
    );
  }
}
