import { createRoute, z } from "@hono/zod-openapi";
import { defineRoute } from "../../shared/context";
import { errorResponses, StatusError } from "../../shared/errors";
import { jsonResponse, queryArray } from "../../shared/openapi";
import {
  AddressType,
  ChainIdType,
  DecimalStringType,
  HexStringType,
} from "../../shared/validation/address";
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
  total_proceeds_withdrawn: DecimalStringType,
  sale_rate: DecimalStringType,
  last_collect_proceeds: z.number().int().nullable(),
  total_amount_sold: DecimalStringType,
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
const AddressListRequestSchema = z.object({
  addresses: z.array(AddressType).min(1).max(25),
});

const ListTwapOrdersFilterParameters = {
  state: OrderStateQueryType.optional().describe(
    "Filter orders by state; defaults to returning all orders",
  ),
  chainId: ChainIdType.optional().describe(
    "Restrict results to a specific chain ID",
  ),
  pageSize: z.coerce
    .number()
    .int()
    .min(1)
    .max(200)
    .default(50)
    .describe("Maximum number of TWAP orders to return per page"),
  page: z.coerce
    .number()
    .int()
    .min(1)
    .default(1)
    .describe("Page number to fetch (1-indexed)"),
};

function buildListTwapOrdersResponse(
  rows: Awaited<
    ReturnType<
      Awaited<ReturnType<typeof createQueries>>["getTwammOrdersByAddress"]
    >
  >["rows"],
  totalCount: number,
  page: number,
  pageSize: number,
) {
  const totalPages = totalCount === 0 ? 0 : Math.ceil(totalCount / pageSize);
  const toEpochSeconds = (value: string | Date | number) =>
    typeof value === "number"
      ? value
      : Math.floor(new Date(value).getTime() / 1000);

  return {
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
    pagination: {
      page,
      pageSize,
      totalPages,
      totalItems: totalCount,
    },
  } satisfies z.infer<typeof ListTwapOrdersResponseType>;
}

export const ListTwapOrders = defineRoute(
  createRoute({
    method: "get",
    path: "/twap/orders/{address}",
    tags: ["TWAP"],
    summary: "List TWAP orders",
    description:
      "Returns the list of TWAP orders currently held by the given address",
    operationId: "get_ListTwapOrders",
    request: {
      params: z.object({
        address: AddressType.openapi({ example: "0x1234" }),
      }),
      query: z.object(ListTwapOrdersFilterParameters),
    },
    responses: {
      200: jsonResponse(
        "The list of TWAP orders placed by the address",
        ListTwapOrdersResponseType,
      ),
      ...errorResponses,
    },
  }),
  async (c) => {
    const { address } = c.req.valid("param");
    const { state, chainId, page, pageSize } = c.req.valid("query");
    const queries = await createQueries(c.env);

    const { rows, totalCount } = await queries.getTwammOrdersByAddress(
      [BigInt(address)],
      state ?? null,
      chainId ?? null,
      {
        page,
        pageSize,
      },
    );
    const response = buildListTwapOrdersResponse(
      rows,
      totalCount,
      page,
      pageSize,
    );

    return c.json(response, 200, {
      "cache-control": "public,max-age=10,must-revalidate",
    });
  },
);

export const BatchListTwapOrders = defineRoute(
  createRoute({
    method: "get",
    path: "/twap/orders/batch",
    tags: ["TWAP"],
    summary: "Batch list TWAP orders",
    description:
      "Returns the list of TWAP orders currently held by the given addresses",
    operationId: "get_BatchListTwapOrders",
    request: {
      query: z.object({
        address: queryArray(AddressType)
          .describe(
            "Repeat the address parameter to merge orders from multiple addresses (e.g. ?address=0x...&address=0x...)",
          )
          .openapi({ example: "0x1234" }),
        ...ListTwapOrdersFilterParameters,
      }),
    },
    responses: {
      200: jsonResponse(
        "The list of TWAP orders placed by the addresses",
        ListTwapOrdersResponseType,
      ),
      ...errorResponses,
    },
  }),
  async (c) => {
    const {
      address: addresses,
      state,
      chainId,
      page,
      pageSize,
    } = c.req.valid("query");

    if (addresses.length === 0) {
      throw new StatusError(400, "At least one address parameter is required");
    }

    const payload = AddressListRequestSchema.parse({ addresses });
    const queries = await createQueries(c.env);

    const { rows, totalCount } = await queries.getTwammOrdersByAddress(
      payload.addresses.map((address) => BigInt(address)),
      state ?? null,
      chainId ?? null,
      {
        page,
        pageSize,
      },
    );
    const response = buildListTwapOrdersResponse(
      rows,
      totalCount,
      page,
      pageSize,
    );

    return c.json(response, 200, {
      "cache-control": "public,max-age=10,must-revalidate",
    });
  },
);
