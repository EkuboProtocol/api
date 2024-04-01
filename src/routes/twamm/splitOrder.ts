import Decimal from "decimal.js-light";
import { TwammPool, TwammSaleRateDelta } from "../quote/nodes/twammPool";

export type TwammSaleRateDeltaMap = {
  [key_hash: string]: TwammSaleRateDelta[];
};

export async function splitTwammOrderByAmountSold({
  amount,
  endTime,
  isToken1,
  maxSplits = 2,
  twammNodes,
}: {
  amount: bigint;
  endTime: Date;
  isToken1: boolean;
  maxSplits: number;
  twammNodes: { [key_hash: string]: TwammPool };
}): Promise<{ amount: string; fee: string }[]> {
  const endTimeSeconds = Math.floor(endTime.getTime() / 1000);

  const poolKeyHashes = Object.keys(twammNodes);

  let poolsWithTokenAmount = poolKeyHashes.map((keyHash) => {
    const node = twammNodes[keyHash];

    const { stateAfter } = node.quote({
      tokenAmount: {
        amount: 0n,
        token: node.key.token0,
      },
      meta: { block: { number: 0, time: endTimeSeconds } },
    });

    const decimalLiquidity = new Decimal(stateAfter.liquidity.toString());
    const decimalSqrtRatio = new Decimal(stateAfter.sqrtRatio.toString()).div(
      2 ** 128
    );

    const otherTokenAmount = isToken1
      ? decimalLiquidity.mul(decimalSqrtRatio)
      : decimalLiquidity.div(decimalSqrtRatio);

    return {
      keyHash,
      otherTokenAmount: new Decimal(otherTokenAmount.toFixed(0)),
    };
  });

  poolsWithTokenAmount = poolsWithTokenAmount
    .sort((a, b) => Number(b.otherTokenAmount.minus(a.otherTokenAmount)))
    .slice(0, maxSplits)
    .filter((pool) => !pool.otherTokenAmount.eq(0));

  let totalOtherTokenAmount: Decimal = poolsWithTokenAmount.reduce(
    (acc, curr) => acc.add(new Decimal(curr.otherTokenAmount.toString())),
    new Decimal(0)
  );

  const decimalAmount: Decimal = new Decimal(amount.toString());
  let sumAmount: Decimal = new Decimal(0);

  return poolsWithTokenAmount.map((state, index) => {
    let weightedAmount: Decimal = new Decimal(0);

    if (index === poolsWithTokenAmount.length - 1) {
      weightedAmount = decimalAmount.sub(sumAmount);
    } else {
      const weightedScore = new Decimal(state.otherTokenAmount.toString()).div(
        totalOtherTokenAmount
      );
      weightedAmount = weightedScore.mul(decimalAmount);
      sumAmount = sumAmount.add(weightedAmount.toFixed(0, Decimal.ROUND_FLOOR));
    }

    return {
      amount: weightedAmount.toFixed(0, Decimal.ROUND_FLOOR).toString(),
      fee: twammNodes[state.keyHash].key.fee.toString(),
    };
  });
}
