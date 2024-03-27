import {
  BasePoolStateQueryResult,
  Queries,
  TwammPoolStateQueryResult,
} from "../../queries";
import { QuoteNode } from "./nodes/quoteNode";
import { BasePool } from "./nodes/basePool";
import { TwammPool } from "./nodes/twammPool";

const QUOTE_NODE_CACHE: {
  [key_hash: string]: {
    lastEventId: bigint;
    node: QuoteNode;
  };
} = {};

export function getCachedNode(key_hash: bigint) {
  return QUOTE_NODE_CACHE[key_hash.toString()]?.node;
}

export async function updateBasePoolCache(
  pools: BasePoolStateQueryResult[],
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
export async function updateTwammPoolCache(
  pools: TwammPoolStateQueryResult[],
  queries: Queries,
): Promise<void> {
  const poolsNeedUpdate = pools.filter(({ pool_key_hash, last_event_id }) => {
    const cached = QUOTE_NODE_CACHE[pool_key_hash];
    return !cached || cached.lastEventId !== BigInt(last_event_id);
  });

  // only get tick data for pools not found in the kv
  const orderData = await queries.getOrderTimeData({
    poolKeyHashes: poolsNeedUpdate.map((p) => BigInt(p.pool_key_hash)),
  });

  poolsNeedUpdate.forEach((pool) => {
    QUOTE_NODE_CACHE[pool.pool_key_hash] = {
      lastEventId: BigInt(pool.last_event_id),
      node: new TwammPool({
        token0: BigInt(pool.token0),
        token1: BigInt(pool.token1),
        sqrtRatio: BigInt(pool.sqrt_ratio),
        fee: BigInt(pool.fee),
        liquidity: BigInt(pool.liquidity),
        tick: pool.tick,
        extension: BigInt(pool.extension),
        lastExecutionTime: pool.last_execution_time.getTime() / 1000,
        saleRateDeltas: orderData[pool.pool_key_hash] ?? [],
        token0SaleRate: BigInt(pool.token0_sale_rate),
        token1SaleRate: BigInt(pool.token1_sale_rate),
      }),
    };
  });
}

export async function getAllRelevantPoolsAndUpdateCache(
  queries: Queries,
  { tokenA, tokenB }: { tokenA: bigint; tokenB: bigint },
): Promise<QuoteNode[]> {
  return queries.withinTransaction(async () => {
    const [{ rows: basePools }, { rows: twammPools }] = await Promise.all([
      queries.getAllRoutablePoolStates({
        tokenA,
        tokenB,
      }),
      queries.getAllRoutableTwammPoolStates({
        tokenA,
        tokenB,
      }),
    ]);

    await Promise.all([
      updateBasePoolCache(basePools, queries),
      updateTwammPoolCache(twammPools, queries),
    ]);

    return basePools
      .map((p) => QUOTE_NODE_CACHE[p.pool_key_hash].node)
      .concat(twammPools.map((p) => QUOTE_NODE_CACHE[p.pool_key_hash].node))
      .filter((n) => n.hasLiquidity());
  });
}
