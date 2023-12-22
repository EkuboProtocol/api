import { IRequest, json } from "itty-router";
import { EkuboAPIRoute } from "../_shared/context";
import { Env } from "../../env";

import { createQueries } from "../../queries";

export class GetOverview extends EkuboAPIRoute {
  async handle(_: IRequest, env: Env) {
    const timestamp = Date.now();
    const twentyFourHoursAgo = new Date(timestamp - 1000 * 60 * 60 * 24);
    const thirtyDaysAgo = new Date(timestamp - 1000 * 60 * 60 * 24 * 30);

    const [queries1, queries2] = await Promise.all([
      createQueries(env),
      createQueries(env),
    ]);

    const [
      [
        { rows: tvlByToken },
        { rows: volumeByToken },
        { rows: revenueByToken },
        { rows: tvlDeltaByTokenByDate },
        { rows: volumeByTokenByDate },
        { rows: revenueByTokenByDate },
      ],

      [
        { rows: volumeByToken_24h },
        { rows: revenueByToken_24h },
        { rows: topPairs },
      ],
    ] = await Promise.all([
      queries1.withinTransaction(() =>
        Promise.all([
          queries1.getTvlByToken(),
          queries1.getTotalVolumeByToken({}),
          queries1.getRevenueByToken({}),
          queries1.getTvlDeltaByTokenByDate(thirtyDaysAgo),
          queries1.getVolumeByTokenByDate(thirtyDaysAgo),
          queries1.getRevenueByTokenByDate(thirtyDaysAgo),
        ])
      ),
      queries2.withinTransaction(() =>
        Promise.all([
          queries2.getTotalVolumeByToken({ since: twentyFourHoursAgo }),
          queries2.getRevenueByToken({ since: twentyFourHoursAgo }),
          queries2.getTopPairs(),
        ])
      ),
    ]);

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
          "cache-control":
            "public, max-age=3600, stale-while-revalidate=180, stale-if-error=180",
        },
      }
    );
  }
}
