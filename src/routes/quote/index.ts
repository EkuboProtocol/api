import { IRequest, json, StatusError } from "itty-router";
import { EkuboAPIRoute, RequestContext } from "../../shared/context";
import { getAllTokens, getTokenByIdentifier } from "../meta/tokens";
import Decimal from "decimal.js-light";
import { getAllPoolsWithLiquidity } from "./quoteNodeFetching";
import { findAllRoutes } from "./findAllRoutes";
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
  TokenIdentifierType,
} from "../../shared/validation/address";
import { getSqrtRatioLimit } from "./getSqrtRatioLimit";
import { BaseOrTwammResourcesGasEstimator } from "./gasEstimators";
import { findOptimalSplitRoute } from "./findOptimalSplitRoute";
import { getBlockMeta } from "./getBlockMeta";
import { ETH_TOKEN_ADDRESS } from "../../shared/constants";
import { TokenAmount, MAX_SQRT_RATIO, MAX_U128 } from "@ekubo/sdk";

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

    let maxHops: number = 2;
    if (typeof query.maxHops === "string") {
      maxHops = parseInt(query.maxHops);
    }

    const queries = await createQueries(env);

    const allTokens = await getAllTokens(env, queries);

    let amount: bigint;
    try {
      amount = BigInt(new Decimal(params.amount).toInteger().toFixed());
    } catch (e) {
      throw new StatusError(
        400,
        `Failed to parse amount: ${(e as Error).message}`,
      );
    }

    const tokenInfo = getTokenByIdentifier(allTokens, params.token);
    const otherTokenInfo = getTokenByIdentifier(allTokens, params.otherToken);

    if (!tokenInfo || !otherTokenInfo) {
      throw new StatusError(400, "Invalid token parameters");
    }

    const token = BigInt(tokenInfo.l2_token_address);
    const otherToken = BigInt(otherTokenInfo.l2_token_address);

    const isExactOutput = amount < 0n;

    if ((isExactOutput ? amount * -1n : amount) > MAX_U128) {
      throw new StatusError(400, "Amount is too large");
    }

    const [meta, otherTokenPriceResult, relevantPools] = await Promise.all([
      getBlockMeta(queries),
      queries.getVolumeWeightedPriceOverPeriod({
        baseToken: ETH_TOKEN_ADDRESS,
        quoteToken: otherToken,
        minSwapCount: 0,
      }),
      getAllPoolsWithLiquidity(queries),
    ]);

    // routes are executed in reverse for exact output
    const allRoutes = findAllRoutes(token, otherToken, relevantPools, maxHops);

    if (!allRoutes.length) {
      throw new StatusError(404, "No routes connect the two tokens");
    }

    const tokenAmount: TokenAmount = {
      amount,
      token,
    };

    // get the ETH price of the other token
    const otherTokenPrice = otherTokenPriceResult?.price ?? new Decimal(0);

    const gasEstimator = new BaseOrTwammResourcesGasEstimator(
      otherTokenPrice,
      new Decimal("1e11"),
    );

    const splitRoutes = findOptimalSplitRoute({
      allRoutes,
      tokenAmount,
      gasEstimator,
      maxSplits,
      meta,
    });

    if (splitRoutes === null) {
      throw new StatusError(404, "Route not found");
    }

    const serializedRoutes = splitRoutes.map(({ route, quoteRouteResult }) => ({
      specifiedAmount: quoteRouteResult.quotes[0].consumedAmount.toString(),
      amount: quoteRouteResult.calculatedAmount.amount.toString(),
      route: route.map(({ key }, ix) => ({
        pool_key: {
          token0: num.toHex(key.token0),
          token1: num.toHex(key.token1),
          fee: num.toHex(key.fee),
          tick_spacing: key.tickSpacing,
          extension: num.toHex(key.extension),
        },
        sqrt_ratio_limit: num.toHex(
          getSqrtRatioLimit(
            quoteRouteResult.quotes[ix].stateAfter.sqrtRatio,
            key.tickSpacing,
            quoteRouteResult.quotes[ix].isPriceIncreasing,
          ),
        ),
        skip_ahead: num.toHex(
          Math.round(
            quoteRouteResult.quotes[ix].executionResources.tickSpacingsCrossed /
              Math.max(
                quoteRouteResult.quotes[ix].executionResources
                  .initializedTicksCrossed,
                1,
              ),
          ),
        ),
      })),
    }));

    const responseBody = specifiedMaxSplits
      ? {
          total: splitRoutes
            .reduce(
              (
                sum,
                {
                  quoteRouteResult: {
                    calculatedAmount: { amount },
                  },
                },
              ) => amount + sum,
              0n,
            )
            .toString(),

          splits: serializedRoutes,
        }
      : serializedRoutes[0];

    return json(responseBody, {
      headers: {
        "cache-control": "public,s-maxage=5,must-revalidate",
      },
    });
  }
}
