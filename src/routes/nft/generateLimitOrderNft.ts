import { generateLimitOrderSvg } from "@ekubo/position-svg-generator";
import { getTokenByAddress } from "../meta/tokens";
import { LimitOrderMetadata, Queries } from "../../queries";
import { formatAmount, formattedPrice } from "./format";
import { DOUBLE_LIMIT_ORDER_TICK_SPACING } from "../../shared/constants";

export async function generateLimitOrderNft(
  id: bigint,
  chainId: string,
  queries: Queries,
  limitOrderMetadata: LimitOrderMetadata[],
) {
  const firstOrderMetadata = limitOrderMetadata[0];

  let numericChainId: bigint;
  try {
    numericChainId = BigInt(chainId);
  } catch {
    throw new Error(`Invalid chain ID provided: "${chainId}"`);
  }

  const isSellingToken0 =
    firstOrderMetadata.tick % DOUBLE_LIMIT_ORDER_TICK_SPACING === 0;

  const [sellTokenAddress, buyTokenAddress] = isSellingToken0
    ? [firstOrderMetadata.token0, firstOrderMetadata.token1]
    : [firstOrderMetadata.token1, firstOrderMetadata.token0];

  const [sellToken, buyToken] = await Promise.all([
    getTokenByAddress(queries, numericChainId, sellTokenAddress),
    getTokenByAddress(queries, numericChainId, buyTokenAddress),
  ]);

  const reversed =
    sellToken && buyToken && sellToken.sort_order >= buyToken.sort_order;

  const formattedLimitPrice =
    !sellToken || !buyToken
      ? undefined
      : reversed
        ? `${formattedPrice(-firstOrderMetadata.tick, sellToken.decimals, buyToken.decimals)} ${sellToken.symbol} / ${buyToken.symbol}`
        : `${formattedPrice(firstOrderMetadata.tick, buyToken.decimals, sellToken.decimals)} ${buyToken.symbol} / ${sellToken.symbol}`;

  const formattedSellAmount = sellToken
    ? `${formatAmount(firstOrderMetadata.amount, sellToken.decimals)} ${sellToken.symbol}`
    : undefined;

  return await generateLimitOrderSvg(id, chainId, {
    sellTokenAddress,
    buyTokenAddress,

    sellTokenSrc: sellToken?.logo_url,
    buyTokenSrc: buyToken?.logo_url,

    sellTokenSymbol: sellToken?.symbol,
    buyTokenSymbol: buyToken?.symbol,

    formattedLimitPrice,
    formattedSellAmount,
  });
}
