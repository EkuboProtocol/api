import { Queries } from "../../queries";
import { QuoteNode } from "./nodes/quoteNode";
import { BasePool } from "./nodes/basePool";
import { TwammPool } from "./nodes/twammPool";

const QUOTE_NODE_CACHE: {
  [key_hash: string]: {
    lastEventId: bigint;
    lastLiquidityUpdateEventId: bigint;
    node: QuoteNode;
  };
} = {};

export function getCachedNode(key_hash: bigint) {
  return QUOTE_NODE_CACHE[key_hash.toString()]?.node;
}

export async function updateBasePoolCache(
  queries: Queries,
  poolKeyHashes: bigint[]
): Promise<void> {
  const { rows: basePoolStates } = await queries.getBasePoolStates({
    poolKeyHashes,
  });

  // only get tick data for pools not found in the kv
  const tickData = await queries.getTickData({
    poolKeyHashes: basePoolStates
      .filter(
        ({ pool_key_hash, last_liquidity_update_event_id }) =>
          QUOTE_NODE_CACHE[pool_key_hash]?.lastLiquidityUpdateEventId !==
          BigInt(last_liquidity_update_event_id ?? 0),
      )
      .map(({ pool_key_hash }) => BigInt(pool_key_hash)),
  });

  basePoolStates.forEach((pool) => {
    QUOTE_NODE_CACHE[pool.pool_key_hash] = {
      lastEventId: BigInt(pool.last_event_id),
      lastLiquidityUpdateEventId: BigInt(
        pool.last_liquidity_update_event_id ?? 0,
      ),
      node: new BasePool({
        token0: BigInt(pool.token0),
        token1: BigInt(pool.token1),
        tickSpacing: Number(pool.tick_spacing),
        sqrtRatio: BigInt(pool.sqrt_ratio),
        fee: BigInt(pool.fee),
        liquidity: BigInt(pool.liquidity),
        tick: pool.tick,
        sortedTicks:
          // if we didn't fetch the tick data for the key hash, it's because we already had it cached
          tickData[pool.pool_key_hash] ??
          QUOTE_NODE_CACHE[pool.pool_key_hash]?.node?.sortedTicks ??
          [],
      }),
    };
  });
}
export async function updateTwammPoolCache(
  queries: Queries,
  poolKeyHashes: bigint[]
): Promise<void> {
  const { rows: twammPools } = await queries.getTwammPoolStates({
    poolKeyHashes,
  });

  // only get tick data for pools not found in the kv
  const orderData = await queries.getOrderTimeData({
    poolKeyHashes,
  });

  twammPools.forEach((pool) => {
    QUOTE_NODE_CACHE[pool.pool_key_hash] = {
      lastEventId: BigInt(pool.last_event_id),
      lastLiquidityUpdateEventId: BigInt(pool.last_liquidity_update_event_id),
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
  { tokenA, tokenB }: { tokenA: bigint; tokenB: bigint }
): Promise<QuoteNode[]> {
  return queries.withinTransaction(async () => {
    const { rows: routablePools } =
      await queries.getAllRoutablePoolKeyHashesWithCacheId({
        tokenA,
        tokenB,
      });

    const { twammPools, basePools } = routablePools
      .filter(({ pool_key_hash, last_event_id, last_twamm_event_id }) => {
        const cached = QUOTE_NODE_CACHE[pool_key_hash];
        let lastUpdateId = BigInt(last_event_id);
        if (last_twamm_event_id && BigInt(last_twamm_event_id) > lastUpdateId) {
          lastUpdateId = BigInt(last_twamm_event_id);
        }
        return !cached || cached.lastEventId !== lastUpdateId;
      })
      .reduce<{
        basePools: bigint[];
        twammPools: bigint[];
      }>(
        (memo, value) => {
          if (value.last_twamm_event_id !== null) {
            memo.twammPools.push(BigInt(value.pool_key_hash));
          } else {
            memo.basePools.push(BigInt(value.pool_key_hash));
          }
          return memo;
        },
        { basePools: [], twammPools: [] }
      );

    await Promise.all([
      updateBasePoolCache(queries, basePools),
      updateTwammPoolCache(queries, twammPools),
    ]);

    return routablePools
      .map((r) => QUOTE_NODE_CACHE[r.pool_key_hash]?.node)
      .filter((n): n is QuoteNode => n?.hasLiquidity());
  });
}
