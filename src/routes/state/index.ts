import { OpenAPIRouteSchema, Path } from "@cloudflare/itty-router-openapi";
import { IRequest, json, StatusError } from "itty-router";
import { EkuboAPIRoute, RequestContext } from "../../shared/context";
import { createQueries } from "../../queries";
import {
  DecimalStringType,
  NumericType,
} from "../../shared/validation/address";
import { getAllTokens, getTokenByAddress } from "../meta/tokens";
import Decimal from "decimal.js-light";
import { z } from "zod";
import toHex from "../../shared/toHex";

export class GetPoolStates extends EkuboAPIRoute {
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
      queries.getAllPoolsWithStates(),
    );

    return json(
      rows.map((pool) => ({
        key_hash: toHex(pool.pool_key_hash),
        token0: toHex(pool.token0),
        token1: toHex(pool.token1),
        fee: toHex(pool.fee),
        tick_spacing: Number(pool.tick_spacing),
        extension: toHex(pool.extension),
        sqrt_ratio: toHex(pool.sqrt_ratio),
        tick: pool.tick,
        liquidity: pool.liquidity,
        lastUpdate: {
          event_id: pool.last_event_id,
        },
      })),
      {
        headers: {
          "cache-control": "public, max-age=180, must-revalidate",
        },
      },
    );
  }
}

export class GetPoolKeyHash extends EkuboAPIRoute {
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

    if (!poolKey) {
      throw new StatusError(404, "Pool key not found");
    }

    const tokens = await getAllTokens(env);
    const [token0, token1] = [
      getTokenByAddress(tokens, poolKey.token0),
      getTokenByAddress(tokens, poolKey.token1),
    ];

    return json(
      {
        pool_key: {
          token0: toHex(BigInt(poolKey.token0)),
          token1: toHex(BigInt(poolKey.token1)),
          fee: toHex(BigInt(poolKey.fee)),
          tick_spacing: poolKey.tick_spacing,
          extension: toHex(BigInt(poolKey.extension)),
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
          "cache-control": "public, immutable, max-age=86400",
        },
      },
    );
  }
}

const LiquidityResponseSchema = z.array(
  z.object({
    tick: DecimalStringType,
    net_liquidity_delta_diff: DecimalStringType,
  }),
);

type LiquidityResponseType = z.infer<typeof LiquidityResponseSchema>;

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
        schema: z.array(z.object({})),
        description: "The current liquidity chart for the given pool key hash",
        contentType: "application/json",
      },
    },
  };

  async handle({ params: { keyHash } }: IRequest, { env }: RequestContext) {
    const poolKeyHash = BigInt(keyHash);

    const queries = await createQueries(env);

    const rows: LiquidityResponseType = (
      await queries.withinTransaction(() =>
        queries.getPoolLiquidityGraph(poolKeyHash),
      )
    ).rows;

    return json(
      {
        data: rows,
      },
      {
        headers: {
          "cache-control": "public, max-age=1800, must-revalidate",
        },
      },
    );
  }
}
