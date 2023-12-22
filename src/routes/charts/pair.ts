import { EkuboAPIRoute } from "../_shared/context";
import { error, IRequest, json } from "itty-router";
import { Env } from "../../env";
import { ADDRESS_REGEX } from "../_shared/validation/address";
import { createQueries } from "../../queries";

export class GetPairInfo extends EkuboAPIRoute {
  async handle({ params }: IRequest, env: Env) {
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

    const queries = await createQueries(env);

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
  async handle(
    { params: { tokenA: tokenAStr, tokenB: tokenBStr } }: IRequest,
    env: Env
  ) {
    let tokenA: bigint, tokenB: bigint;
    try {
      tokenA = BigInt(tokenAStr);
      tokenB = BigInt(tokenBStr);
    } catch (e) {
      return error(400, "Invalid tokens");
    }

    const client = await createQueries(env);

    const [token0, token1] =
      tokenA < tokenB ? [tokenA, tokenB] : [tokenB, tokenA];

    if (token0 === 0n) {
      return error(400, "Invalid tokens");
    }

    const { rows } = await client.withinTransaction(() =>
      client.getPairLiquidityGraph({
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
  async handle(
    { params: { tokenA: tokenAStr, tokenB: tokenBStr } }: IRequest,
    env: Env
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

    const client = await createQueries(env);

    const { rows } = await client.getPairEvents({
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
