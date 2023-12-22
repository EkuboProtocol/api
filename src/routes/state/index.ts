import { OpenAPIRoute } from "@cloudflare/itty-router-openapi";
import { error, IRequest, json } from "itty-router";
import { EkuboAPIRoute, RequestContext } from "../_shared/context";
import { num } from "starknet";
import { Queries } from "../../queries";

export class GetPoolStates extends OpenAPIRoute {
  async handle(_: IRequest, { env, client }: RequestContext) {
    const queries = new Queries(client);

    const { rows } = await queries.withinTransaction(() =>
      queries.getAllPoolsWithStates()
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
  async handle({ params: { key_hash } }: IRequest, { client }: RequestContext) {
    let pool_key_hash: bigint;
    try {
      pool_key_hash = BigInt(key_hash);
    } catch (e) {
      return error(400, "Invalid pool key hash");
    }

    const queries = new Queries(client);

    const { rows } = await queries.withinTransaction(() =>
      queries.getPoolLiquidityGraph(pool_key_hash)
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
