import Decimal from "decimal.js-light";
import { sqrtRate } from "./math";

Decimal.set({ precision: 100 });

export type TwammExtensionPoolState = {
  key_hash: string;
  fee: number;
  token0_sold_amount: bigint;
  token1_sold_amount: bigint;
  liquidity: bigint;
};

export async function splitTWAMMOrder(
  amount: bigint,
  startTime: Date,
  endTime: Date,
  poolStates: TwammExtensionPoolState[],
  maxSplits: number = 2,
): Promise<{ amount: string; fee: string }[]> {
  const nowSec = Math.floor(Date.now() / 1000);
  const startSec = Math.max(nowSec, Math.floor(startTime.getTime() / 1000));
  const endSec = Math.floor(endTime.getTime() / 1000);

  const timeWindow = BigInt(endSec - startSec);

  let poolStatesWithScores = poolStates
    .map((poolState) => {
      const avgToken0SoldAmount = BigInt(poolState.token0_sold_amount) / timeWindow;
      const avgToken1SoldAmount = BigInt(poolState.token1_sold_amount) / timeWindow;

      const score = sqrtRate(avgToken0SoldAmount, avgToken1SoldAmount).add(
        poolState.liquidity.toString(),
      );

      return { ...poolState, score };
    })
    .sort((a, b) => b.score.minus(a.score).toNumber())
    .slice(0, maxSplits);

  let totalScore: Decimal = poolStatesWithScores.reduce(
    (acc, curr) => acc.add(curr.score),
    new Decimal(0),
  );

  const decimalAmount: Decimal = new Decimal(amount.toString());
  let sumAmount: Decimal = new Decimal(0);

  return poolStatesWithScores.reverse().map((state, index) => {
    let weightedAmount: Decimal = new Decimal(0);

    if (index === poolStatesWithScores.length - 1) {
      weightedAmount = decimalAmount.sub(sumAmount);
    } else {
      const weightedScore = state.score.div(totalScore);
      weightedAmount = weightedScore.mul(decimalAmount);
      sumAmount = sumAmount.add(weightedAmount.toFixed(0, Decimal.ROUND_FLOOR));
    }

    return {
      amount: weightedAmount.toFixed(0, Decimal.ROUND_FLOOR).toString(),
      fee: state.fee.toString(),
    };
  });
}
