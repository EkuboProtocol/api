import {
  OpenAPIRouteSchema,
  Path,
  Query,
} from "@cloudflare/itty-router-openapi";
import { IRequest, json, StatusError } from "itty-router";
import { z } from "zod";
import { Env } from "../../env";
import { EkuboAPIRoute, RequestContext } from "../../shared/context";
import {
  AddressType,
  NumericStringType,
} from "../../shared/validation/address";
import { createQueries, Queries, RawErc20TokenRow } from "../../queries";
import toHex from "../../shared/toHex";

const ADDRESS_REGEX = /^0x[a-fA-F0-9]+$/;
const DECIMAL_REGEX = /^\d+(?:e\d+)?$/i;

export const TokenType = z
  .object({
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
    token_address: z.string({
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
  })
  .required({
    token_address: true,
    name: true,
    symbol: true,
    decimals: true,
    visibility_priority: true,
    sort_order: true,
    total_supply: true,
  });

export type TokenInfo = z.infer<typeof TokenType>;

function buildTokenInfo(row: RawErc20TokenRow): TokenInfo {
  const decimals = Number(row.token_decimals);

  const token: TokenInfo = {
    name: row.token_name,
    symbol: row.token_symbol,
    decimals,
    token_address: toHex(BigInt(row.token_address), 20),
    sort_order: row.sort_order,
    visibility_priority: row.visibility_priority,
    logo_url: row.logo_url,
    total_supply:
      row.total_supply !== null
        ? Number(row.total_supply) / Math.pow(10, decimals)
        : null,
  };

  return token;
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

export async function getTokenByUserSpecifiedIdentifier(
  queries: Queries,
  chainId: bigint,
  identifier: string,
): Promise<TokenInfo | null> {
  const trimmed = identifier.trim();

  if (ADDRESS_REGEX.test(trimmed) || DECIMAL_REGEX.test(trimmed)) {
    return getTokenByAddress(queries, chainId, trimmed);
  }

  const row = await queries.getErc20TokenByIdentifier({
    chainId,
    identifier: trimmed,
  });

  return row ? buildTokenInfo(row) : null;
}

export class ListTokens extends EkuboAPIRoute {
  static route = "/tokens/:chainId";
  static schema: OpenAPIRouteSchema = {
    tags: ["Meta"],
    summary: "List tokens",
    description: "Get a list of tokens for the given chain ID",
    parameters: {
      chainId: Path(
        z.coerce.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
        { required: true },
      ),
      pageSize: Query(z.coerce.number().int().min(1).max(10_000), {
        default: 1000,
      }),
      afterToken: Query(AddressType, { required: false }),
      minVisibilityPriority: Query(z.coerce.number().max(100).min(0).int(), {
        required: false,
      }),
    },
    responses: {
      "200": {
        description: "List of tokens",
        schema: z.array(TokenType).openapi({ description: "Array of tokens" }),
        contentType: "application/json",
      },
    },
  };

  async handle(request: IRequest, { env }: RequestContext) {
    const queries = await createQueries(env);
    const chainId = BigInt(request.params.chainId);
    const minVisibilityPriority = Number(
      request.query.minVisibilityPriority ?? 0,
    );
    const pageSize = Number(request.query.pageSize ?? 1000);
    const afterToken =
      typeof request.query.afterToken === "string"
        ? BigInt(request.query.afterToken)
        : null;

    const rows = await queries.listErc20Tokens({
      chainId,
      minVisibilityPriority,
      pageSize,
      afterToken,
    });

    const tokens = rows.map(buildTokenInfo);

    return json(tokens, {
      headers: {
        "cache-control": `public, max-age=600`,
      },
    });
  }
}
