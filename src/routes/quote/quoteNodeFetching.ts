import { Queries } from "../../queries";
import { QuoteNode } from "./nodes/quoteNode";
import { BasePool } from "./nodes/basePool";
import { TwammPool } from "./nodes/twammPool";

export async function getRelevantPools(
  queries: Queries,
  { tokenA, tokenB }: { tokenA: bigint; tokenB: bigint },
): Promise<(TwammPool | BasePool)[]> {
  const { rows: poolData } = await queries.getAllRoutablePools({
    tokenA,
    tokenB,
  });

  return poolData
    .map<QuoteNode>(
      ({
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
      }) => {
        const e = BigInt(extension);
        if (e === 0n) {
          return new BasePool({
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
        } else if (
          last_virtual_execution_time !== null &&
          token0_sale_rate !== null &&
          token1_sale_rate !== null
        ) {
          return new TwammPool({
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
          });
        } else {
          throw new Error("UNRECOGNIZED POOL TYPE");
        }
      },
    )
    .filter((p) => p.hasLiquidity());
}
