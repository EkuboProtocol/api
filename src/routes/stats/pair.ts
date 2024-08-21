import { EkuboAPIRoute, RequestContext } from "../../shared/context";
import { IRequest, json, StatusError } from "itty-router";
import { TokenIdentifierType } from "../../shared/validation/address";
import { createQueries, Queries } from "../../queries";
import { OpenAPIRouteSchema, Path } from "@cloudflare/itty-router-openapi";
import { getAllTokens, getTokenByIdentifier, TokenInfo } from "../meta/tokens";
import { Env } from "../../env";

async function parseOutTokens(
  env: Env,
  request: IRequest,
): Promise<{
  queries: Queries;
  tokenA: TokenInfo;
  tokenB: TokenInfo;
  pair: {
    token0: bigint;
    token1: bigint;
  };
}> {
  const queries = await createQueries(env);
  const allTokens = await getAllTokens(env, queries);

  const tokenA = getTokenByIdentifier(allTokens, request.params.tokenA);
  const tokenB = getTokenByIdentifier(allTokens, request.params.tokenB);

  if (!tokenA) {
    throw new StatusError(
      400,
      `Invalid token identifier: "${request.params.tokenA}"`,
    );
  }
  if (!tokenB) {
    throw new StatusError(
      400,
      `Invalid token identifier: "${request.params.tokenB}"`,
    );
  }
  if (tokenA.l2_token_address === tokenB.l2_token_address) {
    throw new StatusError(400, `tokenA cannot be same as tokenB`);
  }

  const [token0, token1] =
    BigInt(tokenA.l2_token_address) < BigInt(tokenB.l2_token_address)
      ? [tokenA, tokenB]
      : [tokenB, tokenA];

  return {
    queries,
    tokenA,
    tokenB,
    pair: {
      token0: BigInt(token0.l2_token_address),
      token1: BigInt(token1.l2_token_address),
    },
  };
}

export class GetPairInfo extends EkuboAPIRoute {
  static route = "/pair/:tokenA/:tokenB";

  static schema: OpenAPIRouteSchema = {
    tags: ["Stats"],
    summary: "Get pair stats",
    description: "Returns high level stats for a given trading pair",
    parameters: {
      tokenA: Path(TokenIdentifierType),
      tokenB: Path(TokenIdentifierType),
    },
    responses: {
      "200": {
        description: "Information about the token pair",
        contentType: "application/json",
      },
    },
  };

  async handle(request: IRequest, { env }: RequestContext) {
    const { queries, pair } = await parseOutTokens(env, request);

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
    ] = await Promise.all([
      queries.getTvlByToken(pair),
      queries.getTotalVolumeByToken({ pair }),
      queries.getRevenueByToken({ pair }),
      queries.getTvlDeltaByTokenByDate(thirtyDaysAgo, pair),
      queries.getVolumeByTokenByDate(thirtyDaysAgo, pair),
      queries.getRevenueByTokenByDate(thirtyDaysAgo, pair),
      queries.getTopPools(pair),
    ]);

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
          "cache-control": "public, max-age=10800",
        },
      },
    );
  }
}

export class GetPairInfoTvl extends EkuboAPIRoute {
  static route = "/pair/:tokenA/:tokenB/tvl";

  static schema: OpenAPIRouteSchema = {
    tags: ["Stats"],
    summary: "Get pair TVL",
    description: "Returns TVL stats for the pair",
    parameters: {
      tokenA: Path(TokenIdentifierType),
      tokenB: Path(TokenIdentifierType),
    },
    responses: {
      "200": {
        description: "Information about the token pair TVL",
        contentType: "application/json",
      },
    },
  };

  async handle(request: IRequest, { env }: RequestContext) {
    const { queries, pair } = await parseOutTokens(env, request);

    const timestamp = Date.now();
    const thirtyDaysAgo = new Date(timestamp - 1000 * 60 * 60 * 24 * 30);

    const [{ rows: tvlByToken }, { rows: tvlDeltaByTokenByDate }] =
      await Promise.all([
        queries.getTvlByToken(pair),
        queries.getTvlDeltaByTokenByDate(thirtyDaysAgo, pair),
      ]);

    return json(
      {
        tvlByToken,
        tvlDeltaByTokenByDate,
      },
      {
        headers: {
          "cache-control": "public, max-age=3600",
        },
      },
    );
  }
}

export class GetPairInfoVolume extends EkuboAPIRoute {
  static route = "/pair/:tokenA/:tokenB/volume";

  static schema: OpenAPIRouteSchema = {
    tags: ["Stats"],
    summary: "Get pair volume",
    description: "Returns volume stats for a given trading pair",
    parameters: {
      tokenA: Path(TokenIdentifierType),
      tokenB: Path(TokenIdentifierType),
    },
    responses: {
      "200": {
        description: "Information about the token pair volume",
        contentType: "application/json",
      },
    },
  };

  async handle(request: IRequest, { env }: RequestContext) {
    const { queries, pair } = await parseOutTokens(env, request);

    const timestamp = Date.now();
    const thirtyDaysAgo = new Date(timestamp - 1000 * 60 * 60 * 24 * 30);

    const [{ rows: volumeByToken }, { rows: volumeByTokenByDate }] =
      await queries.withinTransaction(() =>
        Promise.all([
          queries.getTotalVolumeByToken({ pair }),
          queries.getVolumeByTokenByDate(thirtyDaysAgo, pair),
        ]),
      );

    return json(
      {
        volumeByToken,
        volumeByTokenByDate,
      },
      {
        headers: {
          "cache-control": "public, max-age=600",
        },
      },
    );
  }
}

export class GetPairInfoPools extends EkuboAPIRoute {
  static route = "/pair/:tokenA/:tokenB/pools";

  static schema: OpenAPIRouteSchema = {
    tags: ["Stats"],
    summary: "Get pools of pair",
    description: "Returns pool info for a pair",
    parameters: {
      tokenA: Path(TokenIdentifierType),
      tokenB: Path(TokenIdentifierType),
    },
    responses: {
      "200": {
        description: "Information about the pools of a token pair",
        contentType: "application/json",
      },
    },
  };

  async handle(request: IRequest, { env }: RequestContext) {
    const { queries, pair } = await parseOutTokens(env, request);

    const { rows: topPools } = await queries.getTopPools(pair);

    return json(
      {
        topPools,
      },
      {
        headers: {
          "cache-control": "public, max-age=600",
        },
      },
    );
  }
}

export class GetPairLiquidity extends EkuboAPIRoute {
  static route = "/tokens/:tokenA/:tokenB/liquidity";
  static schema: OpenAPIRouteSchema = {
    tags: ["Stats"],
    summary: "Get pair liquidity",
    parameters: {
      tokenA: Path(TokenIdentifierType),
      tokenB: Path(TokenIdentifierType),
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

  async handle(request: IRequest, { env }: RequestContext) {
    const { queries, pair } = await parseOutTokens(env, request);

    const data = await queries.withinTransaction(() =>
      queries.getPairLiquidityGraph(pair),
    );

    return json(
      {
        data,
      },
      {
        headers: {
          "cache-control": "public, max-age=600, must-revalidate",
        },
      },
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
      tokenA: Path(TokenIdentifierType),
      tokenB: Path(TokenIdentifierType),
    },
    responses: {
      "200": {
        description: "A list of events for the given pair",
        contentType: "application/json",
      },
    },
  };

  async handle(request: IRequest, { env }: RequestContext) {
    const { queries, pair } = await parseOutTokens(env, request);

    const { rows } = await queries.getPairEvents({
      ...pair,
      limit: 100,
    });

    return json(
      {
        data: rows,
      },
      {
        headers: {
          "cache-control": "public, max-age=180, must-revalidate",
        },
      },
    );
  }
}
