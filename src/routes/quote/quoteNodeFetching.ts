import { Queries } from "../../queries";
import { BasePool, OraclePool, TwammPool } from "@ekubo/sdk";

const allPoolsWithLiquidityByKeyHash: {
  [key_hash: string]: BasePool | TwammPool | OraclePool;
} = {};
let lastEventId: bigint = 0n;

export async function getAllPoolsWithLiquidity(
  queries: Queries,
): Promise<(TwammPool | BasePool)[]> {
  const { rows: poolData } = await queries.getAllRoutablePools({ lastEventId });

  poolData.forEach(
    ({
      key_hash,
      token0,
      token1,
      fee,
      tick_spacing,
      extension,
      token1_sale_rate,
      token0_sale_rate,
      tick,
      orders,
      ticks,
      liquidity,
      sqrt_ratio,
      last_virtual_execution_time,
      last_event_id,
      last_twamm_event_id,
      last_oracle_snapshot_block_timestamp,
    }) => {
      const e = BigInt(extension);

      if (e === 0n) {
        allPoolsWithLiquidityByKeyHash[key_hash] = new BasePool({
          token0: BigInt(token0),
          token1: BigInt(token1),
          fee: BigInt(fee),
          tickSpacing: tick_spacing,
          tick,
          sortedTicks:
            // assumed to be sorted already
            ticks?.map((t) => ({
              tick: t.t,
              liquidityDelta: BigInt(t.l),
            })) ?? [],
          sqrtRatio: BigInt(sqrt_ratio),
          liquidity: BigInt(liquidity),
        });
        if (BigInt(last_event_id) > lastEventId) {
          lastEventId = BigInt(last_event_id);
        }
      } else if (
        last_virtual_execution_time !== null &&
        token0_sale_rate !== null &&
        token1_sale_rate !== null
      ) {
        allPoolsWithLiquidityByKeyHash[key_hash] = new TwammPool({
          token0: BigInt(token0),
          token1: BigInt(token1),
          fee: BigInt(fee),
          liquidity: BigInt(liquidity),
          tick: tick,
          lastExecutionTime: Number(last_virtual_execution_time) / 1_000,
          extension: e,
          token0SaleRate: BigInt(token0_sale_rate),
          token1SaleRate: BigInt(token1_sale_rate),
          sqrtRatio: BigInt(sqrt_ratio),
          saleRateDeltas:
            // assumed to be sorted already
            orders?.map((o) => ({
              time: Number(new Date(o.t).getTime() / 1000),
              saleRateDelta0: BigInt(o.s0),
              saleRateDelta1: BigInt(o.s1),
            })) ?? [],
          sortedTicks:
            // assumed to be sorted already
            ticks?.map((t) => ({
              tick: t.t,
              liquidityDelta: BigInt(t.l),
            })) ?? [],
        });
        if (BigInt(last_twamm_event_id) > lastEventId) {
          lastEventId = BigInt(last_twamm_event_id);
        }
      } else if (last_oracle_snapshot_block_timestamp !== null) {
        allPoolsWithLiquidityByKeyHash[key_hash] = new OraclePool({
          token0: BigInt(token0),
          token1: BigInt(token1),
          liquidity: BigInt(liquidity),
          tick: tick,
          lastSnapshotTime: BigInt(last_oracle_snapshot_block_timestamp),
          extension: e,
          sqrtRatio: BigInt(sqrt_ratio),
          sortedTicks:
            // assumed to be sorted already
            ticks?.map((t) => ({
              tick: t.t,
              liquidityDelta: BigInt(t.l),
            })) ?? [],
        });
        if (BigInt(last_event_id) > lastEventId) {
          lastEventId = BigInt(last_event_id);
        }
      } else {
        throw new Error("UNRECOGNIZED POOL TYPE");
      }
    },
  );

  return Object.values(allPoolsWithLiquidityByKeyHash).filter((p) =>
    p.hasLiquidity(),
  );
}
