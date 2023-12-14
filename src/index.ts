import { createCors, error, IRequest, json, Router } from "itty-router";
import { NFTMetadata } from "./nft";
import { generateSvg } from "./generateSvg";
import { parseId } from "./parseId";
import { Env } from "./env";
import { createQueries } from "./createQueries";
import Decimal from "decimal.js-light";
import {
  feeToPercent,
  formattedPrice,
  numericToHex,
  tickSpacingToPercent,
} from "./format";
import {
  feeToken,
  feeTokenAddress,
  getTokenByAddress,
  parseTokenIdentifier,
  DEFAULT_TOKENS_BY_CHAIN_ID,
} from "./tokens";
import { findAllRoutes } from "./findAllRoutes";
import { PlainPool } from "./nodes/plainPool";
import { MAX_U128 } from "./math/constants";
import { QuoteNode } from "./nodes/quoteNode";
import { PoolState, Queries } from "./queries";
import { toSqrtRatio } from "./math/tick";
import { isPriceIncreasing } from "./math/swap";
import { constants, Contract, shortString, num, RpcProvider } from "starknet";
import POSITIONS_ABI from "./positions-abi.json";

Decimal.set({ precision: 39 });

const ALL_TIME = new Date(0);

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

const ADDRESS_REGEX = /^0x[a-fA-F0-9]+$/;

interface LastUpdatedKey {
  blockNumber: string;
  transactionIndex: number;
  eventIndex: number;
}

const QUOTE_NODE_CACHE: {
  [chainId in constants.StarknetChainId]: {
    [key_hash: string]: {
      lastUpdated: LastUpdatedKey;
      node: QuoteNode<{ initializedTicksCrossed: number }>;
    };
  };
} = {
  ["0x534e5f474f45524c49"]: {},
  ["0x534e5f4d41494e"]: {},
};

interface QuoteResult {
  tokenAmount: {
    token: bigint;
    amount: bigint;
  };
  limits: bigint[];
  resources: { initializedTicksCrossed: number };
}

const POSITIONS_CONTRACT_ADDRESS: {
  [chainId in constants.StarknetChainId]: bigint;
} = {
  ["0x534e5f4d41494e"]:
    0x02e0af29598b407c8716b17f6d2795eca1b471413fa03fb145a5e33722184067n,
  ["0x534e5f474f45524c49"]:
    0x073fa8432bf59f8ed535f29acfd89a7020758bda7be509e00dfed8a9fde12ddcn,
};

function quoteRoute(
  tokenAmount: { token: bigint; amount: bigint },
  route: PoolState[],
  cache: typeof QUOTE_NODE_CACHE[constants.StarknetChainId]
): Readonly<QuoteResult> | null {
  const isExactOutput = tokenAmount.amount < 0n;
  return route.reduce<QuoteResult | null>(
    (state, pool) => {
      if (!state) {
        return null;
      }

      const node = cache[pool.pool_key_hash].node;

      const isToken1 = node.token1 === state.tokenAmount.token;

      const sqrtRatioLimit = toSqrtRatio(
        pool.tick +
          (isPriceIncreasing(state.tokenAmount.amount, isToken1)
            ? 100 * Number(pool.tick_spacing)
            : -100 * Number(pool.tick_spacing))
      );

      state.limits.push(sqrtRatioLimit);

      const quote = node.quote({
        specifiedAmount: state.tokenAmount.amount,
        isToken1,
        sqrtRatioLimit,
      });

      // at the moment we do not support partial execution
      if (quote.consumedAmount !== state.tokenAmount.amount) {
        return null;
      }

      const nextToken = BigInt(isToken1 ? pool.token0 : pool.token1);

      return {
        limits: state.limits,
        tokenAmount: {
          amount: isExactOutput
            ? -quote.calculatedAmount
            : quote.calculatedAmount,
          token: nextToken,
        },
        resources: {
          initializedTicksCrossed:
            state.resources.initializedTicksCrossed +
            quote.executionResources.initializedTicksCrossed,
        },
      };
    },
    {
      tokenAmount,
      limits: [],
      resources: {
        initializedTicksCrossed: 0,
      },
    }
  );
}

async function updatePoolCache(
  pools: PoolState[],
  dao: Queries,
  cache: typeof QUOTE_NODE_CACHE[constants.StarknetChainId]
): Promise<void> {
  const poolsNeedUpdate = pools.filter(
    ({ pool_key_hash, block_number, transaction_index, event_index }) => {
      const cached = cache[pool_key_hash];
      return (
        !cached ||
        cached.lastUpdated.blockNumber !== block_number ||
        cached.lastUpdated.transactionIndex !== transaction_index ||
        cached.lastUpdated.eventIndex !== event_index
      );
    }
  );

  const tickData = await dao.getTickData({
    poolKeyHashes: poolsNeedUpdate.map((pk) => BigInt(pk.pool_key_hash)),
  });

  poolsNeedUpdate.forEach((pool) => {
    cache[pool.pool_key_hash] = {
      lastUpdated: {
        blockNumber: pool.block_number,
        transactionIndex: pool.transaction_index,
        eventIndex: pool.event_index,
      },
      node: new PlainPool({
        token0: BigInt(pool.token0),
        token1: BigInt(pool.token1),
        tickSpacing: Number(pool.tick_spacing),
        sqrtRatio: BigInt(pool.sqrt_ratio),
        fee: BigInt(pool.fee),
        liquidity: BigInt(pool.liquidity),
        tick: pool.tick,
        sortedTicks: tickData[pool.pool_key_hash] ?? [],
      }),
    };
  });
}

async function getAllRelevantPoolsAndUpdateCache(
  dao: Queries,
  cache: typeof QUOTE_NODE_CACHE[constants.StarknetChainId],
  { tokenA, tokenB }: { tokenA: bigint; tokenB: bigint }
) {
  return dao.withinTransaction(async () => {
    const { rows: relevantPools } = await dao.getAllRoutablePools({
      tokenA,
      tokenB,
    });

    await updatePoolCache(relevantPools, dao, cache);

    return relevantPools;
  });
}

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

router
  .get<IRequest, CF>("/tokens", async ({}, env) => {
    const tokens = DEFAULT_TOKENS_BY_CHAIN_ID[env.STARKNET_CHAIN_ID] ?? [];

    const queries = await createQueries(env);

    const { rows } = await queries.getRegisteredTokens();

    rows.forEach((row) => {
      try {
        const name = shortString.decodeShortString(row.name).trim();
        const symbol = shortString.decodeShortString(row.symbol).trim();
        const l2_token_address = num.toHex(row.address);
        if (symbol.length > 6) return;
        if (!/^[\x00-\x7F]*$/.test(name) || !/^[\x00-\x7F]*$/.test(symbol))
          return;

        if (
          // if we find any token matching name symbol etc we skip it
          !tokens.find(
            (t) =>
              BigInt(t.l2_token_address) === BigInt(l2_token_address) ||
              t.symbol.toLowerCase() === symbol.toLowerCase() ||
              t.name.toLowerCase() === name.toLowerCase()
          )
        ) {
          tokens.push({
            l2_token_address,
            name,
            symbol,
            decimals: row.decimals,
            hidden: true,
            sort_order: 2,
          });
        }
      } catch (error) {}
    });

    return json(tokens, {
      headers: {
        "cache-control":
          "public, max-age=3600, stale-while-revalidate=3600, stale-if-error=86400",
      },
    });
  })
  .get<IRequest, CF>("/tokens/:address/logo", async ({ params }, env) => {
    const token = getTokenByAddress(env.STARKNET_CHAIN_ID, params.address);
    if (!token) {
      return error(404, "Token address not found");
    }

    const logo = await env.TOKEN_LOGOS_KV?.get(token.l2_token_address);

    if (!logo) {
      return error(404, "Token logo not available");
    }

    if (logo.startsWith("https://")) {
      return new Response(null, {
        status: 302,
        headers: {
          location: logo,
          "cache-control": "public, max-age=1800, immutable",
        },
      });
    }

    return new Response(logo, {
      status: 200,
      headers: {
        "content-type": "image/svg+xml",
        "cache-control": "public, max-age=10800, immutable",
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
  // gets a full dump of the leaderboard
  .get<IRequest, CF>("/leaderboard/dump", async ({ query }, env) => {
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
  .get<IRequest, CF>("/leaderboard", async ({ query }, env) => {
    const lastMonth = query?.lastMonth === "true";

    const dao = await createQueries(env);

    const positionsContractAddress =
      POSITIONS_CONTRACT_ADDRESS[env.STARKNET_CHAIN_ID];

    const { rows } = await dao.getLeaderboard({
      positionsContractAddress,
      feeTokenAddress: feeTokenAddress(env.STARKNET_CHAIN_ID),
      collectedAfter: lastMonth
        ? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
        : undefined,
    });

    return json(
      {
        timestamp: Date.now(),
        data: rows.map((row) => ({
          collector: numericToHex(row.collector),
          points: Number(row.points),
        })),
      },
      {
        headers: {
          "cache-control":
            "public,max-age=3600,stale-while-revalidate=3600,stale-if-error=180",
        },
      }
    );
  })
  .get<IRequest, CF>(
    "/leaderboard/:collector/points",
    async ({ params, query }, env) => {
      const lastMonth = query?.lastMonth === "true";
      let collector: bigint;
      try {
        collector = BigInt(params.collector);
      } catch (e) {
        return error(400, "Invalid collector address");
      }

      const dao = await createQueries(env);

      const positionsContractAddress =
        POSITIONS_CONTRACT_ADDRESS[env.STARKNET_CHAIN_ID];

      const { rows } = await dao.getLeaderboard({
        positionsContractAddress,
        feeTokenAddress: feeTokenAddress(env.STARKNET_CHAIN_ID),
        collector,
        collectedAfter: lastMonth
          ? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
          : undefined,
      });

      return json(
        {
          points: Number(rows?.[0]?.points ?? 0),
        },
        {
          headers: {
            "cache-control":
              "public,max-age=3600,stale-while-revalidate=3600,stale-if-error=180",
          },
        }
      );
    }
  )

  .get<IRequest, CF>(
    "/quote/:amount/:token/:otherToken",
    async ({ params, query }, env) => {
      let amount: bigint, token: bigint, otherToken: bigint;
      try {
        amount = BigInt(new Decimal(params.amount).toInteger().toFixed());
        token = parseTokenIdentifier(env.STARKNET_CHAIN_ID, params.token);
        otherToken = parseTokenIdentifier(
          env.STARKNET_CHAIN_ID,
          params.otherToken
        );
      } catch (e) {
        return error(
          400,
          `Failed to parse path parameters: ${(e as Error).message}`
        );
      }

      if (token <= 0n || otherToken <= 0n) {
        return error(400, "Invalid token parameters");
      }
      const isExactOutput = amount < 0n;

      if ((isExactOutput ? amount * -1n : amount) > MAX_U128) {
        return error(400, "Amount is too large");
      }

      const dao = await createQueries(env);

      const cache = QUOTE_NODE_CACHE[env.STARKNET_CHAIN_ID];

      const relevantPools = await getAllRelevantPoolsAndUpdateCache(
        dao,
        cache,
        {
          tokenA: token,
          tokenB: otherToken,
        }
      );

      if (!relevantPools.length) {
        return error(404, "No pools connect the two tokens");
      }

      // routes are executed in reverse for exact output
      const allRoutes = findAllRoutes(token, otherToken, relevantPools, 2);

      const quotedRoutes = allRoutes.map((route) => {
        try {
          return {
            quote: quoteRoute({ amount, token }, route, cache),
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

      const bt = getTokenByAddress(env.STARKNET_CHAIN_ID, baseToken);
      const qt = getTokenByAddress(env.STARKNET_CHAIN_ID, quoteToken);

      if (!bt || !qt) {
        return error(400, "Base token or quote token not known");
      }

      const queries = await createQueries(env);

      const timestamp = Date.now();
      const threeHoursAgo = new Date(timestamp - 10_800_000);

      const ft = feeToken(env.STARKNET_CHAIN_ID);

      if (!ft) {
        return error(500, "Fee token not defined for chain");
      }

      const [direct, quoteFt, baseFt] = await queries.withinTransaction(() =>
        Promise.all([
          queries.getLastVolumeWeightedPrice({
            quoteToken,
            baseToken,
            since: threeHoursAgo,
          }),
          queries.getLastVolumeWeightedPrice({
            quoteToken,
            baseToken: BigInt(ft.l2_token_address),
            since: threeHoursAgo,
          }),
          queries.getLastVolumeWeightedPrice({
            quoteToken: BigInt(ft.l2_token_address),
            baseToken,
            since: threeHoursAgo,
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
  .get<IRequest, CF>(
    "/price/:baseToken/:quoteToken/history",
    async ({ params, query }, env) => {
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

      const bt = getTokenByAddress(env.STARKNET_CHAIN_ID, baseToken);
      const qt = getTokenByAddress(env.STARKNET_CHAIN_ID, quoteToken);

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

      const queries = await createQueries(env);

      const [token0, token1] =
        baseToken < quoteToken
          ? [baseToken, quoteToken]
          : [quoteToken, baseToken];

      // convert 1e15 eth to the threshold for token0 by multiplying 1e15 eth by the price in per eth
      const fta = feeTokenAddress(env.STARKNET_CHAIN_ID);
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

    const qt = getTokenByAddress(env.STARKNET_CHAIN_ID, quoteToken);

    if (!qt) {
      return error(400, "Quote token not known");
    }

    const queries = await createQueries(env);

    const timestamp = Date.now();
    const sixHoursAgo = new Date(timestamp - 3_600_000 * 6);

    const prices = await queries.getAllVolumeWeightedPrices({
      quoteToken,
      start: sixHoursAgo,
    });

    const scaledPrices = prices
      .map(({ price, k_volume, token }) => {
        const base = getTokenByAddress(env.STARKNET_CHAIN_ID, token);
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
  .get<IRequest, CF>(
    "/pools/:key_hash/delta_to_sqrt_ratio/:new_sqrt_ratio",
    async ({ params }, env) => {
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
    const token0 = getTokenByAddress(
      env.STARKNET_CHAIN_ID,
      positionMetadata.token0
    );
    const token1 = getTokenByAddress(
      env.STARKNET_CHAIN_ID,
      positionMetadata.token1
    );

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
  if (!response.ok) return response;
  await cache.put(request, response.clone());
  return response;
}

export default {
  fetch: (request: IRequest, env: Env, ctxt: CF) =>
    router

      .handle(request, env, ctxt)

      // transform unformed responses
      .then(json)
      .then((response) => cacheResponse(request, response))

      // catch any errors
      .catch((e) => {
        console.error(e);

        return error(e);
      })

      // add CORS headers to all requests,
      // including errors
      .then(corsify),
};
