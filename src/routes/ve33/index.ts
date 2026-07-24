import {
  OpenAPIRouteSchema,
  Path,
  Query,
} from "@cloudflare/itty-router-openapi";
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

const Ve33TokenType = z.object({
  chain_id: HexStringType,
  owner: HexStringType,
  ve_token_address: HexStringType,
  ve33_address: HexStringType,
  token_id: HexStringType,
  stake_id: HexStringType,
  amount: DecimalStringType,
  end_time: TimestampType,
  voted_pool_id: HexStringType.nullable(),
  voted_pool_key: PoolKeyType.nullable(),
  pool_key_id: DecimalStringType.nullable(),
  applied_vote_weight: DecimalStringType.nullable(),
  voted_swap_fee: DecimalStringType.nullable(),
  pool_total_vote_weight: DecimalStringType.nullable(),
  minted_at: TimestampType.nullable(),
  mint_transaction_hash: HexStringType.nullable(),
  last_stake_changed_event_id: DecimalStringType,
  last_transfer_event_id: DecimalStringType,
});

const PoolStateType = z
  .object({
    sqrt_ratio: DecimalStringType,
    tick: z.number().int(),
    liquidity: DecimalStringType,
  })
  .nullable();

const Ve33PoolType = z.object({
  chain_id: HexStringType,
  pool_key_id: DecimalStringType,
  pool_id: HexStringType,
  token0: HexStringType,
  token1: HexStringType,
  fee: DecimalStringType,
  tick_spacing: z.number().int().nullable(),
  core_address: HexStringType,
  extension: HexStringType,
  pool_key: PoolKeyType,
  pool_state: PoolStateType,
  pool_total_vote_weight: DecimalStringType,
  swap_fee: z.string(),
  volume0_24h: z.string(),
  volume1_24h: z.string(),
  fees0_24h: z.string(),
  fees1_24h: z.string(),
  tvl0_delta_24h: z.string(),
  tvl0_total: z.string(),
  tvl1_delta_24h: z.string(),
  tvl1_total: z.string(),
  depth0: z.string(),
  depth1: z.string(),
  depth_percent: z.number().nullable(),
  last_event_id: DecimalStringType,
});

const PaginationMetadataType = z.object({
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1),
  totalPages: z.number().int().min(0),
  totalItems: z.number().int().min(0),
});

const ListVe33TokensResponseType = z.object({
  data: z.array(Ve33TokenType),
  pagination: PaginationMetadataType,
});

const ListVe33PoolsResponseType = z.object({
  data: z.array(Ve33PoolType),
  total_vote_weight: DecimalStringType,
  pagination: PaginationMetadataType,
});

function parseListVe33TokensFilters(query: IRequest["query"]) {
  return {
    chainId: ChainIdType.optional().parse(query?.chainId) ?? null,
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

function parseListVe33PoolsFilters(query: IRequest["query"]) {
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
    pageSize,
    page,
  };
}

function buildListVe33TokensResponse(
  rows: Awaited<
    ReturnType<
      Awaited<ReturnType<typeof createQueries>>["getVe33TokensByAddress"]
    >
  >["rows"],
  totalCount: number,
  page: number,
  pageSize: number,
) {
  const totalPages = totalCount === 0 ? 0 : Math.ceil(totalCount / pageSize);

  return {
    data: rows.map((row) => ({
      chain_id: toHex(row.chain_id),
      owner: toHex(row.owner),
      ve_token_address: toHex(row.ve_token_address),
      ve33_address: toHex(row.ve33_address),
      token_id: toHex(row.token_id),
      stake_id: toHex(row.stake_id),
      amount: row.amount,
      end_time: row.end_time,
      voted_pool_id: row.voted_pool_id ? toHex(row.voted_pool_id) : null,
      voted_pool_key:
        row.voted_pool_token0 === null ||
        row.voted_pool_token1 === null ||
        row.voted_pool_fee === null ||
        row.voted_pool_extension === null
          ? null
          : {
              token0: toHex(row.voted_pool_token0),
              token1: toHex(row.voted_pool_token1),
              fee: toHex(row.voted_pool_fee),
              tick_spacing:
                row.voted_pool_tick_spacing === null
                  ? null
                  : toHex(row.voted_pool_tick_spacing),
              extension: toHex(row.voted_pool_extension),
              stableswap_params:
                row.voted_pool_stableswap_amplification !== null &&
                row.voted_pool_stableswap_center_tick !== null
                  ? {
                      center_tick: Number(
                        row.voted_pool_stableswap_center_tick,
                      ),
                      amplification: Number(
                        row.voted_pool_stableswap_amplification,
                      ),
                    }
                  : null,
            },
      pool_key_id: row.pool_key_id,
      applied_vote_weight: row.applied_vote_weight,
      voted_swap_fee: row.voted_swap_fee,
      pool_total_vote_weight: row.pool_total_vote_weight,
      minted_at: row.minted_at,
      mint_transaction_hash: row.mint_transaction_hash
        ? toHex(row.mint_transaction_hash)
        : null,
      last_stake_changed_event_id: row.last_stake_changed_event_id,
      last_transfer_event_id: row.last_transfer_event_id,
    })),
    pagination: {
      page,
      pageSize,
      totalPages,
      totalItems: totalCount,
    },
  } satisfies z.infer<typeof ListVe33TokensResponseType>;
}

function buildListVe33PoolsResponse(
  rows: Awaited<
    ReturnType<Awaited<ReturnType<typeof createQueries>>["getVe33Pools"]>
  >["rows"],
  totalCount: number,
  totalVoteWeight: string,
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
        pool_key_id: row.pool_key_id,
        pool_id: toHex(row.pool_id),
        token0: toHex(row.token0),
        token1: toHex(row.token1),
        fee: row.fee,
        tick_spacing: row.tick_spacing,
        core_address: toHex(row.core_address),
        extension: toHex(row.extension),
        pool_key: {
          token0: toHex(row.token0),
          token1: toHex(row.token1),
          fee: toHex(row.fee),
          tick_spacing:
            row.tick_spacing === null ? null : toHex(row.tick_spacing),
          extension: toHex(row.extension),
          stableswap_params: stableswapParams,
        },
        pool_state:
          row.pool_state_sqrt_ratio === null ||
          row.pool_state_tick === null ||
          row.pool_state_liquidity === null
            ? null
            : {
                sqrt_ratio: row.pool_state_sqrt_ratio,
                tick: Number(row.pool_state_tick),
                liquidity: row.pool_state_liquidity,
              },
        pool_total_vote_weight: row.pool_total_vote_weight,
        swap_fee: row.swap_fee,
        volume0_24h: row.volume0_24h,
        volume1_24h: row.volume1_24h,
        fees0_24h: row.fees0_24h,
        fees1_24h: row.fees1_24h,
        tvl0_delta_24h: row.tvl0_delta_24h,
        tvl0_total: row.tvl0_total,
        tvl1_delta_24h: row.tvl1_delta_24h,
        tvl1_total: row.tvl1_total,
        depth0: row.depth0,
        depth1: row.depth1,
        depth_percent: row.depth_percent,
        last_event_id: row.last_event_id,
      };
    }),
    total_vote_weight: totalVoteWeight,
    pagination: {
      page,
      pageSize: responsePageSize,
      totalPages,
      totalItems: totalCount,
    },
  } satisfies z.infer<typeof ListVe33PoolsResponseType>;
}

export class ListVe33Pools extends EkuboAPIRoute {
  static route = "/ve33/:ve33Address/pools";

  static schema: OpenAPIRouteSchema = {
    tags: ["ve33"],
    summary: "List ve33 pools",
    description: "Returns the pools for a ve33 extension",
    parameters: {
      ve33Address: Path(AddressType, {
        description: "The ve33 extension contract address",
      }),
      chainId: Query(ChainIdType, {
        required: true,
        description: "Restrict results to a specific chain ID",
      }),
      pageSize: Query(z.coerce.number().int().min(1).max(200), {
        required: false,
        description:
          "Maximum number of ve33 pools to return per page. Returns all pools when omitted.",
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
        description: "The ve33 pools",
        schema: ListVe33PoolsResponseType,
      },
    },
  };

  async handle(
    { params: { ve33Address }, query }: IRequest,
    { env }: RequestContext,
  ) {
    const { chainId, page, pageSize } = parseListVe33PoolsFilters(query);
    const queries = await createQueries(env);
    const { rows, totalCount, totalVoteWeight } = await queries.getVe33Pools(
      BigInt(ve33Address),
      chainId,
      {
        page,
        pageSize,
      },
    );

    return json(
      buildListVe33PoolsResponse(
        rows,
        totalCount,
        totalVoteWeight,
        page,
        pageSize,
      ),
      {
        headers: {
          "cache-control": "public, max-age=30",
        },
      },
    );
  }
}

export class ListVe33TokensByAddress extends EkuboAPIRoute {
  static route = "/ve33/:veTokenAddress/:address";

  static schema: OpenAPIRouteSchema = {
    tags: ["ve33"],
    summary: "List ve33 tokens",
    description: "Returns the list of ve33 tokens owned by the address",
    parameters: {
      veTokenAddress: Path(AddressType, {
        description: "The veNFT contract address",
      }),
      address: Path(AddressType, {
        description: "The address for which to list ve33 tokens",
      }),
      chainId: Query(ChainIdType, {
        required: false,
        description: "Restrict results to a specific chain ID",
      }),
      pageSize: Query(z.coerce.number().int().min(1).max(200), {
        required: false,
        description: "Maximum number of ve33 tokens to return per page",
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
        description: "The ve33 tokens owned by the address",
        schema: ListVe33TokensResponseType,
      },
    },
  };

  async handle(
    { params: { address: addressStr, veTokenAddress }, query }: IRequest,
    { env }: RequestContext,
  ) {
    const { chainId, page, pageSize } = parseListVe33TokensFilters(query);
    const queries = await createQueries(env);
    const { rows, totalCount } = await queries.getVe33TokensByAddress(
      BigInt(addressStr),
      BigInt(veTokenAddress),
      chainId,
      {
        page,
        pageSize,
      },
    );

    return json(buildListVe33TokensResponse(rows, totalCount, page, pageSize), {
      headers: {
        "cache-control": "no-cache",
      },
    });
  }
}
