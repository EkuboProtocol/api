import { OpenAPIRouteSchema, Path, Query } from "../../shared/openapi";
import { IRequest, json, StatusError } from "itty-router";
import { EkuboAPIRoute, RequestContext } from "../../shared/context";
import { createQueries } from "../../queries";
import {
  AddressType,
  ChainIdType,
  DecimalStringType,
  NumericStringType,
} from "../../shared/validation/address";
import { z } from "zod";
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

function parseAddressParam(name: string, value: unknown): bigint {
  const parsed = BigInt(AddressType.parse(value));
  if (parsed >= MAX_ADDRESS) {
    throw new StatusError(400, `${name} must fit in 20 bytes`);
  }
  return parsed;
}

export class ListPoolKeys extends EkuboAPIRoute {
  static route = "/poolKeys/:chainId/:coreAddress";

  static schema: OpenAPIRouteSchema = {
    tags: ["Swap"],
    summary: "List pool keys",
    description:
      "Enumerates initialized pool keys for one core deployment in ascending pool_id order with keyset pagination, optionally filtered by one token (either side), an exact pair, or an extension",
    parameters: {
      chainId: Path(ChainIdType, { required: true }),
      coreAddress: Path(AddressType, { example: "0xabcd" }),
      tokenA: Query(AddressType, {
        required: false,
        description:
          "Keep only pools containing this token on either side; with tokenB, the exact pair (order-insensitive)",
      }),
      tokenB: Query(AddressType, {
        required: false,
        description: "Second token of an exact pair filter",
      }),
      extension: Query(AddressType, {
        required: false,
        description:
          "Keep only pools using this extension; 0x0 selects extensionless pools",
      }),
      after: Query(NumericStringType, {
        required: false,
        description:
          "Return pools whose pool_id is strictly greater; use next_cursor to continue",
      }),
      limit: Query(z.coerce.number().int().min(1).max(200), {
        required: false,
        description: "Maximum number of pools to return",
        default: 100,
      }),
    },
    responses: {
      "200": {
        schema: PoolKeysResponseType,
        description:
          "One ascending pool_id-ordered page of pool keys; an unknown chain or core yields an empty page",
      },
    },
  };

  async handleRequest(
    { params: { chainId, coreAddress }, query }: IRequest,
    { env }: RequestContext,
  ) {
    const core = parseAddressParam("coreAddress", coreAddress);
    const tokenA =
      query?.tokenA === undefined
        ? undefined
        : parseAddressParam("tokenA", query.tokenA);
    const tokenB =
      query?.tokenB === undefined
        ? undefined
        : parseAddressParam("tokenB", query.tokenB);
    if (tokenA === undefined && tokenB !== undefined) {
      throw new StatusError(400, "tokenB requires tokenA");
    }
    if (tokenA !== undefined && tokenA === tokenB) {
      throw new StatusError(400, "tokenA and tokenB must differ");
    }
    const extension =
      query?.extension === undefined
        ? undefined
        : parseAddressParam("extension", query.extension);
    const afterPoolId =
      query?.after === undefined
        ? undefined
        : BigInt(NumericStringType.parse(query.after));
    if (afterPoolId !== undefined && afterPoolId >= MAX_POOL_ID) {
      throw new StatusError(400, "after must fit in 32 bytes");
    }
    const limit = z.coerce
      .number()
      .int()
      .min(1)
      .max(200)
      .parse(query?.limit ?? 100);

    const [token0, token1] =
      tokenA !== undefined && tokenB !== undefined
        ? tokenA < tokenB
          ? [tokenA, tokenB]
          : [tokenB, tokenA]
        : [undefined, undefined];

    const queries = await createQueries(env);
    const rows = await queries.listPoolKeys({
      chainId: BigInt(chainId),
      coreAddress: core,
      token0,
      token1,
      tokenEither: token0 === undefined ? tokenA : undefined,
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

    return json(response, {
      headers: {
        "cache-control": "public, max-age=1800, must-revalidate",
      },
    });
  }
}

export class GetPoolKeyById extends EkuboAPIRoute {
  static route = "/poolKeys/:chainId/:coreAddress/:poolId";

  static schema: OpenAPIRouteSchema = {
    tags: ["Swap"],
    summary: "Get pool key by pool id",
    description:
      "Returns the pool key and latest indexed state for the given core address and pool id",
    parameters: {
      chainId: Path(ChainIdType, { required: true }),
      coreAddress: Path(AddressType, { example: "0xabcd" }),
      poolId: Path(NumericStringType, { example: "1" }),
    },
    responses: {
      "200": {
        schema: PoolKeyByIdResponseType,
        description: "Pool key and indexed state for the given pool",
      },
    },
  };

  async handleRequest(
    { params: { chainId, coreAddress, poolId } }: IRequest,
    { env }: RequestContext,
  ) {
    const core = parseAddressParam("coreAddress", coreAddress);
    const queries = await createQueries(env);

    const rows = await queries.getPoolKeyByCoreAndId(
      BigInt(chainId),
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
    return json(response, {
      headers: {
        "cache-control": "public, max-age=180, must-revalidate",
      },
    });
  }
}
