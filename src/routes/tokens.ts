import {
  Arr,
  Bool,
  Int,
  OpenAPIRoute,
  OpenAPIRouteSchema,
  Str,
} from "@cloudflare/itty-router-openapi";
import { IRequest, json } from "itty-router";
import { RequestContext } from "./context";
import { Env } from "../env";
import { getAllTokens } from "../tokens";
import { createQueries } from "../createQueries";

const TokenType = {
  name: new Str({
    required: true,
    example: "USD Coin",
    description: "Name of the token",
  }),
  symbol: new Str({
    required: true,
    example: "USDC",
    description: "Symbol for the token",
  }),
  decimals: new Int({
    example: 18,
    required: true,
    description: "The number of decimals used for display of token balances",
  }),
  l2_token_address: new Str({
    required: true,
    example:
      "0x053c91253bc9682c04929ca02ed00b3e423f6710d2ee7e0d5ebb06f3ecf368a8",
    description: "The address of the token on Starknet",
  }),
  sort_order: new Int({
    example: 2,
    description: "How much the token should prefer to be the numerator",
    required: true,
  }),
  total_supply: new Int({
    example: 1000000,
    required: false,
    description: "The total supply of the token",
  }),
  hidden: new Bool({
    example: false,
    required: false,
    description:
      "Whether the token should display by default in the interface.",
  }),
};

export class TokensFetch extends OpenAPIRoute<IRequest, RequestContext> {
  static schema: OpenAPIRouteSchema = {
    tags: ["Tokens"],
    summary: "Get the list of supported tokens",
    responses: {
      "200": {
        description: "List of tokens",
        schema: new Arr(TokenType),
        contentType: "application/json",
      },
    },
  };

  async handle(request: IRequest, env: Env, context: ExecutionContext) {
    const tokens = await getAllTokens(env, await createQueries(env));

    return json(tokens, {
      headers: {
        "cache-control":
          "public, max-age=3600, stale-while-revalidate=3600, stale-if-error=86400",
      },
    });
  }
}
