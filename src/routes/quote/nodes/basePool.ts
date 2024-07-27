import { computeStep, isPriceIncreasing } from "../math/swap";
import {
  approximateNumberOfTickSpacingsCrossed,
  MAX_SQRT_RATIO,
  MIN_SQRT_RATIO,
  toSqrtRatio,
} from "../math/tick";
import {
  BasePoolResources,
  BasePoolState,
  NodeKey,
  Quote,
  QuoteNode,
  QuoteParams,
  Tick,
} from "./quoteNode";

/**
 * Returns the index in the sorted tick array that has the greatest value of tick that is not greater than the given tick
 * @param sortedTicks the sorted list of ticks to search in
 * @param tick the tick to search for
 */
export function findNearestInitializedTickIndex(
  sortedTicks: Tick[],
  tick: number,
): number {
  let l = 0,
    r = sortedTicks.length;

  while (l < r) {
    const mid = Math.floor((l + r) / 2);
    const midTick = sortedTicks[mid].tick;
    if (midTick <= tick) {
      // if it's the last index, or the next tick is greater, we've found our index
      if (mid === sortedTicks.length - 1 || sortedTicks[mid + 1].tick > tick) {
        return mid;
      } else {
        // otherwise our value is to the right of this one
        l = mid;
      }
    } else {
      // the mid tick is greater than the one we want, so we know it's not mid
      r = mid;
    }
  }

  return -1;
}

export class BasePool implements QuoteNode {
  public readonly key: NodeKey;

  // state
  public readonly state: Readonly<BasePoolState>;
  public readonly sortedTicks: Tick[];

  constructor({
    token0,
    token1,
    tickSpacing,
    fee,
    sqrtRatio,
    liquidity,
    tick,
    sortedTicks,
  }: {
    token0: bigint;
    token1: bigint;
    tickSpacing: number;
    fee: bigint;
    sqrtRatio: bigint;
    liquidity: bigint;
    tick: number;
    sortedTicks: Tick[];
  }) {
    this.key = {
      token0,
      token1,
      fee,
      tickSpacing,
      extension: 0n,
    };
    this.sortedTicks = sortedTicks;
    this.state = {
      sqrtRatio,
      liquidity,
      activeTickIndex: findNearestInitializedTickIndex(sortedTicks, tick),
    };
  }

  combineResources(
    resource: BasePoolResources,
    additionalResources: BasePoolResources,
  ): BasePoolResources {
    return {
      initializedTicksCrossed:
        resource.initializedTicksCrossed +
        additionalResources.initializedTicksCrossed,
      tickSpacingsCrossed:
        resource.tickSpacingsCrossed + additionalResources.tickSpacingsCrossed,
    };
  }

  initialResources(): BasePoolResources {
    return {
      initializedTicksCrossed: 0,
      tickSpacingsCrossed: 0,
    };
  }

  public quote({
    tokenAmount: { amount, token },
    sqrtRatioLimit,
    overrideState,
  }: QuoteParams<BasePoolState>): Quote<BasePoolResources, BasePoolState> {
    const isToken1 = token === this.key.token1;

    if (!isToken1 && this.key.token0 !== token) {
      throw new Error("Invalid token");
    }

    const state = overrideState ?? this.state;
    const resources = this.initialResources();

    if (amount === 0n) {
      return {
        isPriceIncreasing: isToken1,
        consumedAmount: 0n,
        calculatedAmount: 0n,
        executionResources: resources,
        stateAfter: state,
        feesPaid: 0n,
      };
    }

    const isIncreasing = isPriceIncreasing(amount, isToken1);

    let { sqrtRatio, liquidity, activeTickIndex } = state;

    if (sqrtRatioLimit) {
      // validate sqrtRatioLimit
      if (isIncreasing && sqrtRatioLimit < sqrtRatio) {
        throw new Error("sqrtRatioLimit cannot be less than sqrtRatio");
      }
      if (!isIncreasing && sqrtRatioLimit > sqrtRatio) {
        throw new Error("sqrtRatioLimit cannot be greater than sqrtRatio");
      }
      if (sqrtRatioLimit < MIN_SQRT_RATIO) {
        throw new Error("sqrtRatioLimit lt min");
      }
      if (sqrtRatioLimit > MAX_SQRT_RATIO) {
        throw new Error("sqrtRatioLimit gt max");
      }
    } else {
      sqrtRatioLimit = isIncreasing ? MAX_SQRT_RATIO : MIN_SQRT_RATIO;
    }

    // the index of the sorted ticks array of the tick that is <= current tick
    let calculatedAmount = 0n;
    let feesPaid = 0n;
    let initializedTicksCrossed = resources.initializedTicksCrossed;
    let amountRemaining = amount;

    // this is used to compute the approximate number of tick spacings crossed by the swap
    const startingSqrtRatio = sqrtRatio;

    while (amountRemaining !== 0n && sqrtRatio !== sqrtRatioLimit) {
      const nextInitializedTick: Tick | null =
        (isIncreasing
          ? this.sortedTicks[activeTickIndex + 1]
          : this.sortedTicks[activeTickIndex]) ?? null;

      const nextInitializedTickSqrtRatio = nextInitializedTick
        ? toSqrtRatio(nextInitializedTick.tick)
        : null;

      const stepSqrtRatioLimit =
        nextInitializedTickSqrtRatio === null
          ? sqrtRatioLimit
          : nextInitializedTickSqrtRatio < sqrtRatioLimit === isIncreasing
            ? nextInitializedTickSqrtRatio
            : sqrtRatioLimit;

      const step = computeStep({
        fee: this.key.fee,
        sqrtRatio,
        liquidity,
        isToken1,
        sqrtRatioLimit: stepSqrtRatioLimit,
        amount: amountRemaining,
      });

      amountRemaining -= step.consumedAmount;
      calculatedAmount += step.calculatedAmount;
      feesPaid += step.feeAmount;
      sqrtRatio = step.sqrtRatioNext;

      // cross the tick if the price moved all the way to the next initialized tick price
      if (nextInitializedTick && sqrtRatio === nextInitializedTickSqrtRatio) {
        activeTickIndex = isIncreasing
          ? activeTickIndex + 1
          : activeTickIndex - 1;
        initializedTicksCrossed++;
        liquidity += isIncreasing
          ? nextInitializedTick.liquidityDelta
          : -nextInitializedTick.liquidityDelta;
      }
    }

    return {
      isPriceIncreasing: isIncreasing,
      consumedAmount: amount - amountRemaining,
      calculatedAmount,
      feesPaid,
      executionResources: {
        initializedTicksCrossed,
        tickSpacingsCrossed:
          resources.tickSpacingsCrossed +
          approximateNumberOfTickSpacingsCrossed(
            startingSqrtRatio,
            sqrtRatio,
            this.key.tickSpacing,
          ),
      },
      stateAfter: {
        sqrtRatio,
        liquidity,
        activeTickIndex,
      },
    };
  }

  public hasLiquidity(): boolean {
    return this.state.liquidity > 0n || this.sortedTicks.length > 0;
  }
}
