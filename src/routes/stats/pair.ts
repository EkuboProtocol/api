import { EkuboAPIRoute, RequestContext } from "../_shared/context";
import { error, IRequest, json } from "itty-router";
import { ADDRESS_REGEX } from "../_shared/validation/address";
import { Queries } from "../../queries";
import { OpenAPIRouteSchema } from "@cloudflare/itty-router-openapi";

export class GetPairInfo extends EkuboAPIRoute {
  static schema: OpenAPIRouteSchema = {
    tags: ["Stats"],
    summary: "Return overview stats for a token pair",
    responses: {
      "200": {
        description: "Information about the token pair",
        contentType: "application/json",
      },
    },
  };

  async handle({ params }: IRequest, { client }: RequestContext) {
    if (
      typeof params.tokenA !== "string" ||
      !ADDRESS_REGEX.test(params.tokenA) ||
      typeof params.tokenB !== "string" ||
      !ADDRESS_REGEX.test(params.tokenB)
    ) {
      return error(
        400,
        "`tokenA` and `tokenB` path parameters must be token addresses in hex format"
      );
    }

    const [token0, token1] =
      BigInt(params.tokenA) < BigInt(params.tokenB)
        ? [BigInt(params.tokenA), BigInt(params.tokenB)]
        : [BigInt(params.tokenB), BigInt(params.tokenA)];

    const pair = { token0, token1 };

    const queries = new Queries(client);

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
  static schema: OpenAPIRouteSchema = {
    tags: ["Stats"],
    summary: "Returns liquidity chart for the given pair",
    responses: {
      "200": {
        description: "For each tick for pools of the pair, the liquidity delta",
        contentType: "application/json",
      },
    },
  };

  async handle(
    { params: { tokenA: tokenAStr, tokenB: tokenBStr } }: IRequest,
    { client }: RequestContext
  ) {
    let tokenA: bigint, tokenB: bigint;
    try {
      tokenA = BigInt(tokenAStr);
      tokenB = BigInt(tokenBStr);
    } catch (e) {
      return error(400, "Invalid tokens");
    }

    const queries = new Queries(client);

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
  static schema: OpenAPIRouteSchema = {
    tags: ["Stats"],
    summary: "Returns a list of recent events for the pair",
    responses: {
      "200": {
        description: "A list of events for the given pair",
        contentType: "application/json",
      },
    },
  };

  async handle(
    { params: { tokenA: tokenAStr, tokenB: tokenBStr } }: IRequest,
    { client }: RequestContext
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

    const queries = new Queries(client);

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
