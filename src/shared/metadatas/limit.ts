import { LimitOrderMetadata } from "../../queries";
import { NFTMetadata } from "../../routes/nft/format";
import { DOUBLE_LIMIT_ORDER_TICK_SPACING } from "../constants";
import toHex from "../toHex";

export function generateLimitOrderNftMetadata(
  limitOrderMetadata: LimitOrderMetadata[],
  image: string,
): NFTMetadata {
  return {
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
}
