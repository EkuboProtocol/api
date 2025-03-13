import { OpenAPIRouteSchema, Path } from "@cloudflare/itty-router-openapi";
import { IRequest, json } from "itty-router";
import { EkuboAPIRoute, RequestContext } from "../../shared/context";
import { createQueries } from "../../queries";
import {
  AddressType,
  DecimalStringType,
  NumericStringType,
} from "../../shared/validation/address";
import { z } from "zod";
import toHex from "../../shared/toHex";

export function toPoolConfig({
  fee,
  tickSpacing,
  extension,
}: {
  fee: bigint;
  tickSpacing: number;
  extension: bigint;
}): `0x${string}` {
  return toHex(BigInt(tickSpacing) + (fee << 32n) + (extension << 96n), 32);
}

export class ListPoolKeys extends EkuboAPIRoute {
  static route = "/v1/poolKeys";

  static schema: OpenAPIRouteSchema = {
    tags: ["Meta"],
    summary: "List pool keys",
    description: "Returns all the pool keys that have been initialized",
    parameters: {},
    responses: {
      "200": {
        description:
          "The pool keys of all the pools that have been initialized",
        contentType: "application/json",
      },
    },
  };

  async handle(_: IRequest, { env }: RequestContext) {
    const queries = await createQueries(env);

    const { rows } = await queries.listAllPoolKeys();

    return json(
      rows.map((pool) => ({
        core_address: toHex(pool.core_address, 20),
        token0: toHex(pool.token0, 20),
        token1: toHex(pool.token1, 20),
        fee: toHex(pool.fee),
        tick_spacing: Number(pool.tick_spacing),
        extension: toHex(pool.extension, 20),
        config: toPoolConfig({
          fee: BigInt(pool.fee),
          tickSpacing: Number(pool.tick_spacing),
          extension: BigInt(pool.extension),
        }),
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
      fee: Path(NumericStringType, {
        example: "1020847100762815390390123822295304634",
      }),
      tickSpacing: Path(NumericStringType, { example: "5982" }),
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
