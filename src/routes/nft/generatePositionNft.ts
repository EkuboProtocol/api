import { Env } from "../../env";
import {
  generateDCAOrderSvg,
  generatePositionSvg,
} from "@ekubo/position-svg-generator";
import { getTokenByAddress } from "../meta/tokens";
import { PositionMetadata, Queries } from "../../queries";
import { feeToPercent, formattedPrice, tickSpacingToPercent } from "./format";

export async function generatePositionNft(
  id: bigint,
  chainId: string,
  env: Env,
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

  const isFullRange = Number(positionMetadata.tick_spacing) === 0;
  const extensionValue = BigInt(positionMetadata.extension);

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

  return await generatePositionSvg(id, chainId, {
    token0Symbol: token0?.symbol,
    token1Symbol: token1?.symbol,

    token0Address: positionMetadata.token0,
    token1Address: positionMetadata.token1,

    token0Src: token0?.logo_url,
    token1Src: token1?.logo_url,

    formattedFeePercent: `${feeToPercent(positionMetadata.fee)}%`,
    formattedTickSpacingPercent: `${tickSpacingToPercent(positionMetadata.tick_spacing)}%`,

    formattedMinPrice: formattedMinPrice,
    formattedMaxPrice: formattedMaxPrice,

    type:
      extensionValue === 0n
        ? isFullRange
          ? "full_range"
          : undefined
        : extensionValue === BigInt(env.TWAMM_ADDRESS)
          ? "dca"
          : extensionValue === BigInt(env.ORACLE_ADDRESS)
            ? "oracle"
            : extensionValue === BigInt(env.MEV_CAPTURE_ADDRESS)
              ? "mev_capture"
              : undefined,
  });
}
