import { error, IRequest, json } from "itty-router";
import { EkuboAPIRoute, RequestContext } from "../../shared/context";
import {
  getAllTokens,
  getTokenByAddress,
  getTokenByIdentifier,
} from "../meta/tokens";
import Decimal from "decimal.js-light";
import { MAX_U128 } from "./math/constants";
import {
  getAllRelevantPoolsAndUpdateCache,
  getCachedNode,
  quoteRoute,
  QuoteRouteResult,
  ResourcesAccumulator,
  updatePoolCache,
} from "./quoting";
import { findAllRoutes } from "./findAllRoutes";
import {
  BaseResources,
  BaseNodeState,
  QuoteNode,
  TokenAmount,
} from "./nodes/quoteNode";
import { num } from "starknet";
import { createQueries } from "../../queries";
import { OpenAPIRouteSchema, Path } from "@cloudflare/itty-router-openapi";
import { z } from "zod";
import {
  AddressType,
  HexStringType,
  NumericType,
  TokenIdentifierType,
} from "../../shared/validation/address";
import { MAX_SQRT_RATIO } from "./math/tick";
import { PlainPool } from "./nodes/plainPool";

const PoolKeyType = z
  .object({
    token0: AddressType.openapi({
      example:
        "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7",
    }),
    token1: AddressType.openapi({
      example:
        "0x053c91253bc9682c04929ca02ed00b3e423f6710d2ee7e0d5ebb06f3ecf368a8",
    }),
    fee: HexStringType.openapi({ example: "0x20c49ba5e353f80000000000000000" }),
    tick_spacing: z.number().int().gt(0).openapi({ example: 1000 }),
    extension: HexStringType.openapi({ example: "0x0" }),
  })
  .openapi({ description: "The composite key identifier for a pool in Ekubo" });

const baseResourcesAccumulator: ResourcesAccumulator<
  BaseResources,
  BaseResources
> = {
  initial(): BaseResources {
    return {
      initializedTicksCrossed: 0,
    };
  },
  accumulate(memo: BaseResources, value: BaseResources): BaseResources {
    return {
      initializedTicksCrossed:
        memo.initializedTicksCrossed + value.initializedTicksCrossed,
    };
  },
};

// These parameters are used for optimizing when we should use multi-hop routes
const ETH_PER_POOL_SWAPPED = new Decimal("0.0003e18");
const ETH_PER_INITIALIZED_TICK_CROSS = new Decimal("0.0001e18");

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
        schema: z.object({
          amount: z
            .string()
            .regex(/^-?\d+$/)
            .openapi({
              description: "The calculated amount for the quote",
              example: "-123456",
            }),
          route: z
            .array(
              z.object({
                pool_key: PoolKeyType,
                sqrt_ratio_limit: HexStringType.openapi({
                  example: num.toHex(MAX_SQRT_RATIO),
                }),
              })
            )
            .openapi({
              description: "The list of pool keys through which to swap",
            }),
        }),
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

    // get the ETH price of the other token
    const otherTokenPrice =
      (
        await queries.getVolumeWeightedPriceOverPeriod({
          baseToken: BigInt(env.ETH_TOKEN_ADDRESS),
          quoteToken: BigInt(otherToken.l2_token_address),
          start: null,
          minSwapCount: 0,
          end: null,
        })
      )?.price ?? new Decimal(0);

    const bestWorkingRoute = allRoutes.reduce<{
      route: QuoteNode[];
      quote: Readonly<QuoteRouteResult<BaseResources, BaseNodeState>>;
      gasAdjustedAmount: bigint;
    } | null>((memo, route) => {
      try {
        const quote = quoteRoute({
          specifiedAmount: tokenAmount,
          route,
          accumulator: baseResourcesAccumulator,
        });

        if (quote) {
          const gasInOtherToken = BigInt(
            ETH_PER_POOL_SWAPPED.mul(route.length)
              .add(
                ETH_PER_INITIALIZED_TICK_CROSS.mul(
                  quote?.resources.initializedTicksCrossed
                )
              )
              .mul(otherTokenPrice)
              .toFixed(0, Decimal.ROUND_DOWN)
          );

          const gasAdjustedAmount =
            quote.calculatedAmount.amount - gasInOtherToken;

          if (!memo) {
            return {
              quote,
              route,
              gasAdjustedAmount,
            };
          }

          if (gasAdjustedAmount > memo.gasAdjustedAmount) {
            return {
              quote,
              route,
              gasAdjustedAmount,
            };
          }
        }

        return memo;
      } catch (e) {
        // Since we failed to quote this route, this route is not valid
        return memo;
      }
    }, null);

    if (!bestWorkingRoute) {
      return error(404, "No route found");
    }

    return json(
      {
        amount: bestWorkingRoute.quote.calculatedAmount.amount.toString(),
        route: bestWorkingRoute.route.map(({ key }, ix) => ({
          pool_key: {
            token0: num.toHex(key.token0),
            token1: num.toHex(key.token1),
            fee: num.toHex(key.fee),
            tick_spacing: key.tickSpacing,
            extension: num.toHex(key.extension),
          },
          sqrt_ratio_limit: num.toHex(
            bestWorkingRoute.quote.nodeStates[ix].sqrtRatio
          ),
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
      tokenAmount: {
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
