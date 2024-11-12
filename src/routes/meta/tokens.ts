import { OpenAPIRouteSchema } from "@cloudflare/itty-router-openapi";
import { IRequest, json } from "itty-router";
import { Env } from "../../env";
import { z } from "zod";
import { EkuboAPIRoute, RequestContext } from "../../shared/context";

import MAINNET_TOKENS from "./defaults/mainnet.json";
import SEPOLIA_TOKENS from "./defaults/sepolia.json";
import { constants, num } from "starknet";
import { createQueries, Queries } from "../../queries";
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
    logo_url: z.optional(z.string().url()),
  })
  .required({
    name: true,
    symbol: true,
    decimals: true,
    l2_token_address: true,
    total_supply: true,
  });

export type TokenInfo = z.infer<typeof TokenType>;

const SEPOLIA_CHAIN_ID = BigInt(constants.StarknetChainId.SN_SEPOLIA);
const MAINNET_CHAIN_ID = BigInt(constants.StarknetChainId.SN_MAIN);

const BANNED_TOKEN_SYMBOLS = [
  "eku",
  "ekubo",
  "kubo",
  "kub",
  "kube",
  "socks",
  "nostra",
  "nostr",
  "nstra",
  "avnu",
  "vesu",
  "jedi",
  "opus",
  "haiko",
  "mochi",
];

export async function getAllTokens(
  env: Env,
  queries: Queries,
): Promise<TokenInfo[]> {
  const tokens: TokenInfo[] =
    BigInt(env.STARKNET_CHAIN_ID) === SEPOLIA_CHAIN_ID
      ? SEPOLIA_TOKENS
      : BigInt(env.STARKNET_CHAIN_ID) === MAINNET_CHAIN_ID
        ? MAINNET_TOKENS
        : [];

  const { rows } = await queries.getRegisteredTokens();

  rows.forEach((row) => {
    try {
      const name = row.name;
      const symbol = row.symbol;
      const l2_token_address = num.toHex(row.address);

      const lowerSplit = symbol.toLowerCase().split(" ");
      if (
        lowerSplit.some((piece) =>
          BANNED_TOKEN_SYMBOLS.some(
            (banned) => piece.startsWith(banned) || piece.endsWith(banned),
          ),
        )
      ) {
        return;
      }

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

  tokens.forEach((t) => {
    t.logo_url = (LOGOS as { [symbol: string]: string })[t.symbol];
  });

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
        "cache-control": `public,max-age=300`,
      },
    });
  }
}
