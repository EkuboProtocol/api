import { OpenAPIRoute } from "@cloudflare/itty-router-openapi";
import { error, IRequest, json } from "itty-router";
import { Env } from "../../env";
import { EkuboAPIRoute } from "../_shared/context";
import { createQueries } from "../../queries";
import { num } from "starknet";

export class GetPoolStates extends OpenAPIRoute {
  async handle(_: IRequest, env: Env) {
    const client = await createQueries(env);

    const { rows } = await client.withinTransaction(() =>
      client.getAllPoolsWithStates()
    );

    return json(
      rows.map((pool) => ({
        key_hash: num.toHex(pool.pool_key_hash),
        token0: num.toHex(pool.token0),
        token1: num.toHex(pool.token1),
        fee: num.toHex(pool.fee),
        tick_spacing: Number(pool.tick_spacing),
        extension: num.toHex(pool.extension),
        sqrt_ratio: num.toHex(pool.sqrt_ratio),
        tick: pool.tick,
        liquidity: pool.liquidity,
        lastUpdate: {
          event_id: pool.last_event_id,
        },
      })),
      {
        headers: {
          "cache-control": "public, max-age=15, must-revalidate",
        },
      }
    );
  }
}

export class GetPoolLiquidity extends EkuboAPIRoute {
  async handle({ params: { key_hash } }: IRequest, env: Env) {
    let pool_key_hash: bigint;
    try {
      pool_key_hash = BigInt(key_hash);
    } catch (e) {
      return error(400, "Invalid pool key hash");
    }

    const client = await createQueries(env);

    const { rows } = await client.withinTransaction(() =>
      client.getPoolLiquidityGraph(pool_key_hash)
    );

    return json(
      {
        data: rows,
      },
      {
        headers: {
          "cache-control": "public, max-age=15, must-revalidate",
        },
      }
    );
  }
}
