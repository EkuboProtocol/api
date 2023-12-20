import { createCors, error, IRequest, json } from "itty-router";
import { NFTMetadata } from "./nft";
import { generateSvg } from "./generateSvg";
import { parseId } from "./parseId";
import { Env } from "./env";
import { createQueries } from "./createQueries";
import Decimal from "decimal.js-light";
import { version } from "../package.json";
import {
  feeToPercent,
  formattedPrice,
  numericToHex,
  tickSpacingToPercent,
} from "./format";
import {
  FEE_TOKEN_ADDRESS,
  getAllTokens,
  getTokenByAddress,
  getTokenByIdentifier,
} from "./tokens";
import { findAllRoutes } from "./findAllRoutes";
import { MAX_U128 } from "./math/constants";
import { PoolState } from "./queries";
import { Contract, num, RpcProvider } from "starknet";
import POSITIONS_ABI from "./positions-abi.json";
import { OpenAPIRouter } from "@cloudflare/itty-router-openapi";
import { RequestContext } from "./routes/context";
import { GetTokens, GetTokenLogo } from "./routes/tokens";
import {
  getAllRelevantPoolsAndUpdateCache,
  QUOTE_NODE_CACHE,
  QuoteResult,
  quoteRoute,
  updatePoolCache,
} from "./quoting";
import { ALL_TIME, POSITIONS_CONTRACT_ADDRESS } from "./constants";
import {
  GetLeaderboard,
  GetLeaderboardForCollector,
} from "./routes/leaderboard";

Decimal.set({ precision: 39 });

const ADDRESS_REGEX = /^0x[a-fA-F0-9]+$/;

let provider: RpcProvider | null = null;

function getProvider(env: Env): RpcProvider {
  return (
    provider ??
    (provider = new RpcProvider({
      nodeUrl: env.RPC_URL,
      chainId: env.STARKNET_CHAIN_ID,
    }))
  );
}

const router = OpenAPIRouter<IRequest, RequestContext>({
  schema: {
    info: {
      title: "Ekubo API",
      version,
      description: "API for ",
      contact: {
        url: "https://ekubo.org",
        email: "eng@ekubo.org",
      },
    },
  },
  // removes the redoc and docs urls because they might increase the bundle size/js load time
  redoc_url: null as unknown as undefined,
  docs_url: null as unknown as undefined,
})
  .get("/tokens", GetTokens)
  .get("/tokens/:identifier/logo", GetTokenLogo)
  .get("/blocks/:number", async ({ params }: IRequest, env: Env) => {
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
  // gets a full dump of the leaderboard
  .get("/leaderboard/dump", async ({ query }: IRequest, env: Env) => {
    if (query.key !== "wip") {
      return error(501, "Not implemented");
    }

    const provider = getProvider(env);

    const contract = new Contract(
      POSITIONS_ABI,
      num.toHex(POSITIONS_CONTRACT_ADDRESS[env.STARKNET_CHAIN_ID]),
      provider
    );

    const queries = await createQueries(env);

    await queries.withinTransaction(async () => {
      const tokens = await queries.getAllActiveTokenIdsWithPoolKeys();

      // todo: write all the current tokens info into temp tables and then query the temp tables and add up all the points
      // todo: make sure the block at which the query happens is the same as the latest database

      await contract.call("get_tokens_info", [[]]);
    });

    return json(
      {},
      {
        headers: {
          "cache-control":
            "public,max-age=86400,stale-while-revalidate=3600,stale-if-error=180",
          "content-disposition": 'attachment; filename="dump.json"',
        },
      }
    );
  })
  .get("/leaderboard", GetLeaderboard)
  .get("/leaderboard/:collector/points", GetLeaderboardForCollector)
  .get(
    "/quote/:amount/:token/:otherToken",
    async ({ params, query }: IRequest, env: Env) => {
      const queries = await createQueries(env);

      const allTokens = await getAllTokens(env, queries);

      let amount: bigint;
      try {
        amount = BigInt(new Decimal(params.amount).toInteger().toFixed());
      } catch (e) {
        return error(
          400,
          `Failed to parse path parameters: ${(e as Error).message}`
        );
      }

      const token = getTokenByIdentifier(allTokens, params.token);
      const otherToken = getTokenByIdentifier(allTokens, params.otherToken);

      if (!token || !otherToken) {
        return error(400, "Invalid token parameters");
      }

      const isExactOutput = amount < 0n;

      if ((isExactOutput ? amount * -1n : amount) > MAX_U128) {
        return error(400, "Amount is too large");
      }

      const cache = QUOTE_NODE_CACHE[env.STARKNET_CHAIN_ID];

      const relevantPools = await getAllRelevantPoolsAndUpdateCache(
        queries,
        cache,
        {
          tokenA: BigInt(token.l2_token_address),
          tokenB: BigInt(otherToken.l2_token_address),
        }
      );

      if (!relevantPools.length) {
        return error(404, "No pools connect the two tokens");
      }

      // routes are executed in reverse for exact output
      const allRoutes = findAllRoutes(
        BigInt(token.l2_token_address),
        BigInt(otherToken.l2_token_address),
        relevantPools,
        2
      );

      const quotedRoutes = allRoutes.map((route) => {
        try {
          return {
            quote: quoteRoute(
              { amount, token: BigInt(token.l2_token_address) },
              route,
              cache
            ),
            route,
          };
        } catch (e) {
          console.error("Failed to quote", route, e);
          return {
            quote: null,
            route,
          };
        }
      });

      let bestWorkingRoute: {
        route: PoolState[];
        quote: Readonly<QuoteResult>;
      } | null = null;
      for (const route of quotedRoutes) {
        if (
          route.quote &&
          (!bestWorkingRoute ||
            route.quote.tokenAmount.amount >
              bestWorkingRoute.quote.tokenAmount.amount)
        ) {
          bestWorkingRoute = route as {
            route: PoolState[];
            quote: Readonly<QuoteResult>;
          };
        }
      }

      if (!bestWorkingRoute) {
        return error(404, "No route found");
      }

      const limits = bestWorkingRoute.quote.limits;

      return json(
        {
          amount: bestWorkingRoute.quote.tokenAmount.amount.toString(),
          route: bestWorkingRoute.route.map((pool, ix) => ({
            pool_key: {
              token0: numericToHex(pool.token0),
              token1: numericToHex(pool.token1),
              fee: numericToHex(pool.fee),
              tick_spacing: Number(pool.tick_spacing),
              extension: numericToHex(pool.extension),
            },
            sqrt_ratio_limit: numericToHex(limits[ix]),
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
  .get("/overview", async (_: IRequest, env: Env) => {
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
  .get("/pair/:tokenA/:tokenB", async ({ params }: IRequest, env: Env) => {
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
  .get(
    "/price/:baseToken/:quoteToken",
    async ({ params }: IRequest, env: Env) => {
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

      const queries = await createQueries(env);
      const allTokens = await getAllTokens(env, queries);

      const bt = getTokenByAddress(allTokens, baseToken);
      const qt = getTokenByAddress(allTokens, quoteToken);

      if (!bt || !qt) {
        return error(400, "Base token or quote token not known");
      }

      const timestamp = Date.now();
      const oneDayAgo = new Date(timestamp - 86_400_000);

      const ft = FEE_TOKEN_ADDRESS[env.STARKNET_CHAIN_ID];

      if (!ft) {
        return error(500, "Fee token not defined for chain");
      }

      const [direct, quoteFt, baseFt] = await queries.withinTransaction(() =>
        Promise.all([
          queries.getLastVolumeWeightedPrice({
            quoteToken,
            baseToken,
            since: oneDayAgo,
          }),
          queries.getLastVolumeWeightedPrice({
            quoteToken,
            baseToken: ft,
            since: oneDayAgo,
          }),
          queries.getLastVolumeWeightedPrice({
            quoteToken: ft,
            baseToken,
            since: oneDayAgo,
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
  .get(
    "/price/:baseToken/:quoteToken/history",
    async ({ params, query }: IRequest, env: Env) => {
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

      const queries = await createQueries(env);

      const tokens = await getAllTokens(env, queries);
      const bt = getTokenByAddress(tokens, baseToken);
      const qt = getTokenByAddress(tokens, quoteToken);

      if (!bt || !qt) {
        return error(400, "Base token or quote token not known");
      }

      if (baseToken === quoteToken) {
        return error(400, "Base token cannot be equal to quote token");
      }

      let intervalSeconds: number;
      let start: Date;
      let end: Date;

      try {
        intervalSeconds =
          typeof query.interval === "string" ? parseInt(query.interval) : 1800;
        end =
          typeof query.end === "string"
            ? new Date(parseInt(query.end) * 1_000)
            : new Date(Date.now());
        start =
          typeof query.start === "string"
            ? new Date(parseInt(query.start) * 1_000)
            : new Date(end.getTime() - intervalSeconds * 60 * 1_000); // default 60 data points
      } catch (e) {
        return error(400, "Invalid `interval`, `end` or `start` parameters");
      }

      const durationMilliseconds = end.getTime() - start.getTime();
      if (durationMilliseconds > 30 * 86_400 * 1_000) {
        return error(
          400,
          "Start time cannot be more than 30 days before end time"
        );
      }

      if (intervalSeconds <= 0) {
        return error(400, "Interval must be positive");
      }

      const numIntervals = durationMilliseconds / intervalSeconds / 1_000;

      if (numIntervals > 120) {
        return error(400, "Interval too small for the range");
      }

      const [token0, token1] =
        baseToken < quoteToken
          ? [baseToken, quoteToken]
          : [quoteToken, baseToken];

      // convert 1e15 eth to the threshold for token0 by multiplying 1e15 eth by the price in per eth
      const fta = FEE_TOKEN_ADDRESS[env.STARKNET_CHAIN_ID];
      const price0 =
        token0 === fta
          ? new Decimal(1)
          : (
              await queries.getLastVolumeWeightedPrice({
                baseToken: fta,
                quoteToken: token0,
                since: null,
              })
            )?.price ?? new Decimal(0);
      const price1 =
        token1 === fta
          ? new Decimal(1)
          : (
              await queries.getLastVolumeWeightedPrice({
                baseToken: fta,
                quoteToken: token1,
                since: null,
              })
            )?.price ?? new Decimal(0);

      const thresholdFeeToken = new Decimal(1e15);
      const threshold0 = BigInt(thresholdFeeToken.mul(price0).toFixed(0));
      const threshold1 = BigInt(thresholdFeeToken.mul(price1).toFixed(0));

      const data = await queries.getPriceHistory({
        token0,
        token1,
        start,
        end,
        intervalSeconds,
        decimalsDifference:
          baseToken < quoteToken
            ? bt.decimals - qt.decimals
            : qt.decimals - bt.decimals,
        delta0Threshold: threshold0,
        delta1Threshold: threshold1,
      });

      return json(
        {
          timestamp: Date.now(),
          start: start.getTime(),
          end: end.getTime(),
          interval: intervalSeconds,
          data:
            baseToken < quoteToken
              ? data
              : data.map((d) => ({
                  ...d,
                  vwap: 1 / d.vwap,
                  max: 1 / d.min,
                  min: 1 / d.max,
                })),
        },
        {
          headers: {
            "cache-control": `public, max-age=${Math.ceil(
              intervalSeconds / 4
            )}, must-revalidate`,
          },
        }
      );
    }
  )
  .get("/price/:quoteToken", async ({ params }: IRequest, env: Env) => {
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

    const queries = await createQueries(env);
    const allTokens = await getAllTokens(env, queries);
    const qt = getTokenByAddress(allTokens, quoteToken);

    if (!qt) {
      return error(400, "Quote token not known");
    }

    const timestamp = Date.now();
    const sixHoursAgo = new Date(timestamp - 3_600_000 * 6);

    const prices = await queries.getAllVolumeWeightedPrices({
      quoteToken,
      start: sixHoursAgo,
    });

    const scaledPrices = prices
      .map(({ price, k_volume, token }) => {
        const base = getTokenByAddress(allTokens, token);
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
  .get("/pools", async (_: IRequest, env: Env) => {
    const client = await createQueries(env);

    const { rows } = await client.withinTransaction(() =>
      client.getAllPoolsWithStates()
    );

    return json(
      rows.map((pool) => ({
        key_hash: numericToHex(pool.pool_key_hash),
        token0: numericToHex(pool.token0),
        token1: numericToHex(pool.token1),
        fee: numericToHex(pool.fee),
        tick_spacing: Number(pool.tick_spacing),
        extension: numericToHex(pool.extension),
        sqrt_ratio: numericToHex(pool.sqrt_ratio),
        tick: pool.tick,
        liquidity: pool.liquidity,
        lastUpdate: {
          blockNumber: Number(pool.block_number),
          transactionIndex: pool.transaction_index,
          eventIndex: pool.event_index,
        },
      })),
      {
        headers: {
          "cache-control": "public, max-age=15, must-revalidate",
        },
      }
    );
  })
  .get(
    "/pools/:key_hash/liquidity",
    async ({ params: { key_hash } }: IRequest, env: Env) => {
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
    "/pools/:key_hash/delta_to_sqrt_ratio/:new_sqrt_ratio",
    async ({ params }: IRequest, env: Env) => {
      let poolKeyHash: bigint, newSqrtRatio: bigint;
      try {
        poolKeyHash = BigInt(params.key_hash);
        newSqrtRatio = BigInt(params.new_sqrt_ratio);
      } catch (e) {
        return error(400, "Invalid path parameters");
      }

      const queries = await createQueries(env);

      const [node, sqrtRatio] = await queries.withinTransaction(async () => {
        const poolState = await queries.getPoolState({ keyHash: poolKeyHash });

        const cache = QUOTE_NODE_CACHE[env.STARKNET_CHAIN_ID];

        await updatePoolCache([poolState], queries, cache);

        return [
          cache[poolKeyHash.toString()].node,
          BigInt(poolState.sqrt_ratio),
        ];
      });

      const isToken1 = sqrtRatio >= newSqrtRatio;
      const { consumedAmount, calculatedAmount } = node.quote({
        specifiedAmount: -0xffffffffffffffffffffffffffffffffn,
        sqrtRatioLimit: newSqrtRatio,
        isToken1: sqrtRatio >= newSqrtRatio,
      });

      return json(
        isToken1
          ? {
              delta0: calculatedAmount.toString(),
              delta1: consumedAmount.toString(),
            }
          : {
              delta0: consumedAmount.toString(),
              delta1: calculatedAmount.toString(),
            },
        {
          headers: {
            "cache-control": "no-cache",
          },
        }
      );
    }
  )
  .get(
    "/positions/:address",
    async (
      { params: { address: addressStr }, query, url }: IRequest,
      env: Env
    ) => {
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
  .get(
    "/tokens/:tokenA/:tokenB/liquidity",
    async (
      { params: { tokenA: tokenAStr, tokenB: tokenBStr } }: IRequest,
      env: Env
    ) => {
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
  .get(
    "/tokens/:tokenA/:tokenB/events",
    async (
      { params: { tokenA: tokenAStr, tokenB: tokenBStr } }: IRequest,
      env: Env
    ) => {
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
  .get("/:id", async ({ url, params: { id: idStr } }: IRequest, env: Env) => {
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
  })
  .get(
    "/:id/history",
    async ({ url, params: { id: idStr } }: IRequest, env: Env) => {
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
  .get(
    "/:id/image.svg",
    async ({ params: { id: idStr } }: IRequest, env: Env) => {
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

const cache = caches.default;

const { preflight, corsify } = createCors({
  maxAge: 86400,
  origins: ["*"],
  methods: ["GET", "OPTIONS", "POST"],
});

export default {
  fetch: async (request: IRequest, env: Env, context: RequestContext) => {
    // first check the preflight before anything. it's so cheap to handle we shouldn't even bother with check the cache
    const preflightResponse = preflight(request);
    if (preflightResponse) return preflightResponse;

    // check cache hits for request
    // we do this outside of the router because we do not want to RE-CACHE a successful response by including the cache logic in the router handler
    const cached = await cache.match(request);
    if (cached) {
      return corsify(cached);
    }

    let response: Response;
    try {
      response = json(await router.handle(request, env, context));
    } catch (e) {
      console.error(e);
      response = json(error(500, "Internal server error"));
    }

    if (response.ok) {
      await cache.put(request, response.clone());
    }

    return corsify(response);
  },
};
