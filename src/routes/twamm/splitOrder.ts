import Decimal from "decimal.js-light";
import {
  TwammPool,
  TwammPoolState,
  TwammResources,
  TwammSaleRateDelta,
} from "../quote/nodes/twammPool";
import { computeFee } from "../quote/math/swap";

export type TwammSaleRateDeltaMap = {
  [key_hash: string]: TwammSaleRateDelta[];
};

export type TwammOrderSplitResult = {
  node: TwammPool;
  amount: bigint;
  otherTokenAmount: bigint;
};

export function splitTwammOrder(
  amount: bigint,
  startTime: number,
  endTime: number,
  isToken1: boolean,
  pools: TwammPool[],
  maxSplits: number
): TwammOrderSplitResult[] {
  const smallestSplitAmount = amount / 2n ** BigInt(maxSplits);
  const timeWindow = BigInt(endTime - startTime);
  const numPieces = Math.pow(2, maxSplits);

  // find top pools
  const topPools = pools
    .map((node) => {
      const amountMinusFee =
        smallestSplitAmount - computeFee(smallestSplitAmount, node.key.fee);

      const orderSaleRate = (amountMinusFee << 32n) / timeWindow;

      const { executionResources, stateAfter } = node.quote({
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
        {
          resources: executionResources,
          state: stateAfter,
        },
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

      const { executionResources, stateAfter } = node.quote({
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
          resources: executionResources,
          state: {
            ...stateAfter,
            token0SaleRate: isToken1
              ? stateAfter.token0SaleRate
              : stateAfter.token0SaleRate + saleRateOverride,
            token1SaleRate: isToken1
              ? stateAfter.token1SaleRate + saleRateOverride
              : stateAfter.token1SaleRate,
          },
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

  const results = topPools
    .map((node) => {
      const nodeAmount = nodeWithAmounts.get(node);

      return {
        node,
        amount: nodeAmount?.amount ?? 0n,
        otherTokenAmount: nodeAmount?.otherTokenAmount ?? 0n,
      };
    })
    .filter((pool) => pool.amount !== 0n && pool.otherTokenAmount > 0n);

  return results;
}

function quoteOtherTokenAmount(
  node: TwammPool,
  endTime: number,
  isToken1: boolean,
  overrides: {
    resources: TwammResources;
    state: TwammPoolState;
  },
  orderSaleRate: bigint
): Decimal {
  const otherTokenAmountWithoutOrder = getOtherTokenAmount(
    node,
    endTime,
    isToken1,
    overrides
  );

  const otherTokenAmountWithOrder = getOtherTokenAmount(
    node,
    endTime,
    isToken1,
    {
      resources: overrides.resources,
      state: {
        ...overrides.state,
        token0SaleRate: isToken1
          ? overrides.state.token0SaleRate
          : overrides.state.token0SaleRate + orderSaleRate,
        token1SaleRate: isToken1
          ? overrides.state.token1SaleRate + orderSaleRate
          : overrides.state.token1SaleRate,
      },
    }
  );

  // adding token1 results in less of token0 in the AMM at the end of execution and vice versa
  return otherTokenAmountWithoutOrder.minus(otherTokenAmountWithOrder);
}

function getOtherTokenAmount(
  node: TwammPool,
  endTime: number,
  isToken1: boolean,
  overrides: { resources: TwammResources; state: TwammPoolState }
): Decimal {
  const { stateAfter } = node.quote({
    tokenAmount: {
      amount: 0n,
      token: node.key.token0,
    },
    overrides,
    meta: { block: { number: 1, time: endTime } },
  });

  const liquidity = new Decimal(stateAfter.liquidity.toString());
  const sqrtRatio = new Decimal(stateAfter.sqrtRatio.toString()).div(2 ** 128);

  return isToken1 ? liquidity.div(sqrtRatio) : liquidity.mul(sqrtRatio);
}
