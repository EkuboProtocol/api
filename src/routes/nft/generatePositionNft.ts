import { generatePositionSvg } from "@ekubo/position-svg-generator";
import { getTokenByAddress } from "../meta/tokens";
import { PositionMetadata, Queries } from "../../queries";
import { feeToPercent, formattedPrice, tickSpacingToPercent } from "./format";

export async function generatePositionNft(
  id: bigint,
  chainId: string,
  queries: Queries,
  positionMetadata: PositionMetadata,
): Promise<string> {
  let numericChainId: bigint;
  try {
    numericChainId = BigInt(chainId);
  } catch {
    throw new Error(`Invalid chain ID provided: "${chainId}"`);
  }

  const [token0, token1] = await Promise.all([
    getTokenByAddress(queries, numericChainId, positionMetadata.token0),
    getTokenByAddress(queries, numericChainId, positionMetadata.token1),
  ]);

  const reversed = token0 && token1 && token0.sort_order >= token1.sort_order;

  const isFullRange = positionMetadata.tick_spacing === null;
  const extensionValue = BigInt(positionMetadata.extension);

  const poolClassification = await queries.getPoolClassification({
    chainId: numericChainId,
    token0: BigInt(positionMetadata.token0),
    token1: BigInt(positionMetadata.token1),
    fee: BigInt(positionMetadata.fee),
    tickSpacing: Number(positionMetadata.tick_spacing),
    extension: extensionValue,
  });

  let poolType: "dca" | "oracle" | "mev_capture" | "full_range" | undefined;

  if (poolClassification?.is_twamm) {
    poolType = "dca";
  } else if (poolClassification?.is_oracle) {
    poolType = "oracle";
  } else if (poolClassification?.is_mev_capture) {
    poolType = "mev_capture";
  } else if (extensionValue === 0n && isFullRange) {
    poolType = "full_range";
  }

  const [formattedMinPrice, formattedMaxPrice] =
    !token0 || !token1 || isFullRange
      ? [undefined, undefined]
      : reversed
        ? [
            `${formattedPrice(
              -Number(positionMetadata.upper_bound),
              token0.decimals,
              token1.decimals,
            )} ${token0.symbol} / ${token1.symbol}`,
            `${formattedPrice(
              -Number(positionMetadata.lower_bound),
              token0.decimals,
              token1.decimals,
            )} ${token0.symbol} / ${token1.symbol}`,
          ]
        : [
            `${formattedPrice(
              Number(positionMetadata.lower_bound),
              token1.decimals,
              token0.decimals,
            )} ${token1.symbol} / ${token0.symbol}`,
            `${formattedPrice(
              Number(positionMetadata.upper_bound),
              token1.decimals,
              token0.decimals,
            )} ${token1.symbol} / ${token0.symbol}`,
          ];

  return generatePositionSvg(id, chainId, {
    token0Symbol: token0?.symbol,
    token1Symbol: token1?.symbol,

    token0Address: positionMetadata.token0,
    token1Address: positionMetadata.token1,

    token0Src: token0?.logo_url,
    token1Src: token1?.logo_url,

    formattedFeePercent: feeToPercent(
      positionMetadata.fee,
      positionMetadata.fee_denominator,
    ),
    formattedTickSpacingPercent: tickSpacingToPercent(
      positionMetadata.tick_spacing ?? "",
    ),

    formattedMinPrice,
    formattedMaxPrice,

    type: poolType,
  });
}
