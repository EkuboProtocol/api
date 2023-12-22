import { error, IRequest, json } from "itty-router";
import { EkuboAPIRoute } from "../_shared/context";
import { Env } from "../../env";
import { getAllTokens, getTokenByIdentifier } from "../meta/tokens";
import Decimal from "decimal.js-light";
import { MAX_U128 } from "./math/constants";
import {
  defaultAccumulator,
  getAllRelevantPoolsAndUpdateCache,
  QUOTE_NODE_CACHE,
  QuoteResult,
  quoteRoute,
  TokenAmount,
  updatePoolCache,
} from "./quoting";
import { findAllRoutes } from "./findAllRoutes";
import { QuoteNode } from "./nodes/quoteNode";
import { createQueries } from "../../queries";
import { num } from "starknet";

export class GetQuote extends EkuboAPIRoute {
  async handle({ params, query }: IRequest, env: Env) {
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

    const cache = QUOTE_NODE_CACHE[env.STARKNET_CHAIN_ID];

    const relevantPools = await getAllRelevantPoolsAndUpdateCache(
      queries,
      cache,
      {
        tokenA: BigInt(token.l2_token_address),
        tokenB: BigInt(otherToken.l2_token_address),
      }
    );

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
        route: bestWorkingRoute.route.map((node, ix) => ({
          pool_key: {
            token0: num.toHex(node.key.token0),
            token1: num.toHex(node.key.token1),
            fee: num.toHex(node.key.fee),
            tick_spacing: Number(node.key.tickSpacing),
            extension: num.toHex(node.key.extension),
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
  async handle({ params }: IRequest, env: Env) {
    let poolKeyHash: bigint, newSqrtRatio: bigint;
    try {
      poolKeyHash = BigInt(params.key_hash);
      newSqrtRatio = BigInt(params.new_sqrt_ratio);
    } catch (e) {
      return error(400, "Invalid path parameters");
    }

    const queries = await createQueries(env);

    const [node, sqrtRatio] = await queries.withinTransaction(async () => {
      const poolState = await queries.getPoolState({ keyHash: poolKeyHash });

      const cache = QUOTE_NODE_CACHE[env.STARKNET_CHAIN_ID];

      await updatePoolCache([poolState], queries, cache);

      return [cache[poolKeyHash.toString()].node, BigInt(poolState.sqrt_ratio)];
    });

    const isToken1 = sqrtRatio >= newSqrtRatio;
    const { consumedAmount, calculatedAmount } = node.quote({
      specifiedAmount: -0xffffffffffffffffffffffffffffffffn,
      sqrtRatioLimit: newSqrtRatio,
      isToken1: sqrtRatio >= newSqrtRatio,
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
