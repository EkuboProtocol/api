import { OpenAPIRouteSchema, Path } from "@cloudflare/itty-router-openapi";
import { error, IRequest, json } from "itty-router";
import { Env } from "../../env";
import { getAllTokens, getTokenByIdentifier } from "../../tokens";
import { z } from "zod";
import { EkuboAPIRoute } from "../_shared/context";
import { createQueries } from "../../queries";

const TokenType = z
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
        .number({
          description: "The total supply of the token",
        })
        .int()
        .gte(0)
    ),
    hidden: z.boolean({
      description:
        "Whether the token should display by default in the interface.",
    }),
  })
  .required({
    name: true,
    symbol: true,
    decimals: true,
    l2_token_address: true,
    total_supply: true,
  });

export class GetTokens extends EkuboAPIRoute {
  static schema: OpenAPIRouteSchema = {
    tags: ["Tokens"],
    summary: "Get the list of supported tokens",
    responses: {
      "200": {
        description: "List of tokens",
        schema: z.array(TokenType, { description: "Array of tokens" }),
        contentType: "application/json",
      },
    },
  };

  async handle(request: IRequest, env: Env) {
    const tokens = await getAllTokens(env, await createQueries(env));

    return json(tokens, {
      headers: {
        "cache-control":
          "public, max-age=3600, stale-while-revalidate=3600, stale-if-error=86400",
      },
    });
  }
}

export class GetTokenLogo extends EkuboAPIRoute {
  static schema: OpenAPIRouteSchema = {
    tags: ["Tokens"],
    summary: "Get the logo for the given token identifier",
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

  async handle({ params }: IRequest, env: Env) {
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
