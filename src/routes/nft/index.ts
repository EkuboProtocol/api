import { EkuboAPIRoute } from "../_shared/context";
import { error, IRequest, json } from "itty-router";
import { Env } from "../../env";
import { getAllTokens, getTokenByAddress } from "../meta/tokens";
import { generateSvg } from "./generateSvg";
import { parseId } from "./parseId";
import Decimal from "decimal.js-light";
import { createQueries } from "../../queries";
import { num } from "starknet";

export interface NFTMetadata {
  name: string;

  description: string;

  image: string;

  attributes: {
    trait_type: string;
    value: string;
  }[];
}

const BASE = new Decimal("1.000001");

export function formattedPrice(
  tick: bigint,
  numeratorDecimals: number,
  denominatorDecimals: number
): string {
  return BASE.pow(tick.toString())
    .mul(new Decimal(10).pow(denominatorDecimals - numeratorDecimals))
    .toSignificantDigits(6)
    .toString();
}

const U128 = new Decimal(2).pow(128);

export function feeToPercent(fee: string) {
  return new Decimal(fee).div(U128).mul(100).toSignificantDigits(4).toString();
}

export function tickSpacingToPercent(tick_spacing: string) {
  return BASE.pow(tick_spacing)
    .sub(1)
    .mul(100)
    .toSignificantDigits(4)
    .toString();
}

export class GetNftMetadata extends EkuboAPIRoute {
  async handle({ url, params: { id: idStr } }: IRequest, env: Env) {
    const id = parseId(idStr);
    if (id === null) {
      return error(400, "Invalid token ID");
    }

    const queries = await createQueries(env);

    const positionMetadata = await queries.getPositionMetadata(id);

    if (positionMetadata === null) {
      return error(404, `Token ID ${id} not found`);
    }

    const attributesStored: NFTMetadata["attributes"] = [
      {
        trait_type: "minted_tx_hash",
        value: num.toHex(positionMetadata.minted_tx_hash),
      },
      { trait_type: "token0", value: num.toHex(positionMetadata.token0) },
      { trait_type: "token1", value: num.toHex(positionMetadata.token1) },
      { trait_type: "fee", value: positionMetadata.fee.toString() },
      {
        trait_type: "tick_spacing",
        value: positionMetadata.tick_spacing.toString(),
      },
      {
        trait_type: "extension",
        value: num.toHex(positionMetadata.extension).toString(),
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

    const allTokens = await getAllTokens(env, queries);

    const origin = new URL(url).origin;

    const token0 = getTokenByAddress(allTokens, positionMetadata.token0);
    const token1 = getTokenByAddress(allTokens, positionMetadata.token1);

    let metadata: NFTMetadata;
    if (token0 && token1) {
      const reversed = token0.sort_order >= token1.sort_order;
      const [numerator, denominator, lowerPrice, upperPrice] = reversed
        ? [
            token0,
            token1,
            formattedPrice(
              -BigInt(positionMetadata.upper_bound),
              token0.decimals,
              token1.decimals
            ),
            formattedPrice(
              -BigInt(positionMetadata.lower_bound),
              token0.decimals,
              token1.decimals
            ),
          ]
        : [
            token1,
            token0,
            formattedPrice(
              BigInt(positionMetadata.lower_bound),
              token1.decimals,
              token0.decimals
            ),
            formattedPrice(
              BigInt(positionMetadata.upper_bound),
              token1.decimals,
              token0.decimals
            ),
          ];

      metadata = {
        name: `${numerator.symbol} / ${
          denominator.symbol
        } : ${lowerPrice} <> ${upperPrice} : ${feeToPercent(
          positionMetadata.fee
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
          positionMetadata.fee
        )}% fee on swaps.`,
        image: `${origin}/${id}/image.svg`,
        attributes: attributesStored,
      };
    } else {
      metadata = {
        name: `Ekubo NFT #${id}`,
        description: "An NFT that represents a liquidity position in Ekubo",
        image: `${origin}/${id}/image.svg`,
        attributes: attributesStored,
      };
    }

    return json(metadata, {
      headers: {
        "cache-control": "public, max-age=3600, immutable",
      },
    });
  }
}

export class ListNftEvents extends EkuboAPIRoute {
  async handle({ params: { id: idStr } }: IRequest, env: Env) {
    const id = parseId(idStr);
    if (id === null) {
      return error(400, "Invalid token ID");
    }

    const queries = await createQueries(env);

    if (!(await queries.getPositionMetadata(id))) {
      return error(404, "Token ID not found");
    }

    const history = await queries.getPositionHistory(id);

    return json(
      {
        events: history.map(
          ({
            delta0,
            liquidity_delta,
            delta1,
            recipient,
            transaction_hash,
            timestamp,
            collect_fees,
          }) => ({
            transaction_hash: num.toHex(transaction_hash),
            timestamp,
            recipient: recipient === null ? null : num.toHex(recipient),
            liquidity_delta,
            delta0,
            delta1,
            collect_fees,
          })
        ),
      },
      {
        headers: {
          "cache-control": "public, max-age=60, must-revalidate",
        },
      }
    );
  }
}

export class GetNftImage extends EkuboAPIRoute {
  async handle({ params: { id: idStr } }: IRequest, env: Env) {
    const id = parseId(idStr);
    if (id === null) {
      return error(400, "Invalid token ID");
    }

    const queries = await createQueries(env);

    const positionMetadata = await queries.getPositionMetadata(id);

    if (positionMetadata === null) {
      return error(404, `Token ID ${id} not found`);
    }

    return new Response(generateSvg(id, env.STARKNET_CHAIN_ID), {
      status: 200,
      headers: {
        "content-type": "image/svg+xml",
        "cache-control": "public, max-age=86400, immutable",
      },
    });
  }
}
