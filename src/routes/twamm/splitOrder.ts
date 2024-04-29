import Decimal from "decimal.js-light";
import {
  TwammPool,
  TwammPoolState,
  TwammSaleRateDelta,
} from "../quote/nodes/twammPool";
import { computeFee } from "../quote/math/swap";

export type TwammSaleRateDeltaMap = {
  [key_hash: string]: TwammSaleRateDelta[];
};

export interface TwammOrderSplit {
  node: TwammPool;
  amount: bigint;
  otherTokenAmount: bigint;
  startTime: number;
  endTime: number;
}

export function splitTwammOrder({
  amount,
  startTime,
  endTime,
  isToken1,
  pools,
  maxSplits,
}: {
  amount: bigint;
  startTime: number;
  endTime: number;
  isToken1: boolean;
  pools: TwammPool[];
  maxSplits: number;
}): TwammOrderSplit[] {
  if (pools.length === 0) {
    throw new Error("No pools");
  }
  const smallestSplitAmount = amount / 2n ** BigInt(maxSplits);
  const timeWindow = BigInt(endTime - startTime);
  const numPieces = Math.pow(2, maxSplits);

  // find top pools
  const topPools = pools
    .map((node) => {
      const amountMinusFee =
        smallestSplitAmount - computeFee(smallestSplitAmount, node.key.fee);

      const orderSaleRate = (amountMinusFee << 32n) / timeWindow;

      const { stateAfter } = node.quote({
        tokenAmount: {
          amount: 0n,
          token: node.key.token0,
        },
        meta: { block: { number: 0, time: startTime } },
      });

      const otherTokenAmount = quoteOtherTokenAmount({
        node,
        endTime,
        isToken1,
        overrideState: stateAfter,
        orderSaleRate,
      });

      return {
        node,
        otherTokenAmount,
      };
    })
    .sort(
      (
        { otherTokenAmount: otherTokenAmountA },
        { otherTokenAmount: otherTokenAmountB },
      ) => otherTokenAmountB.minus(otherTokenAmountA).toNumber(),
    )
    .slice(0, numPieces)
    .map(({ node }) => node);

  const saleRateOverrides = new WeakMap<TwammPool, bigint>();
  const nodeWithAmounts = new WeakMap<
    TwammPool,
    {
      amount: bigint;
      otherTokenAmount: bigint;
    }
  >();

  for (let i = 0; i < numPieces; i++) {
    const partialAmount =
      i === numPieces - 1
        ? smallestSplitAmount + (amount % BigInt(numPieces))
        : smallestSplitAmount;

    const bestPool = topPools.reduce<{
      node: TwammPool;
      otherTokenAmount: Decimal;
      saleRate: bigint;
    } | null>((memo, node) => {
      const amountMinusFee =
        partialAmount - computeFee(partialAmount, node.key.fee);

      const partialOrderSaleRate = (amountMinusFee << 32n) / timeWindow;

      const { stateAfter } = node.quote({
        tokenAmount: {
          amount: 0n,
          token: node.key.token0,
        },
        meta: { block: { number: 0, time: startTime } },
      });

      // if pool has been already used, add previous sale rate
      const saleRateOverride = saleRateOverrides.get(node) ?? 0n;

      const otherTokenAmount = quoteOtherTokenAmount({
        node,
        endTime,
        isToken1,
        overrideState: {
          ...stateAfter,
          token0SaleRate: isToken1
            ? stateAfter.token0SaleRate
            : stateAfter.token0SaleRate + saleRateOverride,
          token1SaleRate: isToken1
            ? stateAfter.token1SaleRate + saleRateOverride
            : stateAfter.token1SaleRate,
        },
        orderSaleRate: partialOrderSaleRate,
      });

      if (!memo || memo.otherTokenAmount.lessThan(otherTokenAmount)) {
        return {
          node,
          otherTokenAmount,
          saleRate: saleRateOverride + partialOrderSaleRate,
        };
      }

      return memo;
    }, null);

    const node = bestPool?.node;

    if (node) {
      saleRateOverrides.set(node, bestPool.saleRate);

      const { amount, otherTokenAmount } = nodeWithAmounts.get(node) ?? {
        amount: 0n,
        otherTokenAmount: 0n,
      };

      nodeWithAmounts.set(node, {
        amount: amount + partialAmount,
        otherTokenAmount:
          otherTokenAmount + BigInt(bestPool.otherTokenAmount.toFixed(0)),
      });
    }
  }

  return topPools
    .map((node) => {
      const { amount, otherTokenAmount } = nodeWithAmounts.get(node) ?? {
        amount: 0n,
        otherTokenAmount: 0n,
      };

      return {
        node,
        amount,
        otherTokenAmount,
        startTime,
        endTime,
      };
    })
    .filter((pool) => pool.amount !== 0n && pool.otherTokenAmount > 0n);
}

export function getPriceImpact(
  orders: TwammOrderSplit[],
  isToken1: boolean,
  averageBlockTime: number,
) {
  const { totalPerBlockAmount, priceOutput, quoteOutput } = orders.reduce<{
    totalPerBlockAmount: bigint;
    priceOutput: bigint;
    quoteOutput: bigint;
  }>(
    (memo, { node, amount, startTime, endTime }) => {
      const { stateAfter } = node.quote({
        tokenAmount: {
          // does not matter which one we quote, this is just to catch the pool up
          token: node.key.token0,
          amount: 0n,
        },
        meta: { block: { number: 0, time: startTime } },
      });

      // this is a 128.256 number
      const ratioAfter = stateAfter.sqrtRatio * stateAfter.sqrtRatio;

      const perBlockAmount =
        (amount * BigInt(averageBlockTime)) / BigInt(endTime - startTime);

      const inverseFee = (1n << 128n) - node.key.fee;

      const priceOutput = isToken1
        ? ((perBlockAmount << 256n) * inverseFee) / (ratioAfter << 128n)
        : (perBlockAmount * ratioAfter * inverseFee) >> 384n;

      const { calculatedAmount: quoteOutput } = node.quote({
        tokenAmount: {
          token: isToken1 ? node.key.token1 : node.key.token0,
          amount: perBlockAmount,
        },
        overrideState: stateAfter,
        meta: { block: { number: 0, time: startTime } },
      });

      return {
        totalPerBlockAmount: memo.totalPerBlockAmount + perBlockAmount,
        priceOutput: memo.priceOutput + priceOutput,
        quoteOutput: memo.quoteOutput + quoteOutput,
      };
    },
    { totalPerBlockAmount: 0n, quoteOutput: 0n, priceOutput: 0n },
  );

  const currentPrice = new Decimal(priceOutput.toString()).div(
    totalPerBlockAmount.toString(),
  );
  const executionPrice = new Decimal(quoteOutput.toString()).div(
    totalPerBlockAmount.toString(),
  );

  return executionPrice
    .ln()
    .sub(currentPrice.ln())
    .abs()
    .exp()
    .sub(1)
    .toNumber();
}

function quoteOtherTokenAmount({
  node,
  endTime,
  isToken1,
  overrideState,
  orderSaleRate,
}: {
  node: TwammPool;
  endTime: number;
  isToken1: boolean;
  overrideState: TwammPoolState;
  orderSaleRate: bigint;
}): Decimal {
  const otherTokenAmountWithoutOrder = getOtherTokenAmount(
    node,
    endTime,
    isToken1,
    overrideState,
  );

  const otherTokenAmountWithOrder = getOtherTokenAmount(
    node,
    endTime,
    isToken1,
    {
      ...overrideState,
      token0SaleRate: isToken1
        ? overrideState.token0SaleRate
        : overrideState.token0SaleRate + orderSaleRate,
      token1SaleRate: isToken1
        ? overrideState.token1SaleRate + orderSaleRate
        : overrideState.token1SaleRate,
    },
  );

  // adding token1 results in less of token0 in the AMM at the end of execution and vice versa
  return otherTokenAmountWithoutOrder.minus(otherTokenAmountWithOrder);
}

function getOtherTokenAmount(
  node: TwammPool,
  endTime: number,
  isToken1: boolean,
  overrideState: TwammPoolState,
): Decimal {
  const { stateAfter } = node.quote({
    tokenAmount: {
      amount: 0n,
      token: node.key.token0,
    },
    overrideState,
    meta: { block: { number: 1, time: endTime } },
  });

  const liquidity = new Decimal(stateAfter.liquidity.toString());
  const sqrtRatio = new Decimal(stateAfter.sqrtRatio.toString()).div(2 ** 128);

  return isToken1 ? liquidity.div(sqrtRatio) : liquidity.mul(sqrtRatio);
}
