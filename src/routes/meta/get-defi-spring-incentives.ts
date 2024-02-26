import { IRequest, json } from "itty-router";
import { EkuboAPIRoute, RequestContext } from "../../shared/context";
import { getAllTokens, getTokenByIdentifier } from "./tokens";
import { createQueries } from "../../queries";

export class GetDefiSpringIncentives extends EkuboAPIRoute {
  public static route = "/defi-spring-incentives";

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

          return {
            tokenA,
            tokenB,
            allocations,
          };
        })
        .filter((p) => !!p),
      {
        headers: {
          "cache-control": "public, max-age=0, must-revalidate",
        },
      }
    );
  }
}
