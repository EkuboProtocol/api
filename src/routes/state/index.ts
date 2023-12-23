import {
  OpenAPIRoute,
  OpenAPIRouteSchema,
  Path,
} from "@cloudflare/itty-router-openapi";
import { error, IRequest, json } from "itty-router";
import { EkuboAPIRoute, RequestContext } from "../../shared/context";
import { num } from "starknet";
import { createQueries, Queries } from "../../queries";
import { z } from "zod";
import { HexNumericType } from "../../shared/validation/address";

export class GetPoolStates extends OpenAPIRoute {
  static route = "/pools";

  static schema: OpenAPIRouteSchema = {
    tags: ["Swap"],
    summary: "Get pool states",
    description:
      "Returns the current state of all the Ekubo pools, including current liquidity and price",
    responses: {
      "200": {
        description: "The current state of all the pools",
        contentType: "application/json",
      },
    },
  };

  async handle(_: IRequest, { env }: RequestContext) {
    const queries = await createQueries(env);

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
  static route = "/pools/:keyHash/liquidity";

  static schema: OpenAPIRouteSchema = {
    tags: ["Swap"],
    summary: "Get pool liquidity",
    description:
      "Returns the liquidity delta for each tick for the given pool key hash",
    parameters: {
      keyHash: Path(HexNumericType, { example: "0xabcd" }),
    },
    responses: {
      "200": {
        description: "The current liquidity chart for the given pool key hash",
        contentType: "application/json",
      },
    },
  };

  async handle({ params: { keyHash } }: IRequest, { env }: RequestContext) {
    let pool_key_hash: bigint;
    try {
      pool_key_hash = BigInt(keyHash);
    } catch (e) {
      return error(400, "Invalid pool key hash");
    }

    const queries = await createQueries(env);

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
