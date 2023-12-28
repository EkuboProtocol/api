import { error, IRequest, json } from "itty-router";
import { EkuboAPIRoute, RequestContext } from "../../shared/context";
import { getAllTokens, getTokenByIdentifier } from "../meta/tokens";
import Decimal from "decimal.js-light";
import { MAX_U128 } from "./math/constants";
import {
  defaultAccumulator,
  getAllRelevantPoolsAndUpdateCache,
  getCachedNode,
  QuoteResult,
  quoteRoute,
  updatePoolCache,
} from "./quoting";
import { findAllRoutes } from "./findAllRoutes";
import { QuoteNode, TokenAmount } from "./nodes/quoteNode";
import { num } from "starknet";
import { createQueries } from "../../queries";
import { OpenAPIRouteSchema, Path } from "@cloudflare/itty-router-openapi";
import { z } from "zod";
import {
  NumericType,
  TokenIdentifierType,
} from "../../shared/validation/address";

export class GetQuote extends EkuboAPIRoute {
  static route = "/quote/:amount/:token/:otherToken";

  static schema: OpenAPIRouteSchema = {
    tags: ["Swap"],
    summary: "Get quote",
    description:
      "Returns a quote for a swap or series of swaps to/from one token amount from/to another token",
    parameters: {
      amount: Path(
        z.string().openapi({
          examples: ["1e9", "1000000", "-1e18", "-100000000000000"],
          example: "-1e9",
          description: "The amount of the specified token",
        })
      ),
      token: Path(TokenIdentifierType, { example: "USDC" }),
      otherToken: Path(TokenIdentifierType, { example: "ETH" }),
    },
    responses: {
      "200": {
        description: "The amount to swap to a price for a pool",
        contentType: "application/json",
        schema: {
          amount: "44170270514359743548",
          route: [
            {
              pool_key: {
                token0:
                  "0x49d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7",
                token1:
                  "0x53c91253bc9682c04929ca02ed00b3e423f6710d2ee7e0d5ebb06f3ecf368a8",
                fee: "0x20c49ba5e353f80000000000000000",
                tick_spacing: 1000,
                extension: "0x0",
              },
              sqrt_ratio_limit: "0x345c00340702d766615a4e0f7ec59",
            },
          ],
        },
      },
    },
  };

  async handle({ params }: IRequest, { env }: RequestContext) {
    const queries = await createQueries(env);

    const allTokens = await getAllTokens(env, queries);

    let amount: bigint;
    try {
      amount = BigInt(new Decimal(params.amount).toInteger().toFixed());
    } catch (e) {
      return error(
        400,
        `Failed to parse path parameters: ${(e as Error).message}`
      );
    }

    const token = getTokenByIdentifier(allTokens, params.token);
    const otherToken = getTokenByIdentifier(allTokens, params.otherToken);

    if (!token || !otherToken) {
      return error(400, "Invalid token parameters");
    }

    const isExactOutput = amount < 0n;

    if ((isExactOutput ? amount * -1n : amount) > MAX_U128) {
      return error(400, "Amount is too large");
    }

    const relevantPools = await getAllRelevantPoolsAndUpdateCache(queries, {
      tokenA: BigInt(token.l2_token_address),
      tokenB: BigInt(otherToken.l2_token_address),
    });

    if (!relevantPools.length) {
      return error(404, "No pools connect the two tokens");
    }

    // routes are executed in reverse for exact output
    const allRoutes = findAllRoutes(
      BigInt(token.l2_token_address),
      BigInt(otherToken.l2_token_address),
      relevantPools,
      2
    );

    const tokenAmount: TokenAmount = {
      amount,
      token: BigInt(token.l2_token_address),
    };

    const quotedRoutes = allRoutes.map((route) => {
      try {
        return {
          quote: quoteRoute({
            tokenAmount,
            route,
            accumulator: defaultAccumulator,
          }),
          route,
        };
      } catch (e) {
        console.error("Failed to quote", route, e);
        return {
          quote: null,
          route,
        };
      }
    });

    let bestWorkingRoute: {
      route: QuoteNode<any>[];
      quote: Readonly<QuoteResult<null>>;
    } | null = null;
    for (const { route, quote } of quotedRoutes) {
      if (
        quote &&
        (!bestWorkingRoute ||
          quote.tokenAmount.amount > bestWorkingRoute.quote.tokenAmount.amount)
      ) {
        bestWorkingRoute = {
          quote,
          route,
        };
      }
    }

    if (!bestWorkingRoute) {
      return error(404, "No route found");
    }

    const limits = bestWorkingRoute.quote.limits;

    return json(
      {
        amount: bestWorkingRoute.quote.tokenAmount.amount.toString(),
        route: bestWorkingRoute.route.map(({ key }, ix) => ({
          pool_key: {
            token0: num.toHex(key.token0),
            token1: num.toHex(key.token1),
            fee: num.toHex(key.fee),
            tick_spacing: key.tickSpacing,
            extension: num.toHex(key.extension),
          },
          sqrt_ratio_limit: num.toHex(limits[ix]),
        })),
      },
      {
        headers: {
          "cache-control": "no-cache",
        },
      }
    );
  }
}

export class GetQuoteToPrice extends EkuboAPIRoute {
  static route = "/pools/:keyHash/delta_to_sqrt_ratio/:newSqrtRatio";

  static schema: OpenAPIRouteSchema = {
    tags: ["Swap"],
    summary: "Quote to price",
    description:
      "Returns the token deltas for swapping a specific pool to the given square root ratio.",
    parameters: {
      keyHash: Path(NumericType, { example: "0xabcd" }),
      nextSqrtRatio: Path(
        z.coerce.string().openapi({
          description: "The price to quote the pool being swapped to",
        })
      ),
    },
    responses: {
      "200": {
        description: "The amount to swap to a price for a pool",
        contentType: "application/json",
      },
    },
  };

  async handle({ params }: IRequest, { env }: RequestContext) {
    let poolKeyHash: bigint, newSqrtRatio: bigint;
    try {
      poolKeyHash = BigInt(params.keyHash);
      newSqrtRatio = BigInt(params.newSqrtRatio);
    } catch (e) {
      return error(400, "Invalid path parameters");
    }

    const queries = await createQueries(env);

    const [node, sqrtRatio] = await queries.withinTransaction(async () => {
      const poolState = await queries.getPoolState({ keyHash: poolKeyHash });

      await updatePoolCache([poolState], queries);

      return [getCachedNode(poolKeyHash), BigInt(poolState.sqrt_ratio)];
    });

    const isToken1 = sqrtRatio >= newSqrtRatio;
    const { consumedAmount, calculatedAmount } = node.quote({
      amount: {
        amount: -0xffffffffffffffffffffffffffffffffn,
        token: sqrtRatio >= newSqrtRatio ? node.key.token1 : node.key.token0,
      },
      sqrtRatioLimit: newSqrtRatio,
    });

    return json(
      isToken1
        ? {
            delta0: calculatedAmount.toString(),
            delta1: consumedAmount.toString(),
          }
        : {
            delta0: consumedAmount.toString(),
            delta1: calculatedAmount.toString(),
          },
      {
        headers: {
          "cache-control": "no-cache",
        },
      }
    );
  }
}
