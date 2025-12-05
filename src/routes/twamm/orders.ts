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
const PaginationMetadataType = z.object({
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1),
  totalPages: z.number().int().min(0),
  totalItems: z.number().int().min(0),
});
const ListTwapOrdersResponseType = z.object({
  orders: z.array(TwammOrderInfo),
  pagination: PaginationMetadataType,
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
        description:
          'Filter orders by state; defaults to returning all orders',
      }),
      chainId: Query(ChainIdType, {
        required: false,
        description: "Restrict results to a specific chain ID",
      }),
      pageSize: Query(z.coerce.number().int().min(1).max(200), {
        required: false,
        description: "Maximum number of TWAP orders to return per page",
        default: 50,
      }),
      page: Query(z.coerce.number().int().min(1), {
        required: false,
        description: "Page number to fetch (1-indexed)",
        default: 1,
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

    const pageSize = z.coerce
      .number()
      .int()
      .min(1)
      .max(200)
      .parse(query?.pageSize ?? 50);
    const page = z.coerce.number().int().min(1).parse(query?.page ?? 1);

    const { rows, totalCount } = await queries.getTwammOrdersByAddress(
      address,
      state,
      chainId,
      {
        page,
        pageSize,
      },
    );

    const totalPages = totalCount === 0 ? 0 : Math.ceil(totalCount / pageSize);

    const response = {
      orders: rows.reduce<TwammOrderInfoType[]>(
        (
          memo,
          {
            chain_id,
            nft_address,
            token_id,
            fee,
            buy_token,
            sell_token,
            end_time,
            start_time,
            last_collect_proceeds,
            total_proceeds_withdrawn,
            sale_rate,
          },
        ) => {
          const tokenId = BigInt(token_id);
          const order = memo.find((m) => BigInt(m.token_id) === tokenId);

          const additionalOrder = {
            key: {
              sell_token: toHex(sell_token),
              buy_token: toHex(buy_token),
              fee: toHex(fee),
              start_time: start_time.getTime() / 1000,
              end_time: end_time.getTime() / 1000,
            },
            last_collect_proceeds: last_collect_proceeds
              ? last_collect_proceeds.getTime() / 1000
              : null,
            total_proceeds_withdrawn,
            sale_rate,
          };

          if (!order) {
            memo.push({
              chain_id: toHex(chain_id),
              nft_address: toHex(nft_address),
              token_id: toHex(BigInt(tokenId)),
              orders: [additionalOrder],
            });
          } else {
            order.orders.push(additionalOrder);
          }

          return memo;
        },
        [],
      ),
      pagination: {
        page,
        pageSize,
        totalPages,
        totalItems: totalCount,
      },
    } satisfies z.infer<typeof ListTwapOrdersResponseType>;

    return json(response, {
      headers: {
        "cache-control": "public,max-age=10,must-revalidate",
      },
    });
  }
}
