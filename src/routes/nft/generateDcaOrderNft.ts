import { generateDCAOrderSvg } from "@ekubo/position-svg-generator";
import { Env } from "../../env";
import { getTokenByAddress, TokenInfo } from "../meta/tokens";
import { TwammOrderMetadata } from "../../queries";
import { formatTimeToUTC } from "./format";

export async function generateDcaOrderNft(
  id: bigint,
  chainId: Env["CHAIN_ID"],
  tokens: TokenInfo[],
  twammOrderMetadatas: TwammOrderMetadata[],
) {
  const firstOrderMetadata = twammOrderMetadatas[0];

  const [sellTokenAddress, buyTokenAddress] =
    BigInt(firstOrderMetadata.sale_rate0) > 0n
      ? [firstOrderMetadata.token0, firstOrderMetadata.token1]
      : [firstOrderMetadata.token1, firstOrderMetadata.token0];

  const [sellToken, buyToken] = [
    getTokenByAddress(tokens, sellTokenAddress),
    getTokenByAddress(tokens, buyTokenAddress),
  ];

  return await generateDCAOrderSvg(id, chainId, {
    sellTokenAddress,
    buyTokenAddress,

    sellTokenSrc: sellToken?.logo_url,
    buyTokenSrc: buyToken?.logo_url,

    sellTokenSymbol: sellToken?.symbol,
    buyTokenSymbol: buyToken?.symbol,

    formattedEndTime: formatTimeToUTC(firstOrderMetadata.end_time),
    formattedStartTime: formatTimeToUTC(firstOrderMetadata.start_time),
  });
}
