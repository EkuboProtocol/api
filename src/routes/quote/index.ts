import { error, IRequest, json } from "itty-router";
import { EkuboAPIRoute, RequestContext } from "../../shared/context";
import { getAllTokens, getTokenByIdentifier } from "../meta/tokens";
import Decimal from "decimal.js-light";
import { MAX_U128 } from "./math/constants";
import {
  getAllRelevantPoolsAndUpdateCache,
  getCachedNode,
  updatePoolCache,
} from "./quoting";
import { findAllRoutes } from "./findAllRoutes";
import { TokenAmount } from "./nodes/quoteNode";
import { num } from "starknet";
import { createQueries } from "../../queries";
import {
  OpenAPIRouteSchema,
  Path,
  Query,
} from "@cloudflare/itty-router-openapi";
import { z } from "zod";
import {
  AddressType,
  HexStringType,
  NumericType,
  TokenIdentifierType,
} from "../../shared/validation/address";
import { MAX_SQRT_RATIO } from "./math/tick";
import { getSqrtRatioLimit } from "./getSqrtRatioLimit";
import { BaseResourcesGasEstimator } from "./baseResourcesGasEstimator";
import { findOptimalSplitRoute } from "./findOptimalSplitRoute";
import { quoteRoute } from "./quoteRoute";

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

const GetQuoteResponseType = z.object({
  specifiedAmount: z.string(),
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
        skip_ahead: z.number().openapi({
          description:
            "A suggested skip_ahead value for gas optimizing the trade",
          example: 123,
        }),
      }),
    )
    .openapi({
      description: "The list of pool keys through which to swap",
    }),
});

const GetQuoteWithSplitsResponseType = z.object({
  total: z.string(),
  splits: z.array(GetQuoteResponseType),
});

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
        }),
      ),
      maxSplits: Query(z.coerce.number().int().min(0).max(8), {
        description:
          "The maximum number of routes that the amount can be split across",
        required: false,
      }),
      maxHops: Query(z.coerce.number().int().min(1).max(3), {
        description:
          "The maximum number of pools that may be used in any route",
        required: false,
      }),
      token: Path(TokenIdentifierType, { example: "USDC" }),
      otherToken: Path(TokenIdentifierType, { example: "ETH" }),
    },
    responses: {
      "200": {
        description: "The suggested route(s) to get the best price",
        contentType: "application/json",
        schema: z.union([GetQuoteResponseType, GetQuoteWithSplitsResponseType]),
      },
    },
  };

  async handle({ params, query }: IRequest, { env }: RequestContext) {
    const maxSplitsQueryParam = query.maxSplits;
    const specifiedMaxSplits = typeof maxSplitsQueryParam === "string";

    let maxSplits: number = 0;
    if (specifiedMaxSplits) {
      maxSplits = parseInt(maxSplitsQueryParam);
    }

    let maxHops: number = 3;
    if (typeof query.maxHops === "string") {
      maxHops = parseInt(query.maxHops);
    }

    const queries = await createQueries(env);

    const allTokens = await getAllTokens(env, queries);

    let amount: bigint;
    try {
      amount = BigInt(new Decimal(params.amount).toInteger().toFixed());
    } catch (e) {
      return error(400, `Failed to parse amount: ${(e as Error).message}`);
    }

    const tokenInfo = getTokenByIdentifier(allTokens, params.token);
    const otherTokenInfo = getTokenByIdentifier(allTokens, params.otherToken);

    if (!tokenInfo || !otherTokenInfo) {
      return error(400, "Invalid token parameters");
    }

    const token = BigInt(tokenInfo.l2_token_address);
    const otherToken = BigInt(otherTokenInfo.l2_token_address);

    const isExactOutput = amount < 0n;

    if ((isExactOutput ? amount * -1n : amount) > MAX_U128) {
      return error(400, "Amount is too large");
    }

    const relevantPools = await getAllRelevantPoolsAndUpdateCache(queries, {
      tokenA: token,
      tokenB: otherToken,
    });

    if (!relevantPools.length) {
      return error(404, "No pools connect the two tokens");
    }

    // routes are executed in reverse for exact output
    const allRoutes = findAllRoutes(token, otherToken, relevantPools, maxHops);

    const tokenAmount: TokenAmount = {
      amount,
      token,
    };

    // get the ETH price of the other token
    const otherTokenPrice =
      (
        await queries.getVolumeWeightedPriceOverPeriod({
          baseToken: BigInt(env.ETH_TOKEN_ADDRESS),
          quoteToken: otherToken,
          minSwapCount: 0,
        })
      )?.price ?? new Decimal(0);

    const smallestSplitAmount = amount / 2n ** BigInt(maxSplits);
    const noOverrides = new WeakMap();
    // try the smallest split across all the routes first, and only consider the top 2**maxSplits
    const feasibleRoutes = allRoutes
      .map((route) => {
        try {
          const quote = quoteRoute({
            route,
            gasEstimator: new BaseResourcesGasEstimator(otherTokenPrice),
            poolStateOverrides: noOverrides,
            specifiedAmount: {
              token,
              amount: smallestSplitAmount,
            },
          });
          return { quote, route };
        } catch (e) {
          return { route, quote: null };
        }
      })
      .sort(({ quote: quoteA }, { quote: quoteB }) => {
        if (!quoteA) return 1;
        if (!quoteB) return -1;
        return Number(
          quoteB.gasAdjustedCalculatedAmount -
            quoteA.gasAdjustedCalculatedAmount,
        );
      })
      .slice(0, Math.pow(2, maxSplits))
      .map(({ route }) => route);

    const splitRoutes = findOptimalSplitRoute({
      allRoutes: feasibleRoutes,
      tokenAmount,
      poolStateOverrides: new WeakMap(),
      gasEstimator: new BaseResourcesGasEstimator(otherTokenPrice),
      maxSplits,
    });

    if (splitRoutes === null) {
      return error(404, "Route not found");
    }

    const serializedRoutes = splitRoutes.map((route) => ({
      specifiedAmount:
        route.quoteRouteResult.quotes[0].consumedAmount.toString(),
      amount: route.quoteRouteResult.calculatedAmount.amount.toString(),
      route: route.route.map((node, ix) => ({
        pool_key: {
          token0: num.toHex(node.key.token0),
          token1: num.toHex(node.key.token1),
          fee: num.toHex(node.key.fee),
          tick_spacing: node.key.tickSpacing,
          extension: num.toHex(node.key.extension),
        },
        sqrt_ratio_limit: num.toHex(
          getSqrtRatioLimit(
            node.state.sqrtRatio,
            route.quoteRouteResult.quotes[ix].stateAfter.sqrtRatio,
            node.key.tickSpacing,
          ),
        ),
      })),
    }));

    const responseBody = specifiedMaxSplits
      ? {
          total: splitRoutes
            .reduce(
              (sum, route) =>
                route.quoteRouteResult.calculatedAmount.amount + sum,
              0n,
            )
            .toString(),
          splits: serializedRoutes,
        }
      : serializedRoutes[0];

    return json(responseBody, {
      headers: {
        "cache-control": "no-cache",
      },
    });
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
      nextSqrtRatio: Path(z.coerce.string(), {
        description:
          "The next square root ratio to quote the pool being swapped to",
        required: true,
      }),
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
      },
    );
  }
}
