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

  const dates = twammOrderMetadatas.reduce<null | [Date, Date]>(
    (memo, value) => {
      const startTime =
        value.minted_timestamp > value.start_time
          ? value.minted_timestamp
          : value.start_time;
      if (!memo) return [startTime, value.end_time];

      return [
        startTime < memo[0] ? startTime : memo[0],
        value.end_time > memo[1] ? value.end_time : memo[1],
      ];
    },
    null,
  );

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

    formattedStartTime: formatTimeToUTC(dates?.[0] ?? new Date(0)),
    formattedEndTime: formatTimeToUTC(dates?.[1] ?? new Date()),
  });
}
