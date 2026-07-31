import { EkuboAPIRoute, RequestContext } from "../../shared/context";
import { OpenAPIRouteSchema, Path, Query } from "../../shared/openapi";
import {
  AddressType,
  ChainIdType,
  DecimalStringType,
  HexStringType,
} from "../../shared/validation/address";
import { z } from "zod";
import { IRequest, json } from "itty-router";
import { createQueries, StateFilter } from "../../queries";
import toHex from "../../shared/toHex";

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
    chain_id: HexStringType,
    token_id: z.number().int().min(1),
    orders: z.array(LimitOrderPartInfo),
  })
  .required({ token_id: true, orders: true });

type LimitOrderInfoType = z.infer<typeof LimitOrderInfo>;
const PaginationMetadataType = z.object({
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1),
  totalPages: z.number().int().min(0),
  totalItems: z.number().int().min(0),
});

const LimitOrderStateQueryType = z.enum(["opened", "closed"]);

export class ListLimitOrders extends EkuboAPIRoute {
  static route = "/limit-orders/orders/:address";

  static schema: OpenAPIRouteSchema = {
    tags: ["Limit Orders"],
    summary: "List limit orders",
    description:
      "Returns the list of limit orders currently held by the given address",
    parameters: {
      address: Path(AddressType, { example: "0x1234" }),
      state: Query(LimitOrderStateQueryType, {
        required: false,
        description:
          "Filter limit orders by state; defaults to returning all orders",
      }),
      chainId: Query(ChainIdType, {
        required: false,
        description: "Restrict results to a specific chain ID",
      }),
      pageSize: Query(z.coerce.number().int().min(1).max(200), {
        required: false,
        description: "Maximum number of limit orders to return per page",
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
        description:
          "The list of limit orders held or previously held by the address",
        schema: z.object({
          orders: z.array(LimitOrderInfo).openapi({
            description: "The list of limit orders owned by the address",
          }),
          pagination: PaginationMetadataType,
        }),
      },
    },
  };

  async handleRequest({ params, query }: IRequest, { env }: RequestContext) {
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
    const page = z.coerce
      .number()
      .int()
      .min(1)
      .parse(query?.page ?? 1);

    const { rows, totalCount } = await queries.getLimitOrdersByAddress(
      address,
      state,
      chainId,
      {
        page,
        pageSize,
      },
    );

    const totalPages = totalCount === 0 ? 0 : Math.ceil(totalCount / pageSize);

    return json(
      {
        orders: rows.reduce<LimitOrderInfoType[]>(
          (
            memo,
            {
              chain_id,
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
                token0: toHex(BigInt(token0)),
                token1: toHex(BigInt(token1)),
                tick,
              },
              liquidity: BigInt(liquidity).toString(),
              amount: BigInt(amount).toString(),
              token0_amount_withdrawn,
              token1_amount_withdrawn,
            };

            if (!order) {
              memo.push({
                chain_id: toHex(chain_id),
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
        pagination: {
          page,
          pageSize,
          totalPages,
          totalItems: totalCount,
        },
      },
      {
        headers: {
          "cache-control": "public,max-age=10,must-revalidate",
        },
      },
    );
  }
}
