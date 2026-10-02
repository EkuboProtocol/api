import { createRoute, z } from "@hono/zod-openapi";
import { defineRoute } from "../../shared/context";
import {
  errorResponses,
  notFoundResponse,
  StatusError,
} from "../../shared/errors";
import { jsonResponse, queryArray } from "../../shared/openapi";
import {
  AddressType,
  ChainIdType,
  DecimalStringType,
  HexStringType,
  ChainIdStringType,
  NumericStringType,
} from "../../shared/validation/address";
import { createQueries, type PositionEventRow } from "../../queries";
import toHex from "../../shared/toHex";
import { NFTMetadataSchema, TokenIdType } from "./format";
import { generatePositionNft } from "./generatePositionNft";
import { generatePositionNftMetadata } from "../../shared/metadatas/positions";

const PositionEventsTimestampType = z.union([z.date(), z.string()]);

const PositionTransferEventType = z.object({
  type: z.literal("transfer"),
  block_number: z.string(),
  transaction_hash: HexStringType,
  timestamp: PositionEventsTimestampType,
  from_address: HexStringType,
  to_address: HexStringType,
});

const PositionUpdateEventType = z.object({
  type: z.literal("update"),
  block_number: z.string(),
  transaction_hash: HexStringType,
  timestamp: PositionEventsTimestampType,
  liquidity_delta: z.string(),
  delta0: z.string(),
  delta1: z.string(),
});

const PositionCollectFeesEventType = z.object({
  type: z.literal("collect_fees"),
  block_number: z.string(),
  transaction_hash: HexStringType,
  timestamp: PositionEventsTimestampType,
  delta0: z.string(),
  delta1: z.string(),
});

const PositionClaimRewardsEventType = z.object({
  type: z.literal("claim_rewards"),
  block_number: z.string(),
  transaction_hash: HexStringType,
  timestamp: PositionEventsTimestampType,
  reward_amount: z.string(),
});

const PositionEventType = z.union([
  PositionTransferEventType,
  PositionUpdateEventType,
  PositionCollectFeesEventType,
  PositionClaimRewardsEventType,
]);

const PositionEventsResponseType = z.object({
  chain_id: NumericStringType,
  events: z.array(PositionEventType),
});

const SignedDecimalStringType = z.string().regex(/^-?\d+$/);

const GlobalPositionEventBaseShape = {
  event_id: SignedDecimalStringType.describe(
    "Signed event cursor encoding block, transaction, and event order",
  ),
  block_number: z.string(),
  transaction_index: z.number().int().nonnegative(),
  event_index: z.number().int().nonnegative(),
  transaction_hash: HexStringType,
  timestamp: PositionEventsTimestampType,
  position_id: HexStringType.describe(
    "Stable core position identifier shared by NFT and pool events",
  ),
  nft_address: HexStringType,
  positions_address: HexStringType,
};

const GlobalPositionLifecycleEventType = z.object({
  ...GlobalPositionEventBaseShape,
  type: z.enum(["mint", "transfer", "burn"]),
  token_id: HexStringType.describe("Position NFT token ID"),
  from_address: HexStringType,
  to_address: HexStringType,
});

const GlobalPositionEventPoolKeyType = z.object({
  core_address: HexStringType,
  pool_id: HexStringType,
  token0: HexStringType,
  token1: HexStringType,
  fee: HexStringType,
  fee_denominator: HexStringType,
  tick_spacing: HexStringType.nullable(),
  extension: HexStringType,
  stableswap_params: z
    .object({ center_tick: z.number(), amplification: z.number() })
    .nullable(),
});

const GlobalPositionUpdateEventType = z.object({
  ...GlobalPositionEventBaseShape,
  type: z.literal("update"),
  pool_key: GlobalPositionEventPoolKeyType,
  bounds: z.object({ lower: z.number(), upper: z.number() }),
  liquidity_delta: z.string(),
  delta0: z.string(),
  delta1: z.string(),
});

const GlobalPositionCollectFeesEventType = z.object({
  ...GlobalPositionEventBaseShape,
  type: z.literal("collect_fees"),
  pool_key: GlobalPositionEventPoolKeyType,
  bounds: z.object({ lower: z.number(), upper: z.number() }),
  delta0: z.string(),
  delta1: z.string(),
});

const GlobalPositionEventType = z.union([
  GlobalPositionLifecycleEventType,
  GlobalPositionUpdateEventType,
  GlobalPositionCollectFeesEventType,
]);

const GlobalPositionEventsResponseType = z.object({
  chain_id: NumericStringType,
  events: z.array(GlobalPositionEventType),
  next_cursor: SignedDecimalStringType.nullable(),
  has_more: z.boolean(),
});

const MAX_POSITION_EVENT_BLOCK = (1n << 32n) - 1n;
const MIN_EVENT_ID = -(1n << 63n);
const MAX_EVENT_ID = (1n << 63n) - 1n;
const EVENT_ID_OFFSET = MIN_EVENT_ID + 1n;
const EVENTS_PER_BLOCK = 1n << 32n;

const PositionEventBlockNumberType = z.coerce
  .bigint()
  .min(0n)
  .max(MAX_POSITION_EVENT_BLOCK)
  .openapi({
    type: "integer",
    format: "int64",
    minimum: 0,
    maximum: Number(MAX_POSITION_EVENT_BLOCK),
  });

const PositionEventCursorType = z.coerce
  .bigint()
  .min(MIN_EVENT_ID)
  .max(MAX_EVENT_ID)
  .openapi({
    type: "integer",
    format: "int64",
  });

export function getPositionEventIdRange({
  cursor,
  fromBlock,
  toBlock,
}: {
  cursor: bigint | null;
  fromBlock: bigint | null;
  toBlock: bigint | null;
}) {
  const fromBlockMinimum =
    fromBlock === null
      ? MIN_EVENT_ID
      : EVENT_ID_OFFSET + fromBlock * EVENTS_PER_BLOCK - 1n;
  const minEventIdExclusive =
    cursor === null || fromBlockMinimum > cursor ? fromBlockMinimum : cursor;
  const requestedMaximum =
    toBlock === null
      ? MAX_EVENT_ID
      : EVENT_ID_OFFSET + toBlock * EVENTS_PER_BLOCK + EVENTS_PER_BLOCK - 1n;
  const maxEventIdInclusive =
    requestedMaximum > MAX_EVENT_ID ? MAX_EVENT_ID : requestedMaximum;

  return { minEventIdExclusive, maxEventIdInclusive };
}

function assertBlockRange(fromBlock: bigint | null, toBlock: bigint | null) {
  if (fromBlock !== null && toBlock !== null && fromBlock > toBlock) {
    throw new StatusError(
      400,
      "fromBlock must be less than or equal to toBlock",
    );
  }
}

const PoolKeySummaryType = z.object({
  token0: HexStringType,
  token1: HexStringType,
  fee: HexStringType,
  tick_spacing: HexStringType.nullable(),
  extension: HexStringType,
  stableswap_params: z
    .object({ center_tick: z.number(), amplification: z.number() })
    .nullable(),
});

const PoolStateSummaryType = z.object({
  sqrt_ratio: DecimalStringType,
  tick: z.number().int(),
  liquidity: DecimalStringType,
  fee: HexStringType,
});

const PositionRewardsSummaryType = z.object({
  amount: DecimalStringType,
  pending: DecimalStringType,
});

const PositionSummaryType = z.object({
  id: HexStringType,
  chain_id: HexStringType,
  positions_address: HexStringType,
  owner: HexStringType.nullable(),
  pool_key: PoolKeySummaryType,
  bounds: z.object({
    lower: z.number(),
    upper: z.number(),
  }),
  metadata_url: z.string(),
  image: z.string(),
  liquidity: DecimalStringType,
  pool_state: PoolStateSummaryType.nullable(),
  rewards: z.record(z.string(), PositionRewardsSummaryType),
});

const PaginationMetadataType = z.object({
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1),
  totalPages: z.number().int().min(0),
  totalItems: z.number().int().min(0),
});

const ListPositionsResponseType = z.object({
  data: z.array(PositionSummaryType),
  pagination: PaginationMetadataType,
});

const PositionStateQueryType = z.enum(["opened", "closed"]);
const AddressListRequestSchema = z.object({
  addresses: z.array(AddressType).min(1).max(50),
});

const ListPositionsFilterShape = {
  state: PositionStateQueryType.optional().describe(
    "Filter positions by state; defaults to returning all positions",
  ),
  chainId: ChainIdType.optional().describe(
    "Restrict results to a specific chain ID",
  ),
  pageSize: z.coerce
    .number()
    .int()
    .min(1)
    .max(200)
    .optional()
    .describe("Maximum number of positions to return per page")
    .default(50),
  page: z.coerce
    .number()
    .int()
    .min(1)
    .optional()
    .describe("Page number to fetch (1-indexed)")
    .default(1),
};

function buildListPositionsResponse(
  rows: Awaited<
    ReturnType<
      Awaited<ReturnType<typeof createQueries>>["getPositionsByAddress"]
    >
  >["rows"],
  totalCount: number,
  page: number,
  pageSize: number,
  origin: string,
) {
  const totalPages = totalCount === 0 ? 0 : Math.ceil(totalCount / pageSize);

  return {
    data: rows.map((row) => {
      const stableswap_params =
        row.stableswap_amplification !== null &&
        row.stableswap_center_tick !== null
          ? {
              center_tick: Number(row.stableswap_center_tick),
              amplification: Number(row.stableswap_amplification),
            }
          : null;

      return {
        id: toHex(BigInt(row.token_id)),
        chain_id: toHex(row.chain_id),
        positions_address: toHex(row.positions_address),
        owner: row.owner ? toHex(row.owner) : null,
        pool_key: {
          token0: toHex(row.token0),
          token1: toHex(row.token1),
          fee: toHex(row.fee),
          tick_spacing: row.tick_spacing ? toHex(row.tick_spacing) : null,
          extension: toHex(row.extension),
          stableswap_params,
        },
        bounds: {
          lower: Number(row.lower_bound),
          upper: Number(row.upper_bound),
        },
        metadata_url: `${origin}/positions/${row.chain_id}/${row.nft_address}/${row.token_id}`,
        image: `${origin}/positions/${row.chain_id}/${row.nft_address}/${row.token_id}/image.svg`,
        liquidity: row.liquidity,
        pool_state: {
          sqrt_ratio: row.pool_state_sqrt_ratio,
          tick: Number(row.pool_state_tick),
          liquidity: row.pool_state_liquidity,
          fee: toHex(row.pool_state_fee),
        },
        rewards: row.rewards ?? {},
      };
    }),
    pagination: {
      page,
      pageSize,
      totalPages,
      totalItems: totalCount,
    },
  } satisfies z.infer<typeof ListPositionsResponseType>;
}

function formatGlobalPositionEvent(
  row: PositionEventRow,
): z.infer<typeof GlobalPositionEventType> {
  const base = {
    event_id: row.event_id.toString(),
    block_number: row.block_number.toString(),
    transaction_index: row.transaction_index,
    event_index: row.event_index,
    transaction_hash: toHex(row.transaction_hash),
    timestamp: row.timestamp,
    position_id: toHex(row.position_id),
    nft_address: toHex(row.nft_address),
    positions_address: toHex(row.positions_address),
  };

  if (row.type === 0 || row.type === 1 || row.type === 2) {
    return {
      ...base,
      type: row.type === 0 ? "mint" : row.type === 1 ? "transfer" : "burn",
      token_id: toHex(row.token_id),
      from_address: toHex(row.from_address),
      to_address: toHex(row.to_address),
    };
  }

  const pool_key = {
    core_address: toHex(row.core_address),
    pool_id: toHex(row.pool_id),
    token0: toHex(row.token0),
    token1: toHex(row.token1),
    fee: toHex(row.fee),
    fee_denominator: toHex(row.fee_denominator),
    tick_spacing: row.tick_spacing === null ? null : toHex(row.tick_spacing),
    extension: toHex(row.pool_extension),
    stableswap_params:
      row.stableswap_center_tick === null ||
      row.stableswap_amplification === null
        ? null
        : {
            center_tick: row.stableswap_center_tick,
            amplification: row.stableswap_amplification,
          },
  };
  const bounds = { lower: row.lower_bound, upper: row.upper_bound };

  return row.type === 3
    ? {
        ...base,
        type: "update",
        pool_key,
        bounds,
        liquidity_delta: row.liquidity_delta,
        delta0: row.delta0,
        delta1: row.delta1,
      }
    : {
        ...base,
        type: "collect_fees",
        pool_key,
        bounds,
        delta0: row.delta0,
        delta1: row.delta1,
      };
}

export const GetPositionNftMetadata = defineRoute(
  createRoute({
    method: "get",
    path: "/positions/{chainId}/{nftAddress}/{id}",
    tags: ["Positions"],
    summary: "Get NFT Metadata",
    description: "Returns the ERC721 metadata for the given position token ID",
    operationId: "get_GetPositionNftMetadata",
    request: {
      params: z.object({
        chainId: ChainIdStringType.describe(
          "Chain ID for which to generate metadata",
        ),
        nftAddress: AddressType.describe(
          "The address of the Positions NFT contract",
        ),
        id: TokenIdType,
      }),
    },
    responses: {
      200: jsonResponse(
        "The NFT metadata for the given position ID",
        NFTMetadataSchema,
      ),
      ...notFoundResponse,
      ...errorResponses,
    },
  }),
  async (c) => {
    const {
      id: idStr,
      chainId: chainIdParam,
      nftAddress,
    } = c.req.valid("param");
    const id = BigInt(idStr);

    const chainId = BigInt(chainIdParam);
    const chainIdString = chainId.toString();

    const queries = await createQueries(c.env);

    const positionMetadata = await queries.getPositionMetadata(
      chainId,
      BigInt(nftAddress),
      id,
    );

    if (positionMetadata === null) {
      throw new StatusError(404, `Token ID ${id} not found`);
    }

    const origin = new URL(c.req.url).origin;
    const image = `${origin}/positions/${chainIdString}/${nftAddress}/${id}/image.svg`;

    const metadata = await generatePositionNftMetadata(
      positionMetadata,
      id,
      queries,
      chainId,
      image,
    );

    const response = metadata satisfies z.infer<typeof NFTMetadataSchema>;

    return c.json(response, 200, {
      "cache-control": "public,max-age=3600,immutable",
    });
  },
);

export const ListPositionNftEvents = defineRoute(
  createRoute({
    method: "get",
    path: "/positions/{chainId}/{lockerAddress}/{id}/history",
    tags: ["Positions"],
    summary: "List position history",
    description: "Returns the entire history of the given position ID",
    operationId: "get_ListPositionNftEvents",
    request: {
      params: z.object({
        chainId: ChainIdStringType.describe(
          "Chain ID for which to list events",
        ),
        lockerAddress: AddressType.describe(
          "The address of the Positions contract",
        ),
        id: TokenIdType,
      }),
    },
    responses: {
      200: jsonResponse("The position history", PositionEventsResponseType),
      ...notFoundResponse,
      ...errorResponses,
    },
  }),
  async (c) => {
    const {
      id: idStr,
      chainId: chainIdParam,
      lockerAddress,
    } = c.req.valid("param");
    const id = BigInt(idStr);
    const chainId = BigInt(chainIdParam);

    const queries = await createQueries(c.env);

    const history = await queries.getPositionHistory(
      id,
      BigInt(lockerAddress),
      chainId,
    );

    if (history.length === 0) {
      throw new StatusError(404, "Token ID not found");
    }

    const response = {
      chain_id: chainIdParam,
      events: history.map(
        ({
          transaction_hash,
          block_number,
          timestamp,
          type,
          from_address,
          to_address,
          liquidity_delta,
          delta0,
          delta1,
          reward_amount,
        }) =>
          type === 0
            ? {
                type: "transfer",
                block_number: block_number.toString(),
                transaction_hash: toHex(transaction_hash),
                timestamp,
                from_address: toHex(from_address),
                to_address: toHex(to_address),
              }
            : type === 1
              ? {
                  type: "update",
                  block_number: block_number.toString(),
                  transaction_hash: toHex(transaction_hash),
                  timestamp,
                  liquidity_delta,
                  delta0,
                  delta1,
                }
              : type === 2
                ? {
                    type: "collect_fees",
                    block_number: block_number.toString(),
                    transaction_hash: toHex(transaction_hash),
                    timestamp,
                    delta0,
                    delta1,
                  }
                : {
                    type: "claim_rewards",
                    block_number: block_number.toString(),
                    transaction_hash: toHex(transaction_hash),
                    timestamp,
                    reward_amount,
                  },
      ),
    } satisfies z.infer<typeof PositionEventsResponseType>;

    return c.json(response, 200, {
      "cache-control": "public, max-age=60, must-revalidate",
    });
  },
);

export const ListPositionEvents = defineRoute(
  createRoute({
    method: "get",
    path: "/positions/{chainId}/events",
    tags: ["Positions"],
    summary: "List position events",
    description:
      "Returns position NFT lifecycle, liquidity update, and fee collection events in ascending event order",
    operationId: "get_ListPositionEvents",
    request: {
      params: z.object({
        chainId: ChainIdType.describe("Chain ID for which to list events"),
      }),
      query: z.object({
        fromBlock: PositionEventBlockNumberType.optional().describe(
          "Inclusive first block number",
        ),
        toBlock: PositionEventBlockNumberType.optional().describe(
          "Inclusive last block number",
        ),
        cursor: PositionEventCursorType.optional().describe(
          "Return events strictly after this event_id; use next_cursor to continue",
        ),
        limit: z.coerce
          .number()
          .int()
          .min(1)
          .max(1000)
          .optional()
          .describe("Maximum number of events to return")
          .default(100),
      }),
    },
    responses: {
      200: jsonResponse(
        "A globally ordered page of position events",
        GlobalPositionEventsResponseType,
      ),
      ...errorResponses,
    },
  }),
  async (c) => {
    const { chainId } = c.req.valid("param");
    const {
      cursor = null,
      fromBlock = null,
      toBlock = null,
      limit,
    } = c.req.valid("query");

    assertBlockRange(fromBlock, toBlock);

    const { minEventIdExclusive, maxEventIdInclusive } =
      getPositionEventIdRange({ cursor, fromBlock, toBlock });
    let rows: PositionEventRow[] = [];
    if (minEventIdExclusive < maxEventIdInclusive) {
      const queries = await createQueries(c.env);
      rows = await queries.listPositionEvents({
        chainId,
        minEventIdExclusive,
        maxEventIdInclusive,
        limit: limit + 1,
      });
    }
    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);
    const nextCursor =
      page.at(-1)?.event_id.toString() ?? cursor?.toString() ?? null;

    const response = {
      chain_id: chainId.toString(),
      events: page.map(formatGlobalPositionEvent),
      next_cursor: nextCursor,
      has_more: hasMore,
    } satisfies z.infer<typeof GlobalPositionEventsResponseType>;

    return c.json(response, 200, {
      "cache-control": "no-cache",
    });
  },
);

export const GetPositionNftImage = defineRoute(
  createRoute({
    method: "get",
    path: "/positions/{chainId}/{nftAddress}/{id}/image.svg",
    tags: ["Positions"],
    summary: "Get NFT Image",
    description: "Returns the generated art for the given position NFT ID",
    operationId: "get_GetPositionNftImage",
    request: {
      params: z.object({
        chainId: ChainIdStringType,
        nftAddress: AddressType.describe(
          "The address of the Positions NFT contract",
        ),
        id: TokenIdType,
      }),
    },
    responses: {
      200: {
        description: "The position NFT image",
      },
      ...notFoundResponse,
      ...errorResponses,
    },
  }),
  async (c) => {
    const {
      id: idStr,
      chainId: chainIdParam,
      nftAddress,
    } = c.req.valid("param");
    const id = BigInt(idStr);
    const chainId = BigInt(chainIdParam);

    const queries = await createQueries(c.env);

    const positionMetadata = await queries.getPositionMetadata(
      chainId,
      BigInt(nftAddress),
      id,
    );

    if (positionMetadata === null) {
      throw new StatusError(404, `Token ID ${id} not found`);
    }

    const svgString = await generatePositionNft(
      id,
      chainIdParam,
      queries,
      positionMetadata,
    );

    return c.body(svgString, 200, {
      "content-type": "image/svg+xml",
      "cache-control": "public, max-age=86400, immutable",
    });
  },
);

export const ListPositionsByAddress = defineRoute(
  createRoute({
    method: "get",
    path: "/positions/{address}",
    tags: ["Positions"],
    summary: "List positions",
    description: "Returns the list of position NFTs and their keys",
    operationId: "get_ListPositionsByAddress",
    request: {
      params: z.object({
        address: AddressType.describe(
          "The address for which to list positions",
        ),
      }),
      query: z.object(ListPositionsFilterShape),
    },
    responses: {
      200: jsonResponse(
        "The position NFTs owned by the address and keys",
        ListPositionsResponseType,
      ),
      ...errorResponses,
    },
  }),
  async (c) => {
    const { address: addressStr } = c.req.valid("param");
    const {
      state = null,
      chainId = null,
      page,
      pageSize,
    } = c.req.valid("query");

    const queries = await createQueries(c.env);
    const { rows, totalCount } = await queries.getPositionsByAddress(
      [BigInt(addressStr)],
      state,
      chainId,
      {
        page,
        pageSize,
      },
    );

    const origin = new URL(c.req.url).origin;
    const response = buildListPositionsResponse(
      rows,
      totalCount,
      page,
      pageSize,
      origin,
    );

    return c.json(response, 200, {
      "cache-control": "no-cache",
    });
  },
);

export const BatchListPositionsByAddress = defineRoute(
  createRoute({
    method: "get",
    path: "/positions/batch",
    tags: ["Positions"],
    summary: "Batch list positions",
    description:
      "Returns the list of position NFTs and their keys for multiple addresses",
    operationId: "get_BatchListPositionsByAddress",
    request: {
      query: z.object({
        address: queryArray(AddressType)
          .describe(
            "Repeat the address parameter to merge positions from multiple addresses (e.g. ?address=0x...&address=0x...)",
          )
          .openapi({ example: "0x1234" }),
        ...ListPositionsFilterShape,
      }),
    },
    responses: {
      200: jsonResponse(
        "The position NFTs owned by the provided addresses and keys",
        ListPositionsResponseType,
      ),
      ...errorResponses,
    },
  }),
  async (c) => {
    const {
      address: addresses,
      state = null,
      chainId = null,
      page,
      pageSize,
    } = c.req.valid("query");

    if (addresses.length === 0) {
      throw new StatusError(400, "At least one address parameter is required");
    }

    const payload = AddressListRequestSchema.parse({ addresses });

    const queries = await createQueries(c.env);
    const { rows, totalCount } = await queries.getPositionsByAddress(
      payload.addresses.map((address) => BigInt(address)),
      state,
      chainId,
      {
        page,
        pageSize,
      },
    );

    const origin = new URL(c.req.url).origin;
    const response = buildListPositionsResponse(
      rows,
      totalCount,
      page,
      pageSize,
      origin,
    );

    return c.json(response, 200, {
      "cache-control": "no-cache",
    });
  },
);
