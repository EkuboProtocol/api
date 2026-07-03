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

const Ve33TokenType = z.object({
  chain_id: HexStringType,
  owner: HexStringType,
  ve_token_address: HexStringType,
  ve33_address: HexStringType,
  token_id: HexStringType,
  stake_id: HexStringType,
  amount: DecimalStringType,
  end_time: TimestampType,
  current_voting_power: DecimalStringType,
  voted_pool_id: HexStringType.nullable(),
  pool_key_id: DecimalStringType.nullable(),
  applied_vote_weight: DecimalStringType.nullable(),
  pool_total_vote_weight: DecimalStringType.nullable(),
  minted_at: TimestampType.nullable(),
  mint_transaction_hash: HexStringType.nullable(),
  last_stake_changed_event_id: DecimalStringType,
  last_transfer_event_id: DecimalStringType,
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

function parseListVe33TokensFilters(query: IRequest["query"]) {
  return {
    chainId: typeof query?.chainId === "string" ? BigInt(query.chainId) : null,
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
      current_voting_power: row.current_voting_power,
      voted_pool_id: row.voted_pool_id ? toHex(row.voted_pool_id) : null,
      pool_key_id: row.pool_key_id,
      applied_vote_weight: row.applied_vote_weight,
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
