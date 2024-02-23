import {
  OpenAPIRoute,
  OpenAPIRouteSchema,
  Path,
} from "@cloudflare/itty-router-openapi";
import { error, IRequest, json } from "itty-router";
import { EkuboAPIRoute, RequestContext } from "../../shared/context";
import { num } from "starknet";
import { createQueries } from "../../queries";
import { NumericType } from "../../shared/validation/address";
import { getAllTokens, getTokenByAddress } from "../meta/tokens";
import Decimal from "decimal.js-light";

export class GetPoolStates extends OpenAPIRoute {
  static route = "/pools";

  static schema: OpenAPIRouteSchema = {
    tags: ["Swap"],
    summary: "Get pool states",
    description:
      "Returns the current state of all the Ekubo pools, including current liquidity and price",
    parameters: {},
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

export class GetPoolKeyHash extends OpenAPIRoute {
  static route = "/pools/:keyHash";

  static schema: OpenAPIRouteSchema = {
    tags: ["Swap", "Meta"],
    summary: "Get pool info",
    description:
      "Returns the information associated with the given pool key hash",
    parameters: {
      keyHash: Path(NumericType, { example: "0xabcd" }),
    },
    responses: {
      "200": {
        description: "The description of the pool key",
        contentType: "application/json",
      },
    },
  };
  async handle({ params: { keyHash } }: IRequest, { env }: RequestContext) {
    const poolKeyHash = BigInt(keyHash);

    const queries = await createQueries(env);
    const poolKey = await queries.getPoolKey(poolKeyHash);

    const tokens = await getAllTokens(env, queries);
    const [token0, token1] = [
      getTokenByAddress(tokens, poolKey.token0),
      getTokenByAddress(tokens, poolKey.token1),
    ];

    return json(
      {
        pool_key: {
          token0: num.toHex(BigInt(poolKey.token0)),
          token1: num.toHex(BigInt(poolKey.token1)),
          fee: num.toHex(BigInt(poolKey.fee)),
          tick_spacing: poolKey.tick_spacing,
          extension: num.toHex(BigInt(poolKey.extension)),
        },
        human_readable: {
          token0,
          token1,
          fee: `${new Decimal(poolKey.fee)
            .div(new Decimal(2).pow(128))
            .mul(100)
            .toSignificantDigits(6)
            .toString()}%`,
          tick_spacing: `${new Decimal("1.000001")
            .pow(new Decimal(poolKey.tick_spacing))
            .sub(1)
            .mul(100)
            .toSignificantDigits(6)
            .toString()}%`,
        },
      },
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
      keyHash: Path(NumericType, { example: "0xabcd" }),
    },
    responses: {
      "200": {
        description: "The current liquidity chart for the given pool key hash",
        contentType: "application/json",
      },
    },
  };

  async handle({ params: { keyHash } }: IRequest, { env }: RequestContext) {
    const poolKeyHash = BigInt(keyHash);

    const queries = await createQueries(env);

    const { rows } = await queries.withinTransaction(() =>
      queries.getPoolLiquidityGraph(poolKeyHash)
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
