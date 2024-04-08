import {
  OpenAPIRoute,
  OpenAPIRouteSchema,
  Path,
} from "@cloudflare/itty-router-openapi";
import { error, IRequest, json } from "itty-router";
import { RequestContext } from "../../shared/context";
import { createQueries } from "../../queries";
import {
  NumericType,
  TokenIdentifierType,
} from "../../shared/validation/address";
import { z } from "zod";
import { getAllTokens, getTokenByIdentifier } from "../meta/tokens";
import { MAX_U128 } from "../quote/math/constants";

export class GetTwammPoolState extends OpenAPIRoute {
  static route = "/twap/pools/:tokenA/:tokenB/:fee";

  static schema: OpenAPIRouteSchema = {
    tags: ["TWAP"],
    summary: "Get TWAP pool",
    description:
      "Returns the current state of the given TWAMM pool, including the future order expirations",
    parameters: {
      tokenA: Path(TokenIdentifierType, { required: true, example: "ETH" }),
      tokenB: Path(TokenIdentifierType, { required: true, example: "USDC" }),
      fee: Path(NumericType, { required: true, example: "" }),
    },
    responses: {
      "200": {
        description: "The current state of the given TWAMM pool",
        contentType: "application/json",
        schema: z.object({}),
      },
    },
  };

  async handle({ params }: IRequest, { env }: RequestContext) {
    const queries = await createQueries(env);

    const tokens = await getAllTokens(env, queries);

    const tokenA = getTokenByIdentifier(tokens, params.tokenA);
    if (!tokenA) {
      return error(404, "`tokenA` not found");
    }
    const tokenB = getTokenByIdentifier(tokens, params.tokenB);
    if (!tokenB) {
      return error(404, "`tokenB` not found");
    }

    const fee = BigInt(params.fee);

    if (fee > MAX_U128) {
      return error(400, "Invalid `fee`");
    }

    const [token0, token1] =
      BigInt(tokenA.l2_token_address) < BigInt(tokenB.l2_token_address)
        ? [BigInt(tokenA.l2_token_address), BigInt(tokenB.l2_token_address)]
        : [BigInt(tokenB.l2_token_address), BigInt(tokenA.l2_token_address)];

    if (token0 === token1) {
      return error(400, "`tokenA` cannot be same as `tokenB`");
    }

    const [{ rows: stateResults }, { rows: saleRateDeltas }] =
      await queries.withinTransaction(() =>
        Promise.all([
          queries.getTwammPoolStateByStateKey({
            token0,
            token1,
            fee,
          }),
          queries.getSaleRateDeltasByPoolKey({
            token0,
            token1,
            fee,
          }),
        ])
      );

    if (stateResults.length !== 1) {
      return error(404, "Pool not found");
    }

    const state = stateResults[0];

    return json(
      {
        token0SaleRate: state.token0_sale_rate.toString(),
        token1SaleRate: state.token1_sale_rate.toString(),
        lastVirtualOrderExecutionTime:
          state.last_execution_time.getTime() / 1000,
        saleRateDeltas: saleRateDeltas.map((srd) => ({
          time: srd.time.getTime() / 1000,
          token0SaleRateDelta: srd.net_sale_rate_delta0.toString(),
          token1SaleRateDelta: srd.net_sale_rate_delta1.toString(),
        })),
      },
      {
        headers: {
          "cache-control": "public, max-age=60, must-revalidate",
        },
      }
    );
  }
}
