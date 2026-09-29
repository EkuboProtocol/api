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
  DecimalStringType,
  NumericStringType,
} from "../../shared/validation/address";
import toHex from "../../shared/toHex";

const MAX_ADDRESS = 1n << 160n;
const MAX_POOL_ID = 1n << 256n;

const PoolKeyType = z.object({
  token0: z.string(),
  token1: z.string(),
  fee: z.string(),
  tick_spacing: z.string().nullable(),
  extension: z.string(),
  stableswap_params: z
    .object({ center_tick: z.number().int(), amplification: z.number().int() })
    .nullable(),
  // The packed bytes32 PoolConfig as emitted on chain; null for legacy
  // v2-core pools whose events carried no packed config.
  config: z.string().nullable(),
});

const PoolStateType = z
  .object({
    sqrt_ratio: DecimalStringType,
    tick: z.number().int(),
    liquidity: DecimalStringType,
  })
  .nullable();

// Every field is always serialized; nullable means present-but-null, never
// omitted, so consumers can rely on the shape.
const PoolKeyListEntryType = z.object({
  pool_id: z.string(),
  pool_key: PoolKeyType,
  state: PoolStateType,
});

const PoolKeysResponseType = z.object({
  pools: z.array(PoolKeyListEntryType),
  next_cursor: z.string().nullable(),
  has_more: z.boolean(),
});

const PoolKeyByIdResponseType = z.object({
  pool_id: z.string(),
  pool_key: PoolKeyType,
  state: PoolStateType,
});

interface PoolKeyRow {
  token0: string;
  token1: string;
  fee: string;
  tick_spacing: number | null;
  extension: string;
  stableswap_center_tick: string | null;
  stableswap_amplification: string | null;
  pool_config: string | null;
}

interface PoolStateRow {
  state_sqrt_ratio: string | null;
  state_tick: number | null;
  state_liquidity: string | null;
}

function formatPoolKey(row: PoolKeyRow): z.infer<typeof PoolKeyType> {
  const stableswap_params =
    row.stableswap_amplification !== null && row.stableswap_center_tick !== null
      ? {
          center_tick: Number(row.stableswap_center_tick),
          amplification: Number(row.stableswap_amplification),
        }
      : null;
  return {
    token0: toHex(row.token0),
    token1: toHex(row.token1),
    fee: toHex(row.fee),
    tick_spacing: row.tick_spacing ? toHex(row.tick_spacing) : null,
    extension: toHex(row.extension),
    stableswap_params,
    config: row.pool_config === null ? null : toHex(row.pool_config, 32),
  };
}

function formatPoolState(row: PoolStateRow): z.infer<typeof PoolStateType> {
  return row.state_sqrt_ratio === null ||
    row.state_tick === null ||
    row.state_liquidity === null
    ? null
    : {
        sqrt_ratio: row.state_sqrt_ratio,
        tick: Number(row.state_tick),
        liquidity: row.state_liquidity,
      };
}

function parseAddressParam(name: string, value: string): bigint {
  const parsed = BigInt(value);
  if (parsed >= MAX_ADDRESS) {
    throw new StatusError(400, `${name} must fit in 20 bytes`);
  }
  return parsed;
}

function parseOptionalAddressParam(
  name: string,
  value: string | undefined,
): bigint | undefined {
  return value === undefined ? undefined : parseAddressParam(name, value);
}

// tokenA alone keeps pools containing it on either side; with tokenB it
// selects the exact pair, sorted into token0 and token1.
function parseTokenFilter(
  tokenAParam: string | undefined,
  tokenBParam: string | undefined,
): { token0?: bigint; token1?: bigint; tokenEither?: bigint } {
  const tokenA = parseOptionalAddressParam("tokenA", tokenAParam);
  const tokenB = parseOptionalAddressParam("tokenB", tokenBParam);
  if (tokenB === undefined) {
    return { tokenEither: tokenA };
  }
  if (tokenA === undefined) {
    throw new StatusError(400, "tokenB requires tokenA");
  }
  if (tokenA === tokenB) {
    throw new StatusError(400, "tokenA and tokenB must differ");
  }
  return tokenA < tokenB
    ? { token0: tokenA, token1: tokenB }
    : { token0: tokenB, token1: tokenA };
}

function parseAfterPoolId(after: string | undefined): bigint | undefined {
  const afterPoolId = after === undefined ? undefined : BigInt(after);
  if (afterPoolId !== undefined && afterPoolId >= MAX_POOL_ID) {
    throw new StatusError(400, "after must fit in 32 bytes");
  }
  return afterPoolId;
}

export const ListPoolKeys = defineRoute(
  createRoute({
    method: "get",
    path: "/poolKeys/{chainId}/{coreAddress}",
    tags: ["Swap"],
    summary: "List pool keys",
    description:
      "Enumerates initialized pool keys for one core deployment in ascending pool_id order with keyset pagination, optionally filtered by one token (either side), an exact pair, or an extension",
    operationId: "get_ListPoolKeys",
    request: {
      params: z.object({
        chainId: ChainIdType,
        coreAddress: AddressType.openapi({ example: "0xabcd" }),
      }),
      query: z.object({
        tokenA: AddressType.optional().describe(
          "Keep only pools containing this token on either side; with tokenB, the exact pair (order-insensitive)",
        ),
        tokenB: AddressType.optional().describe(
          "Second token of an exact pair filter",
        ),
        extension: AddressType.optional().describe(
          "Keep only pools using this extension; 0x0 selects extensionless pools",
        ),
        after: NumericStringType.optional().describe(
          "Return pools whose pool_id is strictly greater; use next_cursor to continue",
        ),
        limit: z.coerce
          .number()
          .int()
          .min(1)
          .max(200)
          .optional()
          .describe("Maximum number of pools to return")
          .default(100),
      }),
    },
    responses: {
      200: jsonResponse(
        "One ascending pool_id-ordered page of pool keys; an unknown chain or core yields an empty page",
        PoolKeysResponseType,
      ),
      ...errorResponses,
    },
  }),
  async (c) => {
    const { chainId, coreAddress } = c.req.valid("param");
    const query = c.req.valid("query");
    const core = parseAddressParam("coreAddress", coreAddress);
    const { token0, token1, tokenEither } = parseTokenFilter(
      query.tokenA,
      query.tokenB,
    );
    const extension = parseOptionalAddressParam("extension", query.extension);
    const afterPoolId = parseAfterPoolId(query.after);
    const { limit } = query;

    const queries = await createQueries(c.env);
    const rows = await queries.listPoolKeys({
      chainId,
      coreAddress: core,
      token0,
      token1,
      tokenEither,
      extension,
      afterPoolId,
      limit: limit + 1,
    });

    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);
    const lastPoolId = page.at(-1)?.pool_id;

    const response = {
      pools: page.map((row) => ({
        pool_id: toHex(row.pool_id, 32),
        pool_key: formatPoolKey(row),
        state: formatPoolState(row),
      })),
      next_cursor: lastPoolId === undefined ? null : toHex(lastPoolId, 32),
      has_more: hasMore,
    } satisfies z.infer<typeof PoolKeysResponseType>;

    return c.json(response, 200, {
      "cache-control": "public, max-age=1800, must-revalidate",
    });
  },
);

export const GetPoolKeyById = defineRoute(
  createRoute({
    method: "get",
    path: "/poolKeys/{chainId}/{coreAddress}/{poolId}",
    tags: ["Swap"],
    summary: "Get pool key by pool id",
    description:
      "Returns the pool key and latest indexed state for the given core address and pool id",
    operationId: "get_GetPoolKeyById",
    request: {
      params: z.object({
        chainId: ChainIdType,
        coreAddress: AddressType.openapi({ example: "0xabcd" }),
        poolId: NumericStringType.openapi({ example: "1" }),
      }),
    },
    responses: {
      200: jsonResponse(
        "Pool key and indexed state for the given pool",
        PoolKeyByIdResponseType,
      ),
      ...notFoundResponse,
      ...errorResponses,
    },
  }),
  async (c) => {
    const { chainId, coreAddress, poolId } = c.req.valid("param");
    const core = parseAddressParam("coreAddress", coreAddress);
    const queries = await createQueries(c.env);

    const rows = await queries.getPoolKeyByCoreAndId(
      chainId,
      core,
      BigInt(poolId),
    );

    if (rows.length !== 1) {
      throw new StatusError(404, "Pool not found");
    }

    const row = rows[0];

    const response = {
      pool_id: toHex(poolId, 32),
      pool_key: formatPoolKey(row),
      state: formatPoolState(row),
    } satisfies z.infer<typeof PoolKeyByIdResponseType>;

    // Shorter than the key-only route because this response carries the
    // indexed pool state, which moves on every swap.
    return c.json(response, 200, {
      "cache-control": "public, max-age=180, must-revalidate",
    });
  },
);
