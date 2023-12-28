import { PoolState, Queries } from "../../queries";
import {
  MAX_SQRT_RATIO,
  MAX_TICK,
  MIN_SQRT_RATIO,
  MIN_TICK,
  toSqrtRatio,
} from "./math/tick";
import { isPriceIncreasing } from "./math/swap";
import { BaseResources, QuoteNode, TokenAmount } from "./nodes/quoteNode";
import { PlainPool } from "./nodes/plainPool";
import { KVNamespace } from "@cloudflare/workers-types";
import { CachingSplittingQuoteNode } from "./nodes/cachingSplittingQuoteNode";

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
  tokenAmount: TokenAmount;
  limits: bigint[];
  resources: TTotal;
}

export interface ResourcesAccumulator<TResources, TTotal> {
  initial(): TTotal;

  accumulate(memo: TTotal, value: TResources): TTotal;
}

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
}: {
  tokenAmount: TokenAmount;
  route: QuoteNode<TResources>[];
  accumulator: ResourcesAccumulator<TResources, TTotal>;
}): Readonly<QuoteResult<TTotal>> | null {
  const isExactOutput = tokenAmount.amount < 0n;
  return route.reduce<QuoteResult<TTotal> | null>(
    (state, node) => {
      if (!state) {
        return null;
      }

      const isToken1 = node.key.token1 === state.tokenAmount.token;

      const sqrtRatioLimit = node.suggestedSqrtRatioLimit({
        amount: state.tokenAmount,
        isToken1,
      });

      state.limits.push(sqrtRatioLimit);

      const quote = node.quote({
        amount: state.tokenAmount,
        sqrtRatioLimit,
      });

      // if we hit the price limit, there is insufficient liquidity in the pool and we do not support partial execution
      if (quote.stateAfter.sqrtRatio === sqrtRatioLimit) {
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

export function plainPoolResourcesReducer(
  memo: BaseResources,
  value: BaseResources
): BaseResources {
  return {
    initializedTicksCrossed:
      memo.initializedTicksCrossed + value.initializedTicksCrossed,
  };
}

export async function updatePoolCache(
  pools: PoolState[],
  queries: Queries
): Promise<void> {
  const poolsNeedUpdate = pools.filter(({ pool_key_hash, last_event_id }) => {
    const cached = QUOTE_NODE_CACHE[pool_key_hash];
    return !cached || cached.lastEventId !== BigInt(last_event_id);
  });

  // only get tick data for pools not found in the kv
  const tickData = await queries.getTickData({
    poolKeyHashes: poolsNeedUpdate.map((p) => BigInt(p.pool_key_hash)),
  });

  await Promise.all(
    poolsNeedUpdate.map(async (pool, ix) => {
      QUOTE_NODE_CACHE[pool.pool_key_hash] = {
        lastEventId: BigInt(pool.last_event_id),
        node: new CachingSplittingQuoteNode(
          new PlainPool({
            token0: BigInt(pool.token0),
            token1: BigInt(pool.token1),
            tickSpacing: Number(pool.tick_spacing),
            sqrtRatio: BigInt(pool.sqrt_ratio),
            fee: BigInt(pool.fee),
            liquidity: BigInt(pool.liquidity),
            tick: pool.tick,
            sortedTicks: tickData[pool.pool_key_hash] ?? [],
          }),
          {
            resourcesReducer: plainPoolResourcesReducer,
            maxSplits: 16,
          }
        ),
      };
    })
  );
}

export async function getAllRelevantPoolsAndUpdateCache(
  queries: Queries,
  { tokenA, tokenB }: { tokenA: bigint; tokenB: bigint }
): Promise<QuoteNode<BaseResources>[]> {
  return queries.withinTransaction(async () => {
    const { rows: relevantPools } = await queries.getAllRoutablePoolStates({
      tokenA,
      tokenB,
    });

    await updatePoolCache(relevantPools, queries);

    return relevantPools
      .map((p) => QUOTE_NODE_CACHE[p.pool_key_hash].node)
      .filter((n) => n.hasLiquidity());
  });
}
