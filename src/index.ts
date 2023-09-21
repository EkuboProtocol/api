import { createCors, error, IRequest, json, Router } from "itty-router";
import { NFTMetadata } from "./nft";
import { generateSvg } from "./generateSvg";
import { parseId } from "./parseId";
import { Env } from "./env";
import { ExecutionContext } from "@cloudflare/workers-types";
import { createQueries } from "./createQueries";
import MAINNET_TOKENS from "./tokens/mainnet.json";
import Decimal from "decimal.js-light";

const TOKENS_BY_CHAIN_ID: {
  [key in "0x534e5f474f45524c49" | "0x534e5f4d41494e"]?: typeof MAINNET_TOKENS;
} = {
  ["0x534e5f4d41494e"]: MAINNET_TOKENS,
};

function findToken(
  chainId: "0x534e5f474f45524c49" | "0x534e5f4d41494e",
  address: string | bigint
) {
  return (TOKENS_BY_CHAIN_ID[chainId] ?? [])?.find(
    (x) => BigInt(x.l2_token_address) === BigInt(address)
  );
}

Decimal.set({ precision: 39 });

const BASE = new Decimal("1.000001");

const ALL_TIME = new Date(0);

function formattedPrice(
  tick: bigint,
  numeratorDecimals: number,
  denominatorDecimals: number
): string {
  return BASE.pow(tick.toString())
    .mul(new Decimal(10).pow(denominatorDecimals - numeratorDecimals))
    .toSignificantDigits(6)
    .toString();
}

const { preflight, corsify } = createCors({
  maxAge: 86400,
  origins: ["*"],
});

// create a convenient duple
type CF = [env: Env, context: ExecutionContext];

const router = Router<IRequest, CF>().all("*", preflight);

function numericToHex(x: bigint | number | string) {
  return `0x${BigInt(x).toString(16)}`;
}

const ADDRESS_REGEX = /^0x[a-fA-F0-9]+$/;

const U128 = new Decimal(2).pow(128);

function feeToPercent(fee: string) {
  return new Decimal(fee).div(U128).mul(100).toSignificantDigits(4).toString();
}

function tickSpacingToPercent(tick_spacing: string) {
  return BASE.pow(tick_spacing)
    .sub(1)
    .mul(100)
    .toSignificantDigits(4)
    .toString();
}

router
  .get<IRequest, CF>("/overview", async ({}, env) => {
    const queries = await createQueries(env);

    const timestamp = Date.now();
    const twentyFourHoursAgo = new Date(timestamp - 1000 * 60 * 60 * 24);
    const thirtyDaysAgo = new Date(timestamp - 1000 * 60 * 60 * 24 * 30);

    const [
      { rows: tvlByToken },
      { rows: volumeByToken },
      { rows: revenueByToken },
      { rows: volumeByToken_24h },
      { rows: revenueByToken_24h },
      { rows: tvlDeltaByTokenByDate },
      { rows: volumeByTokenByDate },
      { rows: revenueByTokenByDate },
      { rows: topPairs },
    ] = await queries.withinTransaction(() =>
      Promise.all([
        queries.getTvlByToken(),
        queries.getTotalVolume(ALL_TIME),
        queries.getRevenueByToken(ALL_TIME),
        queries.getTotalVolume(twentyFourHoursAgo),
        queries.getRevenueByToken(twentyFourHoursAgo),
        queries.getTvlDeltaByTokenByDate(thirtyDaysAgo),
        queries.getVolumeByTokenByDate(thirtyDaysAgo),
        queries.getRevenueByTokenByDate(thirtyDaysAgo),
        queries.getTopPairs(),
      ])
    );

    return json(
      {
        timestamp,
        tvlByToken,
        volumeByToken,
        volumeByToken_24h,
        revenueByToken,
        revenueByToken_24h,
        tvlDeltaByTokenByDate,
        volumeByTokenByDate,
        revenueByTokenByDate,
        topPairs,
      },
      {
        headers: {
          "cache-control": "public, max-age=600",
        },
      }
    );
  })
  .get<IRequest, CF>("/pair/:tokenA/:tokenB", async ({ params }, env) => {
    if (
      typeof params.tokenA !== "string" ||
      !ADDRESS_REGEX.test(params.tokenA) ||
      typeof params.tokenB !== "string" ||
      !ADDRESS_REGEX.test(params.tokenB)
    ) {
      return error(
        400,
        "`tokenA` and `tokenB` path parameters must be token addresses in hex format"
      );
    }

    const [token0, token1] =
      BigInt(params.tokenA) < BigInt(params.tokenB)
        ? [BigInt(params.tokenA), BigInt(params.tokenB)]
        : [BigInt(params.tokenB), BigInt(params.tokenA)];

    const pair = { token0, token1 };

    const queries = await createQueries(env);

    const timestamp = Date.now();
    const thirtyDaysAgo = new Date(timestamp - 1000 * 60 * 60 * 24 * 30);

    const [
      { rows: tvlByToken },
      { rows: volumeByToken },
      { rows: revenueByToken },
      { rows: tvlDeltaByTokenByDate },
      { rows: volumeByTokenByDate },
      { rows: revenueByTokenByDate },
      { rows: topPools },
    ] = await queries.withinTransaction(() =>
      Promise.all([
        queries.getTvlByToken(pair),
        queries.getTotalVolume(ALL_TIME, pair),
        queries.getRevenueByToken(ALL_TIME, pair),
        queries.getTvlDeltaByTokenByDate(thirtyDaysAgo, pair),
        queries.getVolumeByTokenByDate(thirtyDaysAgo, pair),
        queries.getRevenueByTokenByDate(thirtyDaysAgo, pair),
        queries.getTopPools(pair),
      ])
    );

    return json(
      {
        timestamp,
        tvlByToken,
        volumeByToken,
        revenueByToken,
        tvlDeltaByTokenByDate,
        volumeByTokenByDate,
        revenueByTokenByDate,
        topPools,
      },
      {
        headers: {
          "cache-control": "public, max-age=180",
        },
      }
    );
  })
  .get<IRequest, CF>("/stats", async ({ query }, env) => {
    if (
      !query.start ||
      !query.end ||
      typeof query.start !== "string" ||
      typeof query.end !== "string"
    ) {
      return error(
        400,
        "Query parameters must include `start` and `end` timestamps"
      );
    }

    const DATE_REGEX = /^20\d\d-\d\d-\d\d$/;

    if (!DATE_REGEX.test(query.start) || !DATE_REGEX.test(query.end)) {
      return error(
        400,
        "`start` and `end` parameters must be in the format YYYY-MM-DD"
      );
    }

    const start = new Date(query.start);
    const end = new Date(query.end);

    console.log(start, end);

    return error(501, "This endpoint not yet implemented");
  })
  .get<IRequest, CF>(
    "/pool/:key_hash/liquidity",
    async ({ params: { key_hash } }, env) => {
      let pool_key_hash: bigint;
      try {
        pool_key_hash = BigInt(key_hash);
      } catch (e) {
        return error(400, "Invalid pool key hash");
      }

      const client = await createQueries(env);

      const { rows } = await client.getPoolLiquidityGraph(pool_key_hash);

      return json(
        {
          data: rows,
        },
        {
          headers: {
            "cache-control": "public, max-age=600",
          },
        }
      );
    }
  )
  .get(
    "/positions/:address",
    async ({ params: { address: addressStr }, url }, env) => {
      let address: bigint;
      try {
        address = BigInt(addressStr);
      } catch (e) {
        return error(400, "Invalid address");
      }

      const client = await createQueries(env);
      const { rows } = await client.getPositionsByAddress(address);

      const origin = new URL(url).origin;

      return json(
        {
          data: rows.map((row) => ({
            id: Number(row.token_id),
            pool_key: {
              token0: numericToHex(row.token0),
              token1: numericToHex(row.token1),
              fee: numericToHex(row.fee),
              tick_spacing: numericToHex(row.tick_spacing),
              extension: numericToHex(row.extension),
            },
            bounds: {
              lower: Number(row.lower_bound),
              upper: Number(row.upper_bound),
            },
            metadata_url: `${origin}/${row.token_id}`,
            image: `${origin}/${row.token_id}/image.svg`,
            minted_timestamp: row.minted_timestamp.getTime(),
          })),
        },
        {
          headers: {
            "cache-control": "no-cache",
          },
        }
      );
    }
  )
  .get<IRequest, CF>(
    "/tokens/:tokenA/:tokenB/liquidity",
    async ({ params: { tokenA: tokenAStr, tokenB: tokenBStr } }, env) => {
      let tokenA: bigint, tokenB: bigint;
      try {
        tokenA = BigInt(tokenAStr);
        tokenB = BigInt(tokenBStr);
      } catch (e) {
        return error(400, "Invalid tokens");
      }

      const client = await createQueries(env);

      const [token0, token1] =
        tokenA < tokenB ? [tokenA, tokenB] : [tokenB, tokenA];

      if (token0 === 0n) {
        return error(400, "Invalid tokens");
      }

      const { rows } = await client.getPairLiquidityGraph({
        token0,
        token1,
      });

      return json(
        {
          data: rows,
        },
        {
          headers: {
            "cache-control": "public, max-age=600",
          },
        }
      );
    }
  )
  .get<IRequest, CF>(
    "/tokens/:tokenA/:tokenB/events",
    async (
      {
        params: { tokenA: tokenAStr, tokenB: tokenBStr },
        query: { limit: limitStr },
      },
      env
    ) => {
      let tokenA: bigint, tokenB: bigint;
      try {
        tokenA = BigInt(tokenAStr);
        tokenB = BigInt(tokenBStr);
      } catch (e) {
        return error(400, "Invalid tokens");
      }

      let limit: number;
      try {
        limit = typeof limitStr === "string" ? parseInt(limitStr) : 20;
      } catch (error) {
        return error(400, "Limit parameter invalid");
      }

      if (limit < 1 || limit > 100) {
        return error(400, "Limit must be >= 1 and <= 100");
      }

      const client = await createQueries(env);

      const [token0, token1] =
        tokenA < tokenB ? [tokenA, tokenB] : [tokenB, tokenA];

      if (token0 === 0n) {
        return error(400, "Invalid tokens");
      }

      const { rows, rowCount } = await client.getPairEvents({
        token0,
        token1,
        limit,
      });

      return json(
        {
          data: rows,
        },
        {
          headers: {
            "cache-control": "public, max-age=180",
          },
        }
      );
    }
  )
  .get<IRequest, CF>("/:id", async ({ url, params: { id: idStr } }, env) => {
    const id = parseId(idStr);
    if (id === null) {
      return error(400, "Invalid token ID");
    }

    const queries = await createQueries(env);

    const positionMetadata = await queries.getTokenMetadata(id);

    if (positionMetadata === null) {
      return error(404, `Token ID ${id} not found`);
    }

    const attributesStored: NFTMetadata["attributes"] = [
      { trait_type: "token0", value: numericToHex(positionMetadata.token0) },
      { trait_type: "token1", value: numericToHex(positionMetadata.token1) },
      { trait_type: "fee", value: positionMetadata.fee.toString() },
      {
        trait_type: "tick_spacing",
        value: positionMetadata.tick_spacing.toString(),
      },
      {
        trait_type: "extension",
        value: numericToHex(positionMetadata.extension).toString(),
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

    const origin = new URL(url).origin;
    const token0 = findToken(env.STARKNET_CHAIN_ID, positionMetadata.token0);
    const token1 = findToken(env.STARKNET_CHAIN_ID, positionMetadata.token1);

    let metadata: NFTMetadata;
    if (token0 && token1) {
      const reversed = token0.sortOrder >= token1.sortOrder;
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
        "cache-control": "public, max-age=3600",
      },
    });
  })
  .get<IRequest, CF>(
    "/:id/image.svg",
    async ({ params: { id: idStr } }, env) => {
      const id = parseId(idStr);
      if (id === null) {
        return error(400, "Invalid token ID");
      }

      const queries = await createQueries(env);

      const positionMetadata = await queries.getTokenMetadata(id);

      if (positionMetadata === null) {
        return error(404, `Token ID ${id} not found`);
      }

      return new Response(generateSvg(id, env.STARKNET_CHAIN_ID), {
        status: 200,
        headers: {
          "content-type": "image/svg+xml",
          "cache-control": "public, max-age=86400",
        },
      });
    }
  )
  // catch missed routes
  .all("*", () => error(404));

export default {
  fetch: (request, env, ctxt) =>
    router
      .handle(request, env, ctxt)

      // transform unformed responses
      .then(json)

      // catch any errors
      .catch(error)

      // add CORS headers to all requests,
      // including errors
      .then(corsify),
};
