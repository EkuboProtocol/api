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
import { IRequest, json, StatusError } from "itty-router";
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
  addresses: z.array(AddressType).min(1).max(1000),
});

function getQueryParamAsArray(value: unknown): string[] | undefined {
  if (typeof value === "string") {
    return [value];
  }

  if (Array.isArray(value)) {
    return value.filter((entry): entry is string => typeof entry === "string");
  }

  return undefined;
}

function parseListTwapOrdersFilters(query: IRequest["query"]) {
  const stateParam =
    typeof query?.state === "string" ? query.state.toLowerCase() : null;
  const state: StateFilter | null =
    stateParam === "opened" || stateParam === "closed"
      ? (stateParam as StateFilter)
      : null;

  return {
    state,
    chainId: typeof query.chainId === "string" ? BigInt(query.chainId) : null,
    pageSize: z.coerce
      .number()
      .int()
      .min(1)
      .max(200)
      .parse(query?.pageSize ?? 50),
    page: z.coerce
      .number()
      .int()
      .min(1)
      .parse(query?.page ?? 1),
  };
}

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
        schema: ListTwapOrdersResponseType,
      },
    },
  };

  async handle({ params, query }: IRequest, { env }: RequestContext) {
    const { state, chainId, page, pageSize } =
      parseListTwapOrdersFilters(query);
    const queries = await createQueries(env);

    const { rows, totalCount } = await queries.getTwammOrdersByAddress(
      [BigInt(params.address)],
      state,
      chainId,
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

    return json(response, {
      headers: {
        "cache-control": "public,max-age=10,must-revalidate",
      },
    });
  }
}

export class BatchListTwapOrders extends EkuboAPIRoute {
  static route = "/twap/orders/batch";

  static schema: OpenAPIRouteSchema = {
    tags: ["TWAP"],
    summary: "Batch list TWAP orders",
    description:
      "Returns the list of TWAP orders currently held by the given addresses",
    parameters: {
      address: Query([AddressType], {
        required: true,
        description:
          "Repeat the address parameter to merge orders from multiple addresses (e.g. ?address=0x...&address=0x...)",
        example: "0x1234",
      }),
      state: Query(OrderStateQueryType, {
        required: false,
        description: "Filter orders by state; defaults to returning all orders",
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
        description: "The list of TWAP orders placed by the addresses",
        schema: ListTwapOrdersResponseType,
      },
    },
  };

  async handle({ query }: IRequest, { env }: RequestContext) {
    const addresses = getQueryParamAsArray(query.address);

    if (!addresses || addresses.length === 0) {
      throw new StatusError(400, "At least one address parameter is required");
    }

    const payload = AddressListRequestSchema.parse({ addresses });
    const { state, chainId, page, pageSize } =
      parseListTwapOrdersFilters(query);
    const queries = await createQueries(env);

    const { rows, totalCount } = await queries.getTwammOrdersByAddress(
      payload.addresses.map((address) => BigInt(address)),
      state,
      chainId,
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

    return json(response, {
      headers: {
        "cache-control": "public,max-age=10,must-revalidate",
      },
    });
  }
}
