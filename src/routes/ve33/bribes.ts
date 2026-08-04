import { OpenAPIRouteSchema, Path, Query } from "../../shared/openapi";
import { IRequest, json } from "itty-router";
import { z } from "zod";
import { createQueries } from "../../queries";
import { EkuboAPIRoute, RequestContext } from "../../shared/context";
import toHex from "../../shared/toHex";
import {
  AddressType,
  ChainIdType,
  DecimalStringType,
  HexStringType,
} from "../../shared/validation/address";

const TimestampType = z.union([z.date(), z.string()]);

const PoolKeyType = z.object({
  token0: HexStringType,
  token1: HexStringType,
  fee: HexStringType,
  tick_spacing: HexStringType.nullable(),
  extension: HexStringType,
  stableswap_params: z
    .object({ center_tick: z.number().int(), amplification: z.number().int() })
    .nullable(),
});

const Ve33BribeScheduleType = z.object({
  funder: HexStringType,
  start_time: TimestampType,
  end_time: TimestampType,
  reward_rate: DecimalStringType,
  amount: DecimalStringType,
});

const Ve33BribeType = z.object({
  chain_id: HexStringType,
  bribe_id: HexStringType,
  pool_id: HexStringType,
  reward_token: HexStringType,
  voting_fee: DecimalStringType,
  pool_key_id: DecimalStringType.nullable(),
  core_address: HexStringType.nullable(),
  pool_key: PoolKeyType.nullable(),
  total_weight: DecimalStringType,
  total_scheduled_amount: DecimalStringType,
  current_reward_rate: DecimalStringType,
  first_start_time: TimestampType.nullable(),
  last_end_time: TimestampType.nullable(),
  schedules: z.array(Ve33BribeScheduleType),
});

const PaginationMetadataType = z.object({
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1),
  totalPages: z.number().int().min(0),
  totalItems: z.number().int().min(0),
});

const ListVe33BribesResponseType = z.object({
  data: z.array(Ve33BribeType),
  pagination: PaginationMetadataType,
});

function parseListVe33BribesFilters(query: IRequest["query"]) {
  const pageSize =
    query?.pageSize === undefined
      ? undefined
      : z.coerce.number().int().min(1).max(200).parse(query.pageSize);
  const page = z.coerce
    .number()
    .int()
    .min(1)
    .parse(query?.page ?? 1);

  if (pageSize === undefined) {
    z.number()
      .max(1, {
        message: "pageSize is required when page is greater than 1",
      })
      .parse(page);
  }

  return {
    chainId: ChainIdType.parse(query?.chainId),
    activeOnly: z.coerce.boolean().optional().parse(query?.activeOnly) ?? false,
    pageSize,
    page,
  };
}

function buildListVe33BribesResponse(
  rows: Awaited<
    ReturnType<Awaited<ReturnType<typeof createQueries>>["getVe33Bribes"]>
  >["rows"],
  totalCount: number,
  page: number,
  pageSize: number | undefined,
) {
  const responsePageSize = pageSize ?? Math.max(totalCount, 1);
  const totalPages =
    totalCount === 0
      ? 0
      : pageSize === undefined
        ? 1
        : Math.ceil(totalCount / pageSize);

  return {
    data: rows.map((row) => {
      const stableswapParams =
        row.stableswap_amplification !== null &&
        row.stableswap_center_tick !== null
          ? {
              center_tick: Number(row.stableswap_center_tick),
              amplification: Number(row.stableswap_amplification),
            }
          : null;

      return {
        chain_id: toHex(row.chain_id),
        bribe_id: toHex(row.bribe_id),
        pool_id: toHex(row.pool_id),
        reward_token: toHex(row.reward_token),
        voting_fee: row.voting_fee,
        pool_key_id: row.pool_key_id,
        core_address:
          row.core_address === null ? null : toHex(row.core_address),
        pool_key:
          row.token0 === null ||
          row.token1 === null ||
          row.fee === null ||
          row.extension === null
            ? null
            : {
                token0: toHex(row.token0),
                token1: toHex(row.token1),
                fee: toHex(row.fee),
                tick_spacing:
                  row.tick_spacing === null ? null : toHex(row.tick_spacing),
                extension: toHex(row.extension),
                stableswap_params: stableswapParams,
              },
        total_weight: row.total_weight,
        total_scheduled_amount: row.total_scheduled_amount,
        current_reward_rate: row.current_reward_rate,
        first_start_time: row.first_start_time,
        last_end_time: row.last_end_time,
        schedules: row.schedules.map((schedule) => ({
          funder: toHex(schedule.funder),
          start_time: schedule.start_time,
          end_time: schedule.end_time,
          reward_rate: schedule.reward_rate,
          amount: schedule.amount,
        })),
      };
    }),
    pagination: {
      page,
      pageSize: responsePageSize,
      totalPages,
      totalItems: totalCount,
    },
  } satisfies z.infer<typeof ListVe33BribesResponseType>;
}

export class ListVe33Bribes extends EkuboAPIRoute {
  static route = "/ve33/:bribesAddress/bribes";

  static schema: OpenAPIRouteSchema = {
    tags: ["ve33"],
    summary: "List VeToken bribes",
    description:
      "Returns the bribes managed by a VeTokenBribes singleton contract, " +
      "including the incentivized pool, reward token, directed voting fee, " +
      "reward schedules, and currently staked vote weight",
    parameters: {
      bribesAddress: Path(AddressType, {
        description: "The VeTokenBribes singleton contract address",
      }),
      chainId: Query(ChainIdType, {
        required: true,
        description: "Restrict results to a specific chain ID",
      }),
      activeOnly: Query(z.coerce.boolean(), {
        required: false,
        description:
          "Only return bribes with a reward schedule that has not yet ended",
        default: false,
      }),
      pageSize: Query(z.coerce.number().int().min(1).max(200), {
        required: false,
        description:
          "Maximum number of bribes to return per page. Returns all bribes when omitted.",
      }),
      page: Query(z.coerce.number().int().min(1), {
        required: false,
        description:
          "Page number to fetch (1-indexed). Values above 1 require pageSize.",
        default: 1,
      }),
    },
    responses: {
      "200": {
        description: "The bribes managed by the contract",
        schema: ListVe33BribesResponseType,
      },
    },
  };

  async handleRequest(
    { params: { bribesAddress }, query }: IRequest,
    { env }: RequestContext,
  ) {
    const { chainId, activeOnly, page, pageSize } =
      parseListVe33BribesFilters(query);
    const queries = await createQueries(env);
    const { rows, totalCount } = await queries.getVe33Bribes(
      BigInt(bribesAddress),
      chainId,
      { activeOnly },
      { page, pageSize },
    );

    return json(buildListVe33BribesResponse(rows, totalCount, page, pageSize), {
      headers: {
        "cache-control": "public, max-age=30",
      },
    });
  }
}
