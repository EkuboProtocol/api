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
import { OrderKeyType } from "./index";
import { createQueries } from "../../queries";
import { num } from "starknet";

const TwammOrderPartInfo = z.object({
  key: OrderKeyType,
  block_time_at_start: z.number().int().min(0),
  last_order_update: z.number().int().min(0),
  total_proceeds_withdrawn: DecimalStringType,
});

const TwammOrderInfo = z.object({
  token_id: z.number().int().min(1),
  orders: z.array(TwammOrderPartInfo),
});

type TwammOrderInfoType = z.infer<typeof TwammOrderInfo>;

export class ListOrders extends EkuboAPIRoute {
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
            },
          ) => {
            const tokenId = Number(token_id);
            const order = memo.find((m) => m.token_id === tokenId);

            const additionalOrder = {
              key: {
                sell_token: num.toHex(BigInt(sell_token)),
                buy_token: num.toHex(BigInt(buy_token)),
                fee: num.toHex(BigInt(fee)),
                start_time: start_time.getTime() / 1000,
                end_time: end_time.getTime() / 1000,
              },
              block_time_at_start: block_time_at_start.getTime() / 1000,
              last_order_update: last_order_update.getTime() / 1000,
              last_collect_proceeds: last_collect_proceeds
                ? last_collect_proceeds.getTime() / 1000
                : null,
              total_proceeds_withdrawn,
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
