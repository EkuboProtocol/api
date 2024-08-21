import { EkuboAPIRoute, RequestContext } from "../../shared/context";
import { IRequest, json } from "itty-router";
import { TokenIdentifierType } from "../../shared/validation/address";
import { OpenAPIRouteSchema, Path } from "@cloudflare/itty-router-openapi";
import { parseOutTokens } from "../../shared/parseOutTokens";

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
    const { queries, pair } = await parseOutTokens(env, request.params);

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
    const { queries, pair } = await parseOutTokens(env, request.params);

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
    const { queries, pair } = await parseOutTokens(env, request.params);

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
    const { queries, pair } = await parseOutTokens(env, request.params);

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
    const { queries, pair } = await parseOutTokens(env, request.params);

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
    const { queries, pair } = await parseOutTokens(env, request.params);

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
