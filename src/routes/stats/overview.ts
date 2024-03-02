import { IRequest, json } from "itty-router";
import { EkuboAPIRoute, RequestContext } from "../../shared/context";
import { createQueries, Queries } from "../../queries";
import { OpenAPIRouteSchema } from "@cloudflare/itty-router-openapi";

export class GetOverview extends EkuboAPIRoute {
  static route = "/overview";
  static schema: OpenAPIRouteSchema = {
    tags: ["Stats"],
    summary: "Get protocol overview",
    description: "Returns an overview of the high level protocol stats",
    responses: {
      "200": {
        description: "The stats for the protocol overall",
        contentType: "application/json",
      },
    },
  };

  async handle(_: IRequest, { env }: RequestContext) {
    const timestamp = Date.now();
    const twentyFourHoursAgo = new Date(timestamp - 1000 * 60 * 60 * 24);
    const thirtyDaysAgo = new Date(timestamp - 1000 * 60 * 60 * 24 * 30);

    const queries = await createQueries(env);

    const [
      { rows: tvlByToken },
      { rows: volumeByToken },
      { rows: revenueByToken },
      { rows: tvlDeltaByTokenByDate },
      { rows: volumeByTokenByDate },
      { rows: revenueByTokenByDate },
      { rows: volumeByToken_24h },
      { rows: revenueByToken_24h },
      { rows: topPairs },
    ] = await queries.withinTransaction(() =>
      Promise.all([
        queries.getTvlByToken(),
        queries.getTotalVolumeByToken({}),
        queries.getRevenueByToken({}),
        queries.getTvlDeltaByTokenByDate(thirtyDaysAgo),
        queries.getVolumeByTokenByDate(thirtyDaysAgo),
        queries.getRevenueByTokenByDate(thirtyDaysAgo),
        queries.getTotalVolumeByToken({ since: twentyFourHoursAgo }),
        queries.getRevenueByToken({ since: twentyFourHoursAgo }),
        queries.getTopPairs(),
      ]),
    );

    return json(
      {
        timestamp,
        tvlByToken,
        volumeByToken,
        volumeByToken_24h,
        revenueByToken,
        revenueByToken_24h,
        tvlDeltaByTokenByDate,
        volumeByTokenByDate,
        revenueByTokenByDate,
        topPairs,
      },
      {
        headers: {
          "cache-control": "public, max-age=3600",
        },
      },
    );
  }
}
