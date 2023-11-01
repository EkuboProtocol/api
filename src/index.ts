import { createCors, error, IRequest, json, Router } from "itty-router";
import { NFTMetadata } from "./nft";
import { generateSvg } from "./generateSvg";
import { parseId } from "./parseId";
import { Env } from "./env";
import { createQueries } from "./createQueries";
import MAINNET_TOKENS from "./tokens/mainnet.json";
import GOERLI_TOKENS from "./tokens/goerli.json";
import Decimal from "decimal.js-light";

const TOKENS_BY_CHAIN_ID = {
  ["0x534e5f4d41494e"]: MAINNET_TOKENS,
  ["0x534e5f474f45524c49"]: GOERLI_TOKENS,
} as const;

export function feeToken(chainId: "0x534e5f474f45524c49" | "0x534e5f4d41494e") {
  return findToken(
    chainId,
    chainId === "0x534e5f4d41494e"
      ? "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7"
      : chainId === "0x534e5f474f45524c49"
      ? "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7"
      : "0"
  );
}

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

const cache = caches.default;
const router = Router<IRequest, CF>()
  .all("*", preflight)
  .all("*", async (request) => {
    const response = await cache.match(request);
    if (response) return response;
  });

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
  .get<IRequest, CF>("/tokens", async ({}, env) => {
    return json(TOKENS_BY_CHAIN_ID[env.STARKNET_CHAIN_ID] ?? [], {
      headers: {
        "cache-control":
          "public, max-age=3600, stale-while-revalidate=3600, stale-if-error=86400",
      },
    });
  })
  .get<IRequest, CF>("/blocks/:number", async ({ params }, env) => {
    const queries = await createQueries(env);

    if (params.number !== "latest") {
      return error(501, "Not implemented");
    }

    const block = await queries.getLatestBlock();

    return json(
      {
        number: Number(block.number),
        timestamp: block.timestamp,
      },
      {
        headers: {
          "cache-control": "public, max-age=10, must-revalidate",
        },
      }
    );
  })
  .get<IRequest, CF>("/overview", async ({}, env) => {
    const timestamp = Date.now();
    const twentyFourHoursAgo = new Date(timestamp - 1000 * 60 * 60 * 24);
    const thirtyDaysAgo = new Date(timestamp - 1000 * 60 * 60 * 24 * 30);

    const [queries1, queries2] = await Promise.all([
      createQueries(env),
      createQueries(env),
    ]);

    const [
      [
        { rows: tvlByToken },
        { rows: volumeByToken },
        { rows: revenueByToken },
        { rows: tvlDeltaByTokenByDate },
        { rows: volumeByTokenByDate },
        { rows: revenueByTokenByDate },
      ],

      [
        { rows: volumeByToken_24h },
        { rows: revenueByToken_24h },
        { rows: topPairs },
      ],
    ] = await Promise.all([
      queries1.withinTransaction(() =>
        Promise.all([
          queries1.getTvlByToken(),
          queries1.getTotalVolumeByToken(ALL_TIME),
          queries1.getRevenueByToken(ALL_TIME),
          queries1.getTvlDeltaByTokenByDate(thirtyDaysAgo),
          queries1.getVolumeByTokenByDate(thirtyDaysAgo),
          queries1.getRevenueByTokenByDate(thirtyDaysAgo),
        ])
      ),
      queries2.withinTransaction(() =>
        Promise.all([
          queries2.getTotalVolumeByToken(twentyFourHoursAgo),
          queries2.getRevenueByToken(twentyFourHoursAgo),
          queries2.getTopPairs(),
        ])
      ),
    ]);

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
          "cache-control":
            "public, max-age=3600, stale-while-revalidate=180, stale-if-error=180",
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
        queries.getTotalVolumeByToken(ALL_TIME, pair),
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
          "cache-control":
            "public, max-age=600, stale-while-revalidate=180, stale-if-error=180",
        },
      }
    );
  })
  .get<IRequest, CF>(
    "/price/:baseToken/:quoteToken",
    async ({ params }, env) => {
      if (
        typeof params.baseToken !== "string" ||
        !ADDRESS_REGEX.test(params.baseToken) ||
        typeof params.quoteToken !== "string" ||
        !ADDRESS_REGEX.test(params.quoteToken)
      ) {
        return error(
          400,
          "`baseToken` and `quoteToken` path parameters must be token addresses in hex format"
        );
      }

      const baseToken = BigInt(params.baseToken);
      const quoteToken = BigInt(params.quoteToken);

      const bt = findToken(env.STARKNET_CHAIN_ID, baseToken);
      const qt = findToken(env.STARKNET_CHAIN_ID, quoteToken);

      if (!bt || !qt) {
        return error(400, "Base token or quote token not known");
      }

      const queries = await createQueries(env);

      const timestamp = Date.now();
      const sixHoursAgo = new Date(timestamp - 3_600_000 * 6);

      const ft = feeToken(env.STARKNET_CHAIN_ID);

      const [direct, quoteFt, baseFt] = await queries.withinTransaction(() =>
        Promise.all([
          queries.getVolumeWeightedPrice({
            quoteToken,
            baseToken,
            since: sixHoursAgo,
          }),
          queries.getVolumeWeightedPrice({
            quoteToken,
            baseToken: BigInt(ft.l2_token_address),
            since: sixHoursAgo,
          }),
          queries.getVolumeWeightedPrice({
            quoteToken: BigInt(ft.l2_token_address),
            baseToken,
            since: sixHoursAgo,
          }),
        ])
      );

      let price: Decimal;
      if (direct) {
        if (!quoteFt || !baseFt) {
          price = direct.price;
        } else {
          if (quoteFt.k_volume * baseFt.k_volume > direct.k_volume ** 2n) {
            price = quoteFt.price.mul(baseFt.price);
          } else {
            price = direct.price;
          }
        }
      } else {
        if (!quoteFt || !baseFt) {
          return error(404, "No volume for this pair");
        }

        price = quoteFt.price.mul(baseFt.price);
      }

      const scaled = price.mul(new Decimal(10).pow(bt.decimals - qt.decimals));

      return json(
        {
          timestamp,
          price: scaled.toSignificantDigits(10).toString(),
        },
        {
          headers: {
            "cache-control": "public, max-age=180, must-revalidate",
          },
        }
      );
    }
  )
  .get<IRequest, CF>("/price/:quoteToken", async ({ params }, env) => {
    if (
      typeof params.quoteToken !== "string" ||
      !ADDRESS_REGEX.test(params.quoteToken)
    ) {
      return error(
        400,
        "`quoteToken` path parameters must be a token address in hex format"
      );
    }

    const quoteToken = BigInt(params.quoteToken);

    const qt = findToken(env.STARKNET_CHAIN_ID, quoteToken);

    if (!qt) {
      return error(400, "Quote token not known");
    }

    const queries = await createQueries(env);

    const timestamp = Date.now();
    const sixHoursAgo = new Date(timestamp - 3_600_000 * 6);

    const prices = await queries.getAllVolumeWeightedPrices({
      quoteToken,
      end: new Date(timestamp),
      start: sixHoursAgo,
    });

    const scaledPrices = prices
      .map(({ price, k_volume, token }) => {
        const base = findToken(env.STARKNET_CHAIN_ID, token);
        if (!base) return null;

        const scaled = price.mul(
          new Decimal(10).pow(base.decimals - qt.decimals)
        );

        return {
          token,
          price: scaled.toSignificantDigits(6).toString(),
          k_volume: k_volume.toString(),
        };
      })
      .filter((p) => !!p);

    return json(
      {
        timestamp,
        prices: scaledPrices,
      },
      {
        headers: {
          "cache-control": "public, max-age=600, must-revalidate",
        },
      }
    );
  })
  .get("/pools", async (_, env) => {
    const client = await createQueries(env);

    const { rows } = await client.withinTransaction(() =>
      client.getAllPoolsWithStates()
    );

    return json(
      rows.map((p) => ({
        key_hash: numericToHex(p.pool_key_hash),
        token0: numericToHex(p.token0),
        token1: numericToHex(p.token1),
        fee: numericToHex(p.fee),
        tick_spacing: Number(p.tick_spacing),
        extension: numericToHex(p.extension),
        sqrt_ratio: numericToHex(p.sqrt_ratio),
        tick: Number(p.tick),
        liquidity: p.liquidity,
      })),
      {
        headers: {
          "cache-control": "public, max-age=15, must-revalidate",
        },
      }
    );
  })
  .get<IRequest, CF>(
    "/pools/:key_hash/liquidity",
    async ({ params: { key_hash } }, env) => {
      let pool_key_hash: bigint;
      try {
        pool_key_hash = BigInt(key_hash);
      } catch (e) {
        return error(400, "Invalid pool key hash");
      }

      const client = await createQueries(env);

      const { rows } = await client.withinTransaction(() =>
        client.getPoolLiquidityGraph(pool_key_hash)
      );

      return json(
        {
          data: rows,
        },
        {
          headers: {
            "cache-control": "public, max-age=15, must-revalidate",
          },
        }
      );
    }
  )
  .get(
    "/positions/:address",
    async ({ params: { address: addressStr }, query, url }, env) => {
      let address: bigint;
      try {
        address = BigInt(addressStr);
      } catch (e) {
        return error(400, "Invalid address");
      }

      const showClosed = "showClosed" in query && query.showClosed === "true";

      const client = await createQueries(env);
      const { rows } = await client.getPositionsByAddress(address, showClosed);

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

      const { rows } = await client.withinTransaction(() =>
        client.getPairLiquidityGraph({
          token0,
          token1,
        })
      );

      return json(
        {
          data: rows,
        },
        {
          headers: {
            "cache-control": "public, max-age=600, must-revalidate",
          },
        }
      );
    }
  )
  .get<IRequest, CF>(
    "/tokens/:tokenA/:tokenB/events",
    async ({ params: { tokenA: tokenAStr, tokenB: tokenBStr } }, env) => {
      let tokenA: bigint, tokenB: bigint;
      try {
        tokenA = BigInt(tokenAStr);
        tokenB = BigInt(tokenBStr);
      } catch (e) {
        return error(400, "Invalid tokens");
      }

      const [token0, token1] =
        tokenA < tokenB ? [tokenA, tokenB] : [tokenB, tokenA];

      if (token0 === 0n) {
        return error(400, "Invalid tokens");
      }

      const client = await createQueries(env);

      const { rows } = await client.getPairEvents({
        token0,
        token1,
        limit: 300,
      });

      return json(
        {
          data: rows,
        },
        {
          headers: {
            "cache-control": "public, max-age=180, must-revalidate",
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

    const positionMetadata = await queries.getPositionMetadata(id);

    if (positionMetadata === null) {
      return error(404, `Token ID ${id} not found`);
    }

    const attributesStored: NFTMetadata["attributes"] = [
      {
        trait_type: "minted_tx_hash",
        value: numericToHex(positionMetadata.minted_tx_hash),
      },
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
  })
  .get<IRequest, CF>(
    "/:id/history",
    async ({ url, params: { id: idStr } }, env) => {
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
              transaction_hash: numericToHex(transaction_hash),
              timestamp,
              recipient: recipient === null ? null : numericToHex(recipient),
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
  )
  .get<IRequest, CF>(
    "/:id/image.svg",
    async ({ params: { id: idStr } }, env) => {
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
  )
  // catch missed routes
  .all("*", () => error(404));

async function cacheResponse(request: IRequest, response: Response) {
  await cache.put(request, response.clone());
  return response;
}

export default {
  fetch: (request, env, ctxt) =>
    router

      .handle(request, env, ctxt)

      // transform unformed responses
      .then(json)
      .then((response) => cacheResponse(request, response))

      // catch any errors
      .catch(error)

      // add CORS headers to all requests,
      // including errors
      .then(corsify),
};
