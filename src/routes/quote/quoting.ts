import { PoolState, Queries } from "../../queries";
import {
  MAX_SQRT_RATIO,
  MAX_TICK,
  MIN_SQRT_RATIO,
  MIN_TICK,
  toSqrtRatio,
} from "./math/tick";
import { isPriceIncreasing } from "./math/swap";
import { BaseResources, QuoteNode } from "./nodes/quoteNode";
import { PlainPool, Tick } from "./nodes/plainPool";
import { KVNamespace } from "@cloudflare/workers-types";

const QUOTE_NODE_CACHE: {
  [key_hash: string]: {
    lastEventId: bigint;
    node: QuoteNode<BaseResources>;
  };
} = {};

export function getCachedNode(key_hash: bigint) {
  return QUOTE_NODE_CACHE[key_hash.toString()]?.node;
}

export interface QuoteResult<TTotal> {
  tokenAmount: {
    token: bigint;
    amount: bigint;
  };
  limits: bigint[];
  resources: TTotal;
}

export interface ResourcesAccumulator<TResources, TTotal> {
  initial(): TTotal;

  accumulate(memo: TTotal, value: TResources): TTotal;
}

export interface TokenAmount {
  token: bigint;
  amount: bigint;
}

export interface SqrtRatioLimitComputer<T = any> {
  (params: {
    node: QuoteNode<T>;
    tokenAmount: TokenAmount;
    isToken1: boolean;
  }): bigint;
}

// todo: should computing this be a method on the quote node?
export const defaultSqrtRatioLimitComputer: SqrtRatioLimitComputer = ({
  node,
  isToken1,
  tokenAmount,
}) => {
  const increasing = isPriceIncreasing(tokenAmount.amount, isToken1);

  if (node instanceof PlainPool)
    return toSqrtRatio(
      increasing
        ? Math.min(MAX_TICK, node.tick + 100 * node.key.tickSpacing)
        : Math.max(MIN_TICK, node.tick - 100 * node.key.tickSpacing)
    );

  return increasing ? MAX_SQRT_RATIO : MIN_SQRT_RATIO;
};

export const defaultAccumulator: ResourcesAccumulator<any, null> = {
  initial(): null {
    return null;
  },
  accumulate(): null {
    return null;
  },
};

export function quoteRoute<TResources, TTotal>({
  route,
  tokenAmount,
  accumulator,
  computeSqrtRatioLimit = defaultSqrtRatioLimitComputer,
}: {
  tokenAmount: TokenAmount;
  route: QuoteNode<TResources>[];
  accumulator: ResourcesAccumulator<TResources, TTotal>;
  computeSqrtRatioLimit?: SqrtRatioLimitComputer;
}): Readonly<QuoteResult<TTotal>> | null {
  const isExactOutput = tokenAmount.amount < 0n;
  return route.reduce<QuoteResult<TTotal> | null>(
    (state, node) => {
      if (!state) {
        return null;
      }

      const isToken1 = node.key.token1 === state.tokenAmount.token;

      const sqrtRatioLimit = computeSqrtRatioLimit({
        node,
        tokenAmount: state.tokenAmount,
        isToken1,
      });

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

      const nextToken = BigInt(isToken1 ? node.key.token0 : node.key.token1);

      return {
        limits: state.limits,
        tokenAmount: {
          amount: isExactOutput
            ? -quote.calculatedAmount
            : quote.calculatedAmount,
          token: nextToken,
        },
        resources: accumulator.accumulate(
          state.resources,
          quote.executionResources
        ),
      };
    },
    {
      tokenAmount,
      limits: [],
      resources: accumulator.initial(),
    }
  );
}

interface CachedTick {
  readonly liquidityDelta: string;
  readonly tick: number;
}

function cachedToTick(cachedTick: CachedTick): Tick {
  return {
    tick: cachedTick.tick,
    liquidityDelta: BigInt(cachedTick.liquidityDelta),
  };
}
function tickToCached(tick: Tick): CachedTick {
  return {
    tick: tick.tick,
    liquidityDelta: tick.liquidityDelta.toString(),
  };
}

const QUOTE_KV_CACHE_GET_OPTIONS = {
  cacheTtl: 3600,
};
const QUOTE_KV_CACHE_PUT_OPTIONS = { expirationTtl: 3600 };

export async function updatePoolCache(
  pools: PoolState[],
  queries: Queries,
  kv: KVNamespace | undefined
): Promise<void> {
  const poolsNeedUpdate = pools.filter(({ pool_key_hash, last_event_id }) => {
    const cached = QUOTE_NODE_CACHE[pool_key_hash];
    return !cached || cached.lastEventId !== BigInt(last_event_id);
  });

  const kvResults = kv
    ? await Promise.all(
        poolsNeedUpdate.map((p) =>
          kv
            .get(
              [p.pool_key_hash, p.last_event_id].join("-"),
              QUOTE_KV_CACHE_GET_OPTIONS
            )
            .then((result) => {
              if (!result) return null;
              return JSON.parse(result) as CachedTick[];
            })
        )
      )
    : Array(poolsNeedUpdate.length).fill(null);

  // only get tick data for pools not found in the kv
  const tickData = await queries.getTickData({
    poolKeyHashes: poolsNeedUpdate
      .filter((p, ix) => kvResults[ix] === null)
      .map((p) => BigInt(p.pool_key_hash)),
  });

  await Promise.all(
    poolsNeedUpdate.map(async (pool, ix) => {
      const kvTicks = kvResults[ix]?.map(cachedToTick);
      const queriedTicks = tickData[pool.pool_key_hash];
      if (kv && !kvTicks) {
        await kv.put(
          [pool.pool_key_hash, pool.last_event_id].join("-"),
          JSON.stringify(queriedTicks?.map(tickToCached) ?? []),
          QUOTE_KV_CACHE_PUT_OPTIONS
        );
      }

      QUOTE_NODE_CACHE[pool.pool_key_hash] = {
        lastEventId: BigInt(pool.last_event_id),
        node: new PlainPool({
          token0: BigInt(pool.token0),
          token1: BigInt(pool.token1),
          tickSpacing: Number(pool.tick_spacing),
          sqrtRatio: BigInt(pool.sqrt_ratio),
          fee: BigInt(pool.fee),
          liquidity: BigInt(pool.liquidity),
          tick: pool.tick,
          sortedTicks: kvTicks ?? queriedTicks ?? [],
        }),
      };
    })
  );
}

export async function getAllRelevantPoolsAndUpdateCache(
  queries: Queries,
  { tokenA, tokenB }: { tokenA: bigint; tokenB: bigint },
  kv: KVNamespace | undefined
): Promise<QuoteNode<BaseResources>[]> {
  return queries.withinTransaction(async () => {
    const { rows: relevantPools } = await queries.getAllRoutablePoolStates({
      tokenA,
      tokenB,
    });

    await updatePoolCache(relevantPools, queries, kv);

    return relevantPools.map((p) => QUOTE_NODE_CACHE[p.pool_key_hash].node);
  });
}
