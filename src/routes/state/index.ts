import { OpenAPIRouteSchema, Path } from "../../shared/openapi";
import { IRequest, json, StatusError } from "itty-router";
import { EkuboAPIRoute, RequestContext } from "../../shared/context";
import { createQueries } from "../../queries";
import {
  AddressType,
  ChainIdType,
  NumericStringType,
} from "../../shared/validation/address";
import { z } from "zod";
import toHex from "../../shared/toHex";

const LiquidityPointType = z.object({
  tick: z.string(),
  net_liquidity_delta_diff: z.string(),
});

const LiquiditySeriesType = z.array(LiquidityPointType);
const LiquidityResponseType = z.object({
  data: LiquiditySeriesType,
});

const PoolKeyType = z.object({
  token0: z.string(),
  token1: z.string(),
  fee: z.string(),
  tick_spacing: z.string().nullable(),
  extension: z.string(),
  stableswap_params: z
    .object({ center_tick: z.number().int(), amplification: z.number().int() })
    .nullable(),
});

const PoolKeyResponseType = z.object({
  pool_key: PoolKeyType,
});

export class GetPoolLiquidity extends EkuboAPIRoute {
  static route = "/pools/:chainId/:coreAddress/:poolId/liquidity";

  static schema: OpenAPIRouteSchema = {
    tags: ["Swap"],
    summary: "Get pool liquidity",
    description:
      "Returns the liquidity delta for each tick for the given pool key hash",
    parameters: {
      chainId: Path(ChainIdType, { required: true }),
      coreAddress: Path(AddressType, { example: "0xabcd" }),
      poolId: Path(NumericStringType, { example: "1" }),
    },
    responses: {
      "200": {
        schema: LiquidityResponseType,
        description: "The current liquidity chart for the given pool key hash",
      },
    },
  };

  async handleRequest(
    { params: { chainId, coreAddress, poolId } }: IRequest,
    { env }: RequestContext,
  ) {
    const queries = await createQueries(env);

    const rows = await queries.getPoolLiquidityGraph(BigInt(chainId), {
      coreAddress: BigInt(coreAddress),
      poolId: BigInt(poolId),
    });

    const response = {
      data: rows,
    } satisfies z.infer<typeof LiquidityResponseType>;

    return json(response, {
      headers: {
        "cache-control": "public, max-age=1800, must-revalidate",
      },
    });
  }
}

export class GetPoolKey extends EkuboAPIRoute {
  static route = "/pools/:chainId/:coreAddress/:poolId/key";

  static schema: OpenAPIRouteSchema = {
    tags: ["Swap"],
    summary: "Get pool key",
    description:
      "Returns the pool key details for the given core address and pool id",
    parameters: {
      chainId: Path(ChainIdType, { required: true }),
      coreAddress: Path(AddressType, { example: "0xabcd" }),
      poolId: Path(NumericStringType, { example: "1" }),
    },
    responses: {
      "200": {
        schema: PoolKeyResponseType,
        description: "Pool key details for the given pool",
      },
    },
  };

  async handleRequest(
    { params: { chainId, coreAddress, poolId } }: IRequest,
    { env }: RequestContext,
  ) {
    const queries = await createQueries(env);

    const rows = await queries.getPoolKeyByCoreAndId(
      BigInt(chainId),
      BigInt(coreAddress),
      BigInt(poolId),
    );

    if (rows.length !== 1) {
      throw new StatusError(404, "Pool not found");
    }

    const row = rows[0];

    const stableswap_params =
      row.stableswap_amplification !== null &&
      row.stableswap_center_tick !== null
        ? {
            center_tick: Number(row.stableswap_center_tick),
            amplification: Number(row.stableswap_amplification),
          }
        : null;

    const response = {
      pool_key: {
        token0: toHex(row.token0),
        token1: toHex(row.token1),
        fee: toHex(row.fee),
        tick_spacing: row.tick_spacing ? toHex(row.tick_spacing) : null,
        extension: toHex(row.extension),
        stableswap_params,
      },
    } satisfies z.infer<typeof PoolKeyResponseType>;

    return json(response, {
      headers: {
        "cache-control": "public, max-age=1800, must-revalidate",
      },
    });
  }
}
