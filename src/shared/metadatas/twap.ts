import { Queries, TwammOrderMetadata } from "../../queries";
import { NFTMetadata } from "../../routes/nft/format";
import toHex from "../toHex";

export function generateTwapOrderNftMetadata(
  twammOrderMetadata: TwammOrderMetadata[],
  image: string,
): NFTMetadata {
  return {
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
}
