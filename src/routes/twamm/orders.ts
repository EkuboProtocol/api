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
import toHex from "../../shared/toHex";

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

const TwammOrderPartInfo = z.object({
  key: OrderKeyType,
  block_time_at_start: z.number().int().min(0),
  last_order_update: z.number().int().min(0),
  total_proceeds_withdrawn: DecimalStringType,
  total_amount_sold_before_last_update: DecimalStringType,
});

const TwammOrderInfo = z.object({
  token_id: z.number().int().min(1),
  orders: z.array(TwammOrderPartInfo),
});

type TwammOrderInfoType = z.infer<typeof TwammOrderInfo>;

export class ListTwapOrders extends EkuboAPIRoute {
  static route = "/twap/orders/:address";

  static schema: OpenAPIRouteSchema = {
    tags: ["TWAP"],
    summary: "List TWAP orders",
    description:
      "Returns the list of TWAP orders currently held by the given address",
    parameters: {
      address: Path(AddressType, { example: "0x1234" }),
      showClosed: Query(z.coerce.boolean(), {
        description:
          "Whether to show orders that have zero active sell rate as part of the response",
      }),
    },
    responses: {
      "200": {
        description: "The list of TWAP orders placed by the address",
        contentType: "application/json",
        schema: z.object({
          orders: z.array(TwammOrderInfo).openapi({
            description:
              "The list of TWAP orders currently and/or previously owned by the address, depending on `showClosed`",
          }),
        }),
      },
    },
  };

  async handle({ params, query }: IRequest, { env }: RequestContext) {
    const address = BigInt(params.address);
    const showClosed = query.showClosed === "true";

    const queries = await createQueries(env);

    const { rows } = await queries.getTwammOrdersByAddress(address, showClosed);

    return json(
      {
        orders: rows.reduce<TwammOrderInfoType[]>(
          (
            memo,
            {
              token_id,
              fee,
              buy_token,
              sell_token,
              end_time,
              start_time,
              block_time_at_start,
              last_order_update,
              last_collect_proceeds,
              total_proceeds_withdrawn,
              total_amount_sold_before_last_update,
            },
          ) => {
            const tokenId = Number(token_id);
            const order = memo.find((m) => m.token_id === tokenId);

            const additionalOrder = {
              key: {
                sell_token: toHex(BigInt(sell_token)),
                buy_token: toHex(BigInt(buy_token)),
                fee: toHex(BigInt(fee)),
                start_time: start_time.getTime() / 1000,
                end_time: end_time.getTime() / 1000,
              },
              block_time_at_start: block_time_at_start.getTime() / 1000,
              last_order_update: last_order_update.getTime() / 1000,
              last_collect_proceeds: last_collect_proceeds
                ? last_collect_proceeds.getTime() / 1000
                : null,
              total_proceeds_withdrawn,
              total_amount_sold_before_last_update,
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
