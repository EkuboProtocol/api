import { PositionMetadata, Queries } from "../../queries";
import { getTokenByAddress } from "../../routes/meta/tokens";
import {
  feeToPercent,
  formattedPrice,
  NFTMetadata,
  tickSpacingToPercent,
} from "../../routes/nft/format";
import toHex from "../toHex";

export async function generatePositionNftMetadata(
  positionMetadata: PositionMetadata,
  tokenId: bigint,
  queries: Queries,
  chainId: bigint,
  image: string,
): Promise<NFTMetadata> {
  const attributesStored: NFTMetadata["attributes"] = [
    {
      trait_type: "positions_address",
      value: toHex(positionMetadata.positions_address),
    },
    {
      trait_type: "minted_tx_hash",
      value: toHex(positionMetadata.minted_tx_hash),
    },
    { trait_type: "token0", value: toHex(positionMetadata.token0) },
    { trait_type: "token1", value: toHex(positionMetadata.token1) },
    { trait_type: "fee", value: positionMetadata.fee.toString() },
    {
      trait_type: "tick_spacing",
      value: positionMetadata.tick_spacing?.toString() ?? null,
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
    {
      trait_type: "chain_id",
      value: chainId.toString(),
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

    const isFullRange = positionMetadata.tick_spacing === null;

    return {
      name: `${numerator.symbol} / ${
        denominator.symbol
      } : ${lowerPrice} <> ${upperPrice} : ${feeToPercent(
        positionMetadata.fee,
        positionMetadata.fee_denominator,
      )}% / ${isFullRange ? "MAX" : tickSpacingToPercent(positionMetadata.tick_spacing ?? "")}%`,
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
          )}% fee on swaps.`,
      image,
      attributes: attributesStored,
    };
  } else {
    return {
      name: `Ekubo NFT #${tokenId}`,
      description:
        "An NFT that represents a position in Ekubo Protocol. Metadata for this token was not found.",
      image,
      attributes: attributesStored,
    };
  }
}
