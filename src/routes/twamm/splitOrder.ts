import Decimal from "decimal.js-light";
import { TwammPool, TwammSaleRateDelta } from "../quote/nodes/twammPool";

export type TwammSaleRateDeltaMap = {
  [key_hash: string]: TwammSaleRateDelta[];
};

export async function splitTwammOrderByPriceImpact({
  amount,
  startTime,
  endTime,
  isToken1,
  maxSplits = 2,
  twammNodes,
}: {
  amount: bigint;
  startTime: Date;
  endTime: Date;
  isToken1: boolean;
  maxSplits: number;
  twammNodes: { [key_hash: string]: TwammPool };
}): Promise<{ amount: string; fee: string }[]> {
  const startTimeSeconds = Math.max(
    Math.floor(startTime.getTime() / 1000),
    Math.floor(Date.now() / 1000)
  );

  const endTimeSeconds = Math.floor(endTime.getTime() / 1000);

  const poolKeyHashes = Object.keys(twammNodes);

  let orderSaleRate =
    (amount << 32n) / BigInt(endTimeSeconds - startTimeSeconds);

  let poolsWithPriceImpact = poolKeyHashes.map((keyHash) => {
    const node = twammNodes[keyHash];

    const { stateAfter: startState } = node.quote({
      tokenAmount: {
        amount: 0n,
        token: node.key.token0,
      },
      meta: { block: { number: 0, time: startTimeSeconds } },
    });

    const { stateAfter: endStateWithoutOrder } = node.quote({
      tokenAmount: {
        amount: 0n,
        token: node.key.token0,
      },
      overrideSwapState: startState,
      meta: { block: { number: 1, time: endTimeSeconds } },
    });

    const { stateAfter: endStateWithOrder } = node.quote({
      tokenAmount: {
        amount: 0n,
        token: node.key.token0,
      },
      overrideSwapState: {
        ...startState,
        token0SaleRate: isToken1
          ? startState.token0SaleRate
          : startState.token0SaleRate + orderSaleRate,
        token1SaleRate: isToken1
          ? startState.token1SaleRate + orderSaleRate
          : startState.token1SaleRate,
      },
      meta: { block: { number: 1, time: endTimeSeconds } },
    });

    return {
      keyHash,
      impact: calculatePriceImpact(
        endStateWithoutOrder.sqrtRatio,
        endStateWithOrder.sqrtRatio
      ),
    };
  });

  poolsWithPriceImpact = poolsWithPriceImpact
    .sort((a, b) => a.impact.minus(b.impact).toNumber())
    .slice(0, maxSplits);

  let totalPriceImpact: Decimal = poolsWithPriceImpact.reduce(
    (acc, curr) => acc.add(curr.impact),
    new Decimal(0)
  );

  const decimalAmount: Decimal = new Decimal(amount.toString());
  let sumAmount: Decimal = new Decimal(0);

  return poolsWithPriceImpact.map((state, index) => {
    let weightedAmount: Decimal = new Decimal(0);

    if (index === poolsWithPriceImpact.length - 1) {
      weightedAmount = decimalAmount.sub(sumAmount);
    } else {
      const weightedScore = new Decimal(1).minus(
        state.impact.div(totalPriceImpact)
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

function calculatePriceImpact(sqrtRatioA: bigint, sqrtRatioB: bigint): Decimal {
  return new Decimal((sqrtRatioB - sqrtRatioA).toString())
    .div(sqrtRatioA.toString())
    .mul(100)
    .abs();
}
