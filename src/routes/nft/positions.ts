import { EkuboAPIRoute, RequestContext } from "../../shared/context";
import {
  OpenAPIRouteSchema,
  Path,
  Query,
} from "@cloudflare/itty-router-openapi";
import {
  AddressType,
  ChainIdType,
  NumericStringType,
} from "../../shared/validation/address";
import { z } from "zod";
import { IRequest, json, StatusError } from "itty-router";
import { createQueries } from "../../queries";
import toHex from "../../shared/toHex";
import {
  feeToPercent,
  formattedPrice,
  NFTMetadata,
  tickSpacingToPercent,
  TokenIdType,
} from "./format";
import { getTokenByAddress } from "../meta/tokens";
import { generatePositionNft } from "./generatePositionNft";

export class GetPositionNftMetadata extends EkuboAPIRoute {
  static route = "/positions/:chainId/nft/:id";
  static schema: OpenAPIRouteSchema = {
    tags: ["Positions"],
    summary: "Get NFT Metadata",
    description: "Returns the ERC721 metadata for the given position token ID",
    parameters: {
      chainId: Path(NumericStringType, {
        description: "Chain ID for which to generate metadata",
      }),
      id: Path(TokenIdType),
    },
    responses: {
      "200": {
        description: "The NFT metadata for the given position ID",
        contentType: "application/json",
      },
    },
  };

  async handle(
    { url, params: { id: idStr, chainId: chainIdParam } }: IRequest,
    { env }: RequestContext,
  ) {
    const id = BigInt(idStr);

    const chainId = BigInt(chainIdParam);
    const chainIdString = chainId.toString();

    const queries = await createQueries(env);

    let metadata: NFTMetadata;

    const positionMetadata = await queries.getPositionMetadata(id, chainId);

    if (positionMetadata === null) {
      throw new StatusError(404, `Token ID ${id} not found`);
    }

    const origin = new URL(url).origin;
    const image = `${origin}/positions/${chainIdString}/nft/${id}/image.svg`;

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
        )}%F${isFullRange ? "MAX" : `${tickSpacingToPercent(positionMetadata.tick_spacing)}%TS`}`,
        description: isFullRange
          ? `A full range liquidity position in Ekubo consisting of the ${numerator.name} and ${denominator.name} tokens and charging a ${feeToPercent(positionMetadata.fee)}% fee on swaps.`
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
            )}% fee on swaps.`,
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

    return json(metadata, {
      headers: {
        "cache-control": "public,max-age=3600,immutable",
      },
    });
  }
}

export class ListPositionNftEvents extends EkuboAPIRoute {
  static route = "/positions/:chainId/nft/:id/history";
  static schema: OpenAPIRouteSchema = {
    tags: ["Positions"],
    summary: "List position history",
    description: "Returns the entire history of the given position ID",
    parameters: {
      chainId: Path(NumericStringType, {
        description: "Chain ID for which to list events",
      }),
      id: Path(TokenIdType),
    },
    responses: {
      "200": {
        description: "The position history",
        contentType: "application/json",
      },
    },
  };

  async handle(
    { params: { id: idStr, chainId: chainIdParam } }: IRequest,
    { env }: RequestContext,
  ) {
    const id = BigInt(idStr);
    const chainId = BigInt(chainIdParam);

    const queries = await createQueries(env);

    if (!(await queries.getPositionMetadata(id, chainId))) {
      throw new StatusError(404, "Token ID not found");
    }

    const history = await queries.getPositionHistory(id, chainId);

    return json(
      {
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
                  block_number: block_number,
                  transaction_hash: toHex(transaction_hash),
                  timestamp,
                  from_address: toHex(from_address),
                  to_address: toHex(to_address),
                }
              : type === 1
                ? {
                    type: "update",
                    block_number: block_number,
                    transaction_hash: toHex(transaction_hash),
                    timestamp,
                    liquidity_delta,
                    delta0,
                    delta1,
                  }
                : {
                    type: "collect_fees",
                    block_number: block_number,
                    transaction_hash: toHex(transaction_hash),
                    timestamp,
                    delta0,
                    delta1,
                  },
        ),
      },
      {
        headers: {
          "cache-control": "public, max-age=60, must-revalidate",
        },
      },
    );
  }
}

export class GetPositionNftImage extends EkuboAPIRoute {
  static route = "/positions/:chainId/nft/:id/image.svg";

  static schema: OpenAPIRouteSchema = {
    tags: ["Positions"],
    summary: "Get NFT Image",
    description: "Returns the generated art for the given position NFT ID",
    parameters: {
      chainId: Path(NumericStringType),
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
    { params: { id: idStr, chainId: chainIdParam } }: IRequest,
    { env }: RequestContext,
  ) {
    const id = BigInt(idStr);
    const chainId = BigInt(chainIdParam);

    const queries = await createQueries(env);

    const positionMetadata = await queries.getPositionMetadata(id, chainId);

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
      showClosed: Query(z.coerce.boolean()),
      chainId: Query(ChainIdType, {
        required: false,
        description: "Restrict results to a specific chain ID",
      }),
    },
    responses: {
      "200": {
        description: "The position NFTs owned by the address and keys",
        contentType: "application/json",
      },
    },
  };

  async handle(
    { params: { address: addressStr }, query, url }: IRequest,
    { env }: RequestContext,
  ) {
    const address = BigInt(addressStr);

    const showClosed = query?.showClosed === "true";
    const chainId =
      typeof query?.chainId === "string" ? BigInt(query.chainId) : null;

    const queries = await createQueries(env);
    const { rows } = await queries.getPositionsByAddress(
      address,
      showClosed,
      chainId,
    );

    const origin = new URL(url).origin;

    return json(
      {
        data: rows.map((row) => {
          const chainIdValue = row.chain_id?.toString() ?? "";
          return {
            id: toHex(BigInt(row.token_id)),
            chain_id: chainIdValue,
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
            metadata_url: `${origin}/positions/${chainIdValue}/nft/${row.token_id}`,
            image: `${origin}/positions/${chainIdValue}/nft/${row.token_id}/image.svg`,
            minted_timestamp: row.minted_timestamp.getTime(),
            is_closed: row.is_closed,
          };
        }),
      },
      {
        headers: {
          "cache-control": "no-cache",
        },
      },
    );
  }
}
