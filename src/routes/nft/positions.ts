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
  NumericStringType,
} from "../../shared/validation/address";
import { z } from "zod";
import { IRequest, json, StatusError } from "itty-router";
import { createQueries, type StateFilter } from "../../queries";
import toHex from "../../shared/toHex";
import {
  feeToPercent,
  formattedPrice,
  NFTMetadata,
  NFTMetadataSchema,
  tickSpacingToPercent,
  TokenIdType,
} from "./format";
import { getTokenByAddress } from "../meta/tokens";
import { generatePositionNft } from "./generatePositionNft";

const PositionEventsTimestampType = z.union([z.date(), z.string()]);

const PositionTransferEventType = z.object({
  type: z.literal("transfer"),
  block_number: z.string(),
  transaction_hash: HexStringType,
  timestamp: PositionEventsTimestampType,
  from_address: HexStringType,
  to_address: HexStringType,
});

const PositionUpdateEventType = z.object({
  type: z.literal("update"),
  block_number: z.string(),
  transaction_hash: HexStringType,
  timestamp: PositionEventsTimestampType,
  liquidity_delta: z.string(),
  delta0: z.string(),
  delta1: z.string(),
});

const PositionCollectFeesEventType = z.object({
  type: z.literal("collect_fees"),
  block_number: z.string(),
  transaction_hash: HexStringType,
  timestamp: PositionEventsTimestampType,
  delta0: z.string(),
  delta1: z.string(),
});

const PositionEventType = z.union([
  PositionTransferEventType,
  PositionUpdateEventType,
  PositionCollectFeesEventType,
]);

const PositionEventsResponseType = z.object({
  chain_id: NumericStringType,
  events: z.array(PositionEventType),
});

const PoolKeySummaryType = z.object({
  token0: HexStringType,
  token1: HexStringType,
  fee: HexStringType,
  tick_spacing: HexStringType,
  extension: HexStringType,
});

const PoolStateSummaryType = z.object({
  sqrt_ratio: DecimalStringType,
  tick: z.number().int(),
  liquidity: DecimalStringType,
});

const PositionSummaryType = z.object({
  id: HexStringType,
  chain_id: HexStringType,
  positions_address: HexStringType,
  pool_key: PoolKeySummaryType,
  bounds: z.object({
    lower: z.number(),
    upper: z.number(),
  }),
  metadata_url: z.string(),
  image: z.string(),
  liquidity: DecimalStringType,
  pool_state: PoolStateSummaryType.nullable(),
});

const PaginationMetadataType = z.object({
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1),
  totalPages: z.number().int().min(0),
  totalItems: z.number().int().min(0),
});

const ListPositionsResponseType = z.object({
  data: z.array(PositionSummaryType),
  pagination: PaginationMetadataType,
});

const PositionStateQueryType = z.enum(["opened", "closed"]);

export class GetPositionNftMetadata extends EkuboAPIRoute {
  static route = "/positions/:chainId/:nftAddress/:id";
  static schema: OpenAPIRouteSchema = {
    tags: ["Positions"],
    summary: "Get NFT Metadata",
    description: "Returns the ERC721 metadata for the given position token ID",
    parameters: {
      chainId: Path(NumericStringType, {
        description: "Chain ID for which to generate metadata",
      }),
      nftAddress: Path(AddressType, {
        description: "The address of the Positions NFT contract",
      }),
      id: Path(TokenIdType),
    },
    responses: {
      "200": {
        description: "The NFT metadata for the given position ID",
        contentType: "application/json",
        schema: NFTMetadataSchema,
      },
    },
  };

  async handle(
    { url, params: { id: idStr, chainId: chainIdParam, nftAddress } }: IRequest,
    { env }: RequestContext,
  ) {
    const id = BigInt(idStr);

    const chainId = BigInt(chainIdParam);
    const chainIdString = chainId.toString();

    const queries = await createQueries(env);

    let metadata: NFTMetadata;

    const positionMetadata = await queries.getPositionMetadata(
      chainId,
      BigInt(nftAddress),
      id,
    );

    if (positionMetadata === null) {
      throw new StatusError(404, `Token ID ${id} not found`);
    }

    const origin = new URL(url).origin;
    const image = `${origin}/positions/${chainIdString}/${nftAddress}/${id}/image.svg`;

    const attributesStored: NFTMetadata["attributes"] = [
      {
        trait_type: "positions_address",
        value: toHex(positionMetadata.positions_address),
      },
      {
        trait_type: "minted_tx_hash",
        value: toHex(positionMetadata.minted_tx_hash),
      },
      {
        trait_type: "token0",
        value: toHex(positionMetadata.token0),
      },
      {
        trait_type: "token1",
        value: toHex(positionMetadata.token1),
      },
      { trait_type: "fee", value: positionMetadata.fee.toString() },
      {
        trait_type: "tick_spacing",
        value: positionMetadata.tick_spacing.toString(),
      },
      {
        trait_type: "extension",
        value: toHex(positionMetadata.extension),
      },
      {
        trait_type: "tick_lower",
        value: positionMetadata.lower_bound.toString(),
      },
      {
        trait_type: "tick_upper",
        value: positionMetadata.upper_bound.toString(),
      },
      {
        trait_type: "minted_timestamp",
        value: positionMetadata.minted_timestamp.getTime().toString(),
      },
    ];
    attributesStored.push({
      trait_type: "chain_id",
      value: chainIdString,
    });

    const [token0, token1] = await Promise.all([
      getTokenByAddress(queries, chainId, positionMetadata.token0),
      getTokenByAddress(queries, chainId, positionMetadata.token1),
    ]);

    if (token0 && token1) {
      const reversed = token0.sort_order >= token1.sort_order;
      const [numerator, denominator, lowerPrice, upperPrice] = reversed
        ? [
            token0,
            token1,
            formattedPrice(
              -Number(positionMetadata.upper_bound),
              token0.decimals,
              token1.decimals,
            ),
            formattedPrice(
              -Number(positionMetadata.lower_bound),
              token0.decimals,
              token1.decimals,
            ),
          ]
        : [
            token1,
            token0,
            formattedPrice(
              Number(positionMetadata.lower_bound),
              token1.decimals,
              token0.decimals,
            ),
            formattedPrice(
              Number(positionMetadata.upper_bound),
              token1.decimals,
              token0.decimals,
            ),
          ];

      const isFullRange = Number(positionMetadata.tick_spacing) === 0;

      metadata = {
        name: `${numerator.symbol} / ${
          denominator.symbol
        } : ${lowerPrice} - ${upperPrice} : ${feeToPercent(
          positionMetadata.fee,
          positionMetadata.fee_denominator,
        )}F${isFullRange ? "MAX" : `${tickSpacingToPercent(positionMetadata.tick_spacing)}TS`}`,
        description: isFullRange
          ? `A full range liquidity position in Ekubo consisting of the ${numerator.name} and ${denominator.name} tokens and charging a ${feeToPercent(positionMetadata.fee, positionMetadata.fee_denominator)} fee on swaps.`
          : `A liquidity position in Ekubo consisting of the ${
              numerator.name
            } and ${
              denominator.name
            } tokens, active between the prices of ${lowerPrice} ${
              numerator.symbol
            } / ${denominator.symbol} to ${upperPrice} ${numerator.symbol} / ${
              denominator.symbol
            }. This position charges a ${feeToPercent(
              positionMetadata.fee,
              positionMetadata.fee_denominator,
            )} fee on swaps.`,
        image,
        attributes: attributesStored,
      };
    } else {
      metadata = {
        name: `Ekubo NFT #${id}`,
        description:
          "An NFT that represents a position in Ekubo Protocol. Metadata for this token was not found.",
        image,
        attributes: attributesStored,
      };
    }

    const response = metadata satisfies z.infer<typeof NFTMetadataSchema>;

    return json(response, {
      headers: {
        "cache-control": "public,max-age=3600,immutable",
      },
    });
  }
}

export class ListPositionNftEvents extends EkuboAPIRoute {
  static route = "/positions/:chainId/:lockerAddress/:id/history";
  static schema: OpenAPIRouteSchema = {
    tags: ["Positions"],
    summary: "List position history",
    description: "Returns the entire history of the given position ID",
    parameters: {
      chainId: Path(NumericStringType, {
        description: "Chain ID for which to list events",
      }),
      lockerAddress: Path(AddressType, {
        description: "The address of the Positions contract",
      }),
      id: Path(TokenIdType),
    },
    responses: {
      "200": {
        description: "The position history",
        contentType: "application/json",
        schema: PositionEventsResponseType,
      },
    },
  };

  async handle(
    { params: { id: idStr, chainId: chainIdParam, lockerAddress } }: IRequest,
    { env }: RequestContext,
  ) {
    const id = BigInt(idStr);
    const chainId = BigInt(chainIdParam);

    const queries = await createQueries(env);

    const history = await queries.getPositionHistory(
      id,
      BigInt(lockerAddress),
      chainId,
    );

    if (history.length === 0) {
      throw new StatusError(404, "Token ID not found");
    }

    const response = {
      chain_id: chainIdParam,
      events: history.map(
        ({
          transaction_hash,
          block_number,
          timestamp,
          type,
          from_address,
          to_address,
          liquidity_delta,
          delta0,
          delta1,
        }) =>
          type === 0
            ? {
                type: "transfer",
                block_number: block_number.toString(),
                transaction_hash: toHex(transaction_hash),
                timestamp,
                from_address: toHex(from_address),
                to_address: toHex(to_address),
              }
            : type === 1
              ? {
                  type: "update",
                  block_number: block_number.toString(),
                  transaction_hash: toHex(transaction_hash),
                  timestamp,
                  liquidity_delta,
                  delta0,
                  delta1,
                }
              : {
                  type: "collect_fees",
                  block_number: block_number.toString(),
                  transaction_hash: toHex(transaction_hash),
                  timestamp,
                  delta0,
                  delta1,
                },
      ),
    } satisfies z.infer<typeof PositionEventsResponseType>;

    return json(response, {
      headers: {
        "cache-control": "public, max-age=60, must-revalidate",
      },
    });
  }
}

export class GetPositionNftImage extends EkuboAPIRoute {
  static route = "/positions/:chainId/:nftAddress/:id/image.svg";

  static schema: OpenAPIRouteSchema = {
    tags: ["Positions"],
    summary: "Get NFT Image",
    description: "Returns the generated art for the given position NFT ID",
    parameters: {
      chainId: Path(NumericStringType),
      nftAddress: Path(AddressType, {
        description: "The address of the Positions NFT contract",
      }),
      id: Path(TokenIdType),
    },
    responses: {
      "200": {
        description: "The position NFT image",
        contentType: "application/json",
      },
    },
  };

  async handle(
    { params: { id: idStr, chainId: chainIdParam, nftAddress } }: IRequest,
    { env }: RequestContext,
  ) {
    const id = BigInt(idStr);
    const chainId = BigInt(chainIdParam);

    const queries = await createQueries(env);

    const positionMetadata = await queries.getPositionMetadata(
      chainId,
      BigInt(nftAddress),
      id,
    );

    if (positionMetadata === null) {
      throw new StatusError(404, `Token ID ${id} not found`);
    }

    const svgString = await generatePositionNft(
      id,
      chainIdParam,
      queries,
      positionMetadata,
    );

    return new Response(svgString, {
      status: 200,
      headers: {
        "content-type": "image/svg+xml",
        "cache-control": "public, max-age=86400, immutable",
      },
    });
  }
}

export class ListPositionsByAddress extends EkuboAPIRoute {
  static route = "/positions/:address";

  static schema: OpenAPIRouteSchema = {
    tags: ["Positions"],
    summary: "List positions",
    description: "Returns the list of position NFTs and their keys",
    parameters: {
      address: Path(AddressType, {
        description: "The address for which to list positions",
      }),
      state: Query(PositionStateQueryType, {
        required: false,
        description:
          "Filter positions by state; defaults to returning all positions",
      }),
      chainId: Query(ChainIdType, {
        required: false,
        description: "Restrict results to a specific chain ID",
      }),
      pageSize: Query(z.coerce.number().int().min(1).max(200), {
        required: false,
        description: "Maximum number of positions to return per page",
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
        description: "The position NFTs owned by the address and keys",
        contentType: "application/json",
        schema: ListPositionsResponseType,
      },
    },
  };

  async handle(
    { params: { address: addressStr }, query, url }: IRequest,
    { env }: RequestContext,
  ) {
    const address = BigInt(addressStr);

    const stateParam =
      typeof query?.state === "string" ? query.state.toLowerCase() : null;
    const state: StateFilter | null =
      stateParam === "opened" || stateParam === "closed"
        ? (stateParam as StateFilter)
        : null;
    const chainId =
      typeof query?.chainId === "string" ? BigInt(query.chainId) : null;
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

    const queries = await createQueries(env);
    const { rows, totalCount } = await queries.getPositionsByAddress(
      address,
      state,
      chainId,
      {
        page,
        pageSize,
      },
    );

    const origin = new URL(url).origin;
    const totalPages = totalCount === 0 ? 0 : Math.ceil(totalCount / pageSize);

    const response = {
      data: rows.map((row) => {
        return {
          id: toHex(BigInt(row.token_id)),
          chain_id: toHex(row.chain_id),
          positions_address: toHex(row.positions_address),
          pool_key: {
            token0: toHex(row.token0),
            token1: toHex(row.token1),
            fee: toHex(row.fee),
            tick_spacing: toHex(row.tick_spacing),
            extension: toHex(row.extension),
          },
          bounds: {
            lower: Number(row.lower_bound),
            upper: Number(row.upper_bound),
          },
          metadata_url: `${origin}/positions/${row.chain_id}/${row.nft_address}/${row.token_id}`,
          image: `${origin}/positions/${row.chain_id}/${row.nft_address}/${row.token_id}/image.svg`,
          liquidity: row.liquidity,
          pool_state: {
            sqrt_ratio: row.pool_state_sqrt_ratio,
            tick: Number(row.pool_state_tick),
            liquidity: row.pool_state_liquidity,
          },
        };
      }),
      pagination: {
        page,
        pageSize,
        totalPages,
        totalItems: totalCount,
      },
    } satisfies z.infer<typeof ListPositionsResponseType>;

    return json(response, {
      headers: {
        "cache-control": "no-cache",
      },
    });
  }
}
