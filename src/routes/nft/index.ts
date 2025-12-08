import { IRequest, json, StatusError } from "itty-router";
import { generateDcaOrderNft } from "./generateDcaOrderNft";
import { generateLimitOrderNft } from "./generateLimitOrderNft";
import { generatePositionNft } from "./generatePositionNft";
import { EkuboAPIRoute, RequestContext } from "../../shared/context";
import { OpenAPIRouteSchema, Path } from "@cloudflare/itty-router-openapi";
import {
  feeToPercent,
  formattedPrice,
  NFTMetadata,
  tickSpacingToPercent,
  TokenIdType,
} from "./format";
import { createQueries } from "../../queries";
import toHex from "../../shared/toHex";
import { getTokenByAddress } from "../meta/tokens";
import { DOUBLE_LIMIT_ORDER_TICK_SPACING } from "../../shared/constants";

export class GetNftMetadata extends EkuboAPIRoute {
  static route = "/nft/:chainId/:nftAddress/:id";

  static schema: OpenAPIRouteSchema = {
    tags: ["Positions"],
    summary: "Get NFT Metadata",
    description:
      "Returns the ERC721 metadata for the given token ID, chain ID and NFT contract address",
    parameters: {
      id: Path(TokenIdType),
    },
    responses: {
      "200": {
        description: "The NFT metadata for the given position ID",
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
    console.log(positionMetadata);
    const twammOrderMetadata =
      positionMetadata === null
        ? await queries.getTwammOrderMetadata(id, BigInt(nftAddress), chainId)
        : null;
    const limitOrderMetadata =
      positionMetadata === null && (twammOrderMetadata?.length ?? 0) === 0
        ? await queries.getLimitOrderMetadata(id, BigInt(nftAddress), chainId)
        : null;

    const origin = new URL(url).origin;
    const image = `${origin}/nft/${chainIdString}/${nftAddress}/${id}/image.svg`;

    if (positionMetadata !== null) {
      const attributesStored: NFTMetadata["attributes"] = [
        {
          trait_type: "minted_tx_hash",
          value: toHex(positionMetadata.minted_tx_hash),
        },
        { trait_type: "token0", value: toHex(positionMetadata.token0) },
        { trait_type: "token1", value: toHex(positionMetadata.token1) },
        { trait_type: "fee", value: positionMetadata.fee.toString() },
        {
          trait_type: "tick_spacing",
          value: positionMetadata.tick_spacing.toString(),
        },
        {
          trait_type: "extension",
          value: toHex(positionMetadata.extension).toString(),
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

        metadata = {
          name: `${numerator.symbol} / ${
            denominator.symbol
          } : ${lowerPrice} <> ${upperPrice} : ${feeToPercent(
            positionMetadata.fee,
            positionMetadata.fee_denominator,
          )}% / ${tickSpacingToPercent(positionMetadata.tick_spacing)}%`,
          description: `A liquidity position in Ekubo consisting of the ${
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
          )}% fee on swaps.`,
          image,
          attributes: attributesStored,
        };
      } else {
        metadata = {
          name: `Ekubo NFT #${id}`,
          description: "An NFT that represents a position in Ekubo Protocol",
          image,
          attributes: attributesStored,
        };
      }
    } else if (twammOrderMetadata && twammOrderMetadata?.length !== 0) {
      metadata = {
        name: "Ekubo TWAP Order",
        image,
        attributes: [
          {
            trait_type: "minted_tx_hash",
            value: toHex(twammOrderMetadata[0].minted_tx_hash),
          },
          {
            trait_type: "minted_timestamp",
            value: twammOrderMetadata[0].minted_timestamp.getTime().toString(),
          },
        ].concat(
          twammOrderMetadata.flatMap((metadata, ix) => [
            {
              trait_type: `start_time_${ix}`,
              value: (metadata.start_time.getTime() / 1000).toString(),
            },
            {
              trait_type: `end_time_${ix}`,
              value: (metadata.end_time.getTime() / 1000).toString(),
            },
            {
              trait_type: `fee_${ix}`,
              value: toHex(BigInt(metadata.fee)),
            },
            {
              trait_type: `last_update_time_${ix}`,
              value: (metadata.last_update_time.getTime() / 1000).toString(),
            },
            ...(BigInt(metadata.sale_rate0) === 0n &&
            BigInt(metadata.sale_rate1) === 0n
              ? []
              : BigInt(metadata.sale_rate0) > 0n
                ? [
                    {
                      trait_type: `sell_token_${ix}`,
                      value: toHex(BigInt(metadata.token0)),
                    },
                    {
                      trait_type: `buy_token_${ix}`,
                      value: toHex(BigInt(metadata.token1)),
                    },
                  ]
                : [
                    {
                      trait_type: `sell_token_${ix}`,
                      value: toHex(BigInt(metadata.token1)),
                    },
                    {
                      trait_type: `buy_token_${ix}`,
                      value: toHex(BigInt(metadata.token0)),
                    },
                  ]),
          ]),
        ),
        description: "A TWAP order in Ekubo Protocol",
      };
    } else if (limitOrderMetadata && limitOrderMetadata.length !== 0) {
      metadata = {
        name: "Ekubo Limit Order",
        description: "A Limit order in Ekubo Protocol",
        image,
        attributes: [
          {
            trait_type: "minted_tx_hash",
            value: toHex(limitOrderMetadata[0].minted_tx_hash),
          },
          {
            trait_type: "minted_timestamp",
            value: limitOrderMetadata[0].minted_timestamp.getTime().toString(),
          },
        ].concat(
          limitOrderMetadata.flatMap((metadata, ix) => {
            const isSellingToken0 =
              metadata.tick % DOUBLE_LIMIT_ORDER_TICK_SPACING === 0;

            const [sellToken, buyToken] = isSellingToken0
              ? [metadata.token0, metadata.token1]
              : [metadata.token1, metadata.token0];

            return [
              {
                trait_type: `sell_amount_${ix}`,
                value: metadata.amount ?? "0",
              },
              {
                trait_type: `limit_tick_${ix}`,
                value: metadata.tick.toString(),
              },
              {
                trait_type: `sell_token_${ix}`,
                value: toHex(BigInt(sellToken)),
              },
              {
                trait_type: `buy_token_${ix}`,
                value: toHex(BigInt(buyToken)),
              },
            ];
          }),
        ),
      };
    } else {
      throw new StatusError(404, `Token ID ${id} not found`);
    }

    return json(metadata, {
      headers: {
        "cache-control": "public,max-age=3600,immutable",
      },
    });
  }
}

export class GetNftImage extends EkuboAPIRoute {
  static route = "/nft/:chainId/:nftAddress/:id/image.svg";

  static schema: OpenAPIRouteSchema = {
    tags: ["Positions"],
    summary: "Get NFT Image",
    description: "Returns the generated art for the given position NFT ID",
    parameters: {
      id: Path(TokenIdType),
    },
    responses: {
      "200": {
        description: "The position NFT image",
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
    const twammOrderMetadata =
      positionMetadata === null
        ? await queries.getTwammOrderMetadata(id, BigInt(nftAddress), chainId)
        : null;
    const limitOrderMetadata =
      positionMetadata === null && (twammOrderMetadata?.length ?? 0) === 0
        ? await queries.getLimitOrderMetadata(id, BigInt(nftAddress), chainId)
        : null;

    let svgString: string | null = null;

    if (positionMetadata !== null) {
      svgString = await generatePositionNft(
        BigInt(id),
        chainIdParam,
        queries,
        positionMetadata,
      );
    } else if (twammOrderMetadata && twammOrderMetadata?.length !== 0) {
      svgString = await generateDcaOrderNft(
        BigInt(id),
        chainIdParam,
        queries,
        twammOrderMetadata,
      );
    } else if (limitOrderMetadata && limitOrderMetadata.length !== 0) {
      svgString = await generateLimitOrderNft(
        BigInt(id),
        chainIdParam,
        queries,
        limitOrderMetadata,
      );
    } else {
      throw new StatusError(404, `Token ID ${id} not found`);
    }

    return new Response(svgString, {
      status: 200,
      headers: {
        "content-type": "image/svg+xml",
        "cache-control": "public, max-age=86400, immutable",
      },
    });
  }
}
