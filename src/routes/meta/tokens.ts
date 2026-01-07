import {
  OpenAPIRouteSchema,
  Path,
  Query,
} from "@cloudflare/itty-router-openapi";
import { IRequest, json, StatusError } from "itty-router";
import { z } from "zod";
import { EkuboAPIRoute, RequestContext } from "../../shared/context";
import { ErrorResponseType } from "../../shared/errors";
import { AddressType, ChainIdType } from "../../shared/validation/address";
import { createQueries, Queries, RawErc20TokenRow } from "../../queries";
import toHex from "../../shared/toHex";

export const TokenType = z
  .object({
    chain_id: z.string(),
    name: z
      .string({
        description: "Name of the token",
      })
      .min(1)
      .max(100),
    symbol: z
      .string({
        description: "Symbol for the token",
      })
      .min(1)
      .max(32),
    decimals: z
      .number({
        description:
          "The number of decimals used for display of token balances",
      })
      .min(0)
      .max(78)
      .int(),
    address: z.string({
      description: "The address of the token for the specified chain",
    }),
    visibility_priority: z
      .number({
        description:
          "How much this token should be surfaced relative to other tokens (higher is better)",
      })
      .int(),
    sort_order: z
      .number({
        description:
          "How much the token should prefer to be the numerator when displayed in prices (higher is more numerator-like)",
      })
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
    logo_url: z.optional(z.string().url()),
    usd_price: z.nullable(
      z
        .number({
          description: "The USD price for one unit of the token",
        })
        .gte(0),
    ),
    bridgeInfos: z.nullable(
      z.record(
        z.string({ description: "Destination chain ID" }),
        z.object({
          bridge_address: z.string({
            description: "Token address for the destination chain",
          }),
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
          .string({
            description:
              "Token identifier formatted as chain_id:token_address where chain_id may be decimal or 0x-prefixed hexadecimal",
          })
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

export class ListTokens extends EkuboAPIRoute {
  static route = "/tokens";
  static schema: OpenAPIRouteSchema = {
    tags: ["Meta"],
    summary: "List tokens",
    description: "Get a list of tokens for the given chain ID",
    parameters: {
      chainId: Query(ChainIdType, { required: false }),
      search: Query(
        z.string({ description: "Token symbol search" }).min(1).max(32),
        { required: false },
      ),
      pageSize: Query(z.coerce.number().int().min(1).max(10_000), {
        default: 1000,
      }),
      afterToken: Query(z.string().regex(TOKEN_ID_PARAM_REGEX), {
        description:
          "The :-concatenated chain ID and token address for pagination",
        example: "1:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
        required: false,
      }),
      minVisibilityPriority: Query(z.coerce.number().min(-100).max(100).int(), {
        required: false,
      }),
    },
    responses: {
      "200": {
        description: "List of tokens",
        schema: TokenListResponseType,
      },
    },
  };

  async handle({ query }: IRequest, { env }: RequestContext) {
    const chainId = ChainIdType.optional().parse(query.chainId);
    const minVisibilityPriority = Number(query.minVisibilityPriority ?? 0);
    const pageSize = Number(query.pageSize ?? 1000);
    const [afterTokenChainId, afterTokenAddress] =
      typeof query.afterToken === "string" ? query.afterToken.split(":") : [];

    const afterToken =
      afterTokenChainId && afterTokenAddress
        ? {
            chainId: BigInt(afterTokenChainId),
            address: BigInt(afterTokenAddress),
          }
        : null;

    const search =
      typeof query.search === "string" ? query.search.trim() : undefined;

    const queries = await createQueries(env);
    const rows = await queries.listErc20Tokens({
      chainId,
      minVisibilityPriority,
      pageSize,
      afterToken,
      search: search === "" ? undefined : search,
    });

    const tokens = rows.map(buildTokenInfo);
    const response = tokens satisfies TokenListResponse;

    return json(response, {
      headers: {
        "cache-control": `public, max-age=60`,
      },
    });
  }
}

function getQueryParamAsArray(value: unknown): string[] | undefined {
  if (typeof value === "string") {
    return [value];
  }

  if (Array.isArray(value)) {
    return value.filter((entry): entry is string => typeof entry === "string");
  }

  return undefined;
}

export class BatchGetTokens extends EkuboAPIRoute {
  static route = "/tokens/batch";
  static schema: OpenAPIRouteSchema = {
    tags: ["Meta"],
    summary: "Batch tokens",
    description: "Fetch metadata for a specific set of tokens",
    parameters: {
      id: Query(
        [
          z
            .string({
              description:
                "Token identifier formatted as chain_id:token_address where chain_id may be decimal or 0x-prefixed hexadecimal",
            })
            .regex(TOKEN_ID_PARAM_REGEX, {
              message:
                "Token identifiers must use chain_id:token_address with a decimal or 0x-prefixed chain ID and 0x-prefixed token address",
            }),
        ],
        {
          required: true,
          description:
            "Repeat the id parameter to fetch multiple tokens (e.g. ?id=1:0x...&id=0x1:0x...)",
          example: "1:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
        },
      ),
    },
    responses: {
      "200": {
        description: "Tokens",
        schema: TokenListResponseType,
      },
    },
  };

  async handle({ query }: IRequest, { env }: RequestContext) {
    const ids = getQueryParamAsArray(query.id);

    if (!ids || ids.length === 0) {
      throw new StatusError(400, "At least one id parameter is required");
    }

    const payload = TokenIdListRequestSchema.parse({ ids });

    const tokenIds = payload.ids.map(parseTokenIdParam);
    const queries = await createQueries(env);

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

    return json(response, {
      headers: {
        "cache-control": `public, max-age=60`,
      },
    });
  }
}

export class GetToken extends EkuboAPIRoute {
  static route = "/tokens/:chainId/:tokenAddress";

  static schema: OpenAPIRouteSchema = {
    tags: ["Meta"],
    summary: "Get token",
    description: "Returns metadata for a specific token on the given chain",
    parameters: {
      chainId: Path(ChainIdType, { required: true }),
      tokenAddress: Path(AddressType, { required: true }),
    },
    responses: {
      "200": {
        description: "Token information",
        schema: TokenType,
      },
      "404": {
        description: "Token not found",
        schema: ErrorResponseType,
      },
    },
  };

  async handle(request: IRequest, { env }: RequestContext) {
    const chainId = BigInt(request.params.chainId);
    const tokenAddress = request.params.tokenAddress;
    const queries = await createQueries(env);

    const token = await getTokenByAddress(queries, chainId, tokenAddress);

    if (!token) {
      throw new StatusError(404, "Token not found");
    }

    const response = token satisfies TokenInfo;
    return json(response, {
      headers: {
        "cache-control": "public, max-age=600",
      },
    });
  }
}
