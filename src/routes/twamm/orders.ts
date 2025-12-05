import { EkuboAPIRoute, RequestContext } from "../../shared/context";
import {
  OpenAPIRouteSchema,
  Path,
  Query,
} from "@cloudflare/itty-router-openapi";
import {
  AddressType,
  ChainIdType,
  DecimalStringType,
  HexStringType,
} from "../../shared/validation/address";
import { z } from "zod";
import { IRequest, json } from "itty-router";
import { createQueries, type StateFilter } from "../../queries";
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
  total_proceeds_withdrawn: DecimalStringType,
  sale_rate: DecimalStringType,
  last_collect_proceeds: z.number().int().nullable(),
});

const TwammOrderInfo = z.object({
  chain_id: HexStringType,
  nft_address: HexStringType,
  token_id: HexStringType,
  orders: z.array(TwammOrderPartInfo),
});

type TwammOrderInfoType = z.infer<typeof TwammOrderInfo>;
const ListTwapOrdersResponseType = z.object({
  orders: z.array(TwammOrderInfo),
});

const OrderStateQueryType = z.enum(["opened", "closed"]);

export class ListTwapOrders extends EkuboAPIRoute {
  static route = "/twap/orders/:address";

  static schema: OpenAPIRouteSchema = {
    tags: ["TWAP"],
    summary: "List TWAP orders",
    description:
      "Returns the list of TWAP orders currently held by the given address",
    parameters: {
      address: Path(AddressType, { example: "0x1234" }),
      state: Query(OrderStateQueryType, {
        required: false,
        description: "Filter orders by state; defaults to returning all orders",
      }),
      chainId: Query(ChainIdType, {
        required: false,
        description: "Restrict results to a specific chain ID",
      }),
    },
    responses: {
      "200": {
        description: "The list of TWAP orders placed by the address",
        contentType: "application/json",
        schema: ListTwapOrdersResponseType,
      },
    },
  };

  async handle({ params, query }: IRequest, { env }: RequestContext) {
    const address = BigInt(params.address);
    const stateParam =
      typeof query?.state === "string" ? query.state.toLowerCase() : null;
    const state: StateFilter | null =
      stateParam === "opened" || stateParam === "closed"
        ? (stateParam as StateFilter)
        : null;

    const chainId =
      typeof query.chainId === "string" ? BigInt(query.chainId) : null;
    const queries = await createQueries(env);

    const rows = await queries.getTwammOrdersByAddress(address, state, chainId);

    const toEpochSeconds = (value: string | Date | number) =>
      typeof value === "number"
        ? value
        : Math.floor(new Date(value).getTime() / 1000);

    const response = {
      orders: rows.map<TwammOrderInfoType>(
        ({ chain_id, nft_address, token_id, orders }) => ({
          chain_id: toHex(chain_id),
          nft_address: toHex(nft_address),
          token_id: toHex(BigInt(token_id)),
          orders: orders.map((order) => ({
            key: {
              sell_token: toHex(order.sell_token),
              buy_token: toHex(order.buy_token),
              fee: toHex(order.fee),
              start_time: toEpochSeconds(order.start_time),
              end_time: toEpochSeconds(order.end_time),
            },
            total_amount_sold: order.total_amount_sold,
            last_collect_proceeds: order.last_collect_proceeds
              ? toEpochSeconds(order.last_collect_proceeds)
              : null,
            total_proceeds_withdrawn: order.total_proceeds_withdrawn,
            sale_rate: order.sale_rate,
          })),
        }),
      ),
    } satisfies z.infer<typeof ListTwapOrdersResponseType>;

    return json(response, {
      headers: {
        "cache-control": "public,max-age=10,must-revalidate",
      },
    });
  }
}
