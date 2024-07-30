import Decimal from "decimal.js-light";
import { TwammPool, TwammSaleRateDelta } from "../quote/nodes/twammPool";

export type TwammSaleRateDeltaMap = {
  [key_hash: string]: TwammSaleRateDelta[];
};

export interface TwammOrderSplit {
  node: TwammPool;
  amount: bigint;
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
  realStartTime,
  averageBlockTime,
}: {
  amount: bigint;
  startTime: number;
  endTime: number;
  isToken1: boolean;
  pools: TwammPool[];
  maxSplits: number;
  realStartTime: number;
  averageBlockTime: number;
}): TwammOrderSplit[] {
  if (pools.length === 0) {
    throw new Error("No pools");
  }

  const numPieces = Math.pow(2, maxSplits);
  const smallestSplitAmount = amount / BigInt(numPieces);
  const duration = BigInt(endTime - realStartTime);
  // test the quote after a single block
  const quoteTime = Math.min(realStartTime + averageBlockTime, endTime);

  const topPools = pools
    .map((node) => {
      const { calculatedAmount } = node.quote({
        tokenAmount: {
          amount: smallestSplitAmount,
          token: isToken1 ? node.key.token1 : node.key.token0,
        },
        meta: { block: { number: 0, time: quoteTime } },
      });

      return {
        node,
        calculatedAmount,
      };
    })
    .sort(({ calculatedAmount: quoteA }, { calculatedAmount: quoteB }) =>
      Number(quoteB - quoteA),
    )
    .slice(0, numPieces)
    .map(({ node }) => node);

  const additionalSaleRate = new WeakMap<TwammPool, bigint>();
  const splits: { node: TwammPool; amount: bigint }[] = [];

  for (let i = 0; i < numPieces; i++) {
    const partialAmount =
      i === numPieces - 1
        ? smallestSplitAmount + (amount % BigInt(numPieces))
        : smallestSplitAmount;

    const bestPool = topPools.reduce<{
      node: TwammPool;
      calculatedAmount: bigint;
    } | null>((memo, node) => {
      const extraSaleRate = additionalSaleRate.get(node) ?? 0n;

      const { stateAfter: startingState } = node.quote({
        tokenAmount: {
          amount: 0n,
          token: node.key.token0,
        },
        meta: { block: { number: 0, time: realStartTime } },
      });

      const { calculatedAmount } = node.quote({
        tokenAmount: {
          amount: (partialAmount * BigInt(averageBlockTime)) / duration,
          token: isToken1 ? node.key.token1 : node.key.token0,
        },
        meta: { block: { number: 0, time: quoteTime } },
        overrideState: {
          ...startingState,
          ...(isToken1
            ? {
                token1SaleRate: extraSaleRate + startingState.token1SaleRate,
              }
            : {
                token0SaleRate: extraSaleRate + startingState.token0SaleRate,
              }),
        },
      });

      if (memo === null || memo.calculatedAmount < calculatedAmount) {
        return {
          node,
          calculatedAmount,
        };
      }

      return memo;
    }, null);

    if (!bestPool) {
      throw new Error("No pool found");
    }

    const node = bestPool.node;

    const saleRate = (partialAmount << 32n) / duration;

    additionalSaleRate.set(
      node,
      (additionalSaleRate.get(node) ?? 0n) + saleRate,
    );

    const existing = splits.find((s) => s.node === node);
    if (existing) {
      existing.amount += partialAmount;
    } else {
      splits.push({
        amount: partialAmount,
        node,
      });
    }
  }

  return splits.map(({ node, amount }) => ({
    node: node,
    amount: amount,
    endTime: endTime,
    startTime: startTime,
  }));
}

/**
 * Computes the per-block price impact of the trade based on the average block time at the start time for the list of orders
 * @param orders the list of orders for which to compute aggregate price impact
 * @param isToken1 whether the token being sold is token0 or token1
 * @param averageBlockTime the average time per block in seconds
 * @param realStartTime the real start time of the order, since orders can start in the past
 */
export function getPriceImpact({
  orders,
  isToken1,
  averageBlockTime,
  realStartTime,
}: {
  orders: TwammOrderSplit[];
  isToken1: boolean;
  averageBlockTime: number;
  realStartTime: number;
}) {
  const { totalPerBlockAmount, priceOutput, quoteOutput } = orders.reduce<{
    totalPerBlockAmount: bigint;
    priceOutput: bigint;
    quoteOutput: bigint;
  }>(
    (memo, { node, amount, endTime }) => {
      const { stateAfter } = node.quote({
        tokenAmount: {
          // does not matter which one we quote, this is just to catch the pool up
          token: node.key.token0,
          amount: 0n,
        },
        meta: { block: { number: 0, time: realStartTime } },
      });

      // this is a 128.256 number
      const ratioAfter = stateAfter.sqrtRatio * stateAfter.sqrtRatio;

      const perBlockAmount =
        (amount * BigInt(averageBlockTime)) / BigInt(endTime - realStartTime);

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
        meta: { block: { number: 0, time: realStartTime } },
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
