import { PoolState, Queries } from "../../queries";
import { QuoteNode } from "./nodes/quoteNode";
import { BasePool } from "./nodes/basePool";

const QUOTE_NODE_CACHE: {
  [key_hash: string]: {
    lastEventId: bigint;
    node: QuoteNode;
  };
} = {};

export function getCachedNode(key_hash: bigint) {
  return QUOTE_NODE_CACHE[key_hash.toString()]?.node;
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

  poolsNeedUpdate.forEach((pool) => {
    QUOTE_NODE_CACHE[pool.pool_key_hash] = {
      lastEventId: BigInt(pool.last_event_id),
      node: new BasePool({
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
