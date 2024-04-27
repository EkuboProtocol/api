import { error, IRequest, json } from "itty-router";
import { EkuboAPIRoute, RequestContext } from "../../shared/context";
import { getAllTokens, getTokenByIdentifier, TokenInfo } from "../meta/tokens";
import Decimal from "decimal.js-light";
import { createQueries, Queries } from "../../queries";
import {
  OpenAPIRouteSchema,
  Path,
  Query,
} from "@cloudflare/itty-router-openapi";
import { z } from "zod";
import {
  AddressType,
  TokenIdentifierType,
  DateIdentifierType,
} from "../../shared/validation/address";
import { splitTwammOrder, TwammOrderSplitResult } from "./splitOrder";
import { num } from "starknet";
import { getCachedNode, updateTwammPoolCache } from "../quote/quoteNodeCaching";
import { TwammPool } from "../quote/nodes/twammPool";
import { getBlockMeta } from "../quote/getBlockMeta";

export const OrderKeyType = z
  .object({
    sell_token: AddressType.openapi({
      example:
        "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7",
    }),
    buy_token: AddressType.openapi({
      example:
        "0x053c91253bc9682c04929ca02ed00b3e423f6710d2ee7e0d5ebb06f3ecf368a8",
    }),
    fee: z.string().openapi({
      example: "1020847100762815411640772995208708096",
    }),
    start_time: z.number().int().min(0).openapi({
      description: "The epoch time in seconds at which the order starts",
    }),
    end_time: z.number().int().min(0).openapi({
      description: "The epoch time in seconds at which the order ends",
    }),
  })
  .openapi({ description: "The key identifier for a TWAP order in Ekubo" });

/**
 * Parses the date path parameter, which can be either an ISO 8601 timestamp or an epoch seconds
 * @param str the parameter to parse
 */
function parseDatePathParameter(str: string): Date {
  if (/^\d+$/.test(str)) {
    return new Date(parseInt(str) * 1000);
  }
  return new Date(str);
}

const DatePathParameterType = DateIdentifierType.or(
  z.coerce.number().min(0).max(Number.MAX_SAFE_INTEGER).int()
);

export class GetSplitTWAPOrderByDate extends EkuboAPIRoute {
  static route = "/twap/quote/:buyToken/:sellToken/:amount/:startTime/:endTime";

  static schema: OpenAPIRouteSchema = {
    tags: ["TWAP"],
    summary: "Split TWAP order by date",
    description: "Returns a set of orders split across TWAMM pools",
    parameters: {
      buyToken: Path(TokenIdentifierType, { example: "USDC" }),
      sellToken: Path(TokenIdentifierType, { example: "ETH" }),
      amount: Path(
        z.string().openapi({
          examples: ["1e9", "1000000"],
          description: "The amount of the token to sell",
        })
      ),
      startTime: Path(DatePathParameterType, {
        example: "2020-01-01T00:00:01Z",
      }),
      endTime: Path(DatePathParameterType, {
        example: "2020-01-02T00:00:01Z",
      }),
      maxSplits: Query(z.coerce.number().int().min(0).max(8), {
        description:
          "The maximum number of orders that the amount can be split across",
        required: false,
      }),
    },
    responses: {
      "200": {
        description: "The split TWAP order",
        contentType: "application/json",
        schema: z.object({
          priceImpact: z.number().min(0).openapi({
            description: "The price impact of the order on the pool",
          }),
          orders: z
            .array(
              z.object({
                amount: z.string().openapi({
                  examples: ["1000000", "100000000000000"],
                  description: "The amount to sell on this pool",
                }),
                order_key: OrderKeyType,
              })
            )
            .openapi({
              description: "The list of TWAP orders to place",
            }),
        }),
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

    if (amount < 0n) {
      return error(400, "Invalid amount parameters");
    }

    const sellToken = getTokenByIdentifier(allTokens, params.sellToken);
    const buyToken = getTokenByIdentifier(allTokens, params.buyToken);

    if (!sellToken || !buyToken) {
      return error(400, "Invalid token parameters");
    }

    const startTime = parseDatePathParameter(params.startTime);
    const endTime = parseDatePathParameter(params.endTime);

    const now = new Date();

    if (endTime < now) {
      return error(400, "Invalid endTime parameters");
    } else if (startTime > endTime) {
      return error(400, "Invalid startTime parameters");
    }

    let splitOrderResult;
    try {
      splitOrderResult = await splitOrder(
        sellToken,
        buyToken,
        startTime,
        endTime,
        amount,
        maxSplits,
        queries
      );
    } catch (e) {
      return error(400, "No pools available");
    }

    const { splitResult, averageBlockTime } = splitOrderResult;

    return json(
      {
        averageBlockTime,
        priceImpact: splitResult.priceImpact,
        orders: splitResult.orders.map((order) => {
          return {
            amount: order.amount.toString(),
            order_key: {
              sell_token: sellToken.l2_token_address,
              buy_token: buyToken.l2_token_address,
              fee: num.toHex(BigInt(order.node.key.fee)),
              // todo: when implementing time splitting, we should use the order start/end time
              start_time: startTime.getTime() / 1000,
              end_time: endTime.getTime() / 1000,
            },
          };
        }),
      },
      {
        headers: {
          "cache-control": "no-cache",
        },
      }
    );
  }
}

async function splitOrder(
  sellToken: TokenInfo,
  buyToken: TokenInfo,
  startTime: Date,
  endTime: Date,
  amount: bigint,
  maxSplits: number,
  queries: Queries
): Promise<{
  splitResult: TwammOrderSplitResult;
  averageBlockTime: number;
}> {
  const sellTokenAddress: string = sellToken.l2_token_address;
  const buyTokenAddress: string = buyToken.l2_token_address;

  const [token0, token1]: [string, string] =
    BigInt(sellToken.l2_token_address) > BigInt(buyToken.l2_token_address)
      ? [buyTokenAddress, sellTokenAddress]
      : [sellTokenAddress, buyTokenAddress];

  const [{ rows: relevantPools }, averageBlockTime, meta] =
    await queries.withinTransaction(() =>
      Promise.all([
        queries.getAllRelevantTwammPoolStates({
          token0: BigInt(token0),
          token1: BigInt(token1),
        }),
        queries.getAverageBlockTime(),
        getBlockMeta(queries),
      ])
    );

  const poolKeyHashes = relevantPools.map((p) => BigInt(p.key_hash));

  await updateTwammPoolCache(queries, poolKeyHashes);

  const twammNodes = poolKeyHashes.map(
    (keyHash) => getCachedNode(keyHash) as TwammPool
  );

  const startTimeSeconds = Math.max(
    Math.floor(startTime.getTime() / 1000),
    meta?.block?.time
  );

  const endTimeSeconds = Math.floor(endTime.getTime() / 1000);

  return {
    splitResult: splitTwammOrder(
      amount,
      startTimeSeconds,
      endTimeSeconds,
      sellTokenAddress === token1,
      twammNodes,
      maxSplits,
      BigInt(averageBlockTime)
    ),
    averageBlockTime,
  };
}
