import { generateDCAOrderSvg } from "@ekubo/position-svg-generator";
import { getTokenByAddress } from "../meta/tokens";
import { Queries, TwammOrderMetadata } from "../../queries";
import { formatTimeToUTC } from "./format";

export async function generateDcaOrderNft(
  id: bigint,
  chainId: string,
  queries: Queries,
  twammOrderMetadatas: TwammOrderMetadata[],
  timedOrderKind: "dca" | "auction" = "dca",
) {
  const firstOrderMetadata = twammOrderMetadatas[0];

  let numericChainId: bigint;
  try {
    numericChainId = BigInt(chainId);
  } catch {
    throw new Error(`Invalid chain ID provided: "${chainId}"`);
  }

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

  const [sellToken, buyToken] = await Promise.all([
    getTokenByAddress(queries, numericChainId, sellTokenAddress),
    getTokenByAddress(queries, numericChainId, buyTokenAddress),
  ]);

  return await generateDCAOrderSvg(
    id,
    chainId,
    {
      sellTokenAddress,
      buyTokenAddress,

      sellTokenSrc: sellToken?.logo_url,
      buyTokenSrc: buyToken?.logo_url,

      sellTokenSymbol: sellToken?.symbol,
      buyTokenSymbol: buyToken?.symbol,

      formattedStartTime: formatTimeToUTC(dates?.[0] ?? new Date(0)),
      formattedEndTime: formatTimeToUTC(dates?.[1] ?? new Date()),
    },
    { kind: timedOrderKind },
  );
}
