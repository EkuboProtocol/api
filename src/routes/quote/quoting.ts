import { PoolState, Queries } from "../../queries";
import {
  BaseNodeState,
  BaseResources,
  QuoteNode,
  TokenAmount,
} from "./nodes/quoteNode";
import { PlainPool } from "./nodes/plainPool";

const QUOTE_NODE_CACHE: {
  [key_hash: string]: {
    lastEventId: bigint;
    node: QuoteNode;
  };
} = {};

export function getCachedNode(key_hash: bigint) {
  return QUOTE_NODE_CACHE[key_hash.toString()]?.node;
}

export interface QuoteRouteResult<TTotal, TState extends BaseNodeState> {
  calculatedAmount: TokenAmount;
  nodeStates: TState[];
  resources: TTotal;
}

export interface ResourcesAccumulator<TResources, TTotal> {
  initial(): TTotal;

  accumulate(memo: TTotal, value: TResources): TTotal;
}

export function quoteRoute<
  TResources extends BaseResources,
  TState extends BaseNodeState,
  TTotal,
>({
  route,
  specifiedAmount,
  accumulator,
}: {
  specifiedAmount: TokenAmount;
  route: QuoteNode<TResources, TState>[];
  accumulator: ResourcesAccumulator<TResources, TTotal>;
}): Readonly<QuoteRouteResult<TTotal, TState>> | null {
  const isExactOutput = specifiedAmount.amount < 0n;
  return route.reduce<QuoteRouteResult<TTotal, TState>>(
    (state, node) => {
      const isToken1 = node.key.token1 === state.calculatedAmount.token;

      const quote = node.quote({
        tokenAmount: state.calculatedAmount,
      });

      if (quote.consumedAmount !== state.calculatedAmount.amount) {
        // partial swaps through a route are not supported
        throw new Error("Did not consume entire amount");
      }

      state.nodeStates.push(quote.stateAfter);

      const nextToken = BigInt(isToken1 ? node.key.token0 : node.key.token1);

      return {
        calculatedAmount: {
          amount: isExactOutput
            ? -quote.calculatedAmount
            : quote.calculatedAmount,
          token: nextToken,
        },
        resources: accumulator.accumulate(
          state.resources,
          quote.executionResources,
        ),
        nodeStates: state.nodeStates,
      };
    },
    {
      calculatedAmount: specifiedAmount,
      resources: accumulator.initial(),
      nodeStates: [],
    },
  );
}

export async function updatePoolCache(
  pools: PoolState[],
  queries: Queries,
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
    }),
  );
}

export async function getAllRelevantPoolsAndUpdateCache(
  queries: Queries,
  { tokenA, tokenB }: { tokenA: bigint; tokenB: bigint },
): Promise<QuoteNode[]> {
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
