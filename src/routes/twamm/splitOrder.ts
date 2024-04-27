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

type TwammOrderSplit = {
  node: TwammPool;
  amount: bigint;
  otherTokenAmount: bigint;
  startTime: number;
  endTime: number;
};

export type TwammOrderSplitResult = {
  orders: TwammOrderSplit[];
  priceImpact: number;
};

export function splitTwammOrder(
  amount: bigint,
  startTime: number,
  endTime: number,
  isToken1: boolean,
  pools: TwammPool[],
  maxSplits: number,
  averageBlockTime: bigint
): TwammOrderSplitResult {
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

      const otherTokenAmount = quoteOtherTokenAmount(
        node,
        endTime,
        isToken1,
        stateAfter,
        orderSaleRate
      );

      return {
        node,
        otherTokenAmount,
      };
    })
    .sort(
      (
        { otherTokenAmount: otherTokenAmountA },
        { otherTokenAmount: otherTokenAmountB }
      ) => otherTokenAmountB.minus(otherTokenAmountA).toNumber()
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

      const otherTokenAmount = quoteOtherTokenAmount(
        node,
        endTime,
        isToken1,
        {
          ...stateAfter,
          token0SaleRate: isToken1
            ? stateAfter.token0SaleRate
            : stateAfter.token0SaleRate + saleRateOverride,
          token1SaleRate: isToken1
            ? stateAfter.token1SaleRate + saleRateOverride
            : stateAfter.token1SaleRate,
        },
        partialOrderSaleRate
      );

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

  const orders = topPools
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

  if (orders.length == 0) {
    throw new Error("Invalid order split");
  }

  const priceImpact = getPriceImpact(orders, isToken1, averageBlockTime);

  return { orders, priceImpact };
}

function getPriceImpact(
  orders: TwammOrderSplit[],
  isToken1: boolean,
  averageBlockTime: bigint
) {
  const { input, output, executionOutput } = orders.reduce<{
    input: number;
    output: number;
    executionOutput: number;
  }>(
    (memo, { node, amount, startTime, endTime }) => {
      // first catch up the twamm orders to get current price
      const { stateAfter } = node.quote({
        tokenAmount: {
          token: node.key.token1,
          amount: 0n,
        },
        meta: { block: { number: 0, time: startTime } },
      });

      const perBlockAmount =
        (amount * averageBlockTime) / BigInt(endTime - startTime);

      // output amount with no fees and infinite liquidity
      const poolCurrentPrice = isToken1
        ? 1 / (Number(stateAfter.sqrtRatio) / 2 ** 128) ** 2
        : (Number(stateAfter.sqrtRatio) / 2 ** 128) ** 2;
      const output = Number(perBlockAmount) * poolCurrentPrice;

      const { calculatedAmount: executionOutput } = node.quote({
        tokenAmount: {
          token: isToken1 ? node.key.token1 : node.key.token0,
          amount: perBlockAmount,
        },
        overrideState: stateAfter,
        meta: { block: { number: 0, time: startTime } },
      });

      return {
        input: memo.input + Number(perBlockAmount),
        output: memo.output + output,
        executionOutput: memo.executionOutput + Number(executionOutput),
      };
    },
    { input: 0, executionOutput: 0, output: 0 }
  );

  const currentPrice = output / input;
  const executionPrice = executionOutput / input;
  const priceImpact = Math.abs((executionPrice - currentPrice) / currentPrice);
  return priceImpact;
}

function quoteOtherTokenAmount(
  node: TwammPool,
  endTime: number,
  isToken1: boolean,
  overrideState: TwammPoolState,
  orderSaleRate: bigint
): Decimal {
  const otherTokenAmountWithoutOrder = getOtherTokenAmount(
    node,
    endTime,
    isToken1,
    overrideState
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
    }
  );

  // adding token1 results in less of token0 in the AMM at the end of execution and vice versa
  return otherTokenAmountWithoutOrder.minus(otherTokenAmountWithOrder);
}

function getOtherTokenAmount(
  node: TwammPool,
  endTime: number,
  isToken1: boolean,
  overrideState: TwammPoolState
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
