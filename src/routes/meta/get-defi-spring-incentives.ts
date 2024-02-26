import { IRequest, json } from "itty-router";
import { EkuboAPIRoute, RequestContext } from "../../shared/context";
import { getAllTokens, getTokenByIdentifier, TokenType } from "./tokens";
import { createQueries } from "../../queries";
import { OpenAPIRouteSchema, Path } from "@cloudflare/itty-router-openapi";
import { z } from "zod";

export class GetDefiSpringIncentives extends EkuboAPIRoute {
  public static route = "/defi-spring-incentives";
  static schema: OpenAPIRouteSchema = {
    tags: ["Meta"],
    summary: "DeFi Spring Incentives",
    description: "Get information about the DeFi Spring Incentives program",
    parameters: {},
    responses: {
      "200": {
        description: "The allocation of incentives",
        schema: z.array(
          z.object(
            {
              token0: TokenType,
              token1: TokenType,
              allocations: z.array(
                z.object({
                  date: z.string(),
                  allocation: z.number().min(0),
                })
              ),
            },
            {
              description:
                "Array of token pairs and their respective daily allocations",
            }
          )
        ),
        contentType: "application/json",
      },
    },
  };

  async handle(request: IRequest, context: RequestContext, data: any) {
    const queries = await createQueries(context.env);
    const tokens = await getAllTokens(context.env, queries);

    const response = await fetch(
      "https://kx58j6x5me.execute-api.us-east-1.amazonaws.com//starknet/fetchFile?file=qa_strk_grant.json"
    );
    const responseBody = await response.json();

    const pairs: [pairId: string, { date: string; allocation: number }[]][] =
      Object.entries((responseBody as any)?.["Ekubo"]) as any;

    return json(
      pairs
        .map(([id, allocations]) => {
          const [tokenAIdentifier, tokenBIdentifier] = id.split("/");
          const tokenA = getTokenByIdentifier(tokens, tokenAIdentifier);
          const tokenB = getTokenByIdentifier(tokens, tokenBIdentifier);

          if (!tokenA || !tokenB) {
            return null;
          }

          const [token0, token1] =
            BigInt(tokenA.l2_token_address) < BigInt(tokenB.l2_token_address)
              ? [tokenA, tokenB]
              : [tokenB, tokenA];

          return {
            token0,
            token1,
            allocations,
          };
        })
        .filter((p) => !!p),
      {
        headers: {
          "cache-control": "public, max-age=3600, must-revalidate",
        },
      }
    );
  }
}
