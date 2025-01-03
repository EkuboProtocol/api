import { EkuboAPIRoute, RequestContext } from "../../shared/context";
import {
  OpenAPIRouteSchema,
  Path,
  Query,
} from "@cloudflare/itty-router-openapi";
import {
  AddressType,
  DecimalStringType,
} from "../../shared/validation/address";
import { z } from "zod";
import { IRequest, json } from "itty-router";
import { createQueries } from "../../queries";
import { num } from "starknet";

export const OrderKeyType = z
  .object({
    token0: AddressType.openapi({
      example:
        "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7",
    }),
    token1: AddressType.openapi({
      example:
        "0x053c91253bc9682c04929ca02ed00b3e423f6710d2ee7e0d5ebb06f3ecf368a8",
    }),
    tick: z.number().openapi({
      example: 0,
    }),
  })
  .openapi({ description: "The key identifier for a limit order in Ekubo" });

const LimitOrderPartInfo = z
  .object({
    key: OrderKeyType,
    liquidity: DecimalStringType,
    amount: DecimalStringType,
    token0_amount_withdrawn: DecimalStringType.nullable(),
    token1_amount_withdrawn: DecimalStringType.nullable(),
  })
  .required({
    amount: true,
    liquidity: true,
    key: true,
    token0_amount_withdrawn: true,
    token1_amount_withdrawn: true,
  });

const LimitOrderInfo = z
  .object({
    token_id: z.number().int().min(1),
    orders: z.array(LimitOrderPartInfo),
  })
  .required({ token_id: true, orders: true });

type LimitOrderInfoType = z.infer<typeof LimitOrderInfo>;

export class ListLimitOrders extends EkuboAPIRoute {
  static route = "/limit-orders/orders/:address";

  static schema: OpenAPIRouteSchema = {
    tags: ["Limit Orders"],
    summary: "List limit orders",
    description:
      "Returns the list of limit orders currently held by the given address",
    parameters: {
      address: Path(AddressType, { example: "0x1234" }),
      showClosed: Query(z.coerce.boolean(), {
        description:
          "Whether to show limit orders that have already been closed",
      }),
    },
    responses: {
      "200": {
        description:
          "The list of limit orders held or previously held by the address",
        contentType: "application/json",
        schema: z.object({
          orders: z.array(LimitOrderInfo).openapi({
            description: "The list of limit orders owned by the address",
          }),
        }),
      },
    },
  };

  async handle({ params, query }: IRequest, { env }: RequestContext) {
    const address = BigInt(params.address);
    const showClosed = query.showClosed === "true";

    const queries = await createQueries(env);

    const { rows } = await queries.getLimitOrdersByAddress(address, showClosed);

    return json(
      {
        orders: rows.reduce<LimitOrderInfoType[]>(
          (
            memo,
            {
              token_id,
              token0,
              token1,
              tick,
              amount,
              liquidity,
              token0_amount_withdrawn,
              token1_amount_withdrawn,
            },
          ) => {
            const tokenId = Number(token_id);
            const order = memo.find((m) => m.token_id === tokenId);

            const additionalOrder = {
              key: {
                token0: num.toHex(BigInt(token0)),
                token1: num.toHex(BigInt(token1)),
                tick,
              },
              liquidity: BigInt(liquidity).toString(),
              amount: BigInt(amount).toString(),
              token0_amount_withdrawn,
              token1_amount_withdrawn,
            };

            if (!order) {
              memo.push({
                token_id: tokenId,
                orders: [additionalOrder],
              });
            } else {
              order.orders.push(additionalOrder);
            }

            return memo;
          },
          [],
        ),
      },
      {
        headers: {
          "cache-control": "public,max-age=10,must-revalidate",
        },
      },
    );
  }
}
