import { createRoute, z } from "@hono/zod-openapi";
import { jsonResponse, queryArray } from "../../shared/openapi";
import { defineRoute } from "../../shared/context";
import {
  errorResponses,
  notFoundResponse,
  StatusError,
} from "../../shared/errors";
import {
  AddressType,
  ChainIdType,
  VisibilityPriorityType,
} from "../../shared/validation/address";
import { createQueries, Queries, RawErc20TokenRow } from "../../queries";
import toHex from "../../shared/toHex";

export const TokenType = z
  .object({
    chain_id: z.string(),
    name: z.string().describe("Name of the token").min(1).max(100),
    symbol: z.string().describe("Symbol for the token").min(1).max(32),
    decimals: z
      .number()
      .describe("The number of decimals used for display of token balances")
      .min(0)
      .max(78)
      .int(),
    address: z
      .string()
      .describe("The address of the token for the specified chain"),
    visibility_priority: z
      .number()
      .describe(
        "How much this token should be surfaced relative to other tokens (higher is better)",
      )
      .int(),
    sort_order: z
      .number()
      .describe(
        "How much the token should prefer to be the numerator when displayed in prices (higher is more numerator-like)",
      )
      .int(),
    total_supply: z.nullable(
      z
        .number()
        .openapi({
          description: "The total supply of the token",
        })
        .int()
        .gte(0),
    ),
    logo_url: z.optional(z.url()),
    usd_price: z.nullable(
      z.number().describe("The USD price for one unit of the token").gte(0),
    ),
    bridgeInfos: z.nullable(
      z.record(
        z.string().describe("Destination chain ID"),
        z.object({
          bridge_address: z
            .string()
            .describe("Token address for the destination chain"),
        }),
      ),
    ),
  })
  .required({
    chain_id: true,
    address: true,
    name: true,
    symbol: true,
    decimals: true,
    visibility_priority: true,
    sort_order: true,
    total_supply: true,
    usd_price: true,
    bridgeInfos: true,
  });

export type TokenInfo = z.infer<typeof TokenType>;
const TokenListResponseType = z
  .array(TokenType)
  .openapi({ description: "Array of tokens" });
type TokenListResponse = z.infer<typeof TokenListResponseType>;
// includePrices=false drops usd_price from every row.
const ListTokensResponseType = TokenListResponseType.or(
  z.array(TokenType.omit({ usd_price: true })),
).openapi({ description: "Array of tokens" });

type RawBridgeInfoMap = NonNullable<RawErc20TokenRow["bridge_infos"]>;

function formatBridgeInfos(
  bridgeInfos: RawBridgeInfoMap | null | undefined,
): Record<string, { bridge_address: string }> | null {
  if (!bridgeInfos) {
    return null;
  }

  const result: Record<string, { bridge_address: string }> = {};

  for (const chainId in bridgeInfos) {
    const { bridge_address } = bridgeInfos[chainId];

    result[BigInt(chainId).toString()] = {
      bridge_address: toHex(BigInt(bridge_address), 20),
    };
  }

  return result;
}

function buildTokenInfo(row: RawErc20TokenRow): TokenInfo {
  const decimals = Number(row.token_decimals);

  return {
    chain_id: toHex(row.chain_id),
    name: row.token_name,
    symbol: row.token_symbol,
    decimals,
    address: toHex(BigInt(row.token_address), 20),
    sort_order: row.sort_order,
    visibility_priority: row.visibility_priority,
    logo_url: row.logo_url,
    total_supply:
      row.total_supply !== null
        ? Number(row.total_supply) / Math.pow(10, decimals)
        : null,
    usd_price: row.usd_price !== null ? Number(row.usd_price) : null,
    bridgeInfos: formatBridgeInfos(row.bridge_infos),
  };
}

export async function getTokenByAddress(
  queries: Queries,
  chainId: bigint,
  address: string | bigint,
): Promise<TokenInfo | null> {
  const row = await queries.getErc20TokenByAddress({
    chainId,
    tokenAddress: BigInt(address),
  });

  return row ? buildTokenInfo(row) : null;
}

const ADDRESS_REGEX = /^0x[a-fA-F0-9]+$/;
const DECIMAL_REGEX = /^\d+$/;
const TOKEN_ID_PARAM_REGEX = /^(?:\d+|0x[a-fA-F0-9]+):0x[a-fA-F0-9]+$/;

export async function getTokenByUserSpecifiedIdentifier(
  queries: Queries,
  chainId: bigint,
  identifier: string,
): Promise<TokenInfo | null> {
  const trimmed = identifier.trim();

  if (ADDRESS_REGEX.test(trimmed) || DECIMAL_REGEX.test(trimmed)) {
    return getTokenByAddress(queries, chainId, trimmed);
  }

  return null;
}

type TokenIdFilter = {
  chainId: bigint;
  tokenAddress: bigint;
};

function parseTokenIdParam(value: string): TokenIdFilter {
  const trimmed = value.trim();

  if (!TOKEN_ID_PARAM_REGEX.test(trimmed)) {
    throw new StatusError(400, `Invalid id parameter: "${value}"`);
  }

  const [chainIdPart, tokenAddressPart] = trimmed.split(":");

  let chainId: bigint;
  try {
    chainId = ChainIdType.parse(chainIdPart);
  } catch {
    throw new StatusError(400, `Invalid chain ID in id parameter: "${value}"`);
  }

  let tokenAddress: bigint;
  try {
    tokenAddress = BigInt(tokenAddressPart);
  } catch {
    throw new StatusError(
      400,
      `Invalid token address in id parameter: "${value}"`,
    );
  }

  return { chainId, tokenAddress };
}

function buildTokenIdentifierKey(chainId: bigint, tokenAddress: bigint) {
  return `${chainId.toString()}:${tokenAddress.toString()}`;
}

const TokenIdListRequestSchema = z
  .object({
    ids: z
      .array(
        z
          .string()
          .describe(
            "Token identifier formatted as chain_id:token_address where chain_id may be decimal or 0x-prefixed hexadecimal",
          )
          .regex(TOKEN_ID_PARAM_REGEX, {
            message:
              "Token identifiers must use chain_id:token_address with a decimal or 0x-prefixed chain ID and 0x-prefixed token address",
          }),
      )
      .min(1)
      .max(1000),
  })
  .openapi({
    required: ["ids"],
    description: "Batch token lookup request payload",
    example: {
      ids: [
        "1:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
        "0x1:0xdac17f958d2ee523a2206206994597c13d831ec7",
      ],
    },
  });

const IncludePricesType = z
  .enum(["true", "false"])
  .default("true")
  .transform((value) => value === "true");

// Without prices the list only changes when token metadata does (new listings,
// logos, visibility), so browsers and the edge can hold it far longer than the
// priced list, and a stale copy revalidates to a 304 rather than a new body.
const PRICE_FREE_TOKEN_LIST_CACHE_CONTROL =
  "public, max-age=300, stale-while-revalidate=3600";

function parseAfterToken(afterToken: string | undefined) {
  if (afterToken === undefined) return null;
  const [chainId, address] = afterToken.split(":");
  return chainId && address
    ? { chainId: BigInt(chainId), address: BigInt(address) }
    : null;
}

export const ListTokens = defineRoute(
  createRoute({
    method: "get",
    path: "/tokens",
    tags: ["Meta"],
    summary: "List tokens",
    description: "Get a list of tokens for the given chain ID",
    operationId: "get_ListTokens",
    request: {
      query: z.object({
        chainId: ChainIdType.optional(),
        search: z
          .string()
          .describe("Token symbol search")
          .min(1)
          .max(32)
          .optional(),
        pageSize: z.coerce.number().int().min(1).max(10_000).default(1000),
        afterToken: z
          .string()
          .regex(TOKEN_ID_PARAM_REGEX)
          .optional()
          .describe(
            "The :-concatenated chain ID and token address for pagination",
          )
          .openapi({ example: "1:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48" }),
        minVisibilityPriority: VisibilityPriorityType.default(0),
        includePrices: IncludePricesType.optional().describe(
          "Set to false to omit usd_price from every row. The price-free list only changes when token metadata does, so it is cached for longer; pair it with /tokens/prices to keep prices fresh.",
        ),
      }),
    },
    responses: {
      200: jsonResponse("List of tokens", ListTokensResponseType),
      ...errorResponses,
    },
  }),
  async (c) => {
    const {
      includePrices = true,
      search,
      afterToken,
      ...filters
    } = c.req.valid("query");
    const trimmedSearch = search?.trim();

    const queries = await createQueries(c.env);
    const rows = await queries.listErc20Tokens({
      ...filters,
      afterToken: parseAfterToken(afterToken),
      search: trimmedSearch === "" ? undefined : trimmedSearch,
    });

    if (!includePrices) {
      const response = rows.map((row) => {
        const { usd_price, ...token } = buildTokenInfo(row);
        return token;
      }) satisfies Omit<TokenInfo, "usd_price">[];

      return c.json(response, 200, {
        "cache-control": PRICE_FREE_TOKEN_LIST_CACHE_CONTROL,
      });
    }

    const response = rows.map(buildTokenInfo) satisfies TokenListResponse;

    return c.json(response, 200, {
      "cache-control": `public, max-age=60`,
    });
  },
);

const TokenUsdPricesResponseType = z
  .record(
    z.string().describe("Token address, formatted as in the token list"),
    z.number().describe("The USD price for one unit of the token").gte(0),
  )
  .openapi({
    description: "USD price by token address, for priced tokens only",
    example: {
      "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48": 0.9999,
    },
  });
type TokenUsdPricesResponse = z.infer<typeof TokenUsdPricesResponseType>;

export const ListTokenUsdPrices = defineRoute(
  createRoute({
    method: "get",
    path: "/tokens/prices",
    tags: ["Meta"],
    summary: "List token USD prices",
    description:
      "The usd_price of every priced token on a chain, keyed by address. Poll this instead of the token list when only prices need to stay fresh; tokens without a price are omitted.",
    operationId: "get_ListTokenUsdPrices",
    request: {
      query: z.object({
        chainId: ChainIdType,
        minVisibilityPriority: VisibilityPriorityType.default(0),
      }),
    },
    responses: {
      200: jsonResponse(
        "USD prices by token address",
        TokenUsdPricesResponseType,
      ),
      ...errorResponses,
    },
  }),
  async (c) => {
    const { chainId, minVisibilityPriority } = c.req.valid("query");

    const queries = await createQueries(c.env);
    const rows = await queries.listErc20TokenUsdPrices({
      chainId,
      minVisibilityPriority,
    });

    const response: TokenUsdPricesResponse = {};
    for (const row of rows) {
      response[toHex(BigInt(row.token_address), 20)] = Number(row.usd_price);
    }

    return c.json(response, 200, {
      "cache-control": "public, max-age=30",
    });
  },
);

export const BatchGetTokens = defineRoute(
  createRoute({
    method: "get",
    path: "/tokens/batch",
    tags: ["Meta"],
    summary: "Batch tokens",
    description: "Fetch metadata for a specific set of tokens",
    operationId: "get_BatchGetTokens",
    request: {
      query: z.object({
        id: queryArray(
          z
            .string()
            .describe(
              "Token identifier formatted as chain_id:token_address where chain_id may be decimal or 0x-prefixed hexadecimal",
            )
            .regex(TOKEN_ID_PARAM_REGEX, {
              message:
                "Token identifiers must use chain_id:token_address with a decimal or 0x-prefixed chain ID and 0x-prefixed token address",
            }),
        )
          .describe(
            "Repeat the id parameter to fetch multiple tokens (e.g. ?id=1:0x...&id=0x1:0x...)",
          )
          .openapi({ example: "1:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48" }),
      }),
    },
    responses: {
      200: jsonResponse("Tokens", TokenListResponseType),
      ...errorResponses,
    },
  }),
  async (c) => {
    const { id: ids } = c.req.valid("query");

    if (ids.length === 0) {
      throw new StatusError(400, "At least one id parameter is required");
    }

    const payload = TokenIdListRequestSchema.parse({ ids });

    const tokenIds = payload.ids.map(parseTokenIdParam);
    const queries = await createQueries(c.env);

    const uniqueTokenIds = Array.from(
      new Map(
        tokenIds.map((tokenId) => [
          buildTokenIdentifierKey(tokenId.chainId, tokenId.tokenAddress),
          tokenId,
        ]),
      ).values(),
    );

    const rows = await queries.getErc20TokensByIds(uniqueTokenIds);
    const tokensByKey = new Map(
      rows.map((row) => [
        buildTokenIdentifierKey(row.chain_id, BigInt(row.token_address)),
        buildTokenInfo(row),
      ]),
    );

    const tokens = tokenIds
      .map((tokenId) =>
        tokensByKey.get(
          buildTokenIdentifierKey(tokenId.chainId, tokenId.tokenAddress),
        ),
      )
      .filter((token): token is TokenInfo => token !== undefined);

    const response = tokens satisfies TokenListResponse;

    return c.json(response, 200, {
      "cache-control": `public, max-age=60`,
    });
  },
);

export const GetToken = defineRoute(
  createRoute({
    method: "get",
    path: "/tokens/{chainId}/{tokenAddress}",
    tags: ["Meta"],
    summary: "Get token",
    description: "Returns metadata for a specific token on the given chain",
    operationId: "get_GetToken",
    request: {
      params: z.object({
        chainId: ChainIdType,
        tokenAddress: AddressType,
      }),
    },
    responses: {
      200: jsonResponse("Token information", TokenType),
      ...notFoundResponse,
      ...errorResponses,
    },
  }),
  async (c) => {
    const { chainId, tokenAddress } = c.req.valid("param");
    const queries = await createQueries(c.env);

    const token = await getTokenByAddress(queries, chainId, tokenAddress);

    if (!token) {
      throw new StatusError(404, "Token not found");
    }

    const response = token satisfies TokenInfo;
    return c.json(response, 200, {
      "cache-control": "public, max-age=600",
    });
  },
);
