import { createRoute, z } from "@hono/zod-openapi";
import { jsonResponse } from "../../shared/openapi";
import { defineRoute } from "../../shared/context";
import {
  errorResponses,
  notFoundResponse,
  StatusError,
} from "../../shared/errors";
import { createQueries } from "../../queries";
import {
  AddressType,
  ChainIdType,
  NumericStringType,
} from "../../shared/validation/address";
import toHex from "../../shared/toHex";

const LiquidityPointType = z.object({
  // per_pool_per_tick_liquidity.tick is an INT4, which the driver returns as
  // a number.
  tick: z.number().int(),
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

export const GetPoolLiquidity = defineRoute(
  createRoute({
    method: "get",
    path: "/pools/{chainId}/{coreAddress}/{poolId}/liquidity",
    tags: ["Swap"],
    summary: "Get pool liquidity",
    description:
      "Returns the liquidity delta for each tick for the given pool key hash",
    operationId: "get_GetPoolLiquidity",
    request: {
      params: z.object({
        chainId: ChainIdType,
        coreAddress: AddressType.openapi({ example: "0xabcd" }),
        poolId: NumericStringType.openapi({ example: "1" }),
      }),
    },
    responses: {
      200: jsonResponse(
        "The current liquidity chart for the given pool key hash",
        LiquidityResponseType,
      ),
      ...errorResponses,
    },
  }),
  async (c) => {
    const { chainId, coreAddress, poolId } = c.req.valid("param");
    const queries = await createQueries(c.env);

    const rows = await queries.getPoolLiquidityGraph(chainId, {
      coreAddress: BigInt(coreAddress),
      poolId: BigInt(poolId),
    });

    const response = {
      // queries.ts declares tick as a string, but the driver already returns
      // the INT4 as a number, so Number() leaves the value unchanged.
      data: rows.map(({ tick, net_liquidity_delta_diff }) => ({
        tick: Number(tick),
        net_liquidity_delta_diff,
      })),
    } satisfies z.infer<typeof LiquidityResponseType>;

    return c.json(response, 200, {
      "cache-control": "public, max-age=1800, must-revalidate",
    });
  },
);

export const GetPoolKey = defineRoute(
  createRoute({
    method: "get",
    path: "/pools/{chainId}/{coreAddress}/{poolId}/key",
    tags: ["Swap"],
    summary: "Get pool key",
    description:
      "Returns the pool key details for the given core address and pool id",
    operationId: "get_GetPoolKey",
    request: {
      params: z.object({
        chainId: ChainIdType,
        coreAddress: AddressType.openapi({ example: "0xabcd" }),
        poolId: NumericStringType.openapi({ example: "1" }),
      }),
    },
    responses: {
      200: jsonResponse(
        "Pool key details for the given pool",
        PoolKeyResponseType,
      ),
      ...notFoundResponse,
      ...errorResponses,
    },
  }),
  async (c) => {
    const { chainId, coreAddress, poolId } = c.req.valid("param");
    const queries = await createQueries(c.env);

    const rows = await queries.getPoolKeyByCoreAndId(
      chainId,
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

    return c.json(response, 200, {
      "cache-control": "public, max-age=1800, must-revalidate",
    });
  },
);
