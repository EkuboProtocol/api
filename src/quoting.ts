import { PoolState, Queries } from "./queries";
import { constants } from "starknet";
import { MAX_SQRT_RATIO, MIN_SQRT_RATIO, toSqrtRatio } from "./math/tick";
import { isPriceIncreasing } from "./math/swap";
import { QuoteNode } from "./nodes/quoteNode";
import { PlainPool } from "./nodes/plainPool";

export const QUOTE_NODE_CACHE: {
  [chainId in constants.StarknetChainId]: {
    [key_hash: string]: {
      lastEventId: bigint;
      node: QuoteNode<{ initializedTicksCrossed: number }>;
    };
  };
} = {
  ["0x534e5f474f45524c49"]: {},
  ["0x534e5f4d41494e"]: {},
};

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

export const defaultSqrtRatioLimitComputer: SqrtRatioLimitComputer = ({
  node,
  isToken1,
  tokenAmount,
}) => {
  const increasing = isPriceIncreasing(tokenAmount.amount, isToken1);

  if (node instanceof PlainPool)
    return toSqrtRatio(
      node.tick +
        (increasing
          ? 100 * Number(node.tickSpacing)
          : -100 * Number(node.tickSpacing))
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

      const isToken1 = node.token1 === state.tokenAmount.token;

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

      const nextToken = BigInt(isToken1 ? node.token0 : node.token1);

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

export async function updatePoolCache(
  pools: PoolState[],
  dao: Queries,
  cache: typeof QUOTE_NODE_CACHE[constants.StarknetChainId]
): Promise<void> {
  const poolsNeedUpdate = pools.filter(({ pool_key_hash, last_event_id }) => {
    const cached = cache[pool_key_hash];
    return !cached || cached.lastEventId !== BigInt(last_event_id);
  });

  const tickData = await dao.getTickData({
    poolKeyHashes: poolsNeedUpdate.map((pk) => BigInt(pk.pool_key_hash)),
  });

  poolsNeedUpdate.forEach((pool) => {
    cache[pool.pool_key_hash] = {
      lastEventId: BigInt(pool.last_event_id),
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

export async function getAllRelevantPoolsAndUpdateCache(
  dao: Queries,
  cache: typeof QUOTE_NODE_CACHE[constants.StarknetChainId],
  { tokenA, tokenB }: { tokenA: bigint; tokenB: bigint }
): Promise<QuoteNode<{ initializedTicksCrossed: number }>[]> {
  return dao.withinTransaction(async () => {
    const { rows: relevantPools } = await dao.getAllRoutablePools({
      tokenA,
      tokenB,
    });

    await updatePoolCache(relevantPools, dao, cache);

    return relevantPools.map((p) => cache[p.pool_key_hash].node);
  });
}
