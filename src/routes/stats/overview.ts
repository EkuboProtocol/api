import { IRequest, json } from "itty-router";
import { EkuboAPIRoute, RequestContext } from "../../shared/context";
import { createQueries } from "../../queries";
import { OpenAPIRouteSchema, Path } from "@cloudflare/itty-router-openapi";
import { ChainIdType } from "../../shared/validation/address";

export class GetOverviewPairs extends EkuboAPIRoute {
  static route = "/overview/:chainId/pairs";
  static schema: OpenAPIRouteSchema = {
    tags: ["Stats"],
    summary: "Get pairs",
    description: "Returns stats for the top pairs",
    parameters: {
      chainId: Path(ChainIdType, { required: true }),
    },
    responses: {
      "200": {
        description: "The stats for the protocols top pairs",
        contentType: "application/json",
      },
    },
  };

  async handle(request: IRequest, { env }: RequestContext) {
    const chainId = BigInt(request.params.chainId);
    const queries = await createQueries(env);

    const { rows: topPairs } = await queries.getTopPairs(chainId);

    return json(
      {
        topPairs,
      },
      {
        headers: {
          "cache-control": "public, max-age=600",
        },
      },
    );
  }
}

export class GetOverviewRevenue extends EkuboAPIRoute {
  static route = "/overview/:chainId/revenue";
  static schema: OpenAPIRouteSchema = {
    tags: ["Stats"],
    summary: "Get revenue",
    description: "Returns the revenue stats for the protocol",
    parameters: {
      chainId: Path(ChainIdType, { required: true }),
    },
    responses: {
      "200": {
        description: "The revenue stats for the protocol",
        contentType: "application/json",
      },
    },
  };

  async handle(request: IRequest, { env }: RequestContext) {
    const timestamp = Date.now();
    const twentyFourHoursAgo = new Date(timestamp - 1000 * 60 * 60 * 24);
    const thirtyDaysAgo = new Date(timestamp - 1000 * 60 * 60 * 24 * 30);

    const chainId = BigInt(request.params.chainId);
    const queries = await createQueries(env);

    const [
      { rows: revenueByToken },
      { rows: revenueByTokenByDate },
      { rows: revenueByToken_24h },
    ] = await Promise.all([
      queries.getRevenueByToken({ chainId }),
      queries.getRevenueByTokenByDate(chainId, thirtyDaysAgo),
      queries.getRevenueByToken({ since: twentyFourHoursAgo, chainId }),
    ]);

    return json(
      {
        revenueByToken,
        revenueByToken_24h,
        revenueByTokenByDate,
      },
      {
        headers: {
          "cache-control": "public, max-age=600",
        },
      },
    );
  }
}

export class GetOverviewVolume extends EkuboAPIRoute {
  static route = "/overview/:chainId/volume";
  static schema: OpenAPIRouteSchema = {
    tags: ["Stats"],
    summary: "Get volume",
    description: "Returns the volume portion of the overview",
    parameters: {
      chainId: Path(ChainIdType, { required: true }),
    },
    responses: {
      "200": {
        description: "The volume stats for the protocol",
        contentType: "application/json",
      },
    },
  };

  async handle(request: IRequest, { env }: RequestContext) {
    const timestamp = Date.now();
    const twentyFourHoursAgo = new Date(timestamp - 1000 * 60 * 60 * 24);
    const thirtyDaysAgo = new Date(timestamp - 1000 * 60 * 60 * 24 * 30);

    const chainId = BigInt(request.params.chainId);
    const queries = await createQueries(env);

    const [
      { rows: volumeByToken },
      { rows: volumeByTokenByDate },
      { rows: volumeByToken_24h },
    ] = await Promise.all([
      queries.getTotalVolumeByToken({ chainId }),
      queries.getVolumeByTokenByDate(chainId, thirtyDaysAgo),
      queries.getTotalVolumeByToken({ since: twentyFourHoursAgo, chainId }),
    ]);

    return json(
      {
        volumeByToken,
        volumeByTokenByDate,
        volumeByToken_24h,
      },
      {
        headers: {
          "cache-control": "public, max-age=600",
        },
      },
    );
  }
}

export class GetOverviewTvl extends EkuboAPIRoute {
  static route = "/overview/:chainId/tvl";
  static schema: OpenAPIRouteSchema = {
    tags: ["Stats"],
    summary: "Get TVL",
    description: "Returns the TVL portion of the overview",
    parameters: {
      chainId: Path(ChainIdType, { required: true }),
    },
    responses: {
      "200": {
        description: "The TVL stats",
        contentType: "application/json",
      },
    },
  };

  async handle(request: IRequest, { env }: RequestContext) {
    const timestamp = Date.now();
    const thirtyDaysAgo = new Date(timestamp - 1000 * 60 * 60 * 24 * 30);

    const chainId = BigInt(request.params.chainId);
    const queries = await createQueries(env);

    const [{ rows: tvlByToken }, { rows: tvlDeltaByTokenByDate }] =
      await Promise.all([
        queries.getTvlByToken(chainId),
        queries.getTvlDeltaByTokenByDate(chainId, thirtyDaysAgo),
      ]);

    return json(
      {
        tvlByToken,
        tvlDeltaByTokenByDate,
      },
      {
        headers: {
          "cache-control": "public, max-age=600",
        },
      },
    );
  }
}
