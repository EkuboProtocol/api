import { IRequest, json, StatusError } from "itty-router";
import { EkuboAPIRoute, RequestContext } from "../../shared/context";
import { getAllTokens, getTokenByIdentifier } from "../meta/tokens";
import Decimal from "decimal.js-light";
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
import { MAX_SQRT_RATIO, MAX_U128 } from "@ekubo/sdk";

const AVERAGE_SWAP_FEES_IN_DOLLARS = 0.05;

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

    const usdcToken = allTokens.find((t) => t.symbol === "USDC");

    if (!usdcToken) {
      throw new StatusError(500, "Failed to find the USDC token address");
    }

    const tokenPerUsdcNoDecimals = await queries.getVolumeWeightedPrice({
      baseToken: BigInt(usdcToken.l2_token_address),
      quoteToken: otherToken,
      numHours: 24,
    });

    const outputPriceFactor = tokenPerUsdcNoDecimals?.price
      ? // dollar per swap divided by dollar per token ~= output token per swap
        tokenPerUsdcNoDecimals.price
          // adjust for usdc decimals to get token/usd
          .mul(Math.pow(10, otherTokenInfo.decimals - usdcToken.decimals))
          // in dollars/swap
          .mul(AVERAGE_SWAP_FEES_IN_DOLLARS)
          // now we have tokens/swap, multiply by 100 which is a factor we can adjust
          .mul(10000)
          .toNumber()
      : undefined;

    console.log(outputPriceFactor);

    const response = await fetch(
      `${env.QUOTER_API_BASE_URL}${amount}/${token}/${otherToken}?max_hops=${maxHops}&max_splits=${maxSplits}&output_price_factor=${outputPriceFactor}`,
    );

    if (!response.ok) {
      const errorJson = await response.json();

      if (errorJson && typeof errorJson === "object" && "error" in errorJson) {
        throw new StatusError(
          response.status,
          `Request failed: ${errorJson.error}`,
        );
      }

      throw new StatusError(502, "Proxy request failed for unknown reason");
    }

    const result = (await response.json()) as {
      total_calculated: string;
      splits: {
        amount_specified: string;
        amount_calculated: string;
        route_id: string;
        route: {
          pool_key: {
            token0: string;
            token1: string;
            fee: string;
            tick_spacing: number;
            extension: string;
          };
          sqrt_ratio_limit: string;
          skip_ahead: number;
        }[];
      }[];
    };

    const responseBody = specifiedMaxSplits
      ? {
          total: result.total_calculated,
          splits: result.splits.map(
            (s) =>
              ({
                amount: s.amount_calculated,
                specifiedAmount: s.amount_specified,
                route: s.route.map((r) => ({
                  pool_key: r.pool_key,
                  sqrt_ratio_limit: r.sqrt_ratio_limit,
                  skip_ahead: r.skip_ahead,
                })),
              }) satisfies z.infer<typeof GetQuoteResponseType>,
          ),
        }
      : ({
          specifiedAmount: result.splits[0].amount_specified,
          amount: result.total_calculated,
          route: result.splits[0].route.map((r) => ({
            pool_key: r.pool_key,
            sqrt_ratio_limit: r.sqrt_ratio_limit,
            skip_ahead: r.skip_ahead,
          })),
        } satisfies z.infer<typeof GetQuoteResponseType>);

    return json(responseBody, {
      headers: {
        "cache-control": "public,s-maxage=5,must-revalidate",
      },
    });
  }
}
