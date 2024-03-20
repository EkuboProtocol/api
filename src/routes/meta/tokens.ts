import { OpenAPIRouteSchema, Path } from "@cloudflare/itty-router-openapi";
import { error, IRequest, json } from "itty-router";
import { Env } from "../../env";
import { z } from "zod";
import { EkuboAPIRoute, RequestContext } from "../../shared/context";

import MAINNET_TOKENS from "./defaults/mainnet.json";
import GOERLI_TOKENS from "./defaults/goerli.json";
import SEPOLIA_TOKENS from "./defaults/sepolia.json";
import { constants, num, shortString } from "starknet";
import { createQueries, Queries } from "../../queries";

export const TokenType = z
  .object({
    name: z
      .string({
        description: "Name of the token",
      })
      .min(1)
      .max(32),
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
    l2_token_address: z.string({
      description: "The address of the token on Starknet",
    }),
    sort_order: z
      .number({
        description: "How much the token should prefer to be the numerator",
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
    hidden: z.optional(
      z.boolean({
        description:
          "Whether the token should display by default in the interface.",
      }),
    ),
    disabled: z.optional(
      z.boolean({
        description:
          "Whether the token has been disabled for use in Ekubo Interface",
      }),
    ),
  })
  .required({
    name: true,
    symbol: true,
    decimals: true,
    l2_token_address: true,
    total_supply: true,
  });

export type TokenInfo = z.infer<typeof TokenType>;

const DEFAULT_TOKENS_BY_CHAIN_ID: {
  [chainId in constants.StarknetChainId]: TokenInfo[];
} = {
  [constants.StarknetChainId.SN_MAIN]: MAINNET_TOKENS,
  [constants.StarknetChainId.SN_GOERLI]: GOERLI_TOKENS,
  [constants.StarknetChainId.SN_SEPOLIA]: SEPOLIA_TOKENS,
} as const;

const lastGetAllTokens: {
  [chainId in constants.StarknetChainId]?: {
    timestamp: number;
    result: TokenInfo[];
  };
} = {};

const MEMORY_CACHE_TIME_SECONDS = 300;

export async function getAllTokens(
  env: Env,
  queries: Queries,
): Promise<TokenInfo[]> {
  const last = lastGetAllTokens[env.STARKNET_CHAIN_ID];
  if (last && last.timestamp >= Date.now() - MEMORY_CACHE_TIME_SECONDS * 1000) {
    return last.result;
  }

  const tokens = DEFAULT_TOKENS_BY_CHAIN_ID[env.STARKNET_CHAIN_ID] ?? [];

  const { rows } = await queries.getRegisteredTokens();

  rows.forEach((row) => {
    try {
      const name = shortString.decodeShortString(row.name).trim();
      const symbol = shortString.decodeShortString(row.symbol).trim();
      const l2_token_address = num.toHex(row.address);
      if (symbol.length > 8) return;
      if (
        ["eku", "ekubo", "kubo", "kub", "kube"].includes(symbol.toLowerCase())
      ) {
        return;
      }
      if (!/^[\x00-\x7F]*$/.test(name) || !/^[\x00-\x7F]*$/.test(symbol))
        return;

      if (
        // if we find any token matching name symbol etc we skip it
        !tokens.find(
          (t) =>
            BigInt(t.l2_token_address) === BigInt(l2_token_address) ||
            t.symbol.toLowerCase() === symbol.toLowerCase() ||
            t.name === name.toLowerCase(),
        )
      ) {
        tokens.push({
          name,
          symbol,
          decimals: row.decimals,
          l2_token_address,
          sort_order: 1,
          total_supply: Number(
            BigInt(row.total_supply) / 10n ** BigInt(row.decimals),
          ),
          hidden: true,
        });
      }
    } catch (error) {}
  });

  lastGetAllTokens[env.STARKNET_CHAIN_ID] = {
    timestamp: Date.now(),
    result: tokens,
  };

  return tokens;
}

export function getTokenByAddress(
  tokens: TokenInfo[],
  address: string | bigint,
): TokenInfo | undefined {
  return tokens?.find((x) => BigInt(x.l2_token_address) === BigInt(address));
}

export function getTokenByIdentifier(
  tokens: TokenInfo[],
  identifier: string,
): TokenInfo | undefined {
  if (/^0x[a-fA-F0-9]+$/.test(identifier) || /^\d+$/.test(identifier)) {
    return getTokenByAddress(tokens, identifier);
  }

  return tokens.find(
    (x) => x.symbol.toLowerCase() === identifier.toLowerCase(),
  );
}

export class ListTokens extends EkuboAPIRoute {
  static route = "/tokens";
  static schema: OpenAPIRouteSchema = {
    tags: ["Meta"],
    summary: "List tokens",
    description: "Get the list of supported tokens",
    responses: {
      "200": {
        description: "List of tokens",
        schema: z.array(TokenType).openapi({ description: "Array of tokens" }),
        contentType: "application/json",
      },
    },
  };

  async handle(request: IRequest, { env }: RequestContext) {
    const tokens = await getAllTokens(env, await createQueries(env));

    return json(tokens, {
      headers: {
        "cache-control": `public,max-age=${MEMORY_CACHE_TIME_SECONDS * 2}`,
      },
    });
  }
}

export class GetTokenLogo extends EkuboAPIRoute {
  public static route = "/tokens/:identifier/logo";

  static schema: OpenAPIRouteSchema = {
    tags: ["Meta"],
    summary: "Get token logo",
    description: "Get the logo for the given token identifier",
    parameters: {
      identifier: Path(z.string({}).min(1), {
        description: "Either the token symbol or the token address",
      }),
    },
    responses: {
      "200": {
        description: "The token logo as SVG",
        contentType: "image/svg+xml",
      },
      "302": {
        description: "Redirect to the logo image",
      },
    },
  };

  async handle({ params }: IRequest, { env }: RequestContext) {
    const tokens = await getAllTokens(env, await createQueries(env));

    const token = getTokenByIdentifier(tokens, params.identifier);
    if (!token) {
      return error(404, "Token not found");
    }

    const logo = await env.TOKEN_LOGOS_KV?.get(token.symbol);

    if (!logo) {
      return error(404, "Token logo not available");
    }

    // the KV store either stores the https link to the image or the svg logo itself
    if (logo.startsWith("https://")) {
      return new Response(null, {
        status: 302,
        headers: {
          location: logo,
          "cache-control": "public, max-age=1800, immutable",
        },
      });
    }

    return new Response(logo, {
      status: 200,
      headers: {
        "content-type": "image/svg+xml",
        "cache-control": "public, max-age=10800, immutable",
      },
    });
  }
}
