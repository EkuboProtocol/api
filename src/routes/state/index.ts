import { OpenAPIRouteSchema, Path } from "@cloudflare/itty-router-openapi";
import { IRequest, json } from "itty-router";
import { EkuboAPIRoute, RequestContext } from "../../shared/context";
import { createQueries } from "../../queries";
import {
  AddressType,
  DecimalStringType,
  NumericType,
} from "../../shared/validation/address";
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

    const { rows } = await queries.getAllPoolsWithStates();

    return json(
      rows.map((pool) => ({
        core_address: toHex(pool.core_address),
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

const LiquidityResponseSchema = z.array(
  z.object({
    tick: DecimalStringType,
    net_liquidity_delta_diff: DecimalStringType,
  }),
);

type LiquidityResponseType = z.infer<typeof LiquidityResponseSchema>;

export class GetPoolLiquidity extends EkuboAPIRoute {
  static route =
    "/pools/:coreAddress/:token0/:token1/:fee/:tickSpacing/:extension/liquidity";

  static schema: OpenAPIRouteSchema = {
    tags: ["Swap"],
    summary: "Get pool liquidity",
    description:
      "Returns the liquidity delta for each tick for the given pool key hash",
    parameters: {
      coreAddress: Path(AddressType, { example: "0xabcd" }),
      token0: Path(AddressType, {
        example: "0x0000000000000000000000000000000000000000",
      }),
      token1: Path(AddressType, {
        example: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
      }),
      fee: Path(NumericType, {
        example: "1020847100762815390390123822295304634",
      }),
      tickSpacing: Path(NumericType, { example: "5982" }),
      extension: Path(AddressType, { example: "0xabcd" }),
    },
    responses: {
      "200": {
        schema: z.array(z.object({})),
        description: "The current liquidity chart for the given pool key hash",
        contentType: "application/json",
      },
    },
  };

  async handle(
    {
      params: { coreAddress, token0, token1, fee, tickSpacing, extension },
    }: IRequest,
    { env }: RequestContext,
  ) {
    const queries = await createQueries(env);

    const rows: LiquidityResponseType = (
      await queries.getPoolLiquidityGraph({
        coreAddress: BigInt(coreAddress),
        token0: BigInt(token0),
        token1: BigInt(token1),
        fee: BigInt(fee),
        tickSpacing: Number(tickSpacing),
        extension: BigInt(extension),
      })
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
