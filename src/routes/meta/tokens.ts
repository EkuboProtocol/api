import { OpenAPIRouteSchema } from "@cloudflare/itty-router-openapi";
import { IRequest, json } from "itty-router";
import { Env } from "../../env";
import { z } from "zod";
import { EkuboAPIRoute, RequestContext } from "../../shared/context";

import MAINNET_TOKENS from "./defaults/mainnet.json";
import SEPOLIA_TOKENS from "./defaults/sepolia.json";
import UNISWAP_DEFAULT_LIST from "@uniswap/default-token-list";
import LOGOS from "./defaults/logos.json";

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
    token_address: z.string({
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
    logo_url: z.optional(z.string().url()),
  })
  .required({
    name: true,
    symbol: true,
    decimals: true,
    token_address: true,
    total_supply: true,
  });

export type TokenInfo = z.infer<typeof TokenType>;

const SEPOLIA_CHAIN_ID = 11155111;
const MAINNET_CHAIN_ID = 1;

const TOKENS: { [chainId: number]: TokenInfo[] | null } = {};

export function getDefaultTokens(env: Env): TokenInfo[] {
  const ci = Number(env.CHAIN_ID);
  if (TOKENS[ci]) return TOKENS[ci];

  const tokens: TokenInfo[] =
    Number(env.CHAIN_ID) === SEPOLIA_CHAIN_ID
      ? SEPOLIA_TOKENS
      : Number(env.CHAIN_ID) === MAINNET_CHAIN_ID
        ? MAINNET_TOKENS
        : [];

  UNISWAP_DEFAULT_LIST.tokens.forEach((tNew) => {
    if (tNew.chainId !== ci) return;

    // can't find a copy in the list already
    if (
      !tokens.find(
        (tOld) =>
          BigInt(tOld.token_address) === BigInt(tNew.address) ||
          tOld.symbol.toLowerCase() === tNew.symbol.toLowerCase(),
      )
    ) {
      tokens.push({
        symbol: tNew.symbol,
        name: tNew.name,
        token_address: tNew.address,
        decimals: tNew.decimals,
        hidden: false,
        logo_url: tNew.logoURI,
        total_supply: null,
        sort_order: 1,
      });
    }
  });

  tokens.forEach((t) => {
    t.logo_url =
      (LOGOS as { [symbol: string]: string })[t.symbol] ?? t.logo_url;
  });

  return (TOKENS[ci] = tokens);
}

export function getTokenByAddress(
  tokens: TokenInfo[],
  address: string | bigint,
): TokenInfo | undefined {
  return tokens?.find((x) => BigInt(x.token_address) === BigInt(address));
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
    const tokens = getDefaultTokens(env);

    return json(tokens, {
      headers: {
        "cache-control": `public,max-age=300`,
      },
    });
  }
}
