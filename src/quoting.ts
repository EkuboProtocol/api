import { PoolState, Queries } from "./queries";
import { constants } from "starknet";
import { toSqrtRatio } from "./math/tick";
import { isPriceIncreasing } from "./math/swap";
import { QuoteNode } from "./nodes/quoteNode";
import { PlainPool } from "./nodes/plainPool";

interface LastUpdatedKey {
  lastEventId: PoolState["last_event_id"];
}

export const QUOTE_NODE_CACHE: {
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

export interface QuoteResult {
  tokenAmount: {
    token: bigint;
    amount: bigint;
  };
  limits: bigint[];
  resources: { initializedTicksCrossed: number };
}

export function quoteRoute(
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

export async function updatePoolCache(
  pools: PoolState[],
  dao: Queries,
  cache: typeof QUOTE_NODE_CACHE[constants.StarknetChainId]
): Promise<void> {
  const poolsNeedUpdate = pools.filter(({ pool_key_hash, last_event_id }) => {
    const cached = cache[pool_key_hash];
    return !cached || cached.lastUpdated.lastEventId !== last_event_id;
  });

  const tickData = await dao.getTickData({
    poolKeyHashes: poolsNeedUpdate.map((pk) => BigInt(pk.pool_key_hash)),
  });

  poolsNeedUpdate.forEach((pool) => {
    cache[pool.pool_key_hash] = {
      lastUpdated: {
        lastEventId: pool.last_event_id,
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

export async function getAllRelevantPoolsAndUpdateCache(
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
